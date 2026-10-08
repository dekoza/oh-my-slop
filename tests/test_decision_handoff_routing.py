"""Decision handoffs ask the human through grilling or return the choice to a caller.

Issue #265: closing wording such as "stop and report ... the next owner decision" steered
agents to list owner decisions as status instead of asking them. These checks pin the
routing at every handoff site; the matched model runs live outside the package.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from scripts.validate_refs import find_skill_dir
from tests.test_skill_requires import declared_requires, split_frontmatter

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "skills"

HANDOFF_SKILLS = ["fix-pr", "implement", "implement-spec", "resolving-merge-conflicts", "to-spec"]

# Wording that hands an unresolved decision onward: the sites the issue lists.
HANDOFF = re.compile(
    r"owner decision|return the choice|return consequential|remaining decisions"
    r"|awaiting the exact decision|missing decision",
    re.IGNORECASE,
)
RETURN_TO_CALLER = re.compile(r"\breturn\w*\b[^.]*\b(?:caller|publisher|coordinator)\b", re.IGNORECASE)


def paragraphs(skill: str) -> list[str]:
    _, body = split_frontmatter(find_skill_dir(SKILLS_DIR, skill) / "SKILL.md")
    blocks = re.split(r"\n\s*\n|\n(?=\s*(?:- |\d+\. ))", body)
    return [" ".join(block.split()) for block in blocks if block.strip()]


@pytest.mark.parametrize("skill", HANDOFF_SKILLS)
def test_every_decision_handoff_asks_through_grilling_or_returns_to_caller(skill: str) -> None:
    sites = [text for text in paragraphs(skill) if HANDOFF.search(text)]
    assert sites, f"{skill}: expected at least one decision-handoff site"
    for text in sites:
        assert "grilling" in text or RETURN_TO_CALLER.search(text), (
            f"{skill}: decision handoff neither asks via grilling nor returns to a caller: {text[:160]}"
        )
    assert "grilling" in declared_requires(find_skill_dir(SKILLS_DIR, skill))


def test_fix_pr_asks_non_blocking_follow_ups_and_approvals() -> None:
    rule = next(text for text in paragraphs("fix-pr") if "Keep decisions human" in text)
    assert "grilling" in rule
    assert "follow-up" in rule and "approval" in rule, (
        "Non-blocking follow-ups and approvals are questions for the user, not status"
    )


def test_grilling_description_covers_presenting_open_decisions() -> None:
    frontmatter, _ = split_frontmatter(find_skill_dir(SKILLS_DIR, "grilling") / "SKILL.md")
    description = " ".join(yaml.safe_load(frontmatter)["description"].split())
    assert description.startswith(("Use when", "Use whenever"))
    assert "final report" in description and "approvals" in description
    assert len(description.split()) <= 80
    assert len(re.findall(r"[.!?](?:\s|$)", description)) <= 3
    triggers = description.split("Triggers on:", 1)[1]
    assert triggers.count('"') // 2 <= 8
