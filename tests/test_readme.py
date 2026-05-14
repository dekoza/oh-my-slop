from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
README_PATH = REPO_ROOT / "README.md"
JOB_PIPELINE_README_PATH = REPO_ROOT / "extensions" / "job-pipeline" / "README.md"
SKILLS_DIR = REPO_ROOT / "skills"
EXTENSIONS_DIR = REPO_ROOT / "extensions"


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


def test_readme_install_section_marks_extensions_as_opt_in() -> None:
    readme_text = load_readme()

    assert "get the bundled skills without auto-enabling the extensions" in readme_text
    assert "Extensions are shipped in this repo but remain opt-in." in readme_text


def test_readme_lists_every_bundled_extension() -> None:
    readme_text = load_readme()

    for extension_name in iter_extension_names():
        assert extension_name in readme_text


def test_readme_links_every_bundled_skill() -> None:
    readme_text = load_readme()

    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").exists():
            continue
        assert f"skills/{skill_dir.name}/SKILL.md" in readme_text


def test_job_pipeline_readme_says_root_package_install_stays_opt_in() -> None:
    readme_text = load_job_pipeline_readme()

    assert "includes it automatically" not in readme_text
    assert "stays opt-in" in readme_text


def test_readme_anti_sycophancy_section_points_to_the_bundled_agent_rules() -> None:
    readme_text = load_readme()

    section = readme_text.split("## The AGENTS.md and Anti-Sycophancy", maxsplit=1)[1]
    section = section.split("\n## ", maxsplit=1)[0]

    assert "(agent/AGENTS.md)" in section
