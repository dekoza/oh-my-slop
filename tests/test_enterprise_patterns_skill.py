from __future__ import annotations

import json
import re
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "practice" / "enterprise-patterns"
SKILL_PATH = SKILL_ROOT / "SKILL.md"


def _frontmatter(markdown: str) -> dict[str, object]:
    _, raw_frontmatter, _ = markdown.split("---", 2)
    parsed_frontmatter = yaml.safe_load(raw_frontmatter)
    assert isinstance(parsed_frontmatter, dict)
    return parsed_frontmatter


def test_enterprise_patterns_is_a_lean_model_invoked_skill() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8")
    frontmatter = _frontmatter(skill_markdown)
    description = str(frontmatter["description"])

    assert frontmatter["name"] == "enterprise-patterns"
    assert "disable-model-invocation" not in frontmatter
    assert description.startswith(("Use when", "Use whenever"))
    assert len(description.split()) <= 75
    assert len(re.findall(r"[.!?](?:\s|$)", description)) <= 3
    assert len(skill_markdown.splitlines()) < 500

    # Decision layer: the deference rule and forbidden-pattern review blockers sit
    # above the reach-for-it-later base-pattern catalog.
    defer_position = skill_markdown.index("## Defer before you pattern")
    forbidden_position = skill_markdown.index("## Forbidden patterns")
    catalog_position = skill_markdown.index("## Base patterns")
    assert defer_position < forbidden_position < catalog_position


def test_enterprise_patterns_defers_to_ddd_and_cross_links_owned_ground() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8")
    lowered = skill_markdown.lower()

    # Deference rule up front (upstream's only conflict pair).
    assert "domain modeling belongs to" in lowered

    # Do not restate ground other skills own — cross-link instead.
    for owning_skill in (
        "../domain-driven-design/SKILL.md",
        "../../reference/django/SKILL.md",
        "../../reference/drf/SKILL.md",
        "../data-intensive/SKILL.md",
        "../production-readiness/SKILL.md",
    ):
        assert owning_skill in skill_markdown


def test_enterprise_patterns_discloses_each_scope_area_in_references() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8")

    for reference_path in (
        "references/business-logic-and-persistence.md",
        "references/concurrency-and-sessions.md",
        "references/distribution-and-base-patterns.md",
    ):
        assert reference_path in skill_markdown
        assert (SKILL_ROOT / reference_path).is_file()

    business_reference = (
        SKILL_ROOT / "references" / "business-logic-and-persistence.md"
    ).read_text(encoding="utf-8").lower()
    for required_concept in (
        "transaction script",
        "table module",
        "domain model",
        "service layer",
        "data mapper",
        "active record",
        "identity map",
        "unit of work",
        "query object",
    ):
        assert required_concept in business_reference

    concurrency_reference = (
        SKILL_ROOT / "references" / "concurrency-and-sessions.md"
    ).read_text(encoding="utf-8").lower()
    for required_concept in (
        "optimistic offline lock",
        "pessimistic offline lock",
        "coarse-grained lock",
        "implicit lock",
        "isolation",  # names the distinction from DB isolation (data-intensive)
        "client",
        "server",
        "database",
        "cleanup",
    ):
        assert required_concept in concurrency_reference

    distribution_reference = (
        SKILL_ROOT / "references" / "distribution-and-base-patterns.md"
    ).read_text(encoding="utf-8").lower()
    for required_concept in (
        "don't distribute",
        "remote facade",
        "gateway",
        "separated interface",
        "special case",
        "service stub",
        "record set",
        "layering theater",
    ):
        assert required_concept in distribution_reference


def test_enterprise_patterns_has_functional_and_trigger_eval_coverage() -> None:
    evals_document = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )
    trigger_cases = json.loads(
        (SKILL_ROOT / "evals" / "trigger-evals.json").read_text(encoding="utf-8")
    )

    assert evals_document["skill_name"] == "enterprise-patterns"
    assert len(evals_document["evals"]) >= 3
    assert all(eval_case["expectations"] for eval_case in evals_document["evals"])

    positive_cases = [case for case in trigger_cases if case["should_trigger"] is True]
    negative_cases = [case for case in trigger_cases if case["should_trigger"] is False]
    assert len(positive_cases) >= 8
    assert len(negative_cases) >= 8
    assert all(case["query"].strip() for case in trigger_cases)

    benchmark_markdown = (SKILL_ROOT / "evals" / "benchmark.md").read_text(
        encoding="utf-8"
    )
    assert "enterprise-patterns" in benchmark_markdown
    # The benchmark records an actual run against the session model over all cases.
    assert "anthropic/claude-opus-4-8" in benchmark_markdown
    assert f"/{len(trigger_cases)}" in benchmark_markdown


def test_readme_catalogs_enterprise_patterns() -> None:
    readme_markdown = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "**[Enterprise Patterns](skills/practice/enterprise-patterns/SKILL.md)**" in readme_markdown
