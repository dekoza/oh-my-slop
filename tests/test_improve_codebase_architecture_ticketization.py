"""Ticketizing chosen candidates as a wayfinder map.

Design locked on minder/oh-my-slop#36 (selection UX) and #37 (map and ticket
content), amended by #38 (the `Ticketed` seed term) and #40 (unassigned tickets,
the stopping criteria on map Notes). Implemented per #42.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "improve-codebase-architecture"


def _skill_text() -> str:
    return (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")


def _report_text() -> str:
    return (SKILL_ROOT / "references" / "html-report.md").read_text(encoding="utf-8")


def _evals() -> list[dict]:
    document = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )
    return document["evals"]


def _ticketization_section() -> str:
    text = _skill_text()
    start = text.index("### 3. Ticketize the chosen candidates")
    end = text.index("### 4. ", start)
    return text[start:end]


def _grilling_section() -> str:
    text = _skill_text()
    return text[text.index("### 4. Grilling loop") :]


def _map_notes_stopping_criteria_line() -> str:
    """The criteria bullet on the map-body template, wrapped lines rejoined."""
    lines = _ticketization_section().splitlines()
    start = next(
        index
        for index, line in enumerate(lines)
        if line.lstrip("- ").startswith("Stopping criteria")
    )
    bullet = [lines[start].lstrip("- ")]
    for line in lines[start + 1 :]:
        if not line.startswith("  ") or line.lstrip().startswith("- "):
            break
        bullet.append(line.strip())
    return " ".join(bullet)


# --------------------------------------------------------------------------- #
# Placement
# --------------------------------------------------------------------------- #


def test_ticketization_sits_between_the_report_and_the_grilling_loop() -> None:
    """This is the new middle of the skill: the report is written, the map is
    charted, and only then is anything grilled."""
    text = _skill_text()

    assert (
        text.index("### 2. Present candidates")
        < text.index("### 3. Ticketize the chosen candidates")
        < text.index("### 4. Grilling loop")
    )


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #


def test_selection_is_default_with_veto() -> None:
    """Named picks alone put the whole enumeration burden on the user right
    after a long report — the round-trip friction this skill exists to kill."""
    section = _ticketization_section()

    assert "default-with-veto" in section
    assert "confirm or amend" in section


def test_the_seed_is_strength_plus_fresh_plus_not_ticketed() -> None:
    """`Ticketed` is excluded because ticketizing it would manufacture the
    tracker duplicate History Awareness exists to prevent."""
    section = _ticketization_section()

    assert "`Strong`" in section
    assert "`Worth exploring`" in section
    assert "`temporal: fresh`" in section
    assert "not `Ticketed`" in section


def test_the_proposal_is_stated_in_the_terminal_with_what_was_skipped() -> None:
    """The user must never have to re-scan the HTML to know what is being
    proposed."""
    section = _ticketization_section()

    assert "in the terminal" in section
    assert "never have to **re-scan** the HTML" in section
    assert "naming what was skipped and how to pull it in" in section


def test_candidate_ids_are_axis_prefixed_and_assigned_in_report_order() -> None:
    """Title-based reference is ambiguous exactly where the axes overlap, and
    one module may hold a card on both axes."""
    section = _ticketization_section()

    assert "`D1…Dn`" in section
    assert "`S1…Sn`" in section
    assert "report order" in section


# --------------------------------------------------------------------------- #
# Ticketization routes through wayfinder
# --------------------------------------------------------------------------- #


def test_map_and_ticket_operations_route_to_wayfinder() -> None:
    section = _ticketization_section()

    assert "chart a wayfinder map" in section.lower()
    assert "../wayfinder/SKILL.md" in section
    assert "no tracker operations of its own" in section


def test_the_section_inlines_no_tracker_operations() -> None:
    """#35 removed every skill-owned tracker operation because a second copy of
    the map/ticket ops would drift from wayfinder's."""
    section = _ticketization_section()

    for command in ("tea ", "gh issue", "glab ", "curl "):
        assert command not in section

    # The map label, parentage and the frontier query are wayfinder's to state.
    assert "wayfinder:map" not in section


def test_no_tracker_repos_inherit_wayfinders_fallback() -> None:
    """No degrade path and no hard stop — #35 ruled tracker absence must not be
    a speed bump."""
    section = _ticketization_section()

    assert "local-markdown fallback" in section
    assert "/setup-project-skills" in section


def test_a_written_report_always_produces_a_map() -> None:
    """A run where the user vetoes everything is the most decision-dense output
    there is; under a threshold rule that record would have nowhere to live."""
    section = _ticketization_section()

    assert "zero-pick" in section
    assert "No report → no map" in section


def test_candidate_tickets_are_created_unassigned() -> None:
    """Creating them assigned would break wayfinder's frontier query on the very
    next session — the map would look fully worked the moment it was charted."""
    section = _ticketization_section()

    assert "unassigned" in section
    assert "frontier" in section


def test_every_candidate_ticket_carries_the_grilling_label() -> None:
    """No new label type is invented for court-jester routing; that would bend
    wayfinder's vocabulary to fit this skill."""
    section = _ticketization_section()

    assert "`wayfinder:grilling`" in section
    assert "wayfinder:court-jester" in section  # named only to forbid it


# --------------------------------------------------------------------------- #
# The candidate ticket body
# --------------------------------------------------------------------------- #


def test_the_ticket_body_is_question_first_evidence_below() -> None:
    section = _ticketization_section()

    assert "## Question" in section
    assert "## From the review" in section
    assert section.index("## Question") < section.index("## From the review")


def test_the_solution_is_demoted_to_a_proposed_shape() -> None:
    """It was written before any interview happened; that is its actual
    epistemic status."""
    section = _ticketization_section()

    assert "Proposed shape" in section
    assert "the review's guess, not a decision" in section


def test_the_evidence_is_carried_across_not_re_derived() -> None:
    """The report is ephemeral, so evidence not carried is lost permanently."""
    section = _ticketization_section()

    assert "**Problem**" in section
    assert "**Files:**" in section
    assert "**Benefits**" in section


def test_the_candidate_id_is_provenance_in_the_body_never_a_title_prefix() -> None:
    """The id dies with the report; the ticket's durable identity is its index
    and its name."""
    section = _ticketization_section()

    assert "never as a title prefix" in section


def test_the_before_after_diagram_is_deliberately_dropped() -> None:
    """Transcribing Mermaid into ticket bodies would create a standing incentive
    to draw every diagram in Mermaid so it survives ticketization."""
    section = _ticketization_section()

    assert "not transcribed" in section
    assert "deliberately dropped" in section


def test_court_jester_routing_rides_on_the_metadata_line_when_contested() -> None:
    section = _ticketization_section()

    assert "**Route:** court-jester" in section
    assert "contested" in section


# --------------------------------------------------------------------------- #
# The map body
# --------------------------------------------------------------------------- #


def test_the_map_title_names_the_repo_and_the_date() -> None:
    section = _ticketization_section()

    assert "Architecture review — <repo> — <date>" in section


def test_the_destination_is_the_honest_basket_of_decisions() -> None:
    """A thematic destination needs a unifying story that usually does not
    exist; an aspirational one is never reachable, so the map could never
    close."""
    section = _ticketization_section()

    assert "Done when no candidate ticket remains open" in section
    assert "**basket** of independent decisions" in section


def test_the_notes_block_carries_what_a_later_session_cannot_reach() -> None:
    """A work-through session weeks later arrives via `/wayfinder` having never
    loaded this skill."""
    section = _ticketization_section()

    assert "temp path" in section
    assert "`codebase-design`" in section
    assert "`grilling`" in section
    assert "`court-jester`" in section
    assert "independent decisions unless a blocking edge says otherwise" in section


def test_the_notes_block_carries_the_three_deepen_stopping_criteria() -> None:
    """They exist only in this skill, and the skill is not in the repo under
    review — a path reference on the map resolves to nothing."""
    section = _ticketization_section()

    assert "≤ 8" in section or "≤8" in section
    assert "≤ 4" in section or "≤4" in section
    assert "600 lines" in section
    assert "deepen" in section
    assert "council consensus" not in section


def test_the_map_notes_criteria_match_their_source_of_truth() -> None:
    """The numbers live in two places on purpose — the Grilling loop is their
    source, and the map must carry them because a work-through session never
    loads this skill. The duplication is mandated; the drift is not."""
    source = _grilling_section()
    emitted = _map_notes_stopping_criteria_line()

    public_methods = re.search(r"Public methods: ≤ (\d+)", source)
    internal_regions = re.search(r"Internal regions: ≤ (\d+)", source)
    total_lines = re.search(r"Total class: ~(\d+) lines", source)
    assert public_methods and internal_regions and total_lines

    assert f"≤ {public_methods.group(1)}" in emitted
    assert f"≤ {internal_regions.group(1)}" in emitted
    assert f"~{total_lines.group(1)} lines" in emitted

    # Three numbers, not four: the per-region line count stays in the source.
    assert "120" not in emitted


def test_the_stopping_criteria_are_emitted_even_on_a_simplify_only_map() -> None:
    """Three lines of harmless text beat a conditional SKILL.md must state and
    the evals must cover."""
    section = _ticketization_section()

    assert "simplify-only" in section


def test_not_yet_specified_is_charted_empty() -> None:
    """Every candidate arrives with a full report card, so nothing is fog."""
    section = _ticketization_section()

    assert "Not yet specified" in section
    assert "is charted empty" in section


# --------------------------------------------------------------------------- #
# Out of scope — three classes
# --------------------------------------------------------------------------- #


def test_out_of_scope_leads_each_line_with_a_bolded_class_label() -> None:
    """A later run reads this section for decision-respect, so the class must be
    scannable."""
    section = _ticketization_section()

    assert "**Vetoed**" in section
    assert "**Not added**" in section
    assert "**Already ticketed**" in section


def test_vetoed_quotes_the_users_reason_verbatim() -> None:
    """The agent must never invent a rationale for a candidate the user never
    spoke about."""
    section = _ticketization_section()

    assert "verbatim" in section
    assert "never invent" in section


def test_not_added_uses_a_fixed_phrase() -> None:
    section = _ticketization_section()

    assert "below the proposed set; not raised" in section


def test_already_ticketed_is_the_sole_class_that_links() -> None:
    """Stated plainly so nobody later 'fixes' it by creating tickets purely to
    close them."""
    section = _ticketization_section()

    assert "links the pre-existing ticket" in section
    assert "no link" in section
    assert "purely to close them" in section


def test_candidates_ruled_out_during_work_through_keep_wayfinders_rule() -> None:
    """Two paths into one section."""
    section = _ticketization_section()

    assert "close the ticket, link it" in section


# --------------------------------------------------------------------------- #
# Blocking edges
# --------------------------------------------------------------------------- #


def test_the_blocking_rule_is_one_narrow_conjunction() -> None:
    """The obvious rule — same module on both axes, deepen blocks simplify — is
    wrong as stated: the direction depends on the kind of simplification."""
    section = _ticketization_section()

    assert "Files overlap" in section
    assert "splitting or reorganizing rather than deleting" in section
    assert "Otherwise no edge" in section


def test_the_blocking_rule_says_it_is_deliberately_rare_and_why() -> None:
    """All five ponytail-audit categories are deletions, and a wrong edge hides
    a ticket and then refuses to let anyone close it."""
    section = _ticketization_section()

    assert "deliberately rare" in section
    assert "deletions" in section
    assert "refuses to let anyone close it" in section


def test_the_top_recommendation_is_map_order_not_an_edge() -> None:
    section = _ticketization_section()

    assert "first in map order" in section
    assert "not as a blocking edge" in section


# --------------------------------------------------------------------------- #
# references/html-report.md
# --------------------------------------------------------------------------- #


def test_each_card_renders_its_candidate_id_badge() -> None:
    """This is what makes the veto usable."""
    badge_row = next(
        line for line in _report_text().splitlines() if line.startswith("- **Badge row**")
    )

    assert "D1" in badge_row
    assert "S1" in badge_row


# --------------------------------------------------------------------------- #
# evals/evals.json
# --------------------------------------------------------------------------- #


def test_evals_stay_mid_flow_scenarios() -> None:
    for eval_case in _evals():
        assert eval_case["prompt"].startswith("You are")
        assert eval_case["expectations"]


def test_an_eval_guards_the_ticketed_exclusion_from_the_seed() -> None:
    """The card renders; only the filing is suppressed."""
    expectation_sets = ["\n".join(case["expectations"]) for case in _evals()]

    assert any(
        "Ticketed" in expectations
        and "seed" in expectations.lower()
        and "card" in expectations.lower()
        for expectations in expectation_sets
    )


def test_an_eval_guards_the_blocking_rule_not_firing_for_a_deletion() -> None:
    """A blanket 'same files, deepen blocks simplify' rule would fire constantly
    and be wrong nearly every time."""
    expectation_sets = ["\n".join(case["expectations"]) for case in _evals()]

    assert any(
        "block" in expectations.lower()
        and ("delet" in expectations.lower())
        and "no edge" in expectations.lower()
        for expectations in expectation_sets
    )
