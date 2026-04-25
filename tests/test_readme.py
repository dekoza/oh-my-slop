from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
README_PATH = REPO_ROOT / "README.md"
PACKAGE_JSON_PATH = REPO_ROOT / "package.json"
SKILLS_DIR = REPO_ROOT / "skills"


def load_readme() -> str:
    return README_PATH.read_text(encoding="utf-8")


def load_package_manifest() -> dict:
    return json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))


def test_readme_uses_github_details_for_extension_and_skill_catalogs() -> None:
    readme_text = load_readme()

    assert "<summary><strong>Extensions" in readme_text
    assert "<summary><strong>Skills" in readme_text


def test_readme_install_example_matches_the_repo_slug() -> None:
    readme_text = load_readme()

    assert "pi install git:github.com/dekoza/oh-my-slop" in readme_text


def test_readme_lists_every_packaged_extension() -> None:
    readme_text = load_readme()
    manifest = load_package_manifest()

    for entry in manifest["pi"]["extensions"]:
        extension_name = Path(entry).parts[1]
        assert extension_name in readme_text



def test_readme_links_every_bundled_skill() -> None:
    readme_text = load_readme()

    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").exists():
            continue
        assert f"skills/{skill_dir.name}/SKILL.md" in readme_text



def test_readme_anti_sycophancy_section_points_to_the_bundled_agent_rules() -> None:
    readme_text = load_readme()

    section = readme_text.split("## The AGENTS.md and Anti-Sycophancy", maxsplit=1)[1]
    section = section.split("\n## ", maxsplit=1)[0]

    assert "(agent/AGENTS.md)" in section
