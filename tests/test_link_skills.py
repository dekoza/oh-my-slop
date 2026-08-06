"""`scripts/link-skills.sh` bridges a taxonomy the repo keeps and a harness that
cannot see it.

pi recurses to find `SKILL.md`, so bucketed directories cost it nothing. Claude
Code scans exactly one level of `~/.claude/skills`, so a bucket linked in whole
resolves cleanly and hides every skill inside it — the failure is silent, which
is why it needs a script and why the script needs tests.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from scripts.validate_refs import iter_skill_dirs


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "link-skills.sh"
SKILLS_DIR = REPO_ROOT / "skills"


def run_linker(target: Path, *flags: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT_PATH), *flags, str(target)],
        capture_output=True,
        text=True,
        check=False,
    )


def linked_names(target: Path) -> set[str]:
    return {path.name for path in target.iterdir() if path.is_symlink()}


def test_every_bundled_skill_is_linked_at_one_level(tmp_path: Path) -> None:
    target = tmp_path / "skills"

    result = run_linker(target)

    assert result.returncode == 0, result.stderr
    expected = {skill_dir.name for skill_dir in iter_skill_dirs(SKILLS_DIR)}
    assert linked_names(target) == expected

    for name in expected:
        assert (target / name / "SKILL.md").exists(), f"{name} does not resolve to a SKILL.md"


def test_linking_is_idempotent(tmp_path: Path) -> None:
    target = tmp_path / "skills"

    run_linker(target)
    first = linked_names(target)
    second_result = run_linker(target)

    assert second_result.returncode == 0, second_result.stderr
    assert linked_names(target) == first


def test_dry_run_changes_nothing(tmp_path: Path) -> None:
    target = tmp_path / "skills"

    result = run_linker(target, "--dry-run")

    assert result.returncode == 0, result.stderr
    assert "would: ln -sfn" in result.stdout
    assert not target.exists()


def test_a_whole_bucket_linked_in_is_removed(tmp_path: Path) -> None:
    """The mistake the script exists to undo: it resolves, so nothing errors,
    and every skill underneath it silently disappears."""
    target = tmp_path / "skills"
    target.mkdir()
    (target / "workflow").symlink_to(SKILLS_DIR / "workflow")

    result = run_linker(target)

    assert result.returncode == 0, result.stderr
    assert "unlinked bucket: workflow" in result.stdout
    assert "workflow" not in linked_names(target)
    assert "wayfinder" in linked_names(target)


def test_prune_drops_stale_links_into_this_repo_only(tmp_path: Path) -> None:
    target = tmp_path / "skills"
    target.mkdir()
    (target / "retired-skill").symlink_to(SKILLS_DIR / "workflow" / "retired-skill")
    foreign = tmp_path / "elsewhere" / "vanished"
    (target / "foreign").symlink_to(foreign)

    result = run_linker(target, "--prune")

    assert result.returncode == 0, result.stderr
    assert "pruned stale link: retired-skill" in result.stdout
    assert "retired-skill" not in linked_names(target)
    assert (target / "foreign").is_symlink(), "a link outside this repo is not ours to prune"


def test_stale_links_survive_without_prune(tmp_path: Path) -> None:
    target = tmp_path / "skills"
    target.mkdir()
    (target / "retired-skill").symlink_to(SKILLS_DIR / "workflow" / "retired-skill")

    result = run_linker(target)

    assert result.returncode == 0, result.stderr
    assert (target / "retired-skill").is_symlink()
