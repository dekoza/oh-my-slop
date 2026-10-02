"""Committed-candidate contract and real Git evidence for PR repair.

The native fixtures test Git state, not independent reviewer correctness or a live forge.
Source-order checks supplement the bounded model executions retained outside the package.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

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


def certificate_matches(
    repo: Path, base: str, head: str, target: str,
    receipts: dict[str, tuple[str, str, str, int]],
) -> bool:
    """Independent test oracle: missing/stale/nonzero evidence is not approval.

    This is fixture validation, not a new production publisher or review service.
    Each tuple is (review base, checked/reviewed head, target, exit status).
    """
    return (
        git(repo, "rev-parse", "HEAD") == head
        and not git(repo, "diff", "--", "query.txt")
        and not git(repo, "diff", "--cached", "--", "query.txt")
        and bool(git(repo, "diff", f"{base}...{head}", "--", "query.txt"))
        and all(receipts.get(kind) == (base, head, target, 0)
                for kind in ("check", "standards", "spec"))
    )


@pytest.mark.parametrize("invalid", [
    "uncommitted", "additive-repair", "target-movement", "wrong-base",
    "missing-check", "missing-standards", "missing-spec", "failed-check",
])
def test_real_stale_or_incomplete_candidate_is_not_certified(tmp_path: Path, invalid: str) -> None:
    repo = tmp_path / "repair"
    base = init_repo(repo)
    (repo / "query.txt").write_text("tenant=true\npage=2\n", encoding="utf-8")
    git(repo, "add", "query.txt")
    git(repo, "commit", "-m", "fix: reviewed pagination candidate")
    head = git(repo, "rev-parse", "HEAD")
    target = base
    receipts = {kind: (base, head, target, 0) for kind in ("check", "standards", "spec")}
    assert certificate_matches(repo, base, head, target, receipts)
    if invalid in ("uncommitted", "additive-repair"):
        (repo / "query.txt").write_text("tenant=true\npage=3\n", encoding="utf-8")
        if invalid == "additive-repair":
            git(repo, "add", "query.txt")
            git(repo, "commit", "-m", "fix: later repair invalidates approval")
            head = git(repo, "rev-parse", "HEAD")
    elif invalid == "target-movement":
        git(repo, "switch", "release/2")
        (repo / "target.txt").write_text("new target requirement\n", encoding="utf-8")
        git(repo, "add", "target.txt")
        git(repo, "commit", "-m", "feat: advance actual target")
        target = git(repo, "rev-parse", "HEAD")
    elif invalid == "wrong-base":
        base = head
    elif invalid.startswith("missing-"):
        receipts.pop(invalid.removeprefix("missing-"))
    else:
        receipts["check"] = (base, head, target, 1)
    assert not certificate_matches(repo, base, head, target, receipts)

    body = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert "Any later repair or integration invalidates" in body
    assert "additive commit" in body
    assert "rerun affected checks and axes" in body
    assert "both current axis outcomes" in body.lower()


def test_remote_head_and_target_movement_require_additive_reconciliation(tmp_path: Path) -> None:
    repo = tmp_path / "repair"
    base = init_repo(repo)
    git(repo, "switch", "-c", "feature/search")
    (repo / "query.txt").write_text("tenant=true\npage=2\n", encoding="utf-8")
    git(repo, "add", "query.txt")
    git(repo, "commit", "-m", "fix: reviewed repair")
    reviewed = git(repo, "rev-parse", "HEAD")
    remote = tmp_path / "remote.git"
    git(repo, "init", "--bare", str(remote))
    git(repo, "remote", "add", "origin", str(remote))
    git(repo, "push", "origin", "feature/search", "release/2")
    # A second real clone moves BOTH refs after approval, without touching our candidate.
    other = tmp_path / "other"
    git(repo, "clone", "--branch", "feature/search", str(remote), str(other))
    git(other, "config", "user.name", "Other Author")
    git(other, "config", "user.email", "other@example.invalid")
    (other / "concurrent.txt").write_text("preserve concurrent work\n", encoding="utf-8")
    git(other, "add", "concurrent.txt")
    git(other, "commit", "-m", "feat: concurrent PR author change")
    moved_head = git(other, "rev-parse", "HEAD")
    git(other, "push", "origin", "feature/search")
    git(other, "switch", "release/2")
    (other / "target.txt").write_text("current target behavior\n", encoding="utf-8")
    git(other, "add", "target.txt")
    git(other, "commit", "-m", "feat: new release target behavior")
    moved_target = git(other, "rev-parse", "HEAD")
    git(other, "push", "origin", "release/2")
    receipts = {kind: (base, reviewed, base, 0) for kind in ("check", "standards", "spec")}
    assert not certificate_matches(repo, base, reviewed, moved_target, receipts)
    git(repo, "fetch", "origin")
    git(repo, "merge", "--no-edit", "origin/feature/search")
    git(repo, "merge", "--no-edit", "origin/release/2")
    final = git(repo, "rev-parse", "HEAD")
    assert not certificate_matches(repo, base, final, moved_target, receipts)
    assert git(repo, "merge-base", reviewed, final) == reviewed
    assert git(repo, "merge-base", moved_head, final) == moved_head
    assert git(repo, "merge-base", moved_target, final) == moved_target
    assert (repo / "query.txt").read_text(encoding="utf-8") == "tenant=true\npage=2\n"
    assert "+page=2" in git(repo, "diff", f"{base}...{final}")
    # Supplied simulated approval receipts certify state, not real reviewer correctness.
    fresh = {kind: (base, final, moved_target, 0) for kind in ("check", "standards", "spec")}
    assert certificate_matches(repo, base, final, moved_target, fresh)
    git(repo, "push", "origin", "HEAD:refs/heads/feature/search")
    assert git(repo, "ls-remote", "origin", "refs/heads/feature/search").split()[0] == final
    assert git(repo, "ls-remote", "origin", "refs/heads/release/2").split()[0] == moved_target
    assert (repo / "concurrent.txt").read_text(encoding="utf-8") == "preserve concurrent work\n"
    assert (repo / "target.txt").read_text(encoding="utf-8") == "current target behavior\n"

    body = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert "Remote movement invalidates the publication gate" in body
    assert "published head must equal" in body
    assert "same open PR" in body
    assert "two rounds" in body and "stop and report" in body
