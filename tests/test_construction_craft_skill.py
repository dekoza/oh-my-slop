from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "construction-craft"
SKILL_PATH = SKILL_ROOT / "SKILL.md"


def _frontmatter(markdown: str) -> dict[str, object]:
    _, raw_frontmatter, _ = markdown.split("---", 2)
    parsed_frontmatter = yaml.safe_load(raw_frontmatter)
    assert isinstance(parsed_frontmatter, dict)
    return parsed_frontmatter


def test_construction_craft_is_a_lean_model_invoked_skill() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8")
    frontmatter = _frontmatter(skill_markdown)
    description = str(frontmatter["description"])

    assert frontmatter["name"] == "construction-craft"
    assert "disable-model-invocation" not in frontmatter
    assert description.startswith(("Use when", "Use whenever"))
    assert len(description.split()) <= 75
    assert len(re.findall(r"[.!?](?:\s|$)", description)) <= 3
    assert len(skill_markdown.splitlines()) < 500

    critical_rules_position = skill_markdown.index("## Critical rules")
    workflow_position = skill_markdown.index("## Construction workflow")
    assert critical_rules_position < workflow_position


def test_construction_craft_discloses_each_source_branch_directly() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8")

    for reference_path in (
        "references/construction-decisions.md",
        "references/pragmatic-practices.md",
    ):
        assert reference_path in skill_markdown
        assert (SKILL_ROOT / reference_path).is_file()

    construction_reference = (
        SKILL_ROOT / "references" / "construction-decisions.md"
    ).read_text(encoding="utf-8")
    pragmatic_reference = (
        SKILL_ROOT / "references" / "pragmatic-practices.md"
    ).read_text(encoding="utf-8")

    for required_concept in (
        "pre-construction",
        "pseudocode",
        "named constants",
        "closed sets",
        "visible units",
        "table-driven",
        "programmer assumptions",
        "expected failures",
        "remeasure",
    ):
        assert required_concept in construction_reference.lower()

    for required_concept in (
        "authoritative owner",
        "reversible",
        "versioned",
        "plain text",
        "broken windows",
        "uncertainty",
    ):
        assert required_concept in pragmatic_reference.lower()


def test_construction_craft_keeps_concurrency_trigger_and_routes_owned_work() -> None:
    skill_markdown = SKILL_PATH.read_text(encoding="utf-8").lower()
    critical_rules = skill_markdown.split("## critical rules", 1)[1].split(
        "## construction workflow", 1
    )[0]

    assert "concurrency" in critical_rules
    assert "isolate" in critical_rules
    assert "command-query separation" not in critical_rules
    assert "typed result" not in critical_rules

    for owning_skill in (
        "../tdd/skill.md",
        "../testing-workflow/skill.md",
        "../diagnosing-bugs/skill.md",
        "../codebase-design/skill.md",
        "../python-async/skill.md",
        "../refactoring-pass/skill.md",
        "../production-readiness/skill.md",
    ):
        assert owning_skill in skill_markdown


def test_construction_craft_has_functional_and_trigger_eval_coverage() -> None:
    evals_document = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )
    trigger_cases = json.loads(
        (SKILL_ROOT / "evals" / "trigger-evals.json").read_text(encoding="utf-8")
    )

    assert evals_document["skill_name"] == "construction-craft"
    assert len(evals_document["evals"]) >= 3
    assert all(eval_case["expectations"] for eval_case in evals_document["evals"])

    positive_cases = [case for case in trigger_cases if case["should_trigger"] is True]
    negative_cases = [case for case in trigger_cases if case["should_trigger"] is False]
    assert len(positive_cases) == 12
    assert len(negative_cases) == 12
    assert Counter(case["branch"] for case in positive_cases) == {
        "preflight-shape": 2,
        "knowledge-artifact-drift": 2,
        "reversibility": 2,
        "recurring-work-decay": 2,
        "concurrency": 2,
        "evidence": 2,
    }
    assert all(case["query"].strip() for case in trigger_cases)

    benchmark_markdown = (SKILL_ROOT / "evals" / "benchmark.md").read_text(
        encoding="utf-8"
    )
    expected_case_score = f"**{len(trigger_cases)}/{len(trigger_cases)}**"
    expected_coverage_marker = f"**{len(trigger_cases)} cases**"
    assert "construction-craft" in benchmark_markdown
    assert expected_coverage_marker in benchmark_markdown
    assert expected_case_score in benchmark_markdown or (
        "Final validation: **incomplete**" in benchmark_markdown
        and "out of extra usage" in benchmark_markdown
    )


def test_readme_catalogs_construction_craft_and_reports_the_real_count() -> None:
    readme_markdown = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    count_match = re.search(r"<summary><strong>Skills \((\d+)\)</strong>", readme_markdown)
    bundled_skill_count = sum(
        1
        for skill_directory in (REPO_ROOT / "skills").iterdir()
        if skill_directory.is_dir() and (skill_directory / "SKILL.md").is_file()
    )

    assert "**[Construction Craft](skills/construction-craft/SKILL.md)**" in readme_markdown
    assert count_match is not None
    assert int(count_match.group(1)) == bundled_skill_count
