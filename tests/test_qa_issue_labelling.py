import json
from pathlib import Path

from scripts.validate_refs import find_skill_dir


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
WORKFLOW_LABEL = "workflow:implement"


def test_qa_labels_the_issues_it_files_for_implementation_routing() -> None:
    """Forge-backed qa issues carry a category, the workflow marker, and a
    state, resolved through the project's triage label mapping — so the
    issues route to /implement instead of landing bare (Gitea #65)."""
    qa_text = (find_skill_dir(SKILLS_ROOT, "qa") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    label_template_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "triage-labels.md"
    ).read_text(encoding="utf-8")

    for role in ("bug", "enhancement", "ready-for-agent", "ready-for-human"):
        assert f"`{role}`" in qa_text
        assert role in label_template_text

    assert f"`{WORKFLOW_LABEL}`" in qa_text
    assert WORKFLOW_LABEL in label_template_text
    assert "label mapping" in qa_text


def _qa_section(heading: str) -> str:
    qa_text = (find_skill_dir(SKILLS_ROOT, "qa") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    return qa_text.split(f"{heading}\n", 1)[1].split("\n#### ", 1)[0]


def test_clear_reproduction_alone_does_not_make_an_issue_agent_ready() -> None:
    """Concrete steps and an unambiguous expectation establish clarity; agent
    readiness also needs a human grant covering the issue's scope (#254)."""
    labels = _qa_section("#### Labels (forge-backed trackers only)")
    normalized = " ".join(labels.split())

    assert (
        "Apply `ready-for-agent` when the reproduction steps are concrete"
        not in normalized
    )
    assert "**Clarity**" in normalized
    assert "**Authority**" in normalized
    assert "permission to publish, not implementation authority" in normalized
    assert "Apply `ready-for-agent` only when both hold" in normalized


def test_scoped_grant_is_reused_but_never_stretched_or_given_to_human_only_work() -> None:
    """A sufficient same-scope grant is reused without another approval round;
    changed scope pauses for the missing decision, and human-only requirements
    stay human-owned whatever the grant (#254)."""
    labels = " ".join(
        _qa_section("#### Labels (forge-backed trackers only)").split()
    )

    assert "reuse it without asking again" in labels
    assert "does not stretch to changed scope" in labels
    assert "missing decision and its owner" in labels
    assert "stays `ready-for-human` whatever the grant" in labels


def test_breakdown_records_blockers_without_granting_execution_or_concurrency() -> None:
    """Separating symptoms into issues and publishing them is not a grant to
    start work or to run slices concurrently (#254)."""
    breakdown = " ".join(_qa_section("#### For a breakdown (multiple issues)").split())

    assert "can start immediately" not in breakdown
    assert "Maximize parallelism" not in breakdown
    assert "None known" in breakdown
    assert "grants neither execution nor safe concurrency" in breakdown


def test_filed_issues_are_read_back_and_filing_starts_no_work() -> None:
    """Each filed issue's labels and body are verified by readback, and filing
    claims, assigns or starts nothing (#254)."""
    rules = " ".join(_qa_section("#### Rules for all issue bodies").split())

    assert "read each filed issue back" in rules
    assert "no assignment, claim, branch, fix or dispatch" in rules


def test_preserved_capture_contract_survives_the_authority_split() -> None:
    """The authority split keeps light clarification, mandatory reproduction,
    deduplication and agent-work routing intact (#254)."""
    qa_text = (find_skill_dir(SKILLS_ROOT, "qa") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    normalized = " ".join(qa_text.split())

    assert "at most 2-3 short clarifying questions" in normalized
    assert "Reproduction steps are mandatory" in normalized
    assert "First, dedup" in normalized
    assert "File to the **agent work tracker**" in normalized
    assert "Do NOT ask the user to review first" in normalized


def test_evals_simulate_each_authority_outcome_with_readback() -> None:
    """Behavior evals drive a simulated forge tracker through the outcomes the
    authority split must separate, checking readback and absent effects (#254)."""
    document = json.loads(
        (find_skill_dir(SKILLS_ROOT, "qa") / "evals" / "evals.json").read_text(
            encoding="utf-8"
        )
    )
    assert document["skill_name"] == "qa"
    cases = {case["id"]: case for case in document["evals"]}
    assert set(cases) == {1, 2, 3}

    for case in cases.values():
        expectations = " ".join(case["expectations"]).lower()
        assert "read back" in expectations
        assert "no assignment" in expectations

    unauthorized = " ".join(cases[1]["expectations"]).lower()
    assert "ready-for-human" in unauthorized
    assert "publication" in unauthorized

    reused = " ".join(cases[2]["expectations"]).lower()
    assert "without asking again" in reused
    assert "human-only" in reused

    changed = " ".join(cases[3]["expectations"]).lower()
    assert "changed scope" in changed
    assert "missing decision" in changed
