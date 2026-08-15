"""Flatten this package's skills into a valid Claude Code plugin.

`docs/specs/software-factory.md` §6.3: the factory invokes this generator against
a pinned package revision, into an immutable run-scoped directory, then validates
strictly and caches per revision.

Why flattening is required rather than cosmetic — verified against Claude Code
2.1.229: the plugin loader registers `skills/<name>/SKILL.md` **only at depth 1**.
A skill left at `skills/<bucket>/<name>/SKILL.md` is silently absent from the
component inventory — no warning, no error, just a smaller `Skills (N)` count.
That is precisely the failure the factory's preflight exists to catch, and this
generator exists to prevent.

Usage:
    python -m scripts.build_claude_plugin --out <dir> [--source skills]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from scripts.validate_refs import iter_skill_dirs

REPO_ROOT = Path(__file__).resolve().parents[1]

# The manifest name the factory's prompt templates invoke as `/oh-my-slop:<skill>`.
# Changing it silently breaks every worker prompt, so it is a constant, not an option.
PLUGIN_NAME = "oh-my-slop"


class BuildError(RuntimeError):
    """A fail-closed build refusal. Never a warning — the caller pins on this."""


def load_root_manifest(repo_root: Path) -> dict:
    return json.loads((repo_root / "package.json").read_text(encoding="utf-8"))


def build_manifest(root_manifest: dict) -> dict:
    """The plugin manifest, derived from the root package manifest.

    `author` is required rather than defaulted: `claude plugin validate --strict`
    warns when it is absent and `--strict` turns that warning into exit 1. A
    default here would move the failure from this script — where it names the
    missing key — to the factory's preflight, where it reads as an opaque
    validation failure.
    """
    for key in ("version", "description", "author"):
        if not root_manifest.get(key):
            raise BuildError(
                f"package.json is missing '{key}', which the plugin manifest requires"
                f" (claude plugin validate --strict rejects a manifest without it)"
            )

    return {
        "name": PLUGIN_NAME,
        "description": root_manifest["description"],
        "version": root_manifest["version"],
        "author": normalize_author(root_manifest["author"]),
    }


def normalize_author(author: str | dict) -> dict:
    """npm allows `"author": "Name <email>"`; Claude's schema requires an object.

    Verified against Claude Code 2.1.229: a string author fails validation with
    `author: Invalid input: expected object, received string`. The translation
    lives here so `package.json` stays idiomatic npm rather than being bent to
    a second consumer's schema.
    """
    if isinstance(author, dict):
        return author
    if not isinstance(author, str):
        raise BuildError(f"package.json 'author' must be a string or object, got {type(author).__name__}")

    name, _, remainder = author.partition("<")
    normalized = {"name": name.strip()}
    email = remainder.partition(">")[0].strip()
    if email:
        normalized["email"] = email
    return normalized


def plan_skill_layout(skill_dirs: list[Path]) -> dict[str, Path]:
    """Map flattened skill name → source directory, refusing collisions.

    Two buckets holding the same skill name would flatten onto one directory and
    the second would silently win. The package forbids it (a skill lives in
    exactly one bucket), so this is a corruption check, not a policy.
    """
    layout: dict[str, Path] = {}
    for skill_dir in sorted(skill_dirs, key=lambda path: path.name):
        existing = layout.get(skill_dir.name)
        if existing is not None:
            raise BuildError(
                f"skill name collision on flattening: '{skill_dir.name}' exists in both"
                f" {existing.parent.name}/ and {skill_dir.parent.name}/"
            )
        layout[skill_dir.name] = skill_dir
    return layout


def build_plugin(source: Path, out: Path, repo_root: Path = REPO_ROOT) -> dict[str, Path]:
    """Write the plugin tree. Returns the flattened layout that was written."""
    if not source.is_dir():
        raise BuildError(f"source skills root does not exist: {source}")

    if out.exists() and any(out.iterdir()):
        raise BuildError(
            f"output directory is not empty: {out} — the factory builds into an"
            f" immutable run-scoped directory, so an existing tree is never reused"
        )

    skill_dirs = iter_skill_dirs(source)
    if not skill_dirs:
        raise BuildError(f"no skills found under {source}")

    layout = plan_skill_layout(skill_dirs)
    manifest = build_manifest(load_root_manifest(repo_root))

    (out / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (out / ".claude-plugin" / "plugin.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    skills_out = out / "skills"
    skills_out.mkdir(parents=True, exist_ok=True)
    for name, skill_dir in sorted(layout.items()):
        # Copy the whole directory so references/, scripts/, and assets/ stay
        # beside their SKILL.md — a skill whose reference files were dropped
        # loads, then fails at the first link it follows.
        shutil.copytree(skill_dir, skills_out / name)

    return layout


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="plugin output directory")
    parser.add_argument(
        "--source",
        type=Path,
        default=REPO_ROOT / "skills",
        help="skills root to flatten (default: this package's skills/)",
    )
    args = parser.parse_args(argv)

    try:
        layout = build_plugin(args.source, args.out)
    except BuildError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(f"{PLUGIN_NAME}: {len(layout)} skills → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
