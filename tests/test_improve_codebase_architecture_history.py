"""History Awareness: the exploration pass that reads the issue tracker.

Design locked on minder/oh-my-slop#38, implemented per #41.
"""

from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "improve-codebase-architecture"


def _skill_text() -> str:
    return (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")


def _report_text() -> str:
    return (SKILL_ROOT / "references" / "html-report.md").read_text(encoding="utf-8")


def _history_section() -> str:
    text = _skill_text()
    start = text.index("#### History Awareness")
    end = text.index("### 2. Present candidates", start)
    return text[start:end]


def test_orientation_pulls_the_tracker_index_with_the_other_docs() -> None:
    """The index read is orientation, not a step of its own — it belongs on
    Phase 1's opening line beside the docs and the code."""
    assert (
        "existing docs, AGENTS.md, the issue tracker index, and code inspection"
        in _skill_text()
    )


def test_history_awareness_runs_directly_after_temporal_awareness() -> None:
    """Temporal suppression must fire first, so drill-downs are never spent
    matching candidates that will not be rendered."""
    headings = [line for line in _skill_text().splitlines() if line.startswith("###")]

    assert (
        headings.index("#### History Awareness")
        == headings.index("#### Temporal Awareness") + 1
    )


def test_history_awareness_does_not_repeat_the_index_read() -> None:
    """The pass opens by noting the index is already in context. Repeating the
    read instructions is the duplication #35 warned would drift."""
    section = _history_section()

    assert "already pulled during orientation" in section
    assert "no extra queries" in section


def test_read_shape_is_one_index_plus_capped_drill_down() -> None:
    section = _history_section()

    assert "number, title, labels, state, closed-at" in section
    assert "body *and* comments in one call" in section
    assert "~10 issues per review" in section
    assert "always with comments" in section


def test_scope_windows_every_declared_surface() -> None:
    section = _history_section()

    assert "Open is open" in section
    assert "6 months" in section
    assert "all-time" in section
    assert "`wayfinder:*`" in section
    assert "200 issues per surface" in section


def test_drill_down_fires_in_exactly_two_situations() -> None:
    section = _history_section()

    assert "exactly two situations" in section
    assert "title alone cannot settle" in section
    assert "cluster of 3+ issues sharing a module or feature term" in section


def test_the_moot_test_is_the_bar_and_the_judgement_is_binary() -> None:
    """A loose bar would suppress ticketization for every candidate touching a
    busy module, silently gutting the review."""
    section = _history_section()

    assert "resolving that ticket would make the candidate moot" in section
    assert "Sharing a file is not enough" in section
    assert "no confidence tiers" in section
    assert "possible duplicate" in section


def test_three_relations_have_three_distinct_effects() -> None:
    """Copying Temporal Awareness's flat suppression would be wrong: resolved
    means the code already changed; ticketed means the friction is still there."""
    section = _history_section()

    assert "**Ticketed**" in section
    assert "the card renders" in section
    assert "never filed as a new ticket" in section

    assert "**Decided against**" in section
    assert "reuses the ADR rule verbatim" in section

    assert "**Corroborated**" in section
    assert "evidence, never suppression" in section
    assert "never as a counting rule" in section

    assert "Untracked candidates carry nothing" in section


def test_routing_is_backend_agnostic() -> None:
    """The tracker doc knows how many surfaces exist and which is intake. A CLI
    command here would hardcode one backend and drift from that doc."""
    section = _history_section()

    assert "issue-tracker doc" in section
    assert "**List issues**" in section
    assert "**Read an issue**" in section

    for command in ("tea ", "gh issue", "glab ", "--comments", "--state"):
        assert command not in section


def test_no_tracker_degrades_to_a_silent_no_op() -> None:
    """#35 ruled tracker absence must not be a speed bump. That holds for
    reading too — no badges, no nag."""
    section = _history_section()

    assert "no-ops silently" in section
    assert "no badges, no callouts, no citations" in section
    assert "no prompt to run `/setup-project-skills`" in section


def test_report_header_carries_the_tracker_summary_line() -> None:
    text = _report_text()

    assert "tracker summary line" in text
    assert "issues read across" in text
    assert "already ticketed" in text
    assert "previously decided against" in text
    assert "no issue tracker configured — history awareness skipped" in text
    assert "200-issue cap" in text


def test_ticketed_badge_joins_the_existing_badge_row() -> None:
    """Cool neutral, so it reads as metadata rather than a grade."""
    text = _report_text()
    badge_row = next(
        line for line in text.splitlines() if line.startswith("- **Badge row**")
    )

    assert "Ticketed #N" in badge_row
    assert "slate" in badge_row


def test_the_adr_callout_is_widened_to_a_decision_callout() -> None:
    """A closed decision ticket is the same object as an ADR on a different
    surface: one rule, two sources, no new machinery."""
    report = _report_text()

    assert "**Decision callout**" in report
    assert "ADR callout" not in report
    assert "closed decision ticket" in report

    assert "Decision callout" in _skill_text()


def test_corroboration_adds_no_new_card_field() -> None:
    """The relations compose, so a single-value tracker-status field would need
    precedence rules that discard real information."""
    text = _report_text()
    problem_bullet = next(
        line for line in text.splitlines() if line.startswith("- **Problem**")
    )

    assert "cited inline" in problem_bullet
    assert "Tracker:" not in text


def test_evals_are_mid_flow_scenarios_not_natural_language_triggers() -> None:
    """The skill is `disable-model-invocation: true`, so a natural-language
    prompt tests a trigger path that cannot fire."""
    document = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )

    assert document["skill_name"] == "improve-codebase-architecture"
    evals = document["evals"]
    assert len(evals) >= 4

    for eval_case in evals:
        assert eval_case["prompt"].startswith("You are")
        assert eval_case["expectations"]


def test_evals_guard_the_moot_test_and_the_relation_distinction() -> None:
    document = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )
    expectation_sets = [
        "\n".join(eval_case["expectations"]) for eval_case in document["evals"]
    ]

    assert any(
        "moot" in expectations and "corroborat" in expectations.lower()
        for expectations in expectation_sets
    )
    assert any(
        "Ticketed" in expectations and "temporal: resolved" in expectations
        for expectations in expectation_sets
    )
