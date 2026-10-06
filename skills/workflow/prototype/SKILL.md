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

1. **Put what you're testing behind a pure interface.** Keep the thing under question — the state machine, the decision logic — behind a small, side-effect-free interface, separate from the throwaway shell (terminal loop or UI route) that drives it. That isolation is what makes a validated prototype cheap to absorb: you lift the interface into production, not the scaffolding around it.
2. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
3. **One command to run.** Whatever the project's existing task runner supports — `uv run`, `python <path>`, `node <path>`, etc. The user must be able to start it without thinking.
4. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
5. **Skip the polish — while it's throwaway.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast and then delete it. These exemptions end the moment the prototype is absorbed (Rule 7).
6. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
7. **Capture it when done.** Fold any validated decision into the real code, then commit the prototype itself as a **primary source** to a throwaway branch *out of main*, and leave a context pointer to that branch on the implementation issue (using `tea` / Gitea — see `docs/agents/issue-tracker.md`). The main branch keeps only the validated decision.

This is distinct from *absorbing*: lifting a validated reducer keeps the **decision**, not the prototype. The throwaway exemptions end on the folded-in code: it gets real tests, error handling, and the abstractions you skipped, held to the same bar as any production code.

## When done

The _answer_ is the only thing worth keeping from a prototype. The prototype itself is a primary source — commit it, don't delete it.

1. **Fold the validated decision into the real code.** Lift the validated reducer/interface/decision into production, held to the same bar as any production code (real tests, error handling, abstractions — the throwaway exemptions end the moment it's absorbed). This is the only thing that stays on main.
2. **Capture the prototype as a primary source.** List the files the prototype owns: the files it created, plus existing files it edited that held no other uncommitted work when it started. A file holding someone else's uncommitted work is not owned — leave it out and report it. From the repository root, run this as one script with the owned files as arguments and `capture_branch` naming a new throwaway branch *out of main*. It commits them on that branch in a temporary worktree, leaves your checkout untouched, and checks that each file comes back byte-exact:

```sh
set -euo pipefail
capture_dir="$(mktemp -d)"
git worktree add -b "$capture_branch" "$capture_dir" HEAD
tar -cf - -- "$@" | tar -xf - -C "$capture_dir"
git -C "$capture_dir" add -- "$@"
git -C "$capture_dir" commit -m "prototype: preserve $capture_branch"
git worktree remove "$capture_dir"
for path; do git cat-file blob "$capture_branch:$path" | cmp -- - "$path"; done
```

   Leave a context pointer to that branch on the implementation issue (using `tea` / Gitea — see `docs/agents/issue-tracker.md`). The main branch keeps only the validated decision.
3. **Record the answer.** Capture the answer in a `NOTES.md` next to the prototype (or a commit message / ADR / issue if the prototype leaves no trace):

```markdown
# Prototype: <one-line name>
- **Question:** <the design question this was answering>
- **Hypothesis:** <what you expected going in>
- **Approach:** <what the prototype actually did>
- **Answer:** <what you now know>
- **Confidence:** <high / medium / low — and why>
- **Branch:** <throwaway branch name where the prototype is committed>
- **Next step:** <fold validated decision into production / prototype further / shelve>
```

If the user is around, fill this in as a quick conversation. If not, leave the template with the fields stubbed so the verdict can be filled before the throwaway branch is abandoned. Never leave a prototype rotting in the repo.

4. **Clean only what was captured.** After a successful capture, run this with the same branch and files. It stops on a staged file or on any file that no longer matches its captured bytes, and removes nothing else — unrelated tracked and untracked files, other branches and worktrees stay as they are:

```sh
set -euo pipefail
git diff --cached --quiet -- "$@"
for path; do git cat-file blob "$capture_branch:$path" | cmp -s -- - "$path"; done
for path; do
  if git cat-file -e "HEAD:$path" 2>/dev/null; then git restore --source=HEAD --worktree -- "$path"
  else rm -- "$path"; fi
done
```

   A failed capture or a failed check means no cleanup: report what remains.

## Reference

| File | Use When |
|---|---|
| [Logic](references/logic.md) | State machines, business logic, data shapes, API contracts |
| [UI](references/ui.md) | Page layouts, dashboards, settings screens, information hierarchy |
