"""Tests for the Claude plugin generator (`docs/specs/software-factory.md` §6.3).

The unit tests pin the generator's contract. The two live tests at the bottom
run the real `claude` binary, because the whole reason this generator exists is
a loader behaviour no unit test can observe: Claude Code registers
`skills/<name>/SKILL.md` at depth 1 only, and drops a bucketed skill **without
any error**. A green unit suite over a silently-empty plugin is exactly the
"passed installation and discovery while behaviourally dead" failure the
factory's handshake exists to catch.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from scripts.build_claude_plugin import (
    PLUGIN_NAME,
    BuildError,
    build_manifest,
    build_plugin,
    normalize_author,
    plan_skill_layout,
)
from scripts.validate_refs import iter_skill_dirs

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "skills"

CLAUDE = shutil.which("claude")
requires_claude = pytest.mark.skipif(CLAUDE is None, reason="claude CLI not installed")

ANSI = re.compile(r"\x1B\[[0-9;]*[mK]")


def write_skill(root: Path, bucket: str, name: str) -> Path:
    skill_dir = root / bucket / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Probe skill {name}.\n---\n\nBody.\n",
        encoding="utf-8",
    )
    return skill_dir


def test_flattens_every_skill_to_depth_one(tmp_path: Path) -> None:
    out = tmp_path / "plugin"
    layout = build_plugin(SKILLS_DIR, out)

    assert len(layout) == len(iter_skill_dirs(SKILLS_DIR))

    for name in layout:
        assert (out / "skills" / name / "SKILL.md").is_file()

    # Nothing may remain bucketed: a directory under skills/ that holds no
    # SKILL.md of its own is a bucket that survived flattening.
    for child in (out / "skills").iterdir():
        assert (child / "SKILL.md").is_file(), (
            f"{child.name} is not a skill directory — the bucket layer survived"
        )


def test_reference_and_asset_directories_ride_along(tmp_path: Path) -> None:
    """A skill whose references were dropped loads, then fails at its first link."""
    out = tmp_path / "plugin"
    build_plugin(SKILLS_DIR, out)

    source = SKILLS_DIR / "practice" / "construction-craft" / "references"
    copied = out / "skills" / "construction-craft" / "references"

    assert source.is_dir(), "fixture assumption: construction-craft ships references/"
    assert sorted(path.name for path in copied.iterdir()) == sorted(
        path.name for path in source.iterdir()
    )


def test_manifest_carries_the_pinned_name_and_strict_required_fields() -> None:
    manifest = build_manifest(
        {"version": "1.2.3", "description": "d", "author": "Ada Lovelace"}
    )

    assert manifest["name"] == PLUGIN_NAME
    assert manifest == {
        "name": PLUGIN_NAME,
        "description": "d",
        "version": "1.2.3",
        "author": {"name": "Ada Lovelace"},
    }


@pytest.mark.parametrize(
    ("author", "expected"),
    [
        ("Ada Lovelace", {"name": "Ada Lovelace"}),
        ("Ada Lovelace <ada@example.com>", {"name": "Ada Lovelace", "email": "ada@example.com"}),
        ({"name": "Ada", "url": "https://example.com"}, {"name": "Ada", "url": "https://example.com"}),
    ],
)
def test_author_is_normalized_to_claudes_object_schema(author, expected) -> None:
    """npm allows a string; Claude Code 2.1.229 rejects one with
    `author: Invalid input: expected object, received string`."""
    assert normalize_author(author) == expected


@pytest.mark.parametrize("missing", ["version", "description", "author"])
def test_manifest_refuses_a_missing_strict_field(missing: str) -> None:
    root = {"version": "1.2.3", "description": "d", "author": "a"}
    del root[missing]

    with pytest.raises(BuildError, match=missing):
        build_manifest(root)


def test_the_real_package_manifest_satisfies_the_generator() -> None:
    """package.json must keep the fields --strict needs, or the factory's
    preflight fails on a repo change nothing else notices."""
    root = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))

    assert build_manifest(root)["name"] == PLUGIN_NAME


def test_refuses_a_cross_bucket_name_collision(tmp_path: Path) -> None:
    source = tmp_path / "skills"
    write_skill(source, "practice", "twin")
    write_skill(source, "workflow", "twin")

    with pytest.raises(BuildError, match="collision"):
        plan_skill_layout(iter_skill_dirs(source))


def test_refuses_a_non_empty_output_directory(tmp_path: Path) -> None:
    out = tmp_path / "plugin"
    out.mkdir()
    (out / "leftover").write_text("x", encoding="utf-8")

    with pytest.raises(BuildError, match="not empty"):
        build_plugin(SKILLS_DIR, out)


def test_refuses_an_empty_source(tmp_path: Path) -> None:
    source = tmp_path / "skills"
    source.mkdir()

    with pytest.raises(BuildError, match="no skills found"):
        build_plugin(source, tmp_path / "plugin")


@requires_claude
def test_generated_plugin_passes_strict_validation(tmp_path: Path) -> None:
    out = tmp_path / "plugin"
    build_plugin(SKILLS_DIR, out)

    result = subprocess.run(
        [CLAUDE, "plugin", "validate", str(out), "--strict"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, ANSI.sub("", result.stdout + result.stderr)


@requires_claude
def test_claude_registers_every_flattened_skill(tmp_path: Path) -> None:
    """The test the unit suite structurally cannot replace.

    `plugin details` reports the component inventory from the same loader a
    session uses. If flattening regressed, the Skills count silently drops
    rather than erroring — so the count is asserted against the source of truth.
    """
    out = tmp_path / "plugin"
    layout = build_plugin(SKILLS_DIR, out)

    result = subprocess.run(
        [CLAUDE, "--plugin-dir", str(out), "plugin", "details", PLUGIN_NAME],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, ANSI.sub("", result.stdout + result.stderr)

    inventory = ANSI.sub("", result.stdout)
    match = re.search(r"Skills \((\d+)\)", inventory)
    assert match, f"no Skills count in plugin details output:\n{inventory}"
    assert int(match.group(1)) == len(layout), (
        f"claude registered {match.group(1)} skills but the plugin ships"
        f" {len(layout)} — a bucketed skill is being dropped silently"
    )
