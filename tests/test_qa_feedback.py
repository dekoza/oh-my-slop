"""Static feedback-session contracts; model behavior is exercised by qa evals.

These guards verify the installed handoff and load-bearing instructions, not
whether a model actually stays quiet or a real tracker write succeeds.
"""

import json
from pathlib import Path

from scripts.validate_refs import find_skill_dir


ROOT = Path(__file__).resolve().parents[1]


def qa_dir() -> Path:
    path = find_skill_dir(ROOT / "skills", "qa")
    assert path is not None
    return path


def normalized(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").split())


def test_feedback_command_routes_to_qa_and_forwards_the_report() -> None:
    prompt = ROOT / "prompts/feedback.md"
    assert prompt.exists()
    text = prompt.read_text(encoding="utf-8")
    assert "argument-hint:" in text
    assert text.split("\n---\n", 1)[1].strip() == (
        "Use the `qa` skill to start a feedback session for $@."
    )
    assert "/feedback" in (ROOT / "README.md").read_text(encoding="utf-8")


def test_qa_routes_feedback_without_changing_interactive_qa() -> None:
    owner = normalized(qa_dir() / "SKILL.md")
    assert "references/feedback.md" in owner
    assert "no questions until invited" in owner
    assert "interactive QA" in owner
    assert "Reproduction steps are mandatory" in owner
    assert "feedback observations stay in the session record" in owner
    assert "Only in interactive QA" in owner


def test_capture_preserves_corrections_and_silences_background_completion() -> None:
    flow = normalized(qa_dir() / "references/feedback.md")
    for contract in (
        "stable entry IDs",
        "original wording",
        "amend, connect or retract",
        "minimal receipt",
        "stale background",
        "no tracker writes during capture or review",
        "Background completions",
        "only the user",
    ):
        assert contract in flow


def test_review_questions_are_prepared_then_reconciled_before_invitation() -> None:
    flow = normalized(qa_dir() / "references/feedback.md")
    for contract in (
        "Prepare review questions",
        "`grilling` skill",
        "recommended answer",
        "factual answers",
        "remove questions already answered",
        "skip",
        "Resume capture",
        "recommendations are not user answers",
    ):
        assert contract in flow


def test_end_preserves_unresolved_entries_and_reuses_shared_publication() -> None:
    flow = normalized(qa_dir() / "references/feedback.md")
    for contract in (
        "End feedback",
        "pending",
        "session record",
        "deduplication",
        "readback",
        "extend-versus-separate",
        "unverified",
        "no closing questionnaire",
    ):
        assert contract in flow
    owner = normalized(qa_dir() / "SKILL.md")
    assert "permission to publish, not implementation authority" in owner
    assert "Read each filed issue back" in owner


def test_feedback_evals_cover_corrections_review_and_end_failure() -> None:
    document = json.loads((qa_dir() / "evals/evals.json").read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in document["evals"]}
    assert len(cases) == len(document["evals"])
    assert {1, 2, 3, 4, 5, 6} <= cases.keys()
    fixture = json.loads(
        (qa_dir() / "evals/files/feedback-sessions.json").read_text(encoding="utf-8")
    )
    assert {session["id"] for session in fixture["sessions"]} == {4, 5, 6}
    for case_id in (4, 5, 6):
        assert cases[case_id]["files"] == ["evals/files/feedback-sessions.json"]
        assert len(cases[case_id]["expectations"]) >= 4
    turns = json.dumps(fixture)
    for scenario in ("Correction", "Review feedback", "Resume capture", "permission denied"):
        assert scenario in turns
