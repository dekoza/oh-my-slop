---
name: to-tickets
description: >
  Break a plan, spec, or the current conversation into a set of tracer-bullet tickets —
  vertical slices, each declaring its blocking edges — published to the project tracker
  or one local file per ticket.
license: MIT (adapted from mattpocock/skills)
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-project-skills` if not. Publish to the agent work tracker it names, following that doc's conventions. If no tracker has been provided, default to the local-markdown tracker.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets, following the tracker doc's conventions. The tickets are the same whatever the tracker — only the shape of the blocking edges changes:

- **A forge-backed tracker** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the tracker's native blocking relationship where the doc describes one; otherwise set each ticket's "Blocked by" to the blocking issues.
- **Local files** → write one file per ticket at the path the tracker doc specifies, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below — one ticket per file, never a single combined file.

**Every forge-backed ticket opens with the literal first body line `Part of #<parent>`** — the issue the tickets were cut from (the map, or the spec issue when there is no map), then a blank line, then the template below. This line is the membership contract the software factory resolves a parent-scoped run through (`docs/specs/software-factory.md` §3.1): one anchored pattern on the first line, nothing looser. A ticket whose first line is anything else — a heading, a blank line, prose that mentions the parent — is not a member of anything, and a run over its parent refuses as `scope-empty`. When the source is not an issue on the tracker there is no parent, and the line is omitted.

Apply `workflow:implement` to every forge-backed ticket so the next workflow is explicit. Choose the triage state separately: apply `ready-for-agent` by default, or `ready-for-human` when the ticket requires human implementation, resolving either state through the label mapping.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

<local-ticket-template>

# <NN> — <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None — can start immediately".

**Workflow:** implement

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

Part of #<parent>

## Parent

A reference to the parent issue on the tracker, by name and link, for the human reader. The `Part of #<parent>` first line above is what machines read; both are omitted when the source was not an existing issue.

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None — can start immediately".

</issue-template>

In either form, avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

Work the frontier one ticket at a time with the `implement` skill in fresh sessions, clearing context between tickets.
