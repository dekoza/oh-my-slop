"""#257: a prototype's source and decision evidence survive before scoped cleanup.
#258: the documented UI switcher wiring renders the chosen variant and production
excludes prototypes on the server.
#259: an optional browser view of a logic prototype drives the same native module.

The Git fixtures execute the skill's public recipes in real throwaway repositories;
they are not a model or a safety controller. The HTTP checks run the documented UI
example under each startup configuration; real-browser behaviour (switching, reload)
is covered by tests/browser/check_prototype_ui.py, which needs system Playwright and is
deliberately not collected here. Model behaviour is covered separately by the matched
evals in skills/workflow/prototype/evals/evals.json.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import select
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
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


def run_recipe(repo: Path, script: str, paths: tuple[str, ...] = OWNED, cwd: Path | None = None,
               branch: str | None = CAPTURE_BRANCH) -> subprocess.CompletedProcess[str]:
    """Run the recipe the way the skill says: saved outside the repository, files as
    arguments. Its temporary directories land in an owned, initially empty TMPDIR."""
    saved = repo.parent / script
    saved.write_text(recipe(script) + "\n", encoding="utf-8")
    temp = repo.parent / "tmp"
    temp.mkdir(exist_ok=True)
    env = {**os.environ, **ISOLATED_GIT, "TMPDIR": str(temp)}
    if branch is not None:
        env["capture_branch"] = branch
    return subprocess.run(["bash", str(saved), *paths], cwd=cwd or repo, capture_output=True,
                          text=True, timeout=30, env=env)


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
        assert list((repo.parent / "tmp").iterdir()) == []  # its temp directory went too
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
        assert "staged" in cleanup.stderr and OWNED[0] in cleanup.stderr
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
    assert list((repo.parent / "tmp").iterdir()) == []


def test_capture_keeps_its_commit_when_a_hook_dirties_the_temporary_worktree(prototyped: Path) -> None:
    """Once the commit exists the rollback is over: a post-commit hook that leaves an
    untracked file must not make the capture delete the commit it just made."""
    repo = prototyped
    hook = repo / ".git/hooks/post-commit"
    hook.write_text("#!/bin/sh\necho generated > junk.txt\n", encoding="utf-8")
    hook.chmod(0o755)

    capture = run_recipe(repo, "capture.sh")
    assert capture.returncode == 0, capture.stdout + capture.stderr
    pointer = capture.stdout.splitlines()[-1]
    assert pointer == git(repo, "rev-parse", CAPTURE_BRANCH).strip()
    assert git(repo, "worktree", "list", "--porcelain").count("worktree ") == 2  # main + kept


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
@pytest.mark.parametrize("where", ["subdirectory", "outside-any-repository", "no-branch-name"])
def test_recipes_refuse_to_start_without_a_root_and_a_branch(prototyped: Path, script: str, where: str) -> None:
    """From a subdirectory, root-relative paths would be captured or removed at the
    wrong place; outside a repository or without a branch name nothing can be captured."""
    repo = prototyped
    owned_bytes = {path: (repo / path).read_bytes() for path in OWNED}
    if where == "subdirectory":
        result = run_recipe(repo, script, ("variants/layout.py",), cwd=repo / "app/prototype-settings")
        assert "repository root" in result.stderr
    elif where == "outside-any-repository":
        outside = repo.parent / "not-a-repo"
        outside.mkdir()
        result = run_recipe(repo, script, ("layout.py",), cwd=outside)
        assert "staged" not in result.stderr  # no misleading reason
        # Git's own fatal "not a git repository" exit, at the root check, before anything else.
        assert result.returncode == 128, result.stderr
    else:
        result = run_recipe(repo, script, branch=None)
        assert "capture_branch" in result.stderr
    assert result.returncode != 0
    git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{CAPTURE_BRANCH}", expected=1)
    assert {path: (repo / path).read_bytes() for path in OWNED} == owned_bytes
    assert list((repo.parent / "tmp").iterdir()) == []


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
    assert "delete the kept branch only with the user's say-so" in failed_capture
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
    # The skill itself writes the issue pointer (which the tracker may commit) and the capture branch.
    assert ("other than the pointer on issue #12, and the pre-existing branches (apart from a commit that "
            "only records that pointer) and worktrees are unchanged") in " ".join(cases[6]["expectations"])


def documented_example() -> str:
    """The runnable example in ui.md's wiring step, verbatim."""
    text = (SKILL_ROOT / "references/ui.md").read_text(encoding="utf-8")
    blocks = [b for b in re.findall(r"```python\n(.*?)\n```", text, re.DOTALL) if "--env" in b]
    assert len(blocks) == 1, "ui.md documents exactly one runnable example taking --env"
    return blocks[0]


@contextlib.contextmanager
def serve(argv: list[str], cwd: Path) -> Iterator[str]:
    """Start an owned loopback server that announces its address first; always stop it."""
    server = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        ready, _, _ = select.select([server.stdout], [], [], 15)  # a silent server fails, not hangs
        line = server.stdout.readline() if ready else ""
        match = re.search(r"http://127\.0\.0\.1:\d+", line)
        assert match, f"no loopback address announced: {line!r}"
        yield match.group(0)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=10)


@contextlib.contextmanager
def serve_example(tmp_path: Path, env: str) -> Iterator[str]:
    script = tmp_path / "prototype_example.py"
    script.write_text(documented_example() + "\n", encoding="utf-8")
    with serve([sys.executable, str(script), "--env", env, "--port", "0"], tmp_path) as base:
        yield base


def fetch(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8")


def test_documented_example_excludes_prototypes_on_the_production_server(tmp_path: Path) -> None:
    """Production omits the throwaway route and renders the legitimate page whatever
    the selection parameter says; a hidden bar alone would not pass (#248 AC10)."""
    with serve_example(tmp_path, "production") as base:
        status, plain = fetch(base + "/settings")
        assert status == 200
        assert "prototype-bar" not in plain and "data-variant=" not in plain
        assert fetch(base + "/settings?variant=b") == (200, plain)
        assert fetch(base + "/prototype/settings")[0] == 404


def test_documented_example_renders_the_selected_variant_in_development(tmp_path: Path) -> None:
    with serve_example(tmp_path, "development") as base:
        pages = {v: fetch(f"{base}/settings?variant={v}") for v in "abc"}
        assert all(status == 200 for status, _ in pages.values())
        assert len({body for _, body in pages.values()}) == 3  # the server renders each variant
        for v, (_, body) in pages.items():
            assert f'data-variant="{v}"' in body and "prototype-bar" in body
        assert fetch(base + "/settings?variant=zzz")[1] == pages["a"][1]  # unknown falls back
        status, throwaway = fetch(base + "/prototype/settings")
        assert status == 200 and "prototype-bar" in throwaway


def test_documented_example_requires_an_explicit_configuration(tmp_path: Path) -> None:
    script = tmp_path / "prototype_example.py"
    script.write_text(documented_example() + "\n", encoding="utf-8")
    result = subprocess.run([sys.executable, str(script), "--port", "0"],
                            capture_output=True, text=True, timeout=15)
    assert result.returncode != 0 and "--env" in result.stderr


FIXTURE_PROJECT = REPO_ROOT / "tests/fixtures/prototype"


@pytest.mark.parametrize("env", ["development", "production"])
def test_fixture_project_is_a_settings_page_with_no_prototype_yet(env: str) -> None:
    """The representative task's input: a real settings page, explicit startup
    configuration, project-native logic and stub data, and no prototype (#258)."""
    import ast

    with serve([sys.executable, "app.py", "--env", env, "--port", "0"], FIXTURE_PROJECT) as base:
        status, page = fetch(base + "/settings")
        assert status == 200 and "<h1>Settings</h1>" in page
        assert "prototype-bar" not in page and "data-variant" not in page
        assert fetch(base + "/prototype/settings")[0] == 404
    readme = (FIXTURE_PROJECT / "README.md").read_text(encoding="utf-8")
    assert "python3 app.py --env development" in readme and "--env production" in readme
    # The logic module is pure: it imports no I/O, serving or process machinery.
    logic = ast.parse((FIXTURE_PROJECT / "settings_logic.py").read_text(encoding="utf-8"))
    imported = {alias.name for node in ast.walk(logic) if isinstance(node, (ast.Import, ast.ImportFrom))
                for alias in node.names} | {node.module for node in ast.walk(logic)
                                            if isinstance(node, ast.ImportFrom) and node.module}
    assert not imported & {"http", "http.server", "socket", "os", "subprocess", "sys"}


def test_browser_check_stays_outside_the_repository_test_run() -> None:
    """The real-browser check needs system Playwright, which the repository's test
    environment lacks: pytest must neither collect it nor import Playwright through it."""
    import ast

    script = REPO_ROOT / "tests/browser/check_prototype_ui.py"
    tree = ast.parse(script.read_text(encoding="utf-8"))
    top_level = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]
    names = {alias.name for node in top_level for alias in node.names} | {
        node.module for node in top_level if isinstance(node, ast.ImportFrom) and node.module}
    assert not any(name.startswith("playwright") for name in names)
    assert not script.name.startswith("test_")
    assert "/usr/bin/chromium" in script.read_text(encoding="utf-8")
    # Checked pages may come from model-written code: every launch keeps the renderer sandbox on.
    launches = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute) and node.func.attr == "launch"]
    assert launches
    for call in launches:
        sandbox = [k.value for k in call.keywords if k.arg == "chromium_sandbox"]
        assert len(sandbox) == 1 and isinstance(sandbox[0], ast.Constant) and sandbox[0].value is True


def test_skill_and_catalogue_require_server_side_exclusion_and_rendered_switching() -> None:
    body = " ".join(skill_body().split())
    assert "excluded from production on the server, not merely hidden" in body
    ui = " ".join((SKILL_ROOT / "references/ui.md").read_text(encoding="utf-8").split())
    anti_patterns = ui.split("## Anti-patterns", 1)[1]
    assert "**Hiding the switcher and calling the prototype excluded.**" in anti_patterns
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines()
               if "skills/workflow/prototype/SKILL.md" in line and line.startswith("|"))
    assert "a switcher that renders the chosen variant and survives reload" in row
    assert "production excludes prototypes on the server" in row


def test_ui_evals_check_rendered_switching_and_production_exclusion() -> None:
    """Case 2 no longer stops at the URL pattern; case 7 runs the representative task
    on the fixture project, judged by the real-browser check (#258)."""
    document = json.loads((SKILL_ROOT / "evals/evals.json").read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in document["evals"]}
    answer = " ".join(cases[2]["expectations"])
    assert "changes the rendered variant" in answer and "reload" in answer
    assert "excludes the prototype from production on the server" in answer
    task = cases[7]
    assert "supplied copy of the Acme settings project" in task["prompt"]
    assert "/prototype/settings" in task["prompt"] and "--env" in task["prompt"]
    expectations = " ".join(task["expectations"])
    assert "tests/browser/check_prototype_ui.py" in expectations
    assert "404" in expectations and "every variant name used in development" in expectations
    assert "--reference-project" in expectations  # production page judged against the untouched project
    # Preserving the prototype commits it to a throwaway capture branch (#257), so the
    # expectation forbids commits on the starting branch, not every commit (decided
    # after the #258 runs, which all captured that way).
    assert "nothing is committed to the starting branch, pushed or published" in expectations
    assert "settings_logic.py" in expectations
    assert "no new dependency" in expectations


def test_ui_reference_declares_the_switcher_hooks_and_derives_them_from_one_list() -> None:
    """Checks and agents find the switcher by declared hooks; the bar's variant list
    comes from the same mapping the server renders, so a new variant is reachable."""
    ui = " ".join((SKILL_ROOT / "references/ui.md").read_text(encoding="utf-8").split())
    wiring = ui.split("### 3. Wire them together", 1)[1].split("```python", 1)[0]
    for hook in ("`.prototype-bar`", "`data-variants`", "`#prev-variant`", "`#next-variant`", "`#variant-label`"):
        assert hook in wiring, hook
    example = documented_example()
    assert "json.dumps(list(VARIANTS))" in example and "[\"a\",\"b\",\"c\"]" not in example
    assert "e.altKey || e.ctrlKey || e.metaKey" in example  # browser shortcuts stay the browser's
    for raw in ("<th>{k}</th>", "<summary>{k}</summary>", '" | ".join(SETTINGS)'):
        assert raw not in example, raw  # every interpolated string is escaped


def test_ui_reference_no_longer_relies_on_undeclared_template_settings() -> None:
    """The old sample gated only the bar on an undeclared settings.DEBUG and its
    switcher changed just the label and URL (#258)."""
    text = (SKILL_ROOT / "references/ui.md").read_text(encoding="utf-8")
    assert "settings.DEBUG" not in text
    assert "history.replaceState" not in text  # a URL-only change leaves the variant unrendered


# --- #259: an optional browser view over the same project-native logic -------------

LOGIC_FILES = ("orders_machine.py", "prototype_orders.py", "prototype_orders_web.py")


def logic_example(tmp_path: Path, mutate: tuple[str, str] | None = None) -> Path:
    """Write logic.md's example files, each a python block whose first line names it."""
    text = (SKILL_ROOT / "references/logic.md").read_text(encoding="utf-8")
    blocks = {}
    for block in re.findall(r"```python\n(.*?)\n```", text, re.DOTALL):
        match = re.match(r"# (\S+\.py)\n", block)
        if match:
            blocks[match.group(1)] = block
    assert set(blocks) == set(LOGIC_FILES), sorted(blocks)
    folder = tmp_path / "logic-example"
    folder.mkdir(parents=True)
    for name, block in blocks.items():
        if mutate and name == "orders_machine.py":
            assert block.count(mutate[0]) == 1, mutate[0]
            block = block.replace(*mutate)
        (folder / name).write_text(block + "\n", encoding="utf-8")
    return folder


def post(url: str, fields: dict[str, str]) -> int:
    data = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(url, data=data, method="POST")
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def native_run(folder: Path, actions: list[str]) -> dict:
    """The state the project's own module reaches, called directly in a fresh process."""
    script = ("import json, sys, orders_machine as m\nstate = m.initial()\n"
              "for a in sys.argv[1:]:\n    state = m.step(state, a)\nprint(json.dumps(state))\n")
    result = subprocess.run([sys.executable, "-c", script, *actions], cwd=folder,
                            capture_output=True, text=True, timeout=15, check=True)
    return json.loads(result.stdout)


def browser_view_state(folder: Path, actions: list[str]) -> dict:
    with serve([sys.executable, "prototype_orders_web.py", "--port", "0"], folder) as base:
        for action in actions:
            assert post(base + "/action", {"action": action}) == 303, action
        status, body = fetch(base + "/state.json")
        assert status == 200
        return json.loads(body)


def test_browser_view_serves_the_project_native_logic(tmp_path: Path) -> None:
    """The browser shell imports the same pure module the terminal shell drives; its
    state after a sequence of actions is what the module itself computes (#259)."""
    folder = logic_example(tmp_path)
    actions = ["pay", "cancel", "refund"]
    assert browser_view_state(folder, actions) == native_run(folder, actions)
    with serve([sys.executable, "prototype_orders_web.py", "--port", "0"], folder) as base:
        assert post(base + "/action", {"action": "ship-to-mars"}) == 400  # only legal actions
        page = fetch(base + "/")[1]
        assert 'name="action" value="pay"' in page and 'value="ship"' not in page  # legal now
        assert "<script" not in page  # no client-side copy of the logic


def test_changing_the_module_changes_the_browser_view(tmp_path: Path) -> None:
    """A second, independent implementation could not stand in: alter one transition in
    the native module and the browser view follows it (#259)."""
    original = logic_example(tmp_path / "original")
    altered = logic_example(tmp_path / "altered", mutate=('("paid", "cancel"): "refund_pending"',
                                                           '("paid", "cancel"): "cancelled"'))
    actions = ["pay", "cancel"]
    assert browser_view_state(original, actions)["status"] == "refund_pending"
    assert browser_view_state(altered, actions)["status"] == "cancelled"
    assert browser_view_state(altered, actions) == native_run(altered, actions)


def test_browser_check_offers_a_logic_mode() -> None:
    """Real-browser evidence for logic views: actions by their visible names, state from
    the native module, and a changed module the page must follow (#259)."""
    result = subprocess.run([sys.executable, str(REPO_ROOT / "tests/browser/check_prototype_ui.py"), "--help"],
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    for option in ("--logic", "--module", "--actions", "--state-key", "--mutate"):
        assert option in result.stdout, option


def test_skill_routing_and_catalogue_offer_the_browser_view_without_a_rewrite() -> None:
    body = " ".join(skill_body().split())
    logic_branch = body.split("**\"Does this logic / state model feel right?\"**", 1)[1].split("- **", 1)[0]
    assert "a browser view of the same module" in logic_branch
    assert "never a re-implementation in page scripts" in logic_branch  # reads right for Node projects too
    assert "→ both, in sequence" in body  # the three-way choice survives
    index = (SKILL_ROOT / "references/REFERENCE.md").read_text(encoding="utf-8")
    assert "people who would rather click" in index and "logic.md" in index
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines()
               if "skills/workflow/prototype/SKILL.md" in line and line.startswith("|"))
    assert "optional browser view over the same native logic" in row
    logic = " ".join((SKILL_ROOT / "references/logic.md").read_text(encoding="utf-8").split())
    assert "re-implements the logic in JavaScript" in logic  # the excluded replacement is named


def test_logic_evals_pair_terminal_browser_and_native_language_cases() -> None:
    document = json.loads((SKILL_ROOT / "evals/evals.json").read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in document["evals"]}
    terminal, browser, node = cases[8], cases[9], cases[10]
    assert "terminal" in " ".join(terminal["expectations"]) and "no browser view" in " ".join(terminal["expectations"])
    assert "disposable Git fixture" in browser["prompt"] and "prototype_subscription_web.py" in browser["prompt"]
    # The grading contract is stated, not hidden: a free port and the address it really serves.
    assert "--port 0 picks a free port" in browser["prompt"] and "http://127.0.0.1:<port>" in browser["prompt"]
    # Case 7's settings project stays as it was: the logic fixture is not part of its input.
    assert "excluding its logic/ subdirectory" in cases[7]["expected_output"]
    browser_expectations = " ".join(browser["expectations"])
    assert "--logic" in browser_expectations and "subscription_machine.py" in browser_expectations
    assert "no JavaScript re-implementation" in browser_expectations
    node_expectations = " ".join(node["expectations"])
    assert "node:http" in node_expectations and "no Python" in node_expectations
    triggers = json.loads((SKILL_ROOT / "evals/trigger-evals.json").read_text(encoding="utf-8"))
    assert any(t["should_trigger"] and "click through" in t["query"] for t in triggers)


def test_logic_fixture_project_is_pure_logic_with_a_terminal_shell() -> None:
    """Case 9's input: a native module with the initial/actions/step shape and its
    terminal prototype; no browser view yet (#259)."""
    import ast

    folder = REPO_ROOT / "tests/fixtures/prototype/logic"
    names = sorted(p.name for p in folder.iterdir() if p.is_file())
    assert names == ["README.md", "prototype_subscription.py", "subscription_machine.py"]
    tree = ast.parse((folder / "subscription_machine.py").read_text(encoding="utf-8"))
    functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
    assert {"initial", "actions", "step"} <= functions
    assert not [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
    result = subprocess.run([sys.executable, "prototype_subscription.py"], cwd=folder, input="subscribe\nq\n",
                            capture_output=True, text=True, timeout=15,
                            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})  # keep the fixture clean
    assert result.returncode == 0 and '"status": "active"' in result.stdout, result.stderr


def browser_check_module():
    """The check imports Playwright only inside main(), so its helpers load under pytest."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_prototype_ui", REPO_ROOT / "tests/browser/check_prototype_ui.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_logic_check_tells_a_refused_action_from_a_broken_module(tmp_path: Path) -> None:
    """Only the module's own ValueError means "refused"; any other error is a failure,
    so a broken changed module cannot pass as a refusal (#259 review)."""
    check = browser_check_module()
    folder = logic_example(tmp_path)
    assert check.native_state(folder, "orders_machine", ["pay"])["status"] == "paid"
    assert check.native_state(folder, "orders_machine", ["refund"]) is None  # ValueError: refused
    (folder / "broken_machine.py").write_text("def initial():\n    return {}\n\ndef actions(state):\n"
                                              "    return ['pay']\n\ndef step(state, action):\n"
                                              "    return undefined_name\n", encoding="utf-8")
    with pytest.raises(check.Failure, match="NameError"):
        check.native_state(folder, "broken_machine", ["pay"])
    with pytest.raises(check.Failure, match="ModuleNotFoundError"):
        check.native_state(folder, "no_such_module", ["pay"])
    # Refusal means "not among actions(state)": a bug that happens to raise ValueError,
    # or a module that exits with any code, is a failure, never a refusal.
    (folder / "buggy_machine.py").write_text(
        "def initial():\n    return {'status': 'new'}\n\ndef actions(state):\n    return ['pay']\n\n"
        "def step(state, action):\n    x, y = (1, 2, 3)\n", encoding="utf-8")
    with pytest.raises(check.Failure, match="ValueError"):
        check.native_state(folder, "buggy_machine", ["pay"])
    (folder / "exiting_machine.py").write_text(
        "import sys\n\ndef initial():\n    return {'status': 'new'}\n\ndef actions(state):\n    return ['pay']\n\n"
        "def step(state, action):\n    sys.exit(3)\n", encoding="utf-8")
    with pytest.raises(check.Failure):
        check.native_state(folder, "exiting_machine", ["pay"])


def test_logic_check_knows_the_legal_actions_and_changes_step_itself(tmp_path: Path) -> None:
    """The check compares the offered controls with the module's actions(state), and its
    default change edits step() itself, so a page that runs its own step() over the
    module's exported table cannot follow it (#259 second SPEC review)."""
    import ast

    check = browser_check_module()
    folder = logic_example(tmp_path)
    assert check.native_answer(folder, "orders_machine", ["pay"]) == {
        "state": {"status": "paid", "history": ["pay"]}, "legal": ["cancel", "ship"]}
    assert check.native_answer(folder, "orders_machine", []) ["legal"] == ["cancel", "pay"]
    old, new = check.DEFAULT_MUTATION.split("::")
    module = (folder / "orders_machine.py").read_text(encoding="utf-8")
    step = next(node for node in ast.parse(module).body if isinstance(node, ast.FunctionDef) and node.name == "step")
    assert old.strip() in ast.get_source_segment(module, step)  # the change lands inside step()
    assert "TRANSITIONS = " not in old


def test_logic_check_reads_human_labels_and_knows_every_reachable_action(tmp_path: Path) -> None:
    """A support-lead page may say "Payment failed" or "Past due"; and the check knows every
    action the module can ever offer, not only those of the states it visited (#259 delta)."""
    check = browser_check_module()
    pattern = check.name_pattern("payment_failed")
    for label in ("payment_failed", "Payment failed", "PAYMENT-FAILED", "  payment failed "):
        assert pattern.fullmatch(label), label
    for label in ("payment", "payment failed twice", "paymentfailed"):
        assert not pattern.fullmatch(label), label
    # Playwright searches the pattern, so it must be anchored: "pay" is not "payment_failed".
    assert not check.name_pattern("pay").search("payment_failed")
    assert check.shows("past_due", "Status: Past due") and not check.shows("past_due", "Status: past due-ish")
    folder = logic_example(tmp_path)
    assert check.native_universe(folder, "orders_machine") == ["cancel", "pay", "refund", "ship"]
    # A machine with a cycle and a growing history still yields every action (the fixture).
    assert check.native_universe(REPO_ROOT / "tests/fixtures/prototype/logic", "subscription_machine") == [
        "cancel", "pay", "payment_failed", "period_ends", "reactivate", "subscribe"]


def test_logic_check_finds_controls_by_the_action_they_carry() -> None:
    """A support-lead page may label a button "Cancel subscription" while its value is still
    "cancel"; disabled buttons and links are not offered (#259 fourth delta review)."""
    check = browser_check_module()
    selector = check.carried_action_selector('cancel')
    assert 'button[value="cancel"]' in selector and '[data-action="cancel"]' in selector
    assert selector.count(":not([disabled])") == 2 and selector.count(':not([aria-disabled="true"])') == 2
    assert check.carried_action_selector('a"b') .count('a\\"b') == 2  # quotes cannot break out of the selector


def test_browser_check_servers_print_unbuffered_and_skip_disabled_controls() -> None:
    """Regression guards for fixes the browser evidence relies on: an unflushed print of the
    address must arrive, and disabled buttons or links are never counted as offered."""
    import ast

    source = (REPO_ROOT / "tests/browser/check_prototype_ui.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    server = next(node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == "Server")
    assert "PYTHONUNBUFFERED" in ast.get_source_segment(source, server)
    control = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "control")
    roles = [call for call in ast.walk(control) if isinstance(call, ast.Call)
             and isinstance(call.func, ast.Attribute) and call.func.attr == "get_by_role"]
    assert {ast.literal_eval(call.args[0]) for call in roles} == {"button", "link"}
    for call in roles:
        assert any(k.arg == "disabled" and isinstance(k.value, ast.Constant) and k.value.value is False
                   for k in call.keywords), ast.get_source_segment(source, call)


def test_logic_check_never_changes_the_checked_project(tmp_path: Path) -> None:
    """--mutated-project must be a separate copy: pointing it at the project, inside it or
    around it would rewrite the user's own module (#259 review)."""
    project = logic_example(tmp_path)
    before = (project / "orders_machine.py").read_bytes()
    for mutated in (project, project / "copy", project.parent):
        out = tmp_path / f"out-{mutated.name}"
        result = subprocess.run([sys.executable, str(REPO_ROOT / "tests/browser/check_prototype_ui.py"),
                                 "--logic", "--out", str(out), "--project", str(project),
                                 "--start", "python3 prototype_orders_web.py --port {port}",
                                 "--mutated-project", str(mutated)], capture_output=True, text=True, timeout=60)
        assert result.returncode != 0 and "separate copy" in result.stderr, (mutated, result.stderr)
    assert (project / "orders_machine.py").read_bytes() == before


def test_logic_check_mutation_guards(tmp_path: Path) -> None:
    check = browser_check_module()
    source = tmp_path / "m.py"
    source.write_text('T = {"a": "b"}\n', encoding="utf-8")
    check.apply_mutation(source, ('"a": "b"', '"a": "c"'))
    assert source.read_text(encoding="utf-8") == 'T = {"a": "c"}\n'
    source.write_text('T = {"a": "b", "x": "a": "b"}\n', encoding="utf-8")
    with pytest.raises(check.Failure, match="more than once"):
        check.apply_mutation(source, ('"a": "b"', '"a": "c"'))
    source.write_text('T = {"z": "y"}\n', encoding="utf-8")
    with pytest.raises(check.Failure, match="does not carry the mutation"):
        check.apply_mutation(source, ('"a": "b"', '"a": "c"'))


def test_logic_check_refuses_a_stale_mutated_copy(tmp_path: Path) -> None:
    """Reusing an --out directory must not check an old changed copy (#259 review)."""
    out = tmp_path / "out"
    (out / "logic-mutated").mkdir(parents=True)
    result = subprocess.run([sys.executable, str(REPO_ROOT / "tests/browser/check_prototype_ui.py"),
                             "--logic", "--out", str(out)], capture_output=True, text=True, timeout=60)
    assert result.returncode != 0
    assert "already exists" in result.stderr


def test_logic_check_on_a_project_needs_no_repository_files(tmp_path: Path) -> None:
    """Graders run a copy of the check outside the repository; project mode must not read
    the repository's logic.md (it failed before the browser started)."""
    copied = tmp_path / "check_prototype_ui.py"
    copied.write_bytes((REPO_ROOT / "tests/browser/check_prototype_ui.py").read_bytes())
    project = logic_example(tmp_path)
    out = tmp_path / "out"
    subprocess.run([sys.executable, str(copied), "--logic", "--out", str(out), "--project", str(project),
                    "--start", "python3 prototype_orders_web.py --port {port}"],
                   capture_output=True, text=True, timeout=60)
    result = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert "logic.md" not in result["result"], result["result"]
    assert "files" in result["subject"]


def test_logic_example_is_safe_to_copy() -> None:
    """One request at a time keeps the shared state consistent; the Node note names the
    two things node:http does not give you (#259 review)."""
    folder_text = (SKILL_ROOT / "references/logic.md").read_text(encoding="utf-8")
    web = next(b for b in re.findall(r"```python\n(.*?)\n```", folder_text, re.DOTALL)
               if b.startswith("# prototype_orders_web.py"))
    assert "ThreadingHTTPServer" not in web and "HTTPServer((" in web
    node = " ".join(folder_text.split()).split("In a Node project", 1)[1].split("###", 1)[0]
    assert "URLSearchParams" in node and "escape" in node


def test_terminal_shell_still_drives_the_same_module(tmp_path: Path) -> None:
    """The terminal presentation stays the default for developers (#259 AC1)."""
    folder = logic_example(tmp_path)
    result = subprocess.run([sys.executable, "prototype_orders.py"], cwd=folder, input="pay\nq\n",
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert '"status": "paid"' in result.stdout
