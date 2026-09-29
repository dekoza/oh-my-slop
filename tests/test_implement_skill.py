"""Scope contract for the implementation worker skill."""

from __future__ import annotations

import json
import subprocess
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
    the committed candidate's review is a gate on publication, not a trailing formality.
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


def test_candidate_is_committed_before_review_of_a_three_dot_diff(tmp_path: Path) -> None:
    """An uncommitted candidate is absent from the reviewers' public Git interface."""
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=tmp_path, check=True, capture_output=True,
            text=True, timeout=15,
        ).stdout.strip()

    git("init", "-b", "main")
    git("config", "user.name", "Fixture Author")
    git("config", "user.email", "fixture@example.invalid")
    feature = tmp_path / "feature.txt"
    feature.write_text("old behavior\n", encoding="utf-8")
    git("add", "feature.txt")
    git("commit", "-m", "test: establish review base")
    base = git("rev-parse", "HEAD")
    feature.write_text("new behavior\n", encoding="utf-8")
    assert git("diff", f"{base}...HEAD") == ""

    _, body = skill_parts()
    assert body.index("Commit the inspected candidate") < body.index(
        "use the `two-axis-review` skill to review"
    )
    assert "base SHA" in body and "reviewed head SHA" in body
    assert "Any change after review invalidates" in body
    assert "additive commit" in body

    git("add", "feature.txt")
    git("commit", "-m", "feat: record the candidate")
    assert "+new behavior" in git("diff", f"{base}...HEAD")


def test_branch_only_delivery_is_explicit_and_preserves_standalone_publication() -> None:
    """The caller owns integration/publication without weakening worker acceptance."""
    _, body = skill_parts()
    assert "## Delivery: standalone or branch-only" in body
    assert "Default to **standalone**" in body
    assert "explicit operator or caller authorization" in body
    assert "named ticket" in body and "exact base SHA" in body
    assert "verified run-local prerequisite evidence" in body
    assert "not a claim that its tracker blockers are closed" in body
    assert "In branch-only mode, do not push, open a PR, close tickets" in body
    assert "## Return the branch-only handoff" in body
    for evidence in ("worktree path", "base SHA", "reviewed head SHA", "requirement trace",
                     "unresolved obligations", "publisher"):
        assert evidence in body
    assert "occupied or wrong-base worktree" in body
    assert "pause and preserve" in body
    assert "In standalone mode" in body


def test_worker_repairs_have_a_default_stop_and_preserve_interface_agreement() -> None:
    _, body = skill_parts()
    assert "repair budget of **two rounds**" in body
    assert "One round means" in body
    assert "exhausted" in body and "stop and report" in body
    assert "Advisory findings" in body
    assert "approved ticket/spec may already establish" in body
    assert "second approval of an accepted contract" in body
    assert "required acceptance test skipped" in body
