from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON_PATH = REPO_ROOT / "package.json"
EXTENSION_IMPORT_PATTERN = re.compile(
    r"(?:import|export)\s+(?:[^\n;]*?\s+from\s+)?[\"'](?P<path>\.[^\"']+)[\"']"
)


def load_package_manifest(path: Path = PACKAGE_JSON_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def iter_manifest_extension_entrypoints(manifest_path: Path) -> list[Path]:
    manifest = load_package_manifest(manifest_path)
    package_root = manifest_path.parent
    entrypoints: list[Path] = []

    for entry in manifest.get("pi", {}).get("extensions", []):
        resolved_entry = package_root / entry.removeprefix("./")

        if resolved_entry.is_file():
            entrypoints.append(resolved_entry)
            continue

        if resolved_entry.is_dir():
            nested_manifest_path = resolved_entry / "package.json"
            if nested_manifest_path.exists():
                nested_manifest = json.loads(nested_manifest_path.read_text(encoding="utf-8"))
                nested_entries = nested_manifest.get("pi", {}).get("extensions", [])
                for nested_entry in nested_entries:
                    nested_resolved = resolved_entry / nested_entry.removeprefix("./")
                    if not nested_resolved.exists():
                        raise AssertionError(
                            f"Package manifest entry {entry!r} in {manifest_path.relative_to(REPO_ROOT)} "
                            f"declares a missing nested extension {nested_entry!r}"
                        )
                    entrypoints.append(nested_resolved)
                if nested_entries:
                    continue

            for candidate_name in ("index.ts", "index.js"):
                candidate = resolved_entry / candidate_name
                if candidate.exists():
                    entrypoints.append(candidate)
                    break
            else:
                raise AssertionError(
                    f"Package manifest entry {entry!r} in {manifest_path.relative_to(REPO_ROOT)} "
                    "does not expose an extension entrypoint"
                )
            continue

        raise AssertionError(
            f"Package manifest entry {entry!r} in {manifest_path.relative_to(REPO_ROOT)} "
            "does not resolve to a file or directory"
        )

    return entrypoints


def iter_nested_extension_manifest_paths() -> list[Path]:
    return sorted(REPO_ROOT.glob("extensions/*/package.json"))


def resolve_relative_import(source_file: Path, import_path: str) -> Path | None:
    raw_target = source_file.parent / import_path

    if raw_target.suffix:
        suffix_candidates = [raw_target]
        if raw_target.suffix == ".js":
            suffix_candidates.extend(raw_target.with_suffix(suffix) for suffix in [".ts", ".mjs"])
        elif raw_target.suffix == ".mjs":
            suffix_candidates.extend(raw_target.with_suffix(suffix) for suffix in [".ts", ".js"])
    else:
        suffix_candidates = [
            raw_target.with_suffix(".ts"),
            raw_target.with_suffix(".js"),
            raw_target.with_suffix(".mjs"),
            raw_target / "index.ts",
            raw_target / "index.js",
            raw_target / "index.mjs",
        ]

    for candidate in suffix_candidates:
        if candidate.exists():
            return candidate
    return None


def walk_local_import_graph(entrypoint: Path) -> set[Path]:
    discovered: set[Path] = set()
    pending = [entrypoint]

    while pending:
        current = pending.pop()
        if current in discovered:
            continue

        discovered.add(current)
        for match in EXTENSION_IMPORT_PATTERN.finditer(current.read_text(encoding="utf-8")):
            import_path = match.group("path")
            resolved = resolve_relative_import(current, import_path)
            if resolved is None:
                raise AssertionError(
                    f"Unresolvable relative import {import_path!r} in {current.relative_to(REPO_ROOT)}"
                )
            pending.append(resolved)

    return discovered


def test_root_package_manifest_exposes_skills_and_workflow_watchdog_extension() -> None:
    manifest = load_package_manifest()

    assert manifest["keywords"]
    assert "pi-package" in manifest["keywords"]
    assert manifest["pi"]["skills"] == ["./skills"]
    assert manifest["pi"]["prompts"] == ["./prompts"]
    assert manifest["pi"]["extensions"] == ["./extensions/workflow-watchdog"]
    assert manifest["peerDependencies"]["@earendil-works/pi-coding-agent"] == "*"


def test_nested_extension_packages_expose_all_extension_entrypoints() -> None:
    manifest_paths = iter_nested_extension_manifest_paths()

    assert manifest_paths

    declared_entrypoints = {
        path.relative_to(REPO_ROOT)
        for manifest_path in manifest_paths
        for path in iter_manifest_extension_entrypoints(manifest_path)
    }
    actual_entrypoints = {
        path.relative_to(REPO_ROOT) for path in REPO_ROOT.glob("extensions/*/index.ts")
    }

    assert declared_entrypoints == actual_entrypoints


def test_extension_entrypoints_only_use_resolvable_relative_imports() -> None:
    entrypoints = [
        entrypoint
        for manifest_path in iter_nested_extension_manifest_paths()
        for entrypoint in iter_manifest_extension_entrypoints(manifest_path)
    ]

    assert entrypoints

    discovered_files = set()
    for entrypoint in entrypoints:
        discovered_files.update(walk_local_import_graph(entrypoint))

    assert discovered_files
