from __future__ import annotations

import json
import re
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "meta" / "skill-creator"
SKILL_PATH = SKILL_ROOT / "SKILL.md"


def _frontmatter(markdown: str) -> dict[str, object]:
    _, raw_frontmatter, _ = markdown.split("---", 2)
    parsed_frontmatter = yaml.safe_load(raw_frontmatter)
    assert isinstance(parsed_frontmatter, dict)
    return parsed_frontmatter


def test_skill_creator_exemplifies_its_description_and_size_limits() -> None:
    skill_markdown = SKILL_PATH.read_text()
    description = str(_frontmatter(skill_markdown)["description"])

    assert len(SKILL_PATH.read_text().splitlines()) < 500
    assert description.startswith(("Use when", "Use whenever"))
    assert len(description.split()) <= 75
    assert len(re.findall(r"[.!?](?:\s|$)", description)) <= 3


def test_skill_creator_discloses_branch_specific_guidance_directly() -> None:
    skill_markdown = SKILL_PATH.read_text()

    for reference_path in (
        "references/evaluation-workflow.md",
        "references/description-optimization.md",
        "references/environment-adaptations.md",
        "references/testing-pressure-scenarios.md",
    ):
        assert reference_path in skill_markdown
        assert (SKILL_ROOT / reference_path).is_file()

    assert "## Single-agent environment instructions" not in skill_markdown
    assert "## Cowork-Specific Instructions" not in skill_markdown
    assert "## Pressure Testing (Discipline Skills Only)" not in skill_markdown


def test_skill_creator_has_top_rules_quick_start_and_creation_gate() -> None:
    skill_markdown = SKILL_PATH.read_text()

    critical_rules_position = skill_markdown.index("## Critical rules")
    quick_start_position = skill_markdown.index("## Quick start")
    creation_gate_position = skill_markdown.index("## Should this be a skill?")
    full_workflow_position = skill_markdown.index("## Full workflow")

    assert critical_rules_position < quick_start_position
    assert quick_start_position < creation_gate_position < full_workflow_position


def test_skill_creator_evals_use_verifiable_expectations() -> None:
    evals_document = json.loads((SKILL_ROOT / "evals" / "evals.json").read_text())
    vague_terms = {"clearly", "realistic", "better", "vague", "appropriate"}

    assert len(evals_document["evals"]) >= 3
    for eval_case in evals_document["evals"]:
        for relative_file_path in eval_case["files"]:
            assert (SKILL_ROOT / relative_file_path).is_file()

        expectations = eval_case["expectations"]
        assert expectations
        for expectation in expectations:
            expectation_words = set(re.findall(r"[a-z]+", expectation.lower()))
            assert expectation_words.isdisjoint(vague_terms)
            assert any(
                observable in expectation.lower()
                for observable in (
                    " exists",
                    " contains",
                    " records",
                    " uses",
                    " preserves",
                    " matches",
                    " includes",
                    " invokes",
                    " reports",
                )
            )
