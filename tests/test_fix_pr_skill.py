"""Committed-candidate contract and real Git evidence for PR repair.

The native fixtures test Git state, not independent reviewer correctness or a live forge.
Source-order checks supplement the bounded model executions retained outside the package.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills/workflow/fix-pr"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, text=True,
        capture_output=True, timeout=15,
        env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull,
             "GIT_CONFIG_NOSYSTEM": "1", "GIT_EDITOR": "true"},
    ).stdout.strip()


def init_repo(repo: Path) -> str:
    repo.mkdir()
    git(repo, "init", "-b", "release/2")
    git(repo, "config", "user.name", "Fixture Author")
    git(repo, "config", "user.email", "fixture@example.invalid")
    (repo / "query.txt").write_text("tenant=true\npage=1\n", encoding="utf-8")
    git(repo, "add", "query.txt")
    git(repo, "commit", "-m", "test: establish published PR fixture")
    return git(repo, "rev-parse", "HEAD")


def test_committed_review_includes_repair_and_preserves_unrelated_work(tmp_path: Path) -> None:
    repo = tmp_path / "repair"
    base = init_repo(repo)
    git(repo, "switch", "-c", "feature/search")
    # A separate staged file must not be included in the repair commit.
    (repo / "staged.txt").write_text("separate staged work\n", encoding="utf-8")
    git(repo, "add", "staged.txt")
    sentinel_index = git(repo, "ls-files", "--stage", "staged.txt")
    (repo / "untracked.txt").write_text("precious research\n", encoding="utf-8")
    (repo / "query.txt").write_text("tenant=true\npage=2\n", encoding="utf-8")
    assert git(repo, "diff", f"{base}...HEAD") == ""

    body = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert body.index("Commit the inspected repair") < body.index(
        "Use the `two-axis-review` skill for the repair"
    ), "Reviewers inspect committed history, not the uncommitted repair"
    assert "fixed **review base SHA**" in body and "candidate **head SHA**" in body

    git(repo, "add", "query.txt")
    git(repo, "commit", "--only", "query.txt", "-m", "fix: commit inspected pagination repair")
    head = git(repo, "rev-parse", "HEAD")
    assert "+page=2" in git(repo, "diff", f"{base}...{head}")
    assert git(repo, "diff", "--name-only", base, head) == "query.txt"
    assert git(repo, "ls-files", "--stage", "staged.txt") == sentinel_index
    assert (repo / "untracked.txt").read_text(encoding="utf-8") == "precious research\n"
