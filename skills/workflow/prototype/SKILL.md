---
name: prototype
description: >
  Use when a design question is best answered by throwaway code — "does this state model
  or logic feel right?" (build a runnable terminal app) or "what should this look like?"
  (several radically different UI variations on one route). Also when another skill needs
  a cheap concrete artifact to react to. Triggers on: "prototype this", "sanity-check this
  state machine", "mock up a few versions of this screen", "explore what this UI could
  look like".
license: MIT (adapted from mattpocock/skills)
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [Logic](references/logic.md). Build a tiny interactive terminal app that pushes the state machine through cases that are hard to reason about on paper.
- **"What should this look like?"** → [UI](references/ui.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.
- **"Does the logic work *and* how should it surface?"** → both, in sequence. Nail the state model with the Logic branch first, then wrap the validated logic in the UI branch. Don't try to answer both questions in one artifact — a UI mockup over unvalidated logic hides which one you're actually judging.

The branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Put what you're testing behind a pure interface.** Keep the thing under question — the state machine, the decision logic — behind a small, side-effect-free interface, separate from the throwaway shell (terminal loop or UI route) that drives it. That isolation is what makes a validated decision cheap to adopt later: an authorized implementation lifts the interface, not the scaffolding around it.
2. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure. A UI prototype is excluded from production on the server, not merely hidden ([UI](references/ui.md), step 3). Note `git status --short` before the prototype's first edit, so you can later tell its changes from work that was already there.
3. **One command to run.** Whatever the project's existing task runner supports — `uv run`, `python <path>`, `node <path>`, etc. The user must be able to start it without thinking.
4. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
5. **Skip the polish — while it's throwaway.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast, preserve it, and clean it up. These exemptions never carry over into production code.
6. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
7. **Preserve it before cleanup.** When done, record the answer, capture the prototype as a **primary source** on a throwaway branch that is never merged into main, leave a pointer to it, and only then clean up the files it wholly owns (When done, below).

## When done

The _answer_ is what a prototype is for, and its source is the evidence behind that answer: preserve both before any cleanup. Finishing a planning prototype edits no production code. Lifting a validated reducer into production keeps the **decision**, not the prototype, and is a separately authorized implementation under the normal production quality gates — real tests, error handling and the abstractions you skipped.

1. **Record the answer.** Write a `NOTES.md` next to the prototype, so it is captured with the source (if the prototype leaves no files, record the answer in a commit message, ADR or issue instead):

```markdown
# Prototype: <one-line name>
- **Question:** <the design question this was answering>
- **Hypothesis:** <what you expected going in>
- **Approach:** <what the prototype actually did>
- **Answer:** <what you now know>
- **Confidence:** <high / medium / low — and why>
- **Branch:** <throwaway branch where the prototype is captured>
- **Next step:** <separately authorized implementation of the decision / prototype further / shelve>
```

   If the user is around, fill this in as a quick conversation. If not, stub the fields so the verdict can be filled in later from the captured branch.
2. **Capture the prototype as a primary source.** Capture every file the prototype created or edited, including `NOTES.md`. Save this script outside the repository as `capture.sh` and run it from the repository root as `capture_branch=prototype/<name> bash capture.sh <file>…`, naming a new throwaway branch. The branch starts at the current HEAD and is never merged into main. The script commits the files there in a temporary worktree, leaves your checkout untouched, and checks that each file comes back byte-exact:

```bash
set -euo pipefail
: "${capture_branch:?name a new branch}"
prefix="$(git rev-parse --show-prefix)"
[ -z "$prefix" ] || { echo "capture: run from the repository root" >&2; exit 1; }
capture_dir="$(mktemp -d)"
git worktree add -b "$capture_branch" "$capture_dir" HEAD || { rmdir -- "$capture_dir"; exit 1; }
trap 'git worktree remove --force "$capture_dir"; git branch -D "$capture_branch"' ERR
tar -cf - -- "$@" | tar -xf - -C "$capture_dir"
git -C "$capture_dir" add -- "$@"
git -C "$capture_dir" commit -m "chore(prototype): preserve $capture_branch"
trap - ERR
git worktree remove --force "$capture_dir"
for path; do git cat-file blob "$capture_branch:$path" | cmp -- - "$path"; done
git rev-parse "$capture_branch"
```

   If a step fails — a missing file, an ignored path, or a pre-commit hook rejecting throwaway code — the script removes its own worktree and branch and stops. That is a failed capture: report it, and don't force an ignored path or bypass the hook without the user's say-so. Line-ending or clean filters, or a hook that rewrites files, can fail the final check even though the commit exists; the branch stays for inspection. Report that too instead of cleaning up, and capture again under a new branch name once the cause is settled; delete the kept branch only with the user's say-so.

3. **Leave a pointer.** Record the branch and its capture commit (the last line `capture.sh` prints) where the answer will be read: on the implementation issue, following the configured tracker's conventions (they should have been provided to you — tell the user to run `/setup-project-skills` if not), or in a commit message or ADR when there is no issue. The branch is local. Pushing the branch publishes it, including anyone else's uncommitted edits captured in partly owned files: push only to the configured remote and with authority to publish; otherwise report it as local-only.
4. **Clean only what was captured.** Clean only the files the prototype wholly owns. A file is wholly owned when every uncommitted change in it is the prototype's: a file it created, or an existing file whose only edits are its own. Check each one just before cleanup with `git diff -- <file>` against the status you noted at the start. If no status was noted, treat any change you cannot attribute to the prototype as someone else's. A file with any other uncommitted edit, made before the prototype or since, is not wholly owned: leave it out of the recipe, then remove only the prototype's lines by hand, or report them. After a successful capture, save this as `cleanup.sh` and run `capture_branch=prototype/<name> bash cleanup.sh <file>…` with the same branch and the wholly owned files. It stops on a staged file or on any file that no longer matches its captured bytes, and removes nothing else except directories its removals leave empty, even one that was already empty before the prototype wrote into it — unrelated tracked and untracked files, other branches and worktrees stay as they are:

```bash
set -euo pipefail
: "${capture_branch:?name the capture branch}"
prefix="$(git rev-parse --show-prefix)"
[ -z "$prefix" ] || { echo "cleanup: run from the repository root" >&2; exit 1; }
if ! git diff --cached --quiet -- "$@"; then
  echo "cleanup: staged changes; unstage them first:" >&2; git diff --cached --name-only -- "$@" >&2; exit 1
fi
for path; do
  git cat-file blob "$capture_branch:$path" | cmp -s -- - "$path" ||
    { echo "cleanup: $path does not match its capture" >&2; exit 1; }
done
for path; do
  if git cat-file -e "HEAD:$path" 2>/dev/null; then git restore --source=HEAD --worktree -- "$path"
  else rm -- "$path"; rmdir -p -- "$(dirname -- "$path")" 2>/dev/null || true; fi
done
```

   A failed capture or a failed check means no cleanup: report what remains. Never leave a prototype rotting in the repo, and never delete one that was not captured.

## Reference

| File | Use When |
|---|---|
| [Logic](references/logic.md) | State machines, business logic, data shapes, API contracts |
| [UI](references/ui.md) | Page layouts, dashboards, settings screens, information hierarchy |
