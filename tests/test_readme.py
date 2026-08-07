from __future__ import annotations

from pathlib import Path

from scripts.validate_refs import iter_skill_dirs


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_BUCKETS = ("reference", "practice", "workflow", "meta")
README_PATH = REPO_ROOT / "README.md"
JOB_PIPELINE_README_PATH = REPO_ROOT / "extensions" / "job-pipeline" / "README.md"
SKILLS_DIR = REPO_ROOT / "skills"
EXTENSIONS_DIR = REPO_ROOT / "extensions"
PROMPTS_DIR = REPO_ROOT / "prompts"


def load_readme() -> str:
    return README_PATH.read_text(encoding="utf-8")


def load_job_pipeline_readme() -> str:
    return JOB_PIPELINE_README_PATH.read_text(encoding="utf-8")


def iter_extension_names() -> list[str]:
    return sorted(
        path.name
        for path in EXTENSIONS_DIR.iterdir()
        if path.is_dir() and (path / "index.ts").exists()
    )


def test_readme_uses_github_details_for_extension_and_skill_catalogs() -> None:
    readme_text = load_readme()

    assert "<summary><strong>Extensions" in readme_text
    assert "<summary><strong>Skills" in readme_text


def test_readme_install_example_matches_the_repo_slug() -> None:
    readme_text = load_readme()

    assert "pi install git:github.com/dekoza/oh-my-slop" in readme_text


def test_readme_install_section_describes_extension_loading() -> None:
    readme_text = load_readme()

    assert "get the bundled skills without auto-enabling the extensions" in readme_text or "workflow-watchdog" in readme_text
    assert "remain opt-in" in readme_text


def test_readme_lists_every_bundled_extension() -> None:
    readme_text = load_readme()

    for extension_name in iter_extension_names():
        assert extension_name in readme_text


def iter_skill_paths() -> list[str]:
    return [
        skill_dir.relative_to(REPO_ROOT).as_posix()
        for skill_dir in iter_skill_dirs(SKILLS_DIR)
    ]


def readme_bucket_section(readme_text: str, bucket: str) -> str:
    section = readme_text.split(f"#### {bucket.capitalize()}", maxsplit=1)[1]
    section = section.split("\n#### ", maxsplit=1)[0]
    return section.split("\n## ", maxsplit=1)[0]


def test_readme_links_every_bundled_skill() -> None:
    readme_text = load_readme()

    for skill_path in iter_skill_paths():
        assert f"{skill_path}/SKILL.md" in readme_text


def test_readme_lists_each_skill_under_its_own_bucket_heading() -> None:
    """The bucket a skill lives in is the filesystem's fact; the README table is
    a second copy of it. Without this the two drift the first time a skill is
    added or re-filed without touching the table."""
    readme_text = load_readme()

    for bucket in SKILL_BUCKETS:
        section = readme_bucket_section(readme_text, bucket)
        expected = {
            path for path in iter_skill_paths() if path.startswith(f"skills/{bucket}/")
        }

        assert expected, f"no skills found on disk for bucket {bucket!r}"

        for skill_path in expected:
            assert f"{skill_path}/SKILL.md" in section, (
                f"{skill_path} is missing from the README's {bucket} section"
            )

        for other in set(iter_skill_paths()) - expected:
            assert f"{other}/SKILL.md" not in section, (
                f"{other} is listed under the wrong README bucket ({bucket})"
            )


def test_readme_lists_every_bundled_prompt_template() -> None:
    readme_text = load_readme()

    for template_file in sorted(PROMPTS_DIR.iterdir()):
        if not template_file.is_file() or template_file.suffix != ".md":
            continue
        command = f"/{template_file.stem}"
        assert command in readme_text, f"README missing prompt template {command}"


def test_job_pipeline_readme_says_root_package_install_stays_opt_in() -> None:
    readme_text = load_job_pipeline_readme()

    assert "includes it automatically" not in readme_text
    assert "stays opt-in" in readme_text


def test_readme_explains_critical_partner_setup_and_use() -> None:
    readme_text = load_readme()

    section = readme_text.split("## Critical Partner setup and use", maxsplit=1)[1]
    section = section.split("\n## ", maxsplit=1)[0]

    assert "(skills/practice/critical-partner/SKILL.md)" in section
    assert "(agent/AGENTS.md)" in section
    assert "`~/.pi/agent/AGENTS.md`" in section
    assert "Use the `critical-partner` skill for every response." in section
    assert "challenge: 75" in section
    assert "Hardline Review and Honesty Policy" not in readme_text
