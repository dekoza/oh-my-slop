"""Invocation contract for the active domain-modeling discipline."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

SKILL_ROOT = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "workflow"
    / "domain-modeling"
)


def description() -> str:
    text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    _, frontmatter, _ = text.split("---", 2)
    return yaml.safe_load(frontmatter)["description"]


def test_description_covers_direct_domain_document_work_and_skill_reuse() -> None:
    value = description()

    assert value.startswith("Use when")
    assert "codebase terminology" in value
    assert "CONTEXT.md" in value
    assert "ADR" in value
    assert "another skill needs" in value


def test_trigger_evals_name_context_and_adr_files_directly() -> None:
    evals = json.loads(
        (SKILL_ROOT / "evals" / "trigger-evals.json").read_text(encoding="utf-8")
    )
    positives = [item["query"] for item in evals if item["should_trigger"]]

    assert any("CONTEXT.md" in query for query in positives)
    assert any("ADR 0007" in query for query in positives)
