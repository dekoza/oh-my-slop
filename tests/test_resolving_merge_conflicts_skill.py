"""Real Git effects of public guidance, separate from model functional evals."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from scripts.validate_refs import find_skill_dir
from tests.test_skill_requires import declared_requires, referenced_skills, skills_by_name

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
def stopped_merge(tmp_path: Path, request: pytest.FixtureRequest) -> Path:
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
    if getattr(request, "param", "merge") == "rebase":
        git(tmp_path, "switch", "feature")
        git(tmp_path, "rebase", "main", expected=1)
    else:
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


def test_abort_loses_resolution_but_verified_owned_snapshot_is_recoverable(stopped_merge: Path) -> None:
    """Destructive action is confined to disposable test-owned data with a full copy.

    Record ownership and recovery before testing Git's loss: the fixture author
    owns the staged resolution and partial work; the full copy preserves both
    file bytes and Git index/objects/operation state. No user work is involved.
    """
    repo = stopped_merge
    resolution = repo / "resolution [1].txt"
    resolution.write_text("main setting\nfeature setting\n", encoding="utf-8")
    git(repo, "add", "--", resolution.name)
    resolution.write_text(resolution.read_text() + "partial resolution\n", encoding="utf-8")
    saved_bytes = resolution.read_bytes()
    saved_index = git(repo, "ls-files", "--stage")
    saved_refs = git(repo, "show-ref")
    saved_merge = git(repo, "rev-parse", "MERGE_HEAD")
    preserved = repo.parent / (repo.name + "-owned-recovery-copy")
    shutil.copytree(repo, preserved)
    assert (preserved / resolution.name).read_bytes() == saved_bytes
    assert git(preserved, "ls-files", "--stage") == saved_index
    assert git(preserved, "rev-parse", "MERGE_HEAD") == saved_merge
    # Git refuses this staged/unstaged overlap. A failed abort is not recovery.
    git(repo, "merge", "--abort", expected=128)
    assert resolution.read_bytes() == saved_bytes
    assert git(repo, "ls-files", "--stage") == saved_index
    assert git(repo, "rev-parse", "MERGE_HEAD") == saved_merge
    # Stage only the test-owned partial resolution to demonstrate the loss case.
    git(repo, "add", "--", resolution.name)
    git(repo, "merge", "--abort")
    assert resolution.read_text() == "main setting\n"
    assert resolution.read_bytes() != saved_bytes
    assert git(repo, "show-ref") == saved_refs
    assert (preserved / resolution.name).read_bytes() == saved_bytes
    assert git(preserved, "ls-files", "--stage") == saved_index
    assert git(preserved, "show-ref") == saved_refs
    assert git(preserved, "rev-parse", "MERGE_HEAD") == saved_merge

    body = skill_body()
    assert "Before discussing an abort" in body
    assert "staged and partial" in body
    assert "irreversible without" in body
    assert "preservation/recovery prerequisites" in body
    assert "verified recoverable" in body
    assert "separate explicit abort authority" in body
    assert "never `--abort`" not in body


@pytest.mark.parametrize("stopped_merge", ["rebase"], indirect=True)
def test_authorized_rebase_can_continue_after_scoped_resolution(stopped_merge: Path) -> None:
    """Git continuation works; the matched model eval separately checks authority reuse."""
    repo = stopped_merge
    old_feature = git(repo, "rev-parse", "feature")
    main = git(repo, "rev-parse", "main")
    unrelated = {name: (repo / name).read_bytes() for name in ("staged.txt", "unstaged.txt")}
    resolution = "resolution [1].txt"
    (repo / resolution).write_text("main setting\nfeature setting\n", encoding="utf-8")
    git(repo, "--literal-pathspecs", "add", "--", resolution)
    assert git(repo, "diff", "--cached", "--name-only").splitlines() == [resolution]
    git(repo, "-c", "core.editor=true", "rebase", "--continue")
    assert git(repo, "status", "--porcelain=v1") == ""
    assert git(repo, "rev-parse", "main") == main
    assert git(repo, "rev-parse", "feature") != old_feature
    assert git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines() == [resolution]
    for name, contents in unrelated.items():
        assert (repo / name).read_bytes() == contents
    assert (repo / resolution).read_text() == "main setting\nfeature setting\n"


def test_testing_workflow_handoff_resolves_through_declared_closure() -> None:
    """Consumers can discover the check-policy handoff and load bundled guidance."""
    known = skills_by_name()
    assert "testing-workflow" in declared_requires(SKILL_ROOT)
    assert "testing-workflow" in referenced_skills(SKILL_ROOT)
    closure: set[str] = set()
    pending = list(declared_requires(SKILL_ROOT))
    while pending:
        name = pending.pop()
        if name in closure:
            continue
        resolved = find_skill_dir(REPO_ROOT / "skills", name)
        assert resolved == known[name]
        closure.add(name)
        pending.extend(declared_requires(resolved))
    assert "testing-workflow" in closure


def test_functional_evals_supplement_unchanged_trigger_controls_and_catalogue() -> None:
    evals = json.loads((SKILL_ROOT / "evals/evals.json").read_text(encoding="utf-8"))
    assert evals["skill_name"] == "resolving-merge-conflicts"
    assert [case["id"] for case in evals["evals"]] == [1, 2, 3]
    for case in evals["evals"]:
        assert case["prompt"] and case["expected_output"]
        assert len(case["expectations"]) == 3
    assert "index contents are identical" in evals["evals"][0]["expectations"][0]
    assert "preservation/recovery" in evals["evals"][1]["expectations"][2]
    assert "without another approval" in evals["evals"][2]["expectations"][1]
    triggers = json.loads((SKILL_ROOT / "evals/trigger-evals.json").read_text(encoding="utf-8"))
    assert any(case["should_trigger"] for case in triggers)
    assert any(not case["should_trigger"] for case in triggers)
    row = next(line for line in (REPO_ROOT / "README.md").read_text(encoding="utf-8").splitlines()
               if "practice/resolving-merge-conflicts/SKILL.md" in line)
    assert "authorized merge/rebase" in row
    assert "never abort" not in row
