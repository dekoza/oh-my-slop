from __future__ import annotations

import json
import re
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "practice" / "clear-communication"
SKILL_PATH = SKILL_ROOT / "SKILL.md"
BUNDLED_AGENTS_PATH = REPO_ROOT / "agent" / "AGENTS.md"


def _frontmatter(markdown: str) -> dict[str, object]:
    _, raw_frontmatter, _ = markdown.split("---", 2)
    parsed_frontmatter = yaml.safe_load(raw_frontmatter)
    assert isinstance(parsed_frontmatter, dict)
    return parsed_frontmatter


def test_clear_communication_is_the_only_communication_style_skill() -> None:
    assert SKILL_PATH.is_file()
    assert not (REPO_ROOT / "skills" / "meta" / "caveman").exists()
    assert not (REPO_ROOT / "skills" / "practice" / "english-only").exists()


def test_clear_communication_has_a_small_model_invoked_contract() -> None:
    skill_markdown = SKILL_PATH.read_text()
    description = str(_frontmatter(skill_markdown)["description"])

    assert description.startswith(("Use when", "Use whenever"))
    assert len(description.split()) <= 75
    assert len(re.findall(r"[.!?](?:\s|$)", description)) <= 3
    assert len(skill_markdown.splitlines()) < 80

    for required_rule in (
        "lead with the answer",
        "short, complete sentences",
        "correctness, precision, and necessary context",
        "configured domain glossary",
        "explicit user request",
        "safety warnings",
        "state whether it is irreversible",
        "recovery prerequisite",
    ):
        assert required_rule in skill_markdown.lower()

    assert "ASD-STE100 compliant" not in skill_markdown


def test_bundled_agents_activates_clear_communication_with_a_fallback() -> None:
    agents_markdown = BUNDLED_AGENTS_PATH.read_text()

    assert "Use the `clear-communication` skill for every response." in agents_markdown
    assert "Use clear, concise, precise prose." in agents_markdown
    assert "Preserve necessary context and technical accuracy." in agents_markdown
    assert "| Every response | `clear-communication` |" in agents_markdown
    assert "Report each existing non-English code identifier as a separate concern" in agents_markdown
    assert "remains unchanged outside the requested scope" in agents_markdown
    assert "`english-only`" not in agents_markdown


def test_clear_communication_evals_cover_pressure_and_trigger_boundaries() -> None:
    evals_document = json.loads((SKILL_ROOT / "evals" / "evals.json").read_text())
    trigger_evals = json.loads((SKILL_ROOT / "evals" / "trigger-evals.json").read_text())

    assert len(evals_document["evals"]) >= 3
    assert any("DROP TABLE" in eval_case["prompt"] for eval_case in evals_document["evals"])
    assert any("Odpowiedz po polsku" in eval_case["prompt"] for eval_case in evals_document["evals"])
    assert any("eventual consistency" in eval_case["prompt"] for eval_case in evals_document["evals"])

    assert trigger_evals
    assert all(trigger_eval["should_trigger"] for trigger_eval in trigger_evals)
