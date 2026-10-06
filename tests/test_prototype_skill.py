"""#257: a prototype's source and decision evidence survive before scoped cleanup.
#258: the documented UI switcher wiring renders the chosen variant and production
excludes prototypes on the server.

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
    source = script.read_text(encoding="utf-8")
    assert "/usr/bin/chromium" in source
    # Checked pages may come from model-written code: the renderer sandbox stays on.
    assert "chromium_sandbox=True" in source


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
