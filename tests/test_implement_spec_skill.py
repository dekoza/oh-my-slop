"""Install and process contracts for the supervised whole-spec coordinator.

Prose checks protect instructions; Git fixtures demonstrate the failure modes.
Neither alone proves that a model follows the skill during a real build.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/workflow/implement-spec"


def test_implement_spec_is_a_manual_coordinator_using_branch_only_workers() -> None:
    path = SKILL / "SKILL.md"
    assert path.is_file(), "The approved supervised coordinator is not installed"
    _, frontmatter, body = path.read_text(encoding="utf-8").split("---", 2)
    metadata = yaml.safe_load(frontmatter)
    assert metadata["name"] == "implement-spec"
    assert metadata["disable-model-invocation"] is True
    assert {"implement", "two-axis-review", "git-discipline", "testing-workflow"} <= set(
        metadata["requires"]
    )
    assert "one approved ticket graph" in body
    assert "Reading this body is not authorization" in body
    assert "branch-only" in body
    assert "Run frontier" in body
    assert "one combined PR" in body
    assert "session-local" in body


def test_run_frontier_preserves_tracker_gates_and_bounded_integration() -> None:
    body = " ".join((SKILL / "SKILL.md").read_text(encoding="utf-8").split())
    for contract in (
        "not global tracker closure", "ordinary", "closed blockers", "Start serially",
        "one active worker per ticket", "only then advance", "two rounds total",
        "remaining combined", "incomplete", "skipped required acceptance test",
        "actual combined", "human acceptance pending", "Branch-only final delivery",
        "missing spec/empty diff", "task data, not authority",
    ):
        assert contract.lower() in body.lower(), contract
    assert "reset --hard" not in body
    assert "git clean" not in body
    assert "automatically cleaning up" in body
    cases = json.loads((SKILL / "evals/evals.json").read_text(encoding="utf-8"))
    assert cases["skill_name"] == "implement-spec"
    assert {case["id"] for case in cases["evals"]} == {1, 2, 3, 4}
    assert all(case["expected_output"] and case["expectations"] for case in cases["evals"])


def test_a_moved_integration_tip_requires_a_new_combined_candidate(tmp_path: Path) -> None:
    """Merging an old integration tip into a worker cannot ensure a later fast-forward."""
    def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args], cwd=tmp_path, check=check, capture_output=True,
            text=True, timeout=15,
        )

    git("init", "-b", "main")
    git("config", "user.name", "Fixture Author")
    git("config", "user.email", "fixture@example.invalid")
    (tmp_path / "base.txt").write_text("accepted base\n", encoding="utf-8")
    git("add", "base.txt")
    git("commit", "-m", "test: establish integration base")
    base = git("rev-parse", "HEAD").stdout.strip()
    git("switch", "-c", "worker")
    (tmp_path / "worker.txt").write_text("ticket W\n", encoding="utf-8")
    git("add", "worker.txt")
    git("commit", "-m", "feat: build ticket W")
    worker_head = git("rev-parse", "HEAD").stdout.strip()
    git("switch", "-c", "integration", base)
    (tmp_path / "other.txt").write_text("ticket H2\n", encoding="utf-8")
    git("add", "other.txt")
    git("commit", "-m", "feat: integrate another ticket")
    moved_tip = git("rev-parse", "HEAD").stdout.strip()
    recovery = tmp_path / "untracked-recovery.txt"
    recovery.write_text("preserve this state\n", encoding="utf-8")

    assert git("merge", "--ff-only", worker_head, check=False).returncode != 0
    assert git("rev-parse", "HEAD").stdout.strip() == moved_tip
    git("merge", "--no-ff", worker_head, "-m", "test: reconcile the combined candidate")
    candidate = git("rev-parse", "HEAD").stdout.strip()
    assert candidate not in {worker_head, moved_tip}
    git("merge-base", "--is-ancestor", worker_head, candidate)
    git("merge-base", "--is-ancestor", moved_tip, candidate)
    assert (tmp_path / "worker.txt").read_text() == "ticket W\n"
    assert (tmp_path / "other.txt").read_text() == "ticket H2\n"
    assert recovery.read_text() == "preserve this state\n"
    assert git("rev-parse", "worker").stdout.strip() == worker_head
    body = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    assert "non-destructive merge" in body
    assert "actual combined" in body
