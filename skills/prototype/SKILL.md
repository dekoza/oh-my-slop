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
7. **Delete or absorb when done.** When the prototype has answered its question, either delete it or fold the validated decision into the real code — don't leave it rotting in the repo. If you absorb it, the throwaway exemptions are over: the absorbed code gets real tests, error handling, and the abstractions you skipped, held to the same bar as any production code.

## When done

The _answer_ is the only thing worth keeping from a prototype. Before deleting or absorbing it, capture the answer in a `NOTES.md` next to the prototype (or a commit message / ADR / issue if the prototype leaves no trace):

```markdown
# Prototype: <one-line name>
- **Question:** <the design question this was answering>
- **Hypothesis:** <what you expected going in>
- **Approach:** <what the prototype actually did>
- **Answer:** <what you now know>
- **Confidence:** <high / medium / low — and why>
- **Next step:** <absorb into production / discard / prototype further>
```

If the user is around, fill this in as a quick conversation. If not, leave the template with the fields stubbed so the verdict can be filled before the prototype is deleted. Once the answer is captured, delete or absorb the prototype (Rule 7) — never leave it rotting in the repo.

## Reference

| File | Use When |
|---|---|
| [Logic](references/logic.md) | State machines, business logic, data shapes, API contracts |
| [UI](references/ui.md) | Page layouts, dashboards, settings screens, information hierarchy |
