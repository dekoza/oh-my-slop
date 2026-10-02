"""Real Git effects of public guidance, separate from model functional evals."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills/practice/resolving-merge-conflicts"


def skill_body() -> str:
    return (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[2]


def git(repo: Path, *args: str, expected: int = 0) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=15,
        env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull,
             "GIT_CONFIG_NOSYSTEM": "1", "GIT_EDITOR": "true"},
    )
    assert result.returncode == expected, result.stdout + result.stderr
    return result.stdout


@pytest.fixture
def stopped_merge(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Fixture Author")
    git(tmp_path, "config", "user.email", "fixture@example.invalid")
    for name in ("resolution [1].txt", "staged.txt", "unstaged.txt"):
        (tmp_path / name).write_text("base\n", encoding="utf-8")
    git(tmp_path, "add", "--", "resolution [1].txt", "staged.txt", "unstaged.txt")
    git(tmp_path, "commit", "-m", "test: establish conflict fixture")
    git(tmp_path, "switch", "-c", "feature")
    (tmp_path / "resolution [1].txt").write_text("feature setting\n", encoding="utf-8")
    git(tmp_path, "add", "--", "resolution [1].txt")
    git(tmp_path, "commit", "-m", "feat: retain feature setting")
    git(tmp_path, "switch", "main")
    (tmp_path / "resolution [1].txt").write_text("main setting\n", encoding="utf-8")
    git(tmp_path, "add", "--", "resolution [1].txt")
    git(tmp_path, "commit", "-m", "feat: retain main setting")
    git(tmp_path, "merge", "feature", expected=1)
    return tmp_path


def test_documented_staging_preserves_unrelated_index_and_worktree(stopped_merge: Path) -> None:
    """The old 'Stage everything' recipe really stages unrelated files.

    This executes the public command example, not a model or a safety controller.
    The fallback expands the original prose for the representative RED reproduction.
    """
    repo = stopped_merge
    (repo / "staged.txt").write_text("unrelated staged\n", encoding="utf-8")
    git(repo, "add", "staged.txt")
    (repo / "staged.txt").write_text("unrelated unstaged on staged\n", encoding="utf-8")
    (repo / "unstaged.txt").write_text("unrelated unstaged\n", encoding="utf-8")
    (repo / "untracked.txt").write_text("precious untracked\n", encoding="utf-8")
    before_index = git(repo, "ls-files", "--stage", "--", "staged.txt", "unstaged.txt")
    before_bytes = {p.name: p.read_bytes() for p in repo.iterdir() if p.is_file()}
    head = git(repo, "rev-parse", "HEAD")
    (repo / "resolution [1].txt").write_text("main setting\nfeature setting\n", encoding="utf-8")
    body = skill_body()
    examples = re.findall(r"```sh\n(.*?)\n\s*```", body, re.DOTALL)
    recipe = next((block for block in examples if " add " in block), None)
    if recipe is None and "Stage everything" in body:
        recipe = 'git -C "$repo" add --all'
    assert recipe is not None, "Document the scoped staging command at the public Git seam"
    subprocess.run(
        ["bash", "-euc", recipe], cwd=repo, check=True, capture_output=True, text=True,
        timeout=15, env={**os.environ, "repo": str(repo), "resolution_path": "resolution [1].txt"},
    )
    assert git(repo, "ls-files", "--stage", "--", "staged.txt", "unstaged.txt") == before_index
    assert git(repo, "diff", "--cached", "--name-only").splitlines() == ["resolution [1].txt", "staged.txt"]
    assert git(repo, "ls-files", "--others", "--exclude-standard").splitlines() == ["untracked.txt"]
    for name in ("staged.txt", "unstaged.txt", "untracked.txt"):
        assert (repo / name).read_bytes() == before_bytes[name]
    assert git(repo, "rev-parse", "HEAD") == head
    assert git(repo, "rev-parse", "--verify", "MERGE_HEAD")
    assert git(repo, "ls-files", "--unmerged") == ""


def test_operation_authority_is_a_gate_not_an_automatic_finish(stopped_merge: Path) -> None:
    """Read-only inventory preserves a stopped operation; prose gates are supplemental."""
    repo = stopped_merge
    head = git(repo, "rev-parse", "HEAD")
    index = git(repo, "ls-files", "--stage")
    contents = (repo / "resolution [1].txt").read_bytes()
    git(repo, "status", "--porcelain=v1")
    git(repo, "log", "--oneline", "--all")
    git(repo, "diff", "--", "resolution [1].txt")
    assert git(repo, "rev-parse", "HEAD") == head
    assert git(repo, "ls-files", "--stage") == index
    assert (repo / "resolution [1].txt").read_bytes() == contents
    assert git(repo, "rev-parse", "--verify", "MERGE_HEAD")

    body = skill_body()
    assert "authorized operation and ownership" in body
    assert "Reuse sufficient explicit caller/operator authority" in body
    assert "unattributed" in body and "pause" in body
    assert "consequential unresolved semantics" in body
    assert "only when continuation is explicitly authorized" in body
    assert "unrelated staged" in body and "include" in body
    assert "Always resolve" not in body
    assert "pick the one" not in body
