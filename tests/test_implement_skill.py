"""Scope contract for the implementation worker skill."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "workflow" / "implement"


def skill_parts() -> tuple[dict[str, object], str]:
    text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    _, frontmatter, body = text.split("---", 2)
    return yaml.safe_load(frontmatter), body


def test_implement_owns_one_frontier_ticket_not_graph_orchestration() -> None:
    frontmatter, body = skill_parts()
    description = frontmatter["description"]

    assert description.startswith("Use when")
    assert "one ticket-sized" in description
    assert "exactly one unblocked frontier ticket" in body
    assert "fresh session" in body
    assert "caller or controller" in body
    assert "Never implement in the primary checkout" in body


def test_the_review_rubrics_are_read_before_the_build_not_after_it() -> None:
    """A first-round rejection costs a fresh implementation plus a fresh verify.

    Both rubrics are already in this skill's closure, so the axes are reachable;
    what makes them cheap is reading them *before* the first edit. The order in
    the body is the contract: the rubric section precedes the build section, and
    the self-review is a gate on committing rather than a trailing formality.
    """
    frontmatter, body = skill_parts()
    requires = frontmatter["requires"]

    assert "review-standards" in requires
    assert "review-spec" in requires

    rubrics = body.index("## Read the rubrics before you build")
    build = body.index("## Build and verify")
    assert rubrics < build, "the rubrics are read before the first edit, not after the last"

    assert "before the first edit" in body
    assert "Fix every blocking finding" in body
    assert "no blocking finding left open" in body


def test_readme_describes_the_worker_scope() -> None:
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    implement_row = next(
        line for line in readme.splitlines() if "workflow/implement/SKILL.md" in line
    )

    assert "one ticket-sized" in implement_row
    assert "spec or tickets to completion" not in implement_row


def test_multi_ticket_eval_guards_the_worker_boundary() -> None:
    evals = json.loads(
        (SKILL_ROOT / "evals" / "evals.json").read_text(encoding="utf-8")
    )
    multi_ticket = next(item for item in evals["evals"] if item["id"] == 1)
    expectations = "\n".join(multi_ticket["expectations"])

    assert "one unblocked frontier ticket" in expectations
    assert "dedicated worktree" in expectations
    assert "does not attempt the blocked tickets" in expectations
