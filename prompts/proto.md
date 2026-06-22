---
description: Build a throwaway prototype to answer a design question
argument-hint: "<question> [logic|ui]"
---
Build a throwaway prototype to answer a design question. The question decides the shape.

## Pick a branch

Identify which question is being answered:

- **"Does this logic / state model feel right?"** → Logic branch. Build a tiny interactive terminal app that pushes the state machine through hard cases.
- **"What should this look like?"** → UI branch. Generate several radically different UI variations on a single route, switchable via URL search param and a floating bottom bar.

If ambiguous, default to whichever better matches surrounding code (backend module → logic; page or component → UI) and state the assumption.

## Rules

1. **Throwaway from day one.** Name it so a casual reader sees it's a prototype, not production. Locate it close to where it will actually be used.
2. **One command to run.** `uv run`, `python <path>`, `node <path>` — whatever the project supports.
3. **No persistence by default.** State lives in memory. If the question involves a database, hit a scratch DB or a local file named "PROTOTYPE — wipe me".
4. **Skip the polish.** No tests, no error handling beyond runnable, no abstractions. The point is to learn something fast and delete it.
5. **Surface the state.** After every action (logic) or variant switch (UI), print or render the full relevant state.
6. **Delete or absorb when done.** When the prototype answers its question, delete it or fold the validated decision into real code.

## When done

Capture the answer somewhere durable (commit message, ADR, issue, or `NOTES.md` next to the prototype) along with the question it was answering.

$@
