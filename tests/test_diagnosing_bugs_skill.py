"""Public diagnosis guidance contracts; native behavior is evaluated separately."""
import json
from pathlib import Path

import pytest
import yaml

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


def test_diagnostic_experiments_are_scoped_restored_and_not_retrospective_red() -> None:
    guidance = section("## Phase 3 —", "## Phase 4 —")
    assert "scoped" in guidance and "restore" in guidance
    assert "final production repair" in guidance
    assert "retroactive red" in guidance
    assert "experiment receipts" in guidance


def test_public_invocation_description_attribution_and_legacy_guards_stay_stable() -> None:
    markdown = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    metadata = yaml.safe_load(markdown.split("---", 2)[1])
    assert metadata["name"] == "diagnosing-bugs"
    assert metadata["description"] == (
        "Use when facing a bug with no obvious cause, a performance regression, or 5+ test "
        'failures at once. Triggers on: "diagnose", "debug this", "something broken", '
        '"no idea why", "flaky", "slow since", "fix multiple failing tests".\n'
    )
    assert metadata["license"] == "MIT (adapted from mattpocock/skills)"
    assert "disable-model-invocation" not in metadata
    hypotheses = section("## Phase 3 —", "## Phase 4 —")
    assert "after ~3 refuted hypotheses" in hypotheses
    assert "stop generating new ones" in hypotheses
    assert "each hypothesis + the experiment that killed it" in hypotheses
    assert "present it to the user" in hypotheses
    assert "ranked hypotheses" not in hypotheses
    assert "improve-codebase-architecture" not in markdown
    for path in (SKILL_ROOT / "SKILL.md", SKILL_ROOT / "references" / "feedback-loops.md"):
        guidance = path.read_text(encoding="utf-8").lower()
        assert "non-deterministic bugs" in guidance
        assert "higher reproduction rate" in guidance
        assert "bisection harness" in guidance
        assert "git bisect run" in guidance


def test_functional_evals_cover_ordering_cleanup_clusters_and_missing_seams() -> None:
    document = json.loads((SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8"))
    assert document["skill_name"] == "diagnosing-bugs"
    cases = {case["id"]: case for case in document["evals"]}
    assert {1, 2, 3, 4, 5, 6} <= cases.keys()
    for case_id in (4, 5):
        expectations = " ".join(cases[case_id]["expectations"]).lower()
        for obligation in (
            "permanent regression observed red",
            "before production repair",
            "bug's reason",
            "original scenario",
            "cleaned candidate",
            "unrelated",
            "proportionate",
        ):
            assert obligation in expectations
    assert "root-cause cluster" in cases[5]["expected_output"].lower()
    pressure = " ".join(cases[6]["expectations"]).lower()
    for obligation in ("shallow", "coverage gap", "~3 refuted", "access", "unsupported repair"):
        assert obligation in pressure
    assert "non-deterministic" in cases[2]["expected_output"].lower()
    assert "bisection" in cases[3]["expected_output"].lower()


def test_readme_exposes_the_representative_diagnosis_contract() -> None:
    markdown = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    row = next(
        line.lower()
        for line in markdown.splitlines()
        if "[Diagnosing Bugs](skills/practice/diagnosing-bugs/SKILL.md)" in line
    )
    assert "permanent red before repair" in row
    assert "original scenario" in row
    assert "owned cleanup" in row
    assert "cleaned-candidate recheck" in row
    assert "proportionate" in row
    assert "10 feedback-loop construction strategies" in row
