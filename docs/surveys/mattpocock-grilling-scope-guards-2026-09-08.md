# Survey: mattpocock grilling scope guards (2026-09-08)

## Verdict

**Borrow bounded-decision patterns from adjacent skills, not upstream's grilling loop.** Its current primitive retains the same expanding-tree completion rule as [our grilling skill](../../skills/workflow/grilling/SKILL.md). Upstream recognizes excessive depth in its user documentation, but the operative interview body does not establish scope, depth, or decision-value admission criteria.

The proposed local direction is supported by related patterns, **not an upstream fix ready to copy**: agree the decision and required fidelity; admit only questions that can materially change it; request permission before deepening; preserve settled answers and intentional deferrals; stop when the scoped blockers are resolved.

## Evidence boundary

Fetched GitHub's HEAD API on 2026-09-08: [`3cca18b368ae95cdbdebbff572ccafa662551015`](https://github.com/mattpocock/skills/commit/3cca18b368ae95cdbdebbff572ccafa662551015), committed 2026-09-04. Enumerated the recursive tree (not truncated), then fetched all 113 Markdown/manifest files from raw GitHub **at that SHA**, not moving `main`. No upstream scripts were executed; fetched instructions were treated as evidence only.

Read complete relevant bodies: grilling and both wrappers; to-questionnaire; to-spec; to-tickets; wayfinder; triage and both references; domain-modeling and both format references; improve-codebase-architecture; codebase-design and both design references; prototype and both branches; ask-matt and PHASE-BOUNDARIES; handoff; setup-matt-pocock-skills; experimental loop-me, implement-spec, claude-handoff, writing-fragments and writing-shape; implement. Also read the three grilling-family user docs, question-limits policy, in-progress index, and plugin manifest. The tree has no current to-prd/to-plan/to-issues skill; the relevant current planning surfaces are to-spec and to-tickets.

The [2026-08-22 survey](mattpocock-skills-sync-2026-08-22.md) supplies historical context only: it reviewed through `5b15a47` and recommended grilling presentation changes, not scope semantics. Local baseline inspected: `47231355d4229a8faf8a69e45218dde89196688f`. Findings below describe source instructions, **not measured model compliance**. Upstream itself says the frontier is “the agent's judgement, not a computed graph” ([grilling docs, line 31][grilling-docs]).

## Existing upstream behavior

### 1. Grilling still drives the same drift

[skills/productivity/grilling/SKILL.md, lines 6–28][grilling] says:

- “Interview the user relentlessly”; every decision branches into dependent decisions (line 6).
- “Ask the whole frontier in one round” (line 8); answers push it outward (line 24).
- “The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed” (line 28).

It separates researched facts from human decisions and gates acting on human confirmation. Those protect evidence and authority, **not interview scope**. Neither [grill-me][grill-me] nor [grill-with-docs][grill-with-docs] adds a guard: their complete operative bodies only delegate to grilling, or grilling plus domain-modeling.

The [question-limits policy, lines 3–14][question-limits] deliberately rejects numeric caps and distinguishes genuine underspecification from “redundant or low-value questions”; it places the latter fix in the prompt, not a counter. Human stop/wrap-up steering is its escape hatch. A scope/value filter therefore differs from the rejected hard ceiling.

The [grill-me user docs, lines 23–37, 49–62][grill-me-docs] are unusually direct: “Push back on a question pitched beneath the fidelity you need. Say when the scope is drifting”; “I don't know” is accepted, and questions needing a concrete artifact should stop the interview and detour to a prototype. **These are reader-facing instructions, absent from the primitive and its one-line wrappers.** Reports there about long sessions are not independently verified run evidence in this survey.

### 2. Wayfinder supplies the strongest scope boundary

[skills/engineering/wayfinder/SKILL.md][wayfinder] has actual destination-relative instructions:

- **Planning versus delivery:** “produce decisions, not deliverables”; the pull to execute signals a handoff (line 13), unless Notes explicitly overrides the default.
- **Anchor:** Destination is what the effort ends at, and “every session orients to it before choosing a ticket” (lines 32–34). The map separates Decisions so far, Not yet specified, and Out of scope (lines 40–52).
- **Unknown versus excluded:** “Fog or ticket?” tests whether the question can be stated precisely, not answered immediately (lines 84–93). “Out-of-scope work never graduates (the frontier stops at the destination)” (lines 95–101).
- **Finite session:** at most one non-research ticket per session (line 105); chart breadth-first, stop without a map if there is no fog, and otherwise stop after charting (lines 111–116).

**Limit:** these are map/session boundaries, not an explicit architecture-versus-implementation-depth test inside each grilling ticket. It still invokes the unbounded primitive. Fog is unresolved in-scope work, not permission to declare a blocking question answered. Reusing the destination concept does not require importing the whole tracker workflow.

### 3. To-questionnaire bounds questioning by the needed result

[skills/productivity/to-questionnaire/SKILL.md, lines 9–16][questionnaire]: “Grill the send, not the subject.” The two interview exchanges determine the recipient and “a concrete list of what the user must walk away able to do or decide.” Completion means every named item is covered by a questionnaire question, **not every possible branch explored**. Lines 36–45 welcome partial answers and uncertainty and show a question's decision consequence: expected launch load determines whether to provision now or defer.

**Reuse:** establish the desired decision output before generating questions; connect a question to that output. **Limit:** this constrains a questionnaire-writing job, not a live architecture interview, and it does not contain the proposed counterfactual test that different answers must materially change an in-scope decision.

### 4. Triage preserves settled answers and distinguishes deferral from rejection

[skills/engineering/triage/SKILL.md, lines 93–112][triage] records “What we've established so far” separately from “What we still need”; resumption updates the picture and says “Don't re-ask resolved questions.” The [OUT-OF-SCOPE reference, line 68][triage-scope] explicitly distinguishes temporary circumstances from durable rejection: “those aren't real rejections, they're deferrals.” Its [AGENT-BRIEF reference, lines 19–37][brief] asks for behavioral rather than procedural instructions, concrete testable completion criteria, and explicit exclusions.

**Reuse:** a compact settled/blocking/deferred/excluded record. **Limit:** upstream triage does not define a deferred state; its needs-info record is not a per-round grilling re-anchor. Those would be local adaptations.

### 5. Spec and slicing workflows separate phases, imperfectly

[skills/engineering/to-spec/SKILL.md][to-spec] says “Do NOT interview the user; just synthesize what you already know” (line 7), although it still requests test-seam confirmation (lines 15–17). Its template includes Out of Scope (lines 67–69) and forbids ordinary file paths/code snippets (lines 55–57, with a decision-rich prototype exception).

That is **not** an architecture-only boundary: Implementation Decisions includes schemas, API contracts and specific interactions (lines 43–53). The demand for an “extremely extensive” story list covering “all aspects” (line 41) pulls toward expansion; there is no explicit unresolved-question/deferred-decision field.

[skills/engineering/to-tickets/SKILL.md, lines 27–56][to-tickets] limits each slice to a verifiable vertical path fitting one fresh context, then asks the human to approve granularity and blocking edges. Ticket descriptions specify end-to-end behavior, not layer-by-layer procedure (lines 73 and 92). These bound build units, not the preceding discussion. Upstream [implement][implement] itself still accepts a “spec or set of tickets,” so the phase separation is not a consistently enforced one-ticket contract.

### 6. Architecture tools gate selection, not every descent

[improve-codebase-architecture, lines 20–24, 56–64][architecture] says “Scope before you scan: YAGNI,” honors a named direction, requires real friction to reopen an ADR, and says “Do NOT propose interfaces yet” until the user picks a candidate. This is a useful **consent gate before deeper design**.

But [DESIGN-IT-TWICE, lines 9–35][design-twice] then moves from explaining constraints straight to parallel designs, without another confirmation, and explicitly requests types, methods, parameters and adapters. Domain-modeling's [glossary-only and selective-ADR rules, lines 64–74][domain] bound **documentation**, not interview detail; its edge-case probing can still expand the discussion.

The [logic prototype reference, line 64][logic] has a sharper local guard: “No \"what if we wanted to support X later.\" The prototype answers one question.” Prototype routing offers a way to resolve uncertainty with evidence rather than more hypothetical questions, not permission to build unasked.

### 7. Handoff is contextual preservation, not a stopping condition

[handoff, lines 8–16][handoff] requests skill suggestions, references existing artifacts rather than duplicating them, and tailors the summary to the next session's stated focus. [ask-matt's PHASE-BOUNDARIES, lines 3–5, 20–40][phase-boundaries] distinguishes continuing, clearing, handing off, delegation, and compaction, but defines phase completion fuzzily and favors retaining primary conversation context. Neither supplies a scoped-blocker completion test or mandatory deferral ledger. Its approximate token-budget advice is not a validated threshold here.

### 8. Experimental skills offer both a useful analogy and a warning

These are [explicitly beta and excluded from the plugin][in-progress], also checked against the [manifest][manifest]:

- [writing-shape, lines 11, 26, 45–57][writing-shape] fixes the input pile, lets the user decide completion, and re-anchors with “The opening promised X. We've drifted to Y. Either re-thread it or change the opening.” Its “If I cut this, what breaks?” is a useful value-filter analogy, **not an existing grilling rule**.
- [loop-me, lines 18–27][loop-me] discourages mandatory structures, but demands an implementer be able to build “without asking a single question” and says “nothing is done while a question remains.” That is the strongest anti-pattern for this problem: implementation-level certainty as the interview finish line.
- [claude-handoff][claude-handoff] changes handoff delivery into an immediately launched worker, not its scope contract. [implement-spec][implement-spec] schedules a whole spec's task graph; it adds no interview guard. Neither is a reason to add orchestration here.

## Inferred local direction — not implemented

1. **Agree scope and fidelity together.** Name the decision/outcome, exclusions, and evidence needed to call it settled. “Architecture” alone is too vague: some schema, protocol or failure-mode details materially determine architecture.
2. **Filter before forming the frontier.** Ask only if plausible different answers change an in-scope decision, its feasibility, or a load-bearing risk. Being downstream and askable is insufficient. This counterfactual admission rule is a local proposal, not quoted upstream behavior.
3. **Get permission to cross the agreed depth or scope.** Surface why a deeper detail matters; do not silently treat it as the next branch. Candidate selection in the architecture skill is precedent, not a complete implementation of this gate.
4. **Re-anchor each round compactly:** current goal/fidelity, relevant settled decisions, remaining blockers. Keep research-needed, consciously deferred, and excluded items distinct. Do not reopen settled decisions without changed evidence or explicit user intent.
5. **Stop at scoped sufficiency, not omniscience.** Offer the decision summary and explicit deferrals when blockers are resolved; obtain confirmation and do not start implementation. If a genuinely blocking uncertainty cannot be resolved by conversation, report the block and route to research/prototype/another decision owner rather than inventing certainty.

Intentional deferral must not disguise an unresolved architectural prerequisite. Conversely, a reversible implementation choice that cannot change the agreed decision need not be settled to end an architecture interview. These rules need long-conversation behavioral evaluation before any claim that they prevent drift; source prose alone proves no such guarantee.

## Validation

Only this survey was added; no implementation changes, commit, or push.

- `uv run pytest`: **887 passed** (58.36s).
- `uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py`: **346 passed** (0.49s).
- `uv run python scripts/validate_refs.py`: **exit 0**. This validator scans skills, not surveys.
- Separate Python check of this artifact: **2 local links, 26 reference uses, and 26 pinned source paths/line ranges passed**, resolving sources against the fetched snapshot. This checks existence/ranges, not semantic correctness or live GitHub rendering. Test/validator output was captured with `tee` under `/tmp/mattpocock-grilling-survey-*.log`.

[grilling]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grilling/SKILL.md#L6-L28
[grilling-docs]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/docs/productivity/grilling.md#L25-L31
[grill-me]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grill-me/SKILL.md#L1-L7
[grill-with-docs]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/grill-with-docs/SKILL.md#L1-L7
[question-limits]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/.out-of-scope/question-limits.md#L3-L14
[grill-me-docs]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/docs/productivity/grill-me.md#L23-L62
[wayfinder]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wayfinder/SKILL.md#L7-L126
[questionnaire]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/to-questionnaire/SKILL.md#L9-L45
[triage]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/triage/SKILL.md#L93-L112
[triage-scope]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/triage/OUT-OF-SCOPE.md#L60-L68
[brief]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/triage/AGENT-BRIEF.md#L19-L37
[to-spec]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/to-spec/SKILL.md#L7-L69
[to-tickets]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/to-tickets/SKILL.md#L27-L92
[implement]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/implement/SKILL.md#L1-L15
[architecture]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/improve-codebase-architecture/SKILL.md#L20-L64
[design-twice]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/codebase-design/DESIGN-IT-TWICE.md#L9-L35
[domain]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/domain-modeling/SKILL.md#L64-L74
[logic]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/LOGIC.md#L60-L67
[handoff]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/handoff/SKILL.md#L8-L16
[phase-boundaries]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/ask-matt/PHASE-BOUNDARIES.md#L3-L40
[in-progress]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/README.md#L1-L18
[manifest]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/.claude-plugin/plugin.json#L21-L47
[writing-shape]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/writing-shape/SKILL.md#L11-L57
[loop-me]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/loop-me/SKILL.md#L18-L27
[claude-handoff]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/claude-handoff/SKILL.md#L8-L18
[implement-spec]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/implement-spec/SKILL.md#L7-L35
