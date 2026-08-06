"""The grill as a wayfinder work-through of a candidate ticket.

Design locked on minder/oh-my-slop#40, which settled that the in-session grill
claims, resolves and closes the ticket it picked; that the prompt offering it is
separate, defaulted and gated on tickets existing; that `Route:` is honoured
rather than re-decided; and that shortcut markers leave this skill entirely.
Implemented per #43.
"""

from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "workflow" / "improve-codebase-architecture"


def _skill_text() -> str:
    return (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")


def _evals() -> list[dict]:
    document = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )
    return document["evals"]


def _work_through_section() -> str:
    text = _skill_text()
    start = text.index("### 4. ")
    end = text.index("## Reference", start)
    return text[start:end]


def _expectation_sets() -> list[str]:
    return ["\n".join(case["expectations"]) for case in _evals()]


# --------------------------------------------------------------------------- #
# The shape of the loop
# --------------------------------------------------------------------------- #


def test_the_grill_is_a_wayfinder_work_through_of_a_ticket() -> None:
    """The report is gone by now; what the interview establishes survives only
    if it lands on the tracker."""
    section = _work_through_section()

    assert "work-through" in section
    assert "../wayfinder/SKILL.md" in section


def test_the_divergence_from_wayfinders_charting_rule_is_named() -> None:
    """Wayfinder ends charting with 'do not also resolve the other tickets'.
    Ticketize-then-grill breaks that on purpose, and must say so or the next
    reader files it as a bug."""
    section = _work_through_section()

    assert "do not also resolve the other tickets" in section
    assert "on purpose" in section


def test_the_grill_prompt_is_separate_from_selection_and_defaulted() -> None:
    """Selection is about what gets written down; this is about what gets worked
    now. Merging them buries the second question inside a reply to the first."""
    section = _work_through_section()

    assert "Top recommendation" in section
    assert "grill S2 instead" in section
    assert "no, stop here" in section


def test_the_prompt_is_gated_on_at_least_one_candidate_ticket() -> None:
    """A zero-pick run's Top recommendation names a candidate the user just
    vetoed; offering to grill it is the failure this gate prevents."""
    section = _work_through_section()

    assert "zero-pick" in section
    assert "No candidate tickets → no prompt" in section


# --------------------------------------------------------------------------- #
# Claim, resolve, close — conditionally
# --------------------------------------------------------------------------- #


def test_the_ticket_is_claimed_before_any_work() -> None:
    section = _work_through_section()

    assert "Claim the ticket first" in section
    assert "before any work" in section


def test_convergence_closes_the_ticket_and_records_it_on_the_map() -> None:
    section = _work_through_section()

    assert "resolution" in section
    assert "**close**" in section
    assert "Decisions so far" in section


def test_non_convergence_releases_the_claim_and_leaves_the_ticket_open() -> None:
    """A false close and a silent loss are both worse than an open ticket
    carrying real progress."""
    section = _work_through_section()

    assert "release the claim" in section
    assert "unassign" in section
    assert "leave the ticket **open**" in section
    assert "A false close and a silent loss are both worse" in section


# --------------------------------------------------------------------------- #
# Routing
# --------------------------------------------------------------------------- #


def test_the_section_honours_the_route_field_rather_than_re_deciding() -> None:
    """The judgement was made at ticketization, with the report in front of the
    agent that made it."""
    section = _work_through_section()

    assert "`Route:`" in section
    assert "honours it" in section


def test_the_uniform_label_is_stated_to_carry_no_routing_signal() -> None:
    """Otherwise a later editor 'simplifies' the pair by inventing a
    wayfinder:court-jester type."""
    section = _work_through_section()

    assert "carries no routing signal" in section
    assert "the **only** carrier" in section
    assert "wayfinder:court-jester" in section  # named only to forbid it


def test_route_is_a_hint_the_interview_may_escalate_past() -> None:
    section = _work_through_section()

    assert "hint" in section
    assert "Escalate" in section or "escalate" in section


def test_an_escalation_that_fails_to_converge_writes_the_route_back() -> None:
    """Otherwise the next session inherits the card's judgement and rediscovers
    the risk from scratch."""
    section = _work_through_section()

    assert "writes the corrected `Route:` back" in section
    assert "before the claim is released" in section


def test_court_jester_is_a_prelude_to_the_interview_not_an_alternative() -> None:
    """court-jester is one-pass and agent-driven, so its synthesis is the
    agent's; only the live exchange can close a HITL ticket."""
    section = _work_through_section()

    assert "../court-jester/SKILL.md" in section
    assert "**then** the interview" in section
    assert "prelude, not an alternative" in section
    assert "never stands in for the human's side of it" in section


# --------------------------------------------------------------------------- #
# Content that stayed, moved, or went
# --------------------------------------------------------------------------- #


def test_the_three_stopping_criteria_stay_here_as_their_source_of_truth() -> None:
    """§3 emits them onto the map's Notes; they are not moved out of here."""
    section = _work_through_section()

    assert "Public methods: ≤ 8" in section
    assert "Internal regions: ≤ 4" in section
    assert "Total class: ~600 lines" in section
    assert "source of truth" in section


def test_consolidate_then_split_is_reduced_to_a_cross_reference() -> None:
    """codebase-design already carries the rule, and the map's Notes already
    send every session to it."""
    section = _work_through_section()

    assert "../../practice/codebase-design/SKILL.md" in section
    assert "consolidate" in section.lower()


def test_shortcut_marker_generation_is_gone_from_this_skill() -> None:
    """This skill never writes code: tdd is the authoring site and ponytail-debt
    owns the lifecycle."""
    section = _work_through_section()

    assert "generate a `# SHORTCUT:` marker" not in section
    assert "at the relevant code site" not in section
    assert "never touches the reviewed repo's code" in section
    assert "`tdd`" in section


def test_the_broken_note_them_in_the_report_clause_is_gone() -> None:
    """It pointed at a file that is now ephemeral, and ponytail-debt already
    harvests markers from source."""
    section = _work_through_section()

    assert "in the report so they can be tracked" not in section


def test_a_deferred_simplification_becomes_an_implement_ticket_criterion() -> None:
    """The implementer writes the marker when the code is actually written."""
    section = _work_through_section()

    assert "acceptance criterion on the implement ticket" in section
    assert "../ponytail-debt/SKILL.md" in section


def test_the_three_fates_of_a_deferred_simplification_are_stated() -> None:
    section = _work_through_section()

    assert "Still an open decision" in section
    assert "Decided skip with a known upgrade path" in section
    assert "Ruled out" in section
    assert "Out of scope" in section


# --------------------------------------------------------------------------- #
# Routing build-ready work out
# --------------------------------------------------------------------------- #


def test_a_landed_decision_routes_its_implementation_out_in_session() -> None:
    """to-tickets is invoked while the context is at its peak; a design nobody
    filed is the same as a design nobody made."""
    section = _work_through_section()

    assert "../to-tickets/SKILL.md" in section
    assert "in-session" in section
    assert "`workflow:implement`" in section
    assert "`ready-for-agent`" in section
    assert "`ready-for-human`" in section


# --------------------------------------------------------------------------- #
# evals/evals.json
# --------------------------------------------------------------------------- #


def test_an_eval_guards_the_non_convergence_path() -> None:
    """Ticket left open, claim released, progress posted — not closed."""
    assert any(
        "open" in expectations.lower()
        and "unassign" in expectations.lower()
        and "comment" in expectations.lower()
        and "not close" in expectations.lower()
        for expectations in _expectation_sets()
    )


def test_an_eval_guards_the_route_write_back_on_a_failed_escalation() -> None:
    """The compound case: the interview escalated past the card's judgement and
    then ran out — the corrected Route: must survive the released claim."""
    assert any(
        "Route:" in expectations
        and "escalat" in expectations.lower()
        and "unassign" in expectations.lower()
        for expectations in _expectation_sets()
    )


def test_an_eval_guards_court_jester_running_before_the_interview() -> None:
    """And that the interview, not court-jester, is what closes the ticket."""
    assert any(
        "court-jester" in expectations
        and "before" in expectations.lower()
        and "interview" in expectations.lower()
        and "clos" in expectations.lower()
        for expectations in _expectation_sets()
    )


def test_an_eval_guards_the_zero_pick_run_offering_no_grill() -> None:
    assert any(
        "grill" in expectations.lower() and "no candidate ticket" in expectations.lower()
        for expectations in _expectation_sets()
    )


def test_an_eval_guards_the_deferred_shortcut_landing_on_a_filed_ticket() -> None:
    """The one place the old flow wrote code, and the one this skill must not."""
    assert any(
        "SHORTCUT" in expectations
        and "to-tickets" in expectations
        and "implement" in expectations.lower()
        for expectations in _expectation_sets()
    )
