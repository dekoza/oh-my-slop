from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "documentation-lifecycle"


def test_documentation_lifecycle_skill_references_resolve_in_isolation(
    tmp_path: Path,
) -> None:
    target_root = tmp_path / "skills" / "documentation-lifecycle"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_documentation_lifecycle_skill_frontmatter_and_routing_cover_engineering_and_user_docs() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "name: documentation-lifecycle" in skill_text
    assert "description: Use when" in skill_text
    assert "engineering documentation" in skill_text.lower()
    assert "user-facing documentation" in skill_text.lower()
    assert "feature spec" in skill_text.lower()
    assert "ADR" in skill_text
    assert "runbook" in skill_text.lower()
    assert "tutorial" in skill_text.lower()
    assert "how-to" in skill_text.lower()
    assert "reference" in skill_text.lower()
    assert "explanation" in skill_text.lower()
    assert "Socratic" in skill_text or "socratic" in skill_text
    assert "dialectic" in skill_text.lower()
    assert "documentation drift" in skill_text.lower()
    assert "canonical" in skill_text.lower()


def test_documentation_lifecycle_reference_index_routes_to_core_doc_types() -> None:
    index_text = (SKILL_ROOT / "references" / "REFERENCE.md").read_text(
        encoding="utf-8"
    )

    assert "specification-interview.md" in index_text
    assert "feature-spec.md" in index_text
    assert "adr.md" in index_text
    assert "reference-docs.md" in index_text
    assert "runbook.md" in index_text
    assert "user-facing-docs.md" in index_text
    assert "engineering" in index_text.lower()
    assert "user-facing" in index_text.lower()


def test_documentation_lifecycle_references_cover_interview_spec_adr_reference_runbook_and_diataxis() -> None:
    interview_text = (
        SKILL_ROOT / "references" / "specification-interview.md"
    ).read_text(encoding="utf-8")
    feature_spec_text = (SKILL_ROOT / "references" / "feature-spec.md").read_text(
        encoding="utf-8"
    )
    adr_text = (SKILL_ROOT / "references" / "adr.md").read_text(
        encoding="utf-8"
    )
    reference_text = (SKILL_ROOT / "references" / "reference-docs.md").read_text(
        encoding="utf-8"
    )
    runbook_text = (SKILL_ROOT / "references" / "runbook.md").read_text(
        encoding="utf-8"
    )
    user_docs_text = (
        SKILL_ROOT / "references" / "user-facing-docs.md"
    ).read_text(encoding="utf-8")

    assert "Definitional" in interview_text
    assert "Evidential" in interview_text
    assert "Perspective" in interview_text
    assert "Consequential" in interview_text
    assert "thesis" in interview_text.lower()
    assert "antithesis" in interview_text.lower()
    assert "acceptance criteria" in interview_text.lower()

    assert "Goals" in feature_spec_text
    assert "Non-goals" in feature_spec_text
    assert "Acceptance criteria" in feature_spec_text
    assert "Edge cases" in feature_spec_text
    assert "Operational impact" in feature_spec_text

    assert "Context" in adr_text
    assert "Options considered" in adr_text
    assert "Decision" in adr_text
    assert "Tradeoffs" in adr_text
    assert "Status" in adr_text
    assert "Superseded" in adr_text

    assert "API" in reference_text
    assert "configuration" in reference_text.lower()
    assert "schemas" in reference_text.lower()
    assert "feature flag" in reference_text.lower() or "feature flags" in reference_text.lower()
    assert "facts" in reference_text.lower()

    assert "rollback" in runbook_text.lower()
    assert "observability" in runbook_text.lower()
    assert "troubleshooting" in runbook_text.lower()
    assert "recovery" in runbook_text.lower()
    assert "verification" in runbook_text.lower()

    assert "Diátaxis" in user_docs_text or "Diataxis" in user_docs_text
    assert "tutorial" in user_docs_text.lower()
    assert "how-to" in user_docs_text.lower()
    assert "reference" in user_docs_text.lower()
    assert "explanation" in user_docs_text.lower()
    assert "Do not mix" in user_docs_text or "do not mix" in user_docs_text.lower()


def test_documentation_lifecycle_skill_evals_cover_spec_interview_drift_and_user_doc_routing() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "documentation-lifecycle"
    evals = payload["evals"]
    assert len(evals) >= 6
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = "\n".join(item["prompt"] for item in evals)
    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )

    assert "feature spec" in prompts.lower() or "specification" in prompts.lower()
    assert "ADR" in prompts
    assert "runbook" in prompts.lower()
    assert "stale documentation" in prompts.lower() or "documentation drift" in prompts.lower()
    assert "tutorial" in prompts.lower() or "how-to" in prompts.lower()
    assert "skip docs" in prompts.lower() or "ship tonight" in prompts.lower()

    assert "acceptance criteria" in expectations.lower()
    assert "tradeoffs" in expectations.lower()
    assert "rollback" in expectations.lower()
    assert "reference" in expectations.lower()
    assert "tutorial" in expectations.lower() or "how-to" in expectations.lower()
    assert "do not create documentation theater" in expectations.lower() or "no new adr" in expectations.lower()


def test_documentation_lifecycle_trigger_evals_cover_trigger_and_near_miss_cases() -> None:
    trigger_path = SKILL_ROOT / "evals" / "trigger-evals.json"
    payload = json.loads(trigger_path.read_text(encoding="utf-8"))

    assert len(payload) >= 14

    should_trigger = [item for item in payload if item["should_trigger"] is True]
    should_not_trigger = [item for item in payload if item["should_trigger"] is False]

    assert len(should_trigger) >= 7
    assert len(should_not_trigger) >= 7
    assert all(item["query"].strip() for item in payload)

    positive_queries = "\n".join(item["query"] for item in should_trigger)
    negative_queries = "\n".join(item["query"] for item in should_not_trigger)

    assert "ADR" in positive_queries or "adr" in positive_queries
    assert "runbook" in positive_queries.lower()
    assert "feature spec" in positive_queries.lower() or "spec" in positive_queries.lower()
    assert "documentation drift" in positive_queries.lower() or "stale docs" in positive_queries.lower()
    assert "tutorial" in positive_queries.lower() or "how-to" in positive_queries.lower()

    assert "Django" in negative_queries or "django" in negative_queries
    assert "HTTP" in negative_queries or "status code" in negative_queries.lower()
    assert "Docker" in negative_queries or "docker" in negative_queries
    assert "logo" in negative_queries.lower() or "calendar" in negative_queries.lower()


def test_readme_lists_documentation_lifecycle_skill() -> None:
    readme_text = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "[Documentation Lifecycle](skills/documentation-lifecycle/SKILL.md)" in readme_text
    assert "feature spec" in readme_text.lower() or "runbook" in readme_text.lower()
