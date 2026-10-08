"""Behavioral contract for the reusable grilling interview format."""

import json
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


def test_competition_set_reuses_trigger_queries_with_owning_skills() -> None:
    evals = SKILL_MD.parent / "evals"
    triggers = {
        item["query"]: item["should_trigger"]
        for item in json.loads((evals / "trigger-evals.json").read_text(encoding="utf-8"))
    }
    competition = json.loads((evals / "trigger-competition.json").read_text(encoding="utf-8"))

    assert competition
    for item in competition:
        assert item["query"] in triggers
        assert triggers[item["query"]] == (item["expected"] == "grilling")
