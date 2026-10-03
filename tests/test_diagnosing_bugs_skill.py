"""Public diagnosis guidance contracts; native behavior is evaluated separately."""
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "practice" / "diagnosing-bugs"


def section(start: str, end: str) -> str:
    markdown = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    return markdown.split(start, 1)[1].split(end, 1)[0].lower()


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("**The whole skill in one breath:**", "## Multi-Failure Triage"),
        ("### Step 3 — FIX WAVE", "### Step 4 — VERIFY WAVE"),
        ("## Phase 5 —", "### Before applying the fix"),
    ],
    ids=["summary", "multi-failure-offender", "single-bug-repair"],
)
def test_every_repair_entry_requires_observed_permanent_red_before_repair(
    start: str, end: str
) -> None:
    guidance = section(start, end)
    red = "permanent regression observed red"
    assert red in guidance, "An exploratory repro is not an observed permanent regression"
    assert guidance.index(red) < guidance.index("production repair")
    assert "bug's reason" in guidance
    assert "green" in guidance
    assert "original scenario" in guidance


def test_minimisation_requires_boundary_correspondence_and_explicit_coverage_gaps() -> None:
    guidance = section("## Phase 2 —", "## Phase 3 —")
    assert "same boundary" in guidance
    assert "helper" in guidance and "mock" in guidance
    assert "wrong failure" in guidance
    assert "coverage gap" in guidance
    assert "verified completion" in guidance
    assert "evidence or access" in guidance


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("### Step 3 — FIX WAVE", "### Step 4 — VERIFY WAVE"),
        ("## Phase 4 —", "## Phase 5 —"),
        ("## Phase 5 —", "### Before applying the fix"),
    ],
)
def test_cleanup_is_owned_verified_and_followed_by_cleaned_candidate_checks(
    start: str, end: str
) -> None:
    guidance = section(start, end)
    assert "owned" in guidance and "unrelated" in guidance
    assert "verify actual removal" in guidance
    assert "cleaned candidate" in guidance
    assert "rerun" in guidance


@pytest.mark.parametrize("surface", ["triage-gate", "repair-gate", "cluster-reference"])
def test_consumer_check_gates_delegate_proportionately_to_testing_workflow(
    surface: str,
) -> None:
    if surface == "triage-gate":
        guidance = section("### Step 7 —", "### Anti-patterns")
    elif surface == "repair-gate":
        guidance = section("## Phase 5 —", "### Before applying the fix")
    else:
        guidance = (SKILL_ROOT / "references" / "feedback-loops.md").read_text(
            encoding="utf-8"
        ).lower()
    assert "testing-workflow" in guidance
    assert "proportionate" in guidance
    assert "project" in guidance and "required" in guidance
    assert "full suite after each cluster" not in guidance
    assert "run the **entire** test suite (all tiers)" not in guidance
