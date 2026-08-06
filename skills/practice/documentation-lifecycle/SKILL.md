---
name: documentation-lifecycle
description: >
  Use when documentation must stay truthful as software changes — writing or revising a
  spec, ADR, runbook, or API/config reference, splitting user-facing docs by purpose, or
  reconciling documentation drift. Triggers on: "write a spec", "ADR", "runbook", "which
  docs must change", "documentation drift", "missing acceptance criteria", "spec
  interview", "update the API reference".
---

# Documentation Lifecycle

Use this skill to keep repository documentation truthful as software changes. It routes work across two distinct families:

- **engineering documentation** — specs, ADRs, exact reference docs, runbooks, and maintenance surfaces
- **user-facing documentation** — tutorials, how-to guides, reference, and explanation

This skill exists to stop two failure modes:
1. implementation ships while the canonical docs lie
2. teams dump every doc need into a README and call it “done”

## Quick Start

**Hard rule: every document this skill calls for must be written to disk.** Use the `write` tool for new files and the `edit` tool for updates. Outputting document content in the chat instead of writing a file is a failure.

1. Classify the task:
   - vague or disputed change request
   - planned feature or behavior change
   - architecture-significant decision
   - exact interface or configuration update
   - operational / deployment / recovery change
   - user-facing docs request
   - documentation drift audit
2. Decide whether the primary surface is **engineering documentation**, **user-facing documentation**, or both.
3. Read only the smallest reference file that matches:
   - vague scope or missing acceptance criteria -> `references/specification-interview.md`
   - canonical behavior intent -> `references/feature-spec.md`
   - hard-to-reverse architecture choice -> `references/adr.md`
   - exact interfaces and behavior facts -> `references/reference-docs.md`
   - operations, deployment, migration, rollback, troubleshooting -> `references/runbook.md`
   - tutorials / how-to / reference / explanation -> `references/user-facing-docs.md`
   - mixed or unclear work -> `references/REFERENCE.md`
4. Update existing authoritative docs before creating new ones unless the current structure is obviously missing a required document type.
5. If code, tests, and docs disagree, stop and surface the discrepancy instead of picking the text you like best.

## Critical Rules

0. **Documents are files, not chat messages.** When this skill determines that a document must be created or updated, you MUST write it to disk with the `write` tool (or `edit` for updates). Never dump the full document content into the chat as a substitute for writing the file. Describing what you *would* write is not writing it. If you identify that a feature spec, ADR, runbook, reference doc, or any other document is needed, the task is not complete until the file exists on disk at the correct path. For ADRs and the domain glossary, the correct path is whatever the domain doc config specifies — run `/setup-project-skills` if none has been provided, and otherwise default to `CONTEXT.md` and `docs/adr/` at the repo root.

1. **One canonical answer per question.** One document owns intent, another owns rationale, another owns exact interface facts, and another owns operations.
2. **Spec before implementation for non-trivial behavior changes.** If the task changes user-visible or operator-visible behavior, draft or update the canonical feature spec first.
3. **Interview before drafting when the request is vague.** Do not turn ambiguity into fake confidence.
4. **Use adaptive questioning, not bureaucratic questionnaires.** Start with 3-5 high-leverage questions, then branch only where uncertainty remains.
5. **Probe before freezing.** Question the assumptions behind the request, and surface real tradeoffs, before locking a spec. Skip the adversarial theater when there is no genuine conflict.
6. **Separate engineering documentation from user-facing documentation.** Internal implementation docs and external user docs solve different problems.
7. **Prefer updating the nearest canonical doc over spawning document sprawl.** Do not create documentation theater.
8. **Status matters.** Mark authoritative docs clearly: Draft, Active, Superseded, Deprecated.
9. **README is a map, not the whole territory.** Keep it as orientation and links unless it is intentionally the canonical doc for that narrow topic.
10. **Operationally significant changes require maintenance documentation.** If deployment, rollback, alerts, migrations, or recovery change, update the runbook before declaring the task complete.
11. **Documentation drift is a bug.** If you cannot reconcile a known stale doc immediately, flag it visibly rather than leaving a polished lie.

## Routing Matrix

| Situation | Primary doc type | Start with |
|---|---|---|
| New feature or changed workflow | Feature spec | `references/feature-spec.md` |
| Vague request with missing constraints | Spec interview | `references/specification-interview.md` |
| Architectural choice or major tradeoff | ADR | `references/adr.md` |
| New endpoint, schema, flag, CLI option, contract | Reference docs | `references/reference-docs.md` |
| Deployment, migration, rollback, incident response | Runbook / maintenance docs | `references/runbook.md` |
| Public docs for end users | Tutorial / how-to / reference / explanation | `references/user-facing-docs.md` |
| Mixed or drift-heavy task | Audit + targeted updates | `references/REFERENCE.md` |

## Default Workflow

1. **Clarify** — classify the task and determine whether the missing piece is intent, rationale, exact facts, operations, or user guidance.
2. **Interview** — if the request is underspecified, run the lightweight interview flow from `references/specification-interview.md`.
3. **Write engineering docs first** when behavior or implementation contracts change. Use the `write` tool to create or the `edit` tool to update the actual file on disk:
   - feature spec for intent
   - ADR for rationale
   - reference docs for exact interfaces
   - runbook for operational reality
4. **Write user-facing docs second** when the change affects discoverability, onboarding, or public workflows. Same rule: file on disk, not in chat.
5. **Audit for drift** — check status markers, supersession links, acceptance criteria, and whether README or other overview docs now point at stale targets.
6. **Finish only after reconciliation and file verification** — documentation work is incomplete if the code changed but the authoritative docs did not. Verify the files exist on disk before declaring the task done.

## Interview Guidance

When the request is muddy, restate the user's goal in 1-2 sentences to confirm you have it right. Then ask only the questions needed to freeze the contract:

- Ask **probing questions** where definitions are unclear, evidence is shaky, stakeholders are hidden, or failure consequences are unstated.
- When the desired outcome collides with a real counter-pressure — speed vs safety, flexibility vs specificity, internal simplicity vs public clarity — name both sides and resolve the tradeoff explicitly before freezing the spec.

If there is no real conflict, do not manufacture one. Clarify, confirm, and move on.

## Reference Map

| File | Owns | Use when |
|---|---|---|
| `references/REFERENCE.md` | Routing index | The task touches multiple doc types or you are unsure where to start |
| `references/specification-interview.md` | Discovery workflow | Requirements are vague, disputed, or missing acceptance criteria |
| `references/feature-spec.md` | Canonical feature intent | You need to define or revise behavior before implementation |
| `references/adr.md` | Decision rationale | You need to document architecture choices and tradeoffs |
| `references/reference-docs.md` | Exact interface facts | You need to update APIs, schemas, settings, or contracts |
| `references/runbook.md` | Operations and recovery | You need deployment, migration, rollback, or troubleshooting guidance |
| `references/user-facing-docs.md` | Diátaxis split | You need tutorial/how-to/reference/explanation guidance |

## Content Ownership

This skill owns documentation lifecycle decisions:
- which document types must change
- how to interview for a spec
- how to separate intent, rationale, facts, and operations
- how to route user-facing docs by purpose
- how to call out documentation drift

This skill does not own stack-specific implementation details. Pair it with the relevant framework or product skill once the documentation contract is clear.
