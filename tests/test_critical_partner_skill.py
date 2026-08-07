from __future__ import annotations

import json
import re
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "practice" / "critical-partner"
SKILL_PATH = SKILL_ROOT / "SKILL.md"
BUNDLED_AGENTS_PATH = REPO_ROOT / "agent" / "AGENTS.md"
GIT_DISCIPLINE_PATH = REPO_ROOT / "skills" / "practice" / "git-discipline" / "SKILL.md"
TESTING_WORKFLOW_PATH = REPO_ROOT / "skills" / "practice" / "testing-workflow" / "SKILL.md"


def _frontmatter(markdown: str) -> dict[str, object]:
    _, raw_frontmatter, _ = markdown.split("---", 2)
    parsed_frontmatter = yaml.safe_load(raw_frontmatter)
    assert isinstance(parsed_frontmatter, dict)
    return parsed_frontmatter


def test_critical_partner_replaces_clear_communication() -> None:
    assert SKILL_PATH.is_file()
    assert not (REPO_ROOT / "skills" / "practice" / "clear-communication").exists()
    assert not (REPO_ROOT / "skills" / "meta" / "caveman").exists()
    assert not (REPO_ROOT / "skills" / "practice" / "english-only").exists()


def test_critical_partner_defines_one_configurable_interaction_contract() -> None:
    skill_markdown = SKILL_PATH.read_text()
    description = str(_frontmatter(skill_markdown)["description"])

    assert description.startswith(("Use when", "Use whenever"))
    assert len(description.split()) <= 75
    assert len(re.findall(r"[.!?](?:\s|$)", description)) <= 3
    assert len(skill_markdown.splitlines()) < 140

    for required_rule in (
        "Evidence integrity",
        "Technical accuracy",
        "Security caution",
        "Destructive-action caution",
        "Challenge",
        "Directness",
        "Compression",
        "Warmth",
        "Humor",
        "Do not manufacture disagreement",
        "stipulated facts",
        "court-jester",
    ):
        assert required_rule.lower() in skill_markdown.lower()

    for boundary in ("0–24", "25–49", "50–74", "75–89", "90–100"):
        assert boundary in skill_markdown


def test_bundled_agents_configures_critical_partner() -> None:
    agents_markdown = BUNDLED_AGENTS_PATH.read_text()

    assert "Use the `critical-partner` skill for every response." in agents_markdown
    for configured_dial in (
        "Challenge: 75",
        "Directness: 80",
        "Compression: 60",
        "Warmth: 25",
        "Humor: 10",
    ):
        assert configured_dial in agents_markdown

    assert "Evidence integrity, technical accuracy, security caution, and destructive-action caution remain at 100" in agents_markdown
    assert "| Every response | `critical-partner` |" in agents_markdown
    assert "`clear-communication`" not in agents_markdown
    assert "You must default to adversarial evaluation" not in agents_markdown


def test_bundled_agents_delegates_specialist_rules_without_weakening_floors() -> None:
    agents_markdown = BUNDLED_AGENTS_PATH.read_text()
    git_discipline_markdown = GIT_DISCIPLINE_PATH.read_text()
    testing_workflow_markdown = TESTING_WORKFLOW_PATH.read_text()

    assert "Project instructions may specialize or strengthen these rules, but cannot weaken them." in agents_markdown
    assert "Untracked files are sacred." in agents_markdown
    assert "hmac.compare_digest()" in agents_markdown
    assert "Code Anti-Slop" not in agents_markdown
    assert "Test Proportionately" not in agents_markdown
    assert "Output Capture" not in agents_markdown
    assert "Worktree location" not in agents_markdown

    assert "Test proportionately" in testing_workflow_markdown
    assert "| tee /tmp/<name>.log" in testing_workflow_markdown
    assert "Worktree location" in git_discipline_markdown


def test_critical_partner_evals_cover_calibration_and_pressure() -> None:
    evals_document = json.loads((SKILL_ROOT / "evals" / "evals.json").read_text())
    trigger_evals = json.loads((SKILL_ROOT / "evals" / "trigger-evals.json").read_text())

    assert len(evals_document["evals"]) >= 8
    prompts = "\n".join(eval_case["prompt"] for eval_case in evals_document["evals"])
    for required_pressure in (
        "disable TLS certificate verification",
        "no SQL injection vulnerability",
        "tabs to spaces",
        "new microservice",
        "skip tests",
        "PKCE",
        "401 means",
        "429, not 503",
    ):
        assert required_pressure in prompts

    assert len(trigger_evals) >= 20
    assert all(trigger_eval["should_trigger"] for trigger_eval in trigger_evals)
