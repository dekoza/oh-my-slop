"""#257: a prototype's source and decision evidence survive before scoped cleanup.

The Git fixtures execute the skill's public recipes in real throwaway repositories;
they are not a model or a safety controller. Model behaviour is covered separately
by the matched evals in skills/workflow/prototype/evals/evals.json.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills/workflow/prototype"
ISOLATED_GIT = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_EDITOR": "true"}
OWNED = ("app/prototype-settings/variants.py", "app/prototype-settings/NOTES.md", "app/settings.html")
CAPTURE_BRANCH = "prototype/settings-layout"


def skill_body() -> str:
    return (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[2]


def git(repo: Path, *args: str, expected: int = 0) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=15,
        env={**os.environ, **ISOLATED_GIT},
    )
    assert result.returncode == expected, result.stdout + result.stderr
    return result.stdout


def recipe(marker: str) -> str:
    blocks = re.findall(r"```sh\n(.*?)\n```", skill_body(), re.DOTALL)
    found = [block for block in blocks if marker in block]
    assert len(found) == 1, f"document exactly one sh recipe containing {marker!r}"
    return found[0]


def run_recipe(repo: Path, marker: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-c", recipe(marker), "recipe", *OWNED], cwd=repo, capture_output=True,
        text=True, timeout=30, env={**os.environ, **ISOLATED_GIT, "capture_branch": CAPTURE_BRANCH},
    )


@pytest.fixture
def prototyped(tmp_path: Path) -> Path:
    """A repository with a finished prototype beside unrelated work that must survive."""
    repo = tmp_path / "project"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.name", "Fixture Author")
    git(repo, "config", "user.email", "fixture@example.invalid")
    (repo / "app").mkdir()
    (repo / "app/settings.html").write_text("<h1>Settings</h1>\n", encoding="utf-8")
    (repo / "app/other.py").write_text("LIMIT = 1\n", encoding="utf-8")
    git(repo, "add", "app")
    git(repo, "commit", "-m", "feat: legitimate settings page")
    # Retained work that is not this prototype's: a branch and a worktree.
    git(repo, "branch", "prototype/older-question")
    git(repo, "worktree", "add", "-b", "kept-work", str(tmp_path / "kept"))
    (tmp_path / "kept/draft.txt").write_text("someone's draft\n", encoding="utf-8")
    # Unrelated uncommitted work in the same checkout.
    (repo / "app/other.py").write_text("LIMIT = 2  # user's edit\n", encoding="utf-8")
    (repo / "app/user_draft.txt").write_text("precious untracked\n", encoding="utf-8")
    # The prototype: new owned files plus an owned edit of a page that was clean.
    (repo / "app/prototype-settings").mkdir()
    (repo / "app/prototype-settings/variants.py").write_text("VARIANTS = 'abc'\n", encoding="utf-8")
    (repo / "app/prototype-settings/NOTES.md").write_text(
        "# Prototype: settings layout\n- **Question:** which layout?\n", encoding="utf-8")
    (repo / "app/settings.html").write_text("<h1>Settings</h1>\n{% variant %}\n", encoding="utf-8")
    return repo


def snapshot(repo: Path) -> dict[str, object]:
    return {
        "head": git(repo, "rev-parse", "HEAD"),
        "index": git(repo, "ls-files", "--stage"),
        "refs": git(repo, "for-each-ref", "--format=%(refname) %(objectname)",
                    "refs/heads/prototype/older-question", "refs/heads/kept-work"),
        "worktrees": git(repo, "worktree", "list", "--porcelain"),
        "unrelated": {name: (repo / name).read_bytes() for name in ("app/other.py", "app/user_draft.txt")},
        "kept_draft": (repo.parent / "kept/draft.txt").read_bytes(),
    }


def test_capture_preserves_source_and_notes_then_cleanup_removes_only_owned_files(prototyped: Path) -> None:
    repo = prototyped
    before = snapshot(repo)
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}

    capture = run_recipe(repo, "worktree add")
    assert capture.returncode == 0, capture.stdout + capture.stderr
    # Capture changes no checkout state: the throwaway branch is built beside it.
    assert snapshot(repo) == before
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes
    # The branch holds exactly the owned files, on top of the prototyped commit.
    assert git(repo, "rev-parse", f"{CAPTURE_BRANCH}^") == before["head"]
    assert sorted(git(repo, "diff", "--name-only", "HEAD", CAPTURE_BRANCH).split()) == sorted(OWNED)
    for path, data in owned_bytes.items():  # recovery: each source file comes back byte-exact
        shown = subprocess.run(["git", "-C", str(repo), "show", f"{CAPTURE_BRANCH}:{path}"],
                               capture_output=True, check=True, timeout=15)
        assert shown.stdout == data, path

    cleanup = run_recipe(repo, "restore --source=HEAD")
    assert cleanup.returncode == 0, cleanup.stdout + cleanup.stderr
    assert not (repo / OWNED[0]).exists() and not (repo / OWNED[1]).exists()
    assert (repo / "app/settings.html").read_text(encoding="utf-8") == "<h1>Settings</h1>\n"
    assert snapshot(repo) == before
    assert git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines() == [
        " M app/other.py", "?? app/user_draft.txt"]


@pytest.mark.parametrize("failure", ["branch-exists", "changed-after-capture"])
def test_failed_capture_or_changed_file_prevents_any_cleanup(prototyped: Path, failure: str) -> None:
    """Cleanup re-verifies the capture itself, so it cannot follow a failed one."""
    repo = prototyped
    if failure == "branch-exists":
        # A retained branch of the same name is not overwritten and is not a capture.
        git(repo, "branch", CAPTURE_BRANCH, "prototype/older-question")
        retained = git(repo, "rev-parse", CAPTURE_BRANCH)
        capture = run_recipe(repo, "worktree add")
        assert capture.returncode != 0
        assert git(repo, "rev-parse", CAPTURE_BRANCH) == retained
    else:
        capture = run_recipe(repo, "worktree add")
        assert capture.returncode == 0, capture.stdout + capture.stderr
        (repo / OWNED[0]).write_text("VARIANTS = 'abcd'  # edited after capture\n", encoding="utf-8")
    before = snapshot(repo)
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}

    cleanup = run_recipe(repo, "restore --source=HEAD")
    assert cleanup.returncode != 0
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes
    assert snapshot(repo) == before
