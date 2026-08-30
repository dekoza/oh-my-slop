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

The issue tracker and triage label vocabulary should have been provided to you — tell the user to run `/setup-project-skills` if not. Publish to the agent work tracker it names, following that doc's conventions. If no tracker has been provided, default to the local-markdown tracker.

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

**A shared interface is a blocking edge, not a note.** Two tickets can each be a clean vertical slice, each green on its own, and still break on contact: one **defines** an interface — a response body, an event payload, a column, a shared signature — and another **reads** it. Neither gates the other in the *can't start* sense, so the frontier offers both at once and two sessions build against two different truths. Nothing fails until the second one merges.

Draw the edge anyway: the ticket that defines the shape blocks every ticket that consumes it, even when the consumer could start today against the shape already there. This holds only for a shape one of the tickets **changes**; two tickets that merely touch the same file are not this. When the ordering genuinely cannot go that way, because the definer needs the consumer to exist first, keep both and add a shared integrate-and-verify ticket blocked by each, the way a wide refactor's batches do; green is promised only there.

**"Tell the other ticket before merging" in the producer's acceptance criteria is not a substitute.** That note is written by the ticket changing the shape, delivered once its work is already done, to a ticket that may have been built and merged in the meantime. An edge is a constraint the frontier honours; a note is a hope about timing.

**The first implementation ticket is a walking skeleton — a check, not advice.** When the breakdown starts a new product or a new top-level component, its first implementation ticket must produce one **runnable entry point** — a process that starts, a command that answers, a route that responds — thin end to end, which every later ticket extends. Story-independent tickets without it produce a series of little applications that never meet; the running skeleton is what makes each later slice a slice *of something*. Contract tickets (next rule) are not implementation tickets and may precede it: the skeleton is the first ticket that produces behaviour, blocked by whichever contracts it reads. The quiz below refuses a breakdown that fails this check.

**Contract first when the work spans more than one component.** A component is a module, service, or package with its own boundary; the quiz asks. When tickets fall on both sides of one, the interface between them — the request and response shapes, the event payload, the exported signature — gets its own **contract ticket**, emitted before any ticket that depends on it:

- **Ownership.** The interface is **owned by the higher-level component** — the one that composes or calls the other. Its contract ticket lives in that component's scope, not the provider's, so the shape is the caller's need rather than whatever the provider found convenient to expose.
- **One contract ticket per cross-component interface, first.** Every implementation ticket on either side that reads or implements the shape is **blocked by** it, as a native blocking edge, never a note. A dependent is not started until its contract is accepted — the same edge the shared-interface rule above draws, drawn before either side has a ticket to argue with.
- **Acceptance criteria are the artifact and a test.** The contract ticket is done when the interface artifact exists (a schema, a type, an OpenAPI fragment, an event shape) and a test exercises it **from the dependent's side against a stub** of the provider. The stub is what lets the dependent build before the provider does.
- **An accepted contract is immutable.** A revision is a new version, and a new version is a **new ticket** — blocked by nothing, blocking the affected dependents' follow-up tickets. Nobody edits an accepted contract ticket in place; the contract ticket's body says so, in the template below, so the rule survives into the tracker.

**The last ticket is always the human's.** Every breakdown ends in one terminal **review ticket** — `Review the delivered <parent title>` — blocked by every other ticket of the run and marked for a human, never an agent. It is the sink the whole run drains into: when the software factory has implemented everything implementable, this is the one ticket left open on the board, and it is what asks the operator to look. Without it a fully delivered map simply goes quiet. It is not optional and not a ticket the user can drop from the breakdown; a breakdown without it is not publishable. Its body asks three fixed questions — does the delivered behaviour match the destination; what is wrong or missing; what should the next map chart — and the operator answers in a comment and closes it, the same shape a wayfinder resolution has.

### 4. Quiz the user

First apply the walking-skeleton check: if the breakdown starts a new product or a new top-level component and its first implementation ticket — the first ticket after any contract tickets — does not produce a runnable entry point, **refuse** it — do not present it for approval. Say which ticket would have to come first and redraw before quizzing. A breakdown that fails this check is not a candidate, whatever the user prefers about granularity.

Present the proposed breakdown as a numbered list, the review ticket last so it is approved with the rest. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket depend on every ticket that gates it, and on no others?
- Does any ticket change a shape another ticket reads? That gates it too, even though the consumer could start today.
- Does the work span more than one component — module, service, package? If so, which interfaces cross a boundary, which component owns each, and does each have a contract ticket that its dependents are blocked by?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets, following the tracker doc's conventions. The tickets are the same whatever the tracker — only the shape of the blocking edges changes:

- **A forge-backed tracker** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the tracker's native blocking relationship where the doc describes one; otherwise set each ticket's "Blocked by" to the blocking issues. The review ticket is published **last**, with a blocking edge from **every** other ticket of the run, labelled `workflow:implement` and `ready-for-human`; use the review-ticket template below.
- **Local files** → write one file per ticket at the path the tracker doc specifies, numbered from `01` in dependency order (blockers first; contract tickets before their dependents, so a dependent's number is always higher than its contract's). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below — one ticket per file, never a single combined file. The review ticket is the last numbered file, its "Blocked by" listing every other file, its status `ready-for-human`.

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

<contract-ticket-template>

Part of #<parent>

## Parent

A reference to the parent issue, by name and link.

## Contract: <interface name> between <higher-level component> and <lower-level component>

Owned by <higher-level component>. This ticket fixes the shape of <interface> — <what crosses it: request and response, event payload, exported signature> — so both sides can build against one truth. Dependents are blocked by this ticket and start only once it is accepted.

Once accepted, this contract is immutable. A change is a new version, filed as a new ticket that blocks the affected dependents' follow-up tickets; do not edit this ticket's shape in place.

## Acceptance criteria

- [ ] The interface artifact exists: <schema / type / OpenAPI fragment / event shape>.
- [ ] A test exercises the interface from <dependent>'s side against a stub of <provider>.

## Blocked by

- A reference to each blocking ticket, or "None — can start immediately". A revision of an accepted contract is blocked by nothing.

</contract-ticket-template>

<review-ticket-template>

Part of #<parent>

## Parent

A reference to the parent issue, by name and link.

## Review the delivered <parent title>

Every other ticket of this run blocks this one, so it becomes takeable only when the rest is done. It is yours, not an agent's: answer in a comment, then close it.

1. Does the delivered behaviour match the destination the parent names? Where does it fall short?
2. What is wrong or missing — bugs to file, tickets to reopen?
3. What should the next map chart?

## Delivered by

- Each ticket of the run, by name and link.

## Blocked by

- Every other ticket of the run.

</review-ticket-template>

In either form, avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

Work the frontier one ticket at a time with the `implement` skill in fresh sessions, clearing context between tickets.
