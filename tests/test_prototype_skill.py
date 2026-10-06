"""#257: a prototype's source and decision evidence survive before scoped cleanup.

The Git fixtures execute the skill's public recipes in real throwaway repositories;
they are not a model or a safety controller. Model behaviour is covered separately
by the matched evals in skills/workflow/prototype/evals/evals.json.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills/workflow/prototype"
ISOLATED_GIT = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_EDITOR": "true"}
# NOTES.md comes first so its parent empties only after the nested file goes: that
# second-level directory is removed only by `rmdir -p`.
OWNED = ("app/prototype-settings/NOTES.md", "app/prototype-settings/variants/layout.py", "app/settings.html")
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


def git_bytes(repo: Path, *args: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, check=True, timeout=15,
        env={**os.environ, **ISOLATED_GIT},
    ).stdout


SCRIPTS = {"capture.sh": "worktree add", "cleanup.sh": "restore --source=HEAD"}


def recipe(script: str) -> str:
    blocks = re.findall(r"```bash\n(.*?)\n```", skill_body(), re.DOTALL)
    found = [block for block in blocks if SCRIPTS[script] in block]
    assert len(found) == 1, f"document exactly one bash recipe for {script}"
    return found[0]


def run_recipe(repo: Path, script: str, paths: tuple[str, ...] = OWNED) -> subprocess.CompletedProcess[str]:
    """Run the recipe the way the skill says: saved outside the repository, files as arguments."""
    saved = repo.parent / script
    saved.write_text(recipe(script) + "\n", encoding="utf-8")
    return subprocess.run(
        ["bash", str(saved), *paths], cwd=repo, capture_output=True,
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
    (repo / "app/prototype-settings/variants").mkdir(parents=True)
    (repo / "app/prototype-settings/variants/layout.py").write_text("VARIANTS = 'abc'\n", encoding="utf-8")
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

    capture = run_recipe(repo, "capture.sh")
    assert capture.returncode == 0, capture.stdout + capture.stderr
    # Capture changes no checkout state: the throwaway branch is built beside it.
    assert snapshot(repo) == before
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes
    # The branch holds exactly the owned files, on top of the prototyped commit.
    assert git(repo, "rev-parse", f"{CAPTURE_BRANCH}^") == before["head"]
    assert sorted(git(repo, "diff", "--name-only", "HEAD", CAPTURE_BRANCH).split()) == sorted(OWNED)
    # The pointer is the capture commit the script prints; it alone recovers every file.
    pointer = capture.stdout.splitlines()[-1]
    assert pointer == git(repo, "rev-parse", CAPTURE_BRANCH).strip()
    assert git(repo, "cat-file", "-t", pointer).strip() == "commit"
    for path, data in owned_bytes.items():  # recovery: each source file comes back byte-exact
        assert git_bytes(repo, "show", f"{pointer}:{path}") == data, path

    cleanup = run_recipe(repo, "cleanup.sh")
    assert cleanup.returncode == 0, cleanup.stdout + cleanup.stderr
    assert not (repo / OWNED[0]).exists() and not (repo / OWNED[1]).exists()
    assert not (repo / "app/prototype-settings").exists()  # emptied by cleanup, so removed
    assert (repo / "app/settings.html").read_text(encoding="utf-8") == "<h1>Settings</h1>\n"
    assert snapshot(repo) == before
    assert git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines() == [
        " M app/other.py", "?? app/user_draft.txt"]


@pytest.mark.parametrize("failure", ["branch-exists", "changed-after-capture", "staged"])
def test_failed_capture_or_changed_file_prevents_any_cleanup(prototyped: Path, failure: str) -> None:
    """Cleanup re-verifies the capture itself, so it cannot follow a failed one."""
    repo = prototyped
    if failure == "branch-exists":
        # A retained branch of the same name is not overwritten and is not a capture.
        git(repo, "branch", CAPTURE_BRANCH, "prototype/older-question")
        retained = git(repo, "rev-parse", CAPTURE_BRANCH)
        capture = run_recipe(repo, "capture.sh")
        assert capture.returncode != 0
        assert git(repo, "rev-parse", CAPTURE_BRANCH) == retained
    else:
        capture = run_recipe(repo, "capture.sh")
        assert capture.returncode == 0, capture.stdout + capture.stderr
        if failure == "staged":
            # Removing a staged file would leave its index entry behind.
            git(repo, "add", "--", OWNED[0])
        else:
            (repo / OWNED[1]).write_text("VARIANTS = 'abcd'  # edited after capture\n", encoding="utf-8")
    before = snapshot(repo)
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}

    cleanup = run_recipe(repo, "cleanup.sh")
    assert cleanup.returncode != 0
    if failure == "staged":
        assert "staged" in cleanup.stderr
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes
    assert snapshot(repo) == before


@pytest.mark.parametrize("failure", ["rejecting-hook", "missing-file"])
def test_capture_failing_midway_rolls_back_its_own_worktree_and_branch(prototyped: Path, failure: str) -> None:
    """A hook rejection or a missing file leaves no capture debris that blocks a retry."""
    repo = prototyped
    paths = OWNED
    if failure == "rejecting-hook":
        hook = repo / ".git/hooks/pre-commit"
        hook.write_text("#!/bin/sh\necho 'lint: prototype code rejected' >&2\nexit 1\n", encoding="utf-8")
        hook.chmod(0o755)
    else:
        paths = OWNED + ("app/prototype-settings/missing.py",)
    before = snapshot(repo)
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}

    capture = run_recipe(repo, "capture.sh", paths)
    assert capture.returncode != 0
    git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{CAPTURE_BRANCH}", expected=1)
    assert snapshot(repo) == before
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes


def test_capture_whose_final_check_fails_keeps_its_commit_and_blocks_cleanup(prototyped: Path) -> None:
    """A line-ending filter makes the stored bytes differ: the commit stays for
    inspection, the capture reports failure, and cleanup refuses with a reason."""
    repo = prototyped
    git(repo, "config", "core.autocrlf", "true")
    (repo / OWNED[1]).write_bytes(b"VARIANTS = 'abc'\r\n")
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}

    capture = run_recipe(repo, "capture.sh")
    assert capture.returncode != 0
    git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{CAPTURE_BRANCH}")
    cleanup = run_recipe(repo, "cleanup.sh")
    assert cleanup.returncode != 0
    assert f"{OWNED[1]} does not match its capture" in cleanup.stderr
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes


@pytest.mark.parametrize("script", ["capture.sh", "cleanup.sh"])
def test_recipes_refuse_to_run_outside_the_repository_root(prototyped: Path, script: str) -> None:
    """From a subdirectory, root-relative paths would be captured or removed at the wrong place."""
    repo = prototyped
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}
    saved = repo.parent / script
    saved.write_text(recipe(script) + "\n", encoding="utf-8")
    result = subprocess.run(
        ["bash", str(saved), "variants/layout.py"], cwd=repo / "app/prototype-settings",
        capture_output=True, text=True, timeout=30,
        env={**os.environ, **ISOLATED_GIT, "capture_branch": CAPTURE_BRANCH},
    )
    assert result.returncode != 0
    assert "repository root" in result.stderr
    git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{CAPTURE_BRANCH}", expected=1)
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes


def test_skill_documents_how_to_run_each_recipe() -> None:
    """A recipe run as `bash -c '<recipe>' file…` would take the first file as $0."""
    done = " ".join(section(skill_body(), "## When done").split())
    assert "`capture_branch=prototype/<name> bash capture.sh <file>…`" in done
    assert "`capture_branch=prototype/<name> bash cleanup.sh <file>…`" in done
    assert "outside the repository" in done
    assert "```sh" not in skill_body()
    # The recipe branches from HEAD, which cleanup restores from; it is not cut from main.
    assert "out of main" not in skill_body()
    assert "starts at the current HEAD and is never merged into main" in done


def section(text: str, heading: str) -> str:
    return text.split(heading, 1)[1].split("\n## ", 1)[0]


def reference_done_step(name: str) -> str:
    """The text of a reference's numbered '### N. When done' step, whitespace-normalized."""
    text = (SKILL_ROOT / "references" / name).read_text(encoding="utf-8")
    match = re.search(r"^### \d+\. When done\n(.*?)(?=^##|\Z)", text, re.DOTALL | re.MULTILINE)
    assert match, f"{name} has no numbered When done step"
    return " ".join(match.group(1).split())


def test_planning_only_completion_records_then_captures_and_edits_no_production_code() -> None:
    """Finishing a prototype ends with findings; folding them in is separate work (#248 AC9)."""
    done = " ".join(section(skill_body(), "## When done").split())

    assert "Finishing a planning prototype edits no production code" in done
    assert "Fold the validated decision into the real code" not in done
    assert "separately authorized implementation" in done
    assert "normal production quality gates" in done
    # Decision evidence is captured with the source, so NOTES.md is written first.
    order = [done.index(step) for step in (
        "**Record the answer.**", "**Capture the prototype as a primary source.**",
        "**Leave a pointer.**", "**Clean only what was captured.**")]
    assert order == sorted(order)
    for name in ("logic.md", "ui.md"):
        done_step = reference_done_step(name)
        assert "the prototype skill's When done" in done_step, name
        assert "Delete the TUI shell" not in done_step and "Fold the validated decision" not in done_step, name


def test_partly_owned_files_are_captured_but_never_cleaned_wholesale() -> None:
    """Capture is evidence and changes no checkout; cleanup takes wholly owned files only."""
    done = " ".join(section(skill_body(), "## When done").split())
    capture = done.split("**Capture the prototype as a primary source.**", 1)[1].split("```bash", 1)[0]
    cleanup = done.split("**Clean only what was captured.**", 1)[1].split("```bash", 1)[0]

    assert "every file the prototype created or edited" in capture
    assert "leave it out" not in capture
    assert "wholly owned" in cleanup
    # Ownership is checked against the file's current changes, not its state at the
    # start: a user edit made while prototyping must also keep the file out.
    assert "every uncommitted change in it is the prototype's" in cleanup
    assert "just before cleanup" in cleanup
    assert "when it started" not in cleanup
    assert "remove only the prototype's lines by hand, or report them" in cleanup
    assert "`git status --short` before the prototype's first edit" in skill_body()
    # Wrap-up often starts in a later session that noted nothing at the start.
    assert "If no status was noted, treat any change you cannot attribute to the prototype as someone else's" in cleanup
    assert "even one that was already empty" in cleanup
    failed_capture = done.split("**Leave a pointer.**", 1)[0].rsplit("```", 1)[1]
    assert "an ignored path" in failed_capture and "a hook that rewrites files" in failed_capture
    assert "capture again under a new branch name" in failed_capture
    for name in ("logic.md", "ui.md"):
        done_step = reference_done_step(name)
        assert "wholly owns" in done_step, name
    assert "including your edits to the host page" not in reference_done_step("ui.md")
    assert "remove only the prototype's lines by hand" in reference_done_step("ui.md")


def test_pointer_follows_the_configured_tracker_not_a_hardcoded_forge() -> None:
    texts = {"SKILL.md": skill_body()} | {
        name: (SKILL_ROOT / "references" / name).read_text(encoding="utf-8") for name in ("logic.md", "ui.md")}
    for name, text in texts.items():
        assert not re.search(r"\btea\b|Gitea|docs/agents/", text), name
    pointer = " ".join(section(skill_body(), "## When done").split()).split("**Leave a pointer.**", 1)[1]
    pointer = pointer.split("**Clean only what was captured.**", 1)[0]
    assert "configured tracker" in pointer and "/setup-project-skills" in pointer
    assert "capture commit" in pointer
    assert "Pushing the branch publishes it" in pointer
    # Partly owned files are captured whole, so a push carries others' edits too.
    assert "including anyone else's uncommitted edits captured in partly owned files" in pointer


def test_branch_choice_and_notes_structure_are_preserved() -> None:
    body = skill_body()
    assert "→ both, in sequence" in body
    notes = body.split("```markdown", 1)[1].split("```", 1)[0]
    fields = re.findall(r"^- \*\*(.+?):\*\*", notes, re.MULTILINE)
    assert fields == ["Question", "Hypothesis", "Approach", "Answer", "Confidence", "Branch", "Next step"]
    assert "fold validated decision into production" not in notes
    assert "separately authorized implementation" in notes


def test_catalogue_states_preservation_and_the_planning_boundary() -> None:
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines()
               if "skills/workflow/prototype/SKILL.md" in line and line.startswith("|"))

    assert "capture when done" not in row
    assert "preserve before a scoped cleanup" in row
    assert "production adoption is separately authorized" in row


def test_evals_reward_preservation_not_automatic_production_folding() -> None:
    """Case 4 no longer rewards folding into production; fixture cases pair the
    full wrap-up with a partly owned file whose user edit must survive (#257)."""
    document = json.loads((SKILL_ROOT / "evals/evals.json").read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in document["evals"]}
    assert len(cases) == len(document["evals"])

    wrap_up = " ".join(cases[4]["expectations"])
    assert "It describes folding the validated decision into production." not in cases[4]["expectations"]
    assert "does not fold variant A into production" in wrap_up
    assert "before any cleanup" in wrap_up
    assert "configured tracker" in wrap_up

    assert "out of main" not in json.dumps(document)
    for case_id in (5, 6):
        assert "disposable Git fixture" in cases[case_id]["prompt"], case_id
        # The fixture's tracker doc, not this repository's tea doc, defines the pointer.
        assert "a local markdown tracker" in cases[case_id]["prompt"], case_id
        expectations = " ".join(cases[case_id]["expectations"])
        assert "new throwaway branch" in expectations, case_id
        assert "separately authorized implementation" in expectations, case_id
        assert "docs/agents/issue-tracker.md" in expectations and "no tea, gh or push" in expectations, case_id
    assert "app/orders.py" in " ".join(cases[5]["expectations"])
    assert "heading fix" in " ".join(cases[6]["expectations"])
    assert "not restored to HEAD" in " ".join(cases[6]["expectations"])
    # Following the skill removes the created NOTES.md, so a strict grader must not fail it.
    assert "settings_variants.html and NOTES.md are removed only after" in " ".join(cases[6]["expectations"])
    # The skill itself writes the issue pointer and the capture branch.
    assert "other than the pointer on issue #12, and the pre-existing branches and worktrees are unchanged" in " ".join(cases[6]["expectations"])
