"""qa files issues whose state separates clarity from implementation authority (#254).

Static contract guards complement the matched behavior comparisons; they do not
establish that a model labels, reads back or refrains from acting correctly.
"""

import json
import re
from pathlib import Path

from scripts.validate_refs import find_skill_dir


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
WORKFLOW_LABEL = "workflow:implement"
LABELS = "#### Labels (forge-backed trackers only)"


def _qa_dir() -> Path:
    qa_dir = find_skill_dir(SKILLS_ROOT, "qa")
    assert qa_dir is not None, "qa skill not found under skills/"
    return qa_dir


def _normalized(text: str) -> str:
    return " ".join(text.split())


def _qa_text() -> str:
    return (_qa_dir() / "SKILL.md").read_text(encoding="utf-8")


def _qa_section(heading: str) -> str:
    """The normalized body under a qa heading, up to the next level-3/4 heading."""
    body = _qa_text().split(f"{heading}\n", 1)[1]
    return _normalized(re.split(r"\n#{3,4} ", body, maxsplit=1)[0])


def _qa_evals() -> dict[int, dict]:
    document = json.loads((_qa_dir() / "evals" / "evals.json").read_text(encoding="utf-8"))
    assert document["skill_name"] == "qa"
    cases = {case["id"]: case for case in document["evals"]}
    assert len(cases) == len(document["evals"])
    return cases


def test_qa_labels_the_issues_it_files_for_implementation_routing() -> None:
    """Forge-backed qa issues carry a category, the workflow marker, and a
    state, resolved through the project's triage label mapping — so the
    issues route to /implement instead of landing bare (Gitea #65)."""
    qa_text = _qa_text()
    label_template_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "triage-labels.md"
    ).read_text(encoding="utf-8")

    for role in ("bug", "enhancement", "ready-for-agent", "ready-for-human"):
        assert f"`{role}`" in qa_text
        assert role in label_template_text

    assert f"`{WORKFLOW_LABEL}`" in qa_text
    assert WORKFLOW_LABEL in label_template_text
    assert "label mapping" in qa_text


def test_clear_reproduction_alone_does_not_make_an_issue_agent_ready() -> None:
    """Concrete steps and an unambiguous expectation establish clarity; agent
    readiness also needs a human grant covering the issue's scope (#254)."""
    labels = _qa_section(LABELS)

    assert (
        "Apply `ready-for-agent` when the reproduction steps are concrete"
        not in labels
    )
    assert "permission to publish, not implementation authority" in labels
    assert "Apply `ready-for-agent` only when both hold" in labels
    assert "the project's authority rules" in labels


def test_every_human_state_role_records_the_missing_decision_owner_and_next_action() -> None:
    """A missing grant, a design choice and changed scope alike leave a durable
    record, in a named place, of what is missing, who owns it and what happens
    next (#254)."""
    labels = _qa_section(LABELS)
    otherwise = labels.split("Otherwise apply `ready-for-human`", 1)[1].split(". ", 1)[0]

    assert "or only the grant is missing" in otherwise
    assert (
        "record in the issue's additional context the missing decision or action, "
        "its owner and the next action" in otherwise
    )


def test_scoped_grant_is_reused_but_never_stretched_or_given_to_human_only_work() -> None:
    """A sufficient same-scope grant is reused without another approval round;
    changed scope pauses for the missing decision, and human-only requirements
    stay human-owned whatever the grant (#254)."""
    labels = _qa_section(LABELS)

    assert "reuse it without asking again" in labels
    assert "does not stretch to changed scope" in labels
    assert "Issues still inside the granted scope stay `ready-for-agent`" in labels
    assert "stays `ready-for-human` whatever the grant" in labels


def test_breakdown_records_blockers_without_granting_execution_or_concurrency() -> None:
    """Separating symptoms into issues and publishing them is not a grant to
    start work or to run slices concurrently (#254)."""
    scope = _qa_section("### 3. Assess scope: single issue or breakdown?")
    breakdown = _qa_section("#### For a breakdown (multiple issues)")

    assert "parallel" not in scope
    assert "can start immediately" not in breakdown
    assert "Maximize parallelism" not in breakdown
    assert "None known" in breakdown
    assert "**Leave scheduling to the project's authority rules and execution gates**" in breakdown
    assert "decide neither when a slice may start nor whether slices may run side by side" in breakdown


def test_filed_issues_are_read_back_and_filing_starts_no_work() -> None:
    """Each filed issue is verified by readback, filing claims, assigns or starts
    nothing, and agent readiness is not execution eligibility (#254)."""
    after_filing = _qa_section("#### After filing")

    assert "Read each filed issue back" in after_filing
    assert "on a forge-backed tracker" in after_filing
    assert "reported as such, not as filed" in after_filing
    assert "no assignment, claim, branch, fix or dispatch" in after_filing
    assert "records clarity and authority, not eligibility" in after_filing


def test_preserved_capture_contract_survives_the_authority_split() -> None:
    """The authority split keeps light clarification, mandatory reproduction,
    deduplication and agent-work routing intact (#254)."""
    qa_text = _normalized(_qa_text())

    assert "at most 2-3 short clarifying questions" in qa_text
    assert "Reproduction steps are mandatory" in qa_text
    assert "First, dedup" in qa_text
    assert "File to the **agent work tracker**" in qa_text
    assert "Do NOT ask the user to review first" in qa_text


def test_evals_simulate_each_authority_outcome_with_readback() -> None:
    """Behavior evals drive a simulated forge tracker through the outcomes the
    authority split must separate, checking readback and absent effects (#254)."""
    cases = _qa_evals()
    assert {1, 2, 3} <= cases.keys()

    for case in (cases[1], cases[2], cases[3]):
        expectations = " ".join(case["expectations"]).lower()
        assert "read back" in expectations
        assert "no assignment" in expectations
        assert "next action" in expectations
        assert "before creating" in expectations
        assert "exactly" in expectations

    # The clear-but-unauthorized case stays silent on authority, so only the
    # skill, not a disclaimer in the prompt, can keep it out of agent readiness.
    unauthorized = cases[1]
    for authority_hint in ("decided", "go-ahead", "may fix", "agent may"):
        assert authority_hint not in unauthorized["prompt"].lower()
    unauthorized_expectations = " ".join(unauthorized["expectations"]).lower()
    assert "ready-for-human" in unauthorized_expectations
    assert "publication" in unauthorized_expectations

    reused = " ".join(cases[2]["expectations"]).lower()
    assert "without asking again" in reused
    assert "even though the grant covers it" in reused

    # The changed-scope report is itself clear, so only the grant's scope,
    # not vagueness, can keep it out of agent readiness.
    changed = " ".join(cases[3]["expectations"]).lower()
    assert "changed scope" in changed
    assert "even though the report is clear" in changed
    assert "missing implementation decision" in changed
