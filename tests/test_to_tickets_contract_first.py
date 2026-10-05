"""#191: contract-first ordering, walking skeleton first, one language per builder;
#256: reuse of sufficient accepted unchanged interfaces with recorded evidence.

Decision evidence: docs/surveys/swarm-forge-adoption-survey-2026-08-30.md,
adoption item 5 and the two #135 notes. The skill emits an explicit inspected
ordering contract; an external executor's enforcement is not presumed here.
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts.validate_refs import find_skill_dir

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"


def skill_text(name: str) -> str:
    skill_dir = find_skill_dir(SKILLS_ROOT, name)
    assert skill_dir is not None, f"no bundled skill named {name!r}"
    return (skill_dir / "SKILL.md").read_text(encoding="utf-8")


def test_to_tickets_emits_a_contract_ticket_per_cross_component_interface() -> None:
    text = skill_text("to-tickets")

    assert "<contract-ticket-template>" in text
    assert "owned by the higher-level component" in text
    assert "An accepted contract is immutable" in text
    # Revising an accepted contract is a new ticket, never an edit.
    assert "a new version is a **new ticket**" in text
    # The dependent side proves the contract with a stub before the real thing exists.
    assert "from the dependent's side against a stub" in text


def test_to_tickets_publishes_contract_tickets_before_their_dependents() -> None:
    text = skill_text("to-tickets")

    assert "contract tickets before their dependents, so a dependent's number is always higher" in text


def test_to_tickets_quiz_asks_about_components() -> None:
    text = skill_text("to-tickets")

    assert "more than one component" in text


def test_to_tickets_requires_scaffolding_then_a_product_walking_skeleton() -> None:
    text = skill_text("to-tickets")

    assert "first product-behaviour ticket is a walking skeleton" in text
    assert "does not produce a runnable entry point, **refuse** it" in text
    # Executable contracts consume scaffolding; the product path consumes contracts.
    assert "after scaffolding and required contract tickets" in text


def test_implement_names_the_shared_vocabulary_as_a_builder_input() -> None:
    """Parallel builders drift into synonymous vocabularies unless one language is an
    input to every worker — the reviewer reading CONTEXT.md is not enough (#135).
    The closure half (`domain-modeling` in implement's requires) is held by
    tests/test_skill_requires.py."""
    text = skill_text("implement")

    assert "read it before editing" in text
    assert "`CONTEXT.md`" in text
    # Not a write target: N parallel slices must not race on one glossary file.
    assert "leave the glossary edit to the map's owner" in text


def _normalized(text: str) -> str:
    return " ".join(text.split())


def test_unchanged_accepted_interface_is_reused_with_recorded_evidence() -> None:
    """A sufficient accepted interface that stays unchanged needs no new contract
    ticket, but the plan records where the accepted shape lives, who owns it and
    what accepted it; a filename or a closed issue alone proves nothing (#256)."""
    text = _normalized(skill_text("to-tickets"))

    assert "**Reuse a sufficient accepted interface that stays unchanged.**" in text
    assert "consumers record its authoritative source, its owner and the acceptance evidence" in text
    # Positive definition first, so a closed issue that links an accepting test counts.
    assert "the accepted artifact plus the test or review that accepted it" in text
    assert "A filename or a closed issue alone is not acceptance evidence" in text
    display = text.split("For each ticket, show:", 1)[1].split("Show the proposed concurrent sets", 1)[0]
    assert "stable inputs (source, owner, evidence)" in display


def test_contract_tickets_cover_new_or_changed_interfaces_only() -> None:
    """The contract-first rule and its quiz no longer demand a contract ticket for
    every crossing interface; they demand one for each new or changed interface
    and recorded evidence for each reused one (#256)."""
    text = _normalized(skill_text("to-tickets"))

    assert "One contract ticket per cross-component interface, first." not in text
    assert "**One contract ticket per new or changed cross-component interface, first.**" in text
    assert "When tickets fall on both sides of one, a new or changed interface between them" in text
    quiz = text.split("Does the work span more than one component", 1)[1].split("- Should any", 1)[0]
    assert "each new or changed one" in quiz
    assert "each reused one its recorded evidence" in quiz


def test_missing_reuse_evidence_or_a_changed_shape_is_not_reuse() -> None:
    """Without source, owner or acceptance evidence an interface is unknown impact
    that blocks approval; changing, versioning or editing the shape is a contract
    or an overlap, never reuse. Both ticket templates ask for the evidence (#256)."""
    text = _normalized(skill_text("to-tickets"))
    reuse = text.split("**Reuse a sufficient accepted interface that stays unchanged.**", 1)[1].split("**The last ticket", 1)[0]

    assert "Missing source, owner or evidence makes the interface unknown impact, not reusable" in reuse
    assert "investigate it or plan its contract ticket" in reuse
    assert "keep its dependents unapproved until it resolves" in reuse
    assert "Changing or versioning the shape, or editing its files, is never reuse" in reuse
    for template in ("<local-ticket-template>", "<issue-template>"):
        block = text.split(template, 1)[1].split("</" + template[1:], 1)[0]
        assert "accepted unchanged inputs with source, owner and acceptance evidence" in block, template


def test_catalogue_states_interface_reuse() -> None:
    """The README row tells planners that accepted unchanged interfaces are reused
    and that contract tickets are for new or changed ones (#256)."""
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines() if "skills/workflow/to-tickets/SKILL.md" in line and line.startswith("|"))

    assert "contract-first ordering for new or changed interfaces" in row
    assert "reuse of evidenced unchanged ones" in row


def _evals() -> dict[int, dict]:
    skill_dir = find_skill_dir(SKILLS_ROOT, "to-tickets")
    assert skill_dir is not None
    document = json.loads((skill_dir / "evals" / "evals.json").read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in document["evals"]}
    assert len(cases) == len(document["evals"])
    return cases


def test_planning_evals_pair_every_interface_reuse_outcome() -> None:
    """Paired planning cases cover sufficient reuse, missing evidence or ownership,
    a new shape, a new version and mutable overlap (#256)."""
    cases = _evals()
    assert {1, 2, 3, 4, 5, 6} <= cases.keys()

    # Case 3 is the sufficient-reuse positive control, so it supplies the evidence.
    assert "accepted in ADR-0007" in cases[3]["prompt"]
    # Case 4 reuses EnrollmentStore.list, so it supplies that evidence too.
    assert "accepted in ADR-0003" in cases[4]["prompt"]
    assert any("EnrollmentStore.list" in e and "acceptance evidence" in e for e in cases[4]["expectations"])
    # Case 5's concurrency must rest on inspection, not on directory names.
    assert "Inspection confirms" in cases[5]["prompt"]
    assert any("authoritative source, owner and acceptance evidence" in e for e in cases[3]["expectations"])
    assert any("registry" in e for e in cases[3]["expectations"])  # mutable overlap

    reuse_and_gap = " ".join(cases[5]["expectations"])
    assert "no contract ticket and no producer edge" in reuse_and_gap
    assert "Does not treat docs/notify.md or closed issue #12 as acceptance evidence" in reuse_and_gap
    assert "unknown impact" in reuse_and_gap

    new_shapes = " ".join(cases[6]["expectations"])
    assert "new PricingQuote version" in new_shapes
    assert "not by editing v2" in new_shapes
    assert "OrderPlaced" in new_shapes
    assert "against a stub" in new_shapes
