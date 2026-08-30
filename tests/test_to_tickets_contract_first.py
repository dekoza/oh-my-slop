"""#191: contract-first ordering, walking skeleton first, one language per builder.

Decision evidence: docs/surveys/swarm-forge-adoption-survey-2026-08-30.md,
adoption item 5 and the two #135 notes. The factory enforces blocking edges
mechanically (spec §3.2), so the skills only have to *emit* the order.
"""

from __future__ import annotations

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


def test_to_tickets_refuses_a_breakdown_whose_first_ticket_is_not_a_walking_skeleton() -> None:
    text = skill_text("to-tickets")

    assert "first implementation ticket is a walking skeleton" in text
    assert "does not produce a runnable entry point, **refuse** it" in text
    # Contract tickets precede the skeleton; the refusal must not fire on them.
    assert "the first ticket after any contract tickets" in text


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
