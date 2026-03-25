from __future__ import annotations

import subprocess
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "validate_refs.py"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", "python", str(SCRIPT_PATH)],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )


def test_valid_repo_passes(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True)
    _ = (refs_dir / "bar.md").write_text("# Bar\n", encoding="utf-8")
    _ = (skill_dir / "SKILL.md").write_text(
        "See [bar](references/bar.md)\n", encoding="utf-8"
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0
    assert result.stdout == ""


def test_broken_link_detected(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    skill_dir.mkdir(parents=True)
    _ = (skill_dir / "SKILL.md").write_text(
        "Broken [ref](references/missing.md)\n", encoding="utf-8"
    )

    result = run_validator(tmp_path)

    assert result.returncode == 1
    assert "skills/foo/SKILL.md:1:references/missing.md" in result.stdout


def test_relative_path_resolution(tmp_path: Path) -> None:
    source_dir = tmp_path / "skills" / "dir1"
    target_dir = tmp_path / "skills" / "dir2"
    source_dir.mkdir(parents=True)
    target_dir.mkdir(parents=True)
    _ = (target_dir / "file.md").write_text("# Target\n", encoding="utf-8")
    _ = (source_dir / "SKILL.md").write_text(
        "See [target](../dir2/file.md)\n", encoding="utf-8"
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0


def test_http_links_skipped(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    skill_dir.mkdir(parents=True)
    _ = (skill_dir / "SKILL.md").write_text(
        "See [docs](https://example.com/docs) and [mirror](http://example.com/docs)\n",
        encoding="utf-8",
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0


def test_anchor_links_skipped(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True)
    _ = (refs_dir / "real.md").write_text("# Real\n", encoding="utf-8")
    _ = (skill_dir / "SKILL.md").write_text(
        "[anchor](#section)\n[ok](references/real.md)\n",
        encoding="utf-8",
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0


def test_yaml_frontmatter_ignored(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True)
    _ = (refs_dir / "present.md").write_text("# Present\n", encoding="utf-8")
    frontmatter_content = (
        "---\n"
        "name: test\n"
        'note: "[fake](references/does-not-exist.md)"\n'
        "globs:\n"
        '  - "*.md"\n'
        "---\n"
        "`references/present.md`\n"
    )
    _ = (skill_dir / "SKILL.md").write_text(
        frontmatter_content,
        encoding="utf-8",
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0


def test_references_path_from_nested_reference_file(tmp_path: Path) -> None:
    refs_dir = tmp_path / "skills" / "foo" / "references"
    refs_dir.mkdir(parents=True)
    _ = (refs_dir / "target.md").write_text("# Target\n", encoding="utf-8")
    _ = (refs_dir / "REFERENCE.md").write_text(
        "See `references/target.md`\n", encoding="utf-8"
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0


def test_glob_like_reference_patterns_are_ignored(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True)
    _ = (refs_dir / "real.md").write_text("# Real\n", encoding="utf-8")
    _ = (skill_dir / "SKILL.md").write_text(
        "Use `references/*.md` as a narrative pattern\n"
        "and still validate `references/real.md`.\n",
        encoding="utf-8",
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0


def test_workspace_markdown_is_ignored(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "foo"
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True)
    _ = (refs_dir / "real.md").write_text("# Real\n", encoding="utf-8")
    _ = (skill_dir / "SKILL.md").write_text(
        "See `references/real.md`\n", encoding="utf-8"
    )

    workspace_output = (
        tmp_path
        / "skills"
        / "foo-workspace"
        / "iteration-1"
        / "eval-1"
        / "with_skill"
        / "run-1"
        / "outputs"
        / "response.md"
    )
    workspace_output.parent.mkdir(parents=True)
    _ = workspace_output.write_text(
        "Narrative output mentioning `references/not-a-real-file.md`\n",
        encoding="utf-8",
    )

    result = run_validator(tmp_path)

    assert result.returncode == 0
