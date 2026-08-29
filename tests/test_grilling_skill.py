"""Behavioral contract for the reusable grilling interview format."""

from pathlib import Path

SKILL_MD = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "workflow"
    / "grilling"
    / "SKILL.md"
)


def test_round_example_separates_consecutive_questions() -> None:
    text = SKILL_MD.read_text(encoding="utf-8")
    example = text.split("```", 2)[1]

    first_question = example.index("❓ **Q1**")
    separator = example.index("\n---\n")
    second_question = example.index("❓ **Q2**")

    assert first_question < separator < second_question
    assert example.count("➡️ <your recommended answer>") == 2
