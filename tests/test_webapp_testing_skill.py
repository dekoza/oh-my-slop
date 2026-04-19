from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "webapp-testing"


def test_webapp_testing_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "webapp-testing"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_webapp_testing_skill_frontmatter_and_guardrails_cover_video_workflow() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "name: webapp-testing" in skill_text
    assert "description: Use when" in skill_text
    assert "Playwright" in skill_text
    assert "recorded video" in skill_text or "record a video" in skill_text
    assert "## When to record video" in skill_text
    assert "record_video_dir" in skill_text
    assert "record_video_size" in skill_text
    assert "video.save_as" in skill_text
    assert "context.close()" in skill_text
    assert "headless=True" in skill_text
    assert "one fresh browser context" in skill_text
    assert "Video supplements" in skill_text
    assert "orange dot" in skill_text.lower()
    assert "ripple effect" in skill_text.lower()
    assert "pace of a human" in skill_text.lower()
    assert "smooth" in skill_text.lower()
    assert "jump" in skill_text.lower()
    assert "Xvfb" not in skill_text
    assert "headless=False" not in skill_text


def test_webapp_testing_skill_example_records_and_names_video_artifacts() -> None:
    example_text = (SKILL_ROOT / "examples" / "video_recording.py").read_text(
        encoding="utf-8"
    )

    assert "record_video_dir" in example_text
    assert "record_video_size" in example_text
    assert "video.save_as" in example_text
    assert "context.close()" in example_text
    assert "headless=True" in example_text
    assert "orange" in example_text.lower()
    assert "ripple" in example_text.lower()
    assert "add_init_script" in example_text
    assert "mouse.move" in example_text
    assert "steps=" in example_text
    assert "wait_for_timeout" in example_text
    assert "def present_click(" in example_text
    assert "Locator" in example_text
    assert "bounding_box()" in example_text
    assert "present_click(page, first_link)" in example_text
    assert "move_pointer_smoothly_and_click(page," not in example_text


def test_webapp_testing_skill_evals_cover_video_repro_and_walkthrough_cases() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "webapp-testing"
    evals = payload["evals"]
    assert len(evals) >= 5
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = "\n".join(item["prompt"] for item in evals)
    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )

    assert "record a video" in prompts
    assert "where the video file was saved" in prompts
    assert "walkthrough video" in prompts
    assert "record_video_dir" in expectations
    assert "context.close()" in expectations
    assert "video path" in expectations
    assert "orange dot" in expectations.lower()
    assert "ripple" in expectations.lower()
    assert "pace of a human" in expectations.lower()
    assert "smooth" in expectations.lower()
    assert "UI" in prompts or "click" in prompts


def test_readme_lists_webapp_testing_skill() -> None:
    readme_text = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "[Webapp Testing](skills/webapp-testing/SKILL.md)" in readme_text
    assert "Playwright" in readme_text
    assert "video" in readme_text.lower()
