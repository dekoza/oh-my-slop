from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON_PATH = REPO_ROOT / "package.json"
EXTENSION_IMPORT_PATTERN = re.compile(
    r"(?:import|export)\s+(?:[^\n;]*?\s+from\s+)?[\"'](?P<path>\.[^\"']+)[\"']"
)


def load_package_manifest() -> dict:
    return json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))


def iter_package_extension_entrypoints() -> list[Path]:
    manifest = load_package_manifest()
    patterns = manifest["pi"]["extensions"]
    entrypoints: list[Path] = []
    for pattern in patterns:
        entrypoints.extend(sorted(REPO_ROOT.glob(pattern.removeprefix("./"))))
    return entrypoints


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


def test_root_package_manifest_exposes_skills_and_nested_extensions() -> None:
    manifest = load_package_manifest()

    assert manifest["keywords"]
    assert "pi-package" in manifest["keywords"]
    assert manifest["pi"]["skills"] == ["./skills"]

    declared_entrypoints = {
        path.relative_to(REPO_ROOT) for path in iter_package_extension_entrypoints()
    }
    actual_entrypoints = {
        path.relative_to(REPO_ROOT) for path in REPO_ROOT.glob("extensions/*/index.ts")
    }

    assert declared_entrypoints == actual_entrypoints


def test_extension_entrypoints_only_use_resolvable_relative_imports() -> None:
    entrypoints = iter_package_extension_entrypoints()

    assert entrypoints

    discovered_files = set()
    for entrypoint in entrypoints:
        discovered_files.update(walk_local_import_graph(entrypoint))

    assert discovered_files
