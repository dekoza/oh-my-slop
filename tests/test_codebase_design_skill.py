from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "practice" / "codebase-design"
SKILL_PATH = SKILL_ROOT / "SKILL.md"
CLEAN_ARCHITECTURE_PATH = SKILL_ROOT / "references" / "clean-architecture.md"
REFERENCE_INDEX_PATH = SKILL_ROOT / "references" / "REFERENCE.md"
EVALS_PATH = SKILL_ROOT / "evals" / "evals.json"


def test_clean_architecture_covers_the_unported_decision_rules() -> None:
    reference_markdown = CLEAN_ARCHITECTURE_PATH.read_text(encoding="utf-8").lower()

    for required_concept in (
        "acyclic",
        "stability",
        "volatility",
        "substitution value",
        "partial seam",
        "actors",
        "change reasons",
    ):
        assert required_concept in reference_markdown


def test_codebase_design_routes_clean_architecture_decisions_directly() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8").lower()
    reference_index = REFERENCE_INDEX_PATH.read_text(encoding="utf-8").lower()

    for routing_concept in (
        "dependency direction",
        "module cycles",
        "seam cost",
        "use-case separation",
    ):
        assert routing_concept in skill_markdown
        assert routing_concept in reference_index


def test_codebase_design_evals_cover_component_and_use_case_decisions() -> None:
    evals_document = json.loads(EVALS_PATH.read_text(encoding="utf-8"))
    eval_prompts = "\n".join(
        str(eval_case["prompt"]).lower() for eval_case in evals_document["evals"]
    )
    eval_expectations = "\n".join(
        str(expectation).lower()
        for eval_case in evals_document["evals"]
        for expectation in eval_case["expectations"]
    )

    assert "dependency cycle" in eval_prompts
    assert "different actors" in eval_prompts
    assert "stability" in eval_expectations
    assert "partial seam" in eval_expectations
    assert "change reasons" in eval_expectations
