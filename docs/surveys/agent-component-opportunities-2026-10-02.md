# Agent components worth adopting

Research for **oh-my-slop** and **Cleopatra** · 2 October 2026 · English

## Executive verdict

**Adapt narrow components, not another agent framework.** The strongest opportunities are a pre-install supply-chain audit, safer watchdog advice, trace-based skill evaluation, and failure-aware delivery evidence. Use HumanLayer's control-loop decomposition to design bounded recurring work, but keep durable execution in Cleopatra. Transfer autoresearch's experiment discipline—not its indefinite autonomy or Git-reset policy.

This report proposes **10 changes: two new skills and eight updates**. Priorities, effort, value and acceptance criteria are analyst recommendations, not measured improvements. Nothing proposed here has been installed or implemented.

| Rank | Proposal | Owner | Change | Effort |
| --- | --- | --- | --- | --- |
| 1 | Audit third-party skill and plugin supply chains | oh-my-slop | New meta skill | M |
| 2 | Make watchdog rescue advice bounded and non-authoritative | oh-my-slop | Extension update | M |
| 3 | Grade agent action traces, not just final answers | oh-my-slop | skill-creator update | M |
| 4 | Audit whether a repository is actually agent-ready | oh-my-slop | New workflow skill | M |
| 5 | Package delivery evidence for human comprehension | oh-my-slop | Workflow updates | S–M |
| 6 | Design bounded maintenance control loops | oh-my-slop | construction-craft update | S–M |
| 7 | Preserve useful artifacts when workers fail or stall | Cleopatra | Runtime/reporting update | M |
| 8 | Project privacy-safe operational traces | Cleopatra | Observability update | M |
| 9 | Treat the CLI as an agent-facing protocol | Cleopatra | CLI/test update | S–M |
| 10 | Run bounded skill experiments against a frozen evaluator | oh-my-slop | skill-creator update | L |

Effort is relative: **S** means a small documentation/test slice; **M** means a coherent component plus regression fixtures; **L** means several slices and an operational pilot. These are not calendar estimates. Start with ranks 1–3; pilot 10 only after evaluation integrity is established.

## Method and provenance

The background researcher retrieved GitHub repository metadata, complete recursive tree listings and selected source files. Its initial run and resumed synthesis both timed out without delivering a note. This report was completed directly from those retained snapshots, with targeted local verification. Coverage is **source inspection**, not a runtime audit, paid model trial or security certification.

The downloaded source bytes were checked against their Git blob IDs in the retained GitHub trees. All fetched, tree-listed files matched. This detects inconsistent downloads; Git's SHA-1 blob identity is not publisher authentication or a modern supply-chain attestation.

| Requested repository | Default branch | Inspected commit | Tree files | SKILL.md bodies | Fetched files verified |
| --- | --- | --- | --- | --- | --- |
| [cursor/plugins](https://github.com/cursor/plugins/tree/7022c81efb48d8b5eb15498ce6043a3bd74b694c) | main | 7022c81efb48d8b5eb15498ce6043a3bd74b694c | 887 | 101 | 149 |
| [humanlayer/skills](https://github.com/humanlayer/skills/tree/ca7c8088db69e315a8b2deea43820270457f8f3c) | main | ca7c8088db69e315a8b2deea43820270457f8f3c | 41 | 6 | 40 |
| [seb1n/awesome-ai-agent-skills](https://github.com/seb1n/awesome-ai-agent-skills/tree/75865a5d037a4cdaa7f409a4ec14ab9b0292920b) | main | 75865a5d037a4cdaa7f409a4ec14ab9b0292920b | 171 | 103 | 60 |
| [karpathy/autoresearch](https://github.com/karpathy/autoresearch/tree/228791fb499afffb54b46200aca536f79142f117) | master | 228791fb499afffb54b46200aca536f79142f117 | 10 | 0 | 4 |
| [mehdihadeli/awesome-software-architecture](https://github.com/mehdihadeli/awesome-software-architecture/tree/686546eb1bb1167229d409b9e9eb996a882aeadc) | main | 686546eb1bb1167229d409b9e9eb996a882aeadc | 339 | 0 | 14 |

Counts describe **tree blobs and named files**, not independent capabilities, installed entrypoints or quality. Cursor's marketplace separately lists **96 plugins** [C1]. A SKILL.md count is not a plugin count. Tree enumeration covered all paths; substantive reading was selective. Fetched-file counts do not imply every file received a complete behavioral review.

Additional primary-source follow-through: Microsoft Waza at `1234308b2f3422b9e1a3f164e177b408d7f9bfe9`; Agent Skills specification at `69ef37e9424c0a7ea9dd2293b559e43ec8176379`; Vercel skills at `18f96ea131dab3b0fcc9b27cf7c6f6cbb6174680`; OpenTelemetry semantic-conventions at `8b49d4206e9299fb0a59284effef7456ea130810`, then its current GenAI owner at `e07f4ebacb08f56db8c4c882d117720333fbca04`. Only selected material from these projects informs the proposals; this is not a comparison of all evaluation or telemetry frameworks.

**Local synthesis baseline:** oh-my-slop `071a9442dc86260f7a9fdc2dd68dd4067bd5a1ed`, clean before report creation; Cleopatra `df5754d910e9e4c459a9cb6208ac896b1dc6fbed`, with an unrelated untracked research note left untouched. The initial research spanned moving local checkouts; recommendations below were checked against the synthesis baseline. Local citations are navigable working-tree paths, not immutable hosted permalinks.

No upstream installers, helpers, hooks, demos or model evaluations were executed. The known repository URLs were sufficient for direct source retrieval; no additional general web search was needed. Fetched instructions were treated as material to analyze, not commands to obey. Report content contains no discovered credential values.

### The local boundary that matters

- oh-my-slop already owns evaluation-driven skill authoring, scoped interviews, ticket handoff, independent spec/standards review and supervised whole-spec implementation. Extending these owners is usually better than adding parallel skills [L1] [L2] [L3] [L4].
- `implement-spec` is explicitly session-local, preserves worker worktrees, binds evidence to committed candidates, defaults to serial execution and bounds combined repairs. It is not a durable service [L3].
- Cleopatra's root policy specifies human readiness, constrained automatic delivery as a target product, Python core and one-controller-host execution. Its developer reference distinguishes installed authority operations from unimplemented scheduler/publication/provider integrations. Do not infer operational production readiness from source existence [L5] [L6].
- Cleopatra already has runtime correlation, typed capture truncation, durable control/accounting concepts, and attention-ticket reconciliation tests. Proposals must complement those contracts, not replace them with a generic approval file or queue [L7] [L8] [L9].
- Factory is retired in favor of the separate Cleopatra project. This survey proposes no Factory restoration or assumed integration API [L10].

## Findings by repository

### Cursor plugins — take interfaces and evidence patterns

The repository combines a marketplace manifest, plugin-specific metadata, skills, hooks, agents and validation tooling [C1] [C2]. Promising inspected first-party surfaces were `agent-compatibility`, `cli-for-agent`, `advisor`, `pr-review-canvas` and `orchestrate`; the fetched set also contains `create-plugin`, `continual-learning` and `ralph-loop`. The 101 skill bodies include third-party content; they were not all individually audited.

**Useful patterns:** agent compatibility separates startup, validation-loop and documentation checks [C3]; CLI guidance emphasizes non-interactive input, layered help, meaningful errors, idempotency and preview [C4]; review canvas orders explanation by core logic, integration and mechanical changes, with concrete before/after traces [C5]. Advisor is explicitly opt-in, read-only and checkpoint-limited [C6]. Orchestrate documents synthetic failure handoffs, explicit verification-quality categories and downstream handoff relay [C7].

**Transfer limits:** Canvas depends on Cursor-specific local SDK files; the orchestration runtime is not Cleopatra's Python core. Its handoff guide says to treat worker summaries as fact and relay raw handoffs; preserve local stronger verification and trust boundaries instead [C7] [L3]. The compatibility skill hides its weighted score calculation by default; transparent findings are more useful here than a pseudo-precise headline [C3].

**License:** GitHub metadata did not identify a root license. Inspected plugin-level LICENSE files exist, including MIT terms for advisor [C8]. Verify the exact component's license and notices before copying; one plugin's license does not cover the marketplace or every third-party subtree.

### HumanLayer skills — strongest workflow decomposition

The six plugin skill bodies are `build-iterated-agentic-loop`, `design-control-loop`, `improve-claude-md`, `narrow-react-prop-types`, `show-me` and `visual-pr`; plugin discovery is separately defined by the marketplace [H1]. The research retrieved 40 of 41 tree files. The most useful content for these projects is control-loop design and visual evidence packaging—not React prop specialization.

`design-control-loop` separates set point, sensor, controller and actuator, asks for a tailored design, and makes the pieces locally runnable before scheduled CI. It adds a non-regression dampener, standing reviewer feedback and a recommended one-open-PR limit [H2]. `build-iterated-agentic-loop` offers a related repeated-improvement workflow [H3]. `show-me` chooses the smallest explanatory representation: pseudocode, trees, diffs, diagrams or focused HTML [H4]. `visual-pr` packages a short rationale, material caveats and a structural change outline, but uses GitHub tooling and may create/publish a PR [H5].

**Do not import its policy blindly:** manual runs bypass the recommended open-PR bound in the control-loop workflow; that is not suitable as an implicit Cleopatra admission exception [H2]. The `improve-claude-md` skill asserts that XML relevance tags improve adherence, but no paired evidence for these local models was established. Preserve mandatory safety rules and existing progressive disclosure; test any presentation rewrite before adoption [H6] [L1]. The repository carries MIT terms [H7].

### seb1n skills — real bundled components, not merely an awesome list

Despite the name, this snapshot contains **103 skill bodies**, plus selected scripts, references, agent descriptors and a demo. The security and engineering skills are direct primary sources for their own guidance, not proof that the controls work. Prioritized reading covered supply-chain audit, prompt-injection defense, evaluation, observability and human oversight [S1] [S2] [S3] [S4] [S5]. Context-engineering and orchestration material was sampled, not exhaustively validated.

The supply-chain skill explicitly defaults to static inspection, inventories endpoints and permissions, preserves snapshot hashes and distinguishes observed/inferred/unknown findings. Its scanner contract exposes incomplete content review rather than interpreting a clean heuristic result as safety [S1]. Prompt-injection guidance places consequential authority outside model reasoning and covers cross-agent handoffs and persisted memory [S2]. Evaluation separates frozen versions, representative data, holdout, baseline comparison and failure analysis; `aggregate_results.py` documents missing-label denominators and limited uncertainty claims [S3]. Observability defaults to content-free metadata and treats absent telemetry as incomplete evidence [S4]. Human oversight binds the exact action to a decision rather than equating a confirmation dialog with authority [S5].

**Transfer limits:** broad dual-control, multi-tenant or break-glass policies do not match Cleopatra's single-operator first release by default [S5] [L5]. The demo and validators were inspected as source, not run. An initially guessed evaluation-script filename was absent; the verified source is `aggregate_results.py` [S3]. MIT terms allow adaptation with the required notice [S6].

### Karpathy autoresearch — borrow experiment discipline, reject its authority model

The inspected core is `program.md`, `prepare.py`, `train.py` and README. There are no skill bodies in the 10-file tree. `program.md` scopes edits to `train.py`, freezes `prepare.py` and its evaluation function, requires a baseline, records keep/discard/crash outcomes, and values simplification as well as metric gains [A1]. `prepare.py` sets `TIME_BUDGET = 300`; `train.py` imports and uses the evaluator and reports training and total durations separately [A2] [A3].

**The five-minute limit is training time, not a hard total process budget.** Startup, compilation and evaluation add overhead; enforcement instructions and reporting are not a security boundary [A1] [A3]. Because the editable training file calls the evaluator, freezing its source alone does not prevent manipulation of invocation or reported output. A transferable experiment runner must evaluate candidates independently.

The upstream loop explicitly says to run indefinitely and reset the branch after rejected experiments [A1]. Neither behavior is acceptable as imported standing authority here. Use finite operator-approved experiments, independent evaluation, isolated candidate branches, retained artifacts and explicit spending limits. No root license was identified in metadata or the inspected tree; use conceptual adaptation rather than copying source until licensing is resolved.

### Awesome software architecture — use it as an index, not a product backlog

This snapshot has 339 files and no SKILL.md bodies. Relevant pages index agent skills/plugins, evaluation tools, harness engineering, security, loops, ADR/C4 documentation, modular monoliths, tracing and inbox/outbox/idempotency topics [M1] [M2] [M3] [M4]. A catalogue entry is a discovery lead, not evidence of an implementation's properties.

Useful follow-through reached the owning Agent Skills specification, Waza's grader documentation/source and the OpenTelemetry GenAI conventions [F1] [F2] [F3] [F4]. The older semantic-conventions pages explicitly say GenAI moved to a separate repository; the proposal cites the new owner rather than a stale index [F4] [F5].

**Recommendation:** use these references to improve measurable contracts and existing architecture skills. Do not import a generic architecture mega-skill, distributed event bus, .NET evaluation stack or another orchestrator. Cleopatra already has a standard-library SQLite-backed durable controller and a one-host first-release boundary [L5] [L6]. CC0 applies to this catalogue [M5]; linked projects retain their own licenses. ADR/C4 and inbox/outbox were discovery-level reading only, not a primary-source implementation comparison.

## Prioritized proposals

### 1. Third-party skill and plugin supply-chain audit

**New · oh-my-slop · Priority: high · Effort: M.** Proposed name: `skill-supply-chain-audit`, under the meta bucket. This is a candidate name, not an installed capability.

**Source pattern:** seb1n's offline inventory, update comparison, bounded archive review and evidence-labeled dispositions [S1]. **Local fit:** `skill-creator` governs usefulness and authoring, while `setup-project-skills` governs consumer bindings. Neither inspected body owns pre-install package risk review [L1] [L11].

**Concrete slice:** create a manually invoked audit skill with a small static helper that reports snapshot/version, instruction and executable inventory, endpoints, dependencies, requested filesystem/credential reach, license and differences from a known-good version. Reject unsafe archive paths before extraction. Emit coverage gaps and observed/inferred/unknown labels; keep the report outside the target package. No installation, dependency execution, network activation or destructive quarantine.

**Value:** makes future imports from all five repositories accountable and repeatable. **Risk:** a heuristic scanner can produce false confidence; ambiguous binaries and oversized content remain unresolved, never green by omission. Adapt MIT material with notices rather than copying an unreviewed helper wholesale [S6].

**Acceptance:** fixtures for a benign package, malicious instructions, telemetry endpoint expansion, symlink/path traversal, unreadable/oversized material and changed install hooks. The audit must not execute target code, leak canary values or mark incomplete review as approved. Package approval remains a scoped human decision, not runtime permission.

### 2. Bounded, non-authoritative watchdog advice

**Update · oh-my-slop · Priority: high · Effort: M.** Targets: `extensions/workflow-watchdog/index.ts`, its detection library and Node tests [L12] [L13].

**Observed source issue:** the extension forwards rescue-model text as “Supervisor Instructions” and says to follow it carefully. Its HTTP calls have no explicit abort deadline in the inspected implementation. The briefing claims recent tool results are present, but `buildRecentContext` actually receives normalized assistant-message strings and counters—not the underlying error payloads [L12] [L13]. These are source findings, not a demonstrated exploit or live provider failure.

**Source pattern:** Cursor advisor uses selective read-only checkpoints and evidence-rich briefings [C6]; seb1n separates model suggestions from deterministic authority [S2].

**Concrete slice:** keep the existing opt-in rescue feature, but label its output advisory, preserve operator/repository authority, and bound one call plus at most one evidence-request follow-up. Supply selected, redacted error evidence with explicit omissions. Add timeout/abort and response-size limits. Verify actual provider/model routing rather than guessing a generic provider endpoint; investigate the harness-supported transport before choosing an implementation.

**Value:** improve diagnoses without adding another advisor skill or routine model calls. `council` and `court-jester` already cover requested independent challenge. **Risk:** private trace export, route mistakes and additional cost; allow no silent provider/model fallback. This recommendation does not replace Cleopatra's independently pinned reviewer route [L5].

**Acceptance:** synthetic hanging/oversized/erroring provider replies terminate predictably; injected advice cannot change allowed scope; canaries are absent from requests/logs; omitted errors are disclosed; one stalled task cannot acquire an unbounded consultation budget.

### 3. Trace-based skill evaluation

**Update · oh-my-slop · Priority: high · Effort: M.** Targets: `skills/meta/skill-creator/references/evaluation-workflow.md`, existing evaluation helpers and evaluation regression fixtures [L1] [L14].

**Source pattern:** Waza exposes action-sequence and tool-constraint graders, including required calls, forbidden calls, allowlists and argument matchers [F2] [F3] [F6]. seb1n adds held-out cases, timeout/failure denominators and uncertainty limits [S3]. The local authoring workflow already has baseline/candidate comparison and observable assertions; the missing opportunity is richer behavioral evidence, not another evaluation doctrine [L1] [L14].

**Concrete slice:** normalize harness action traces into a small local record format with run identity, action, target, outcome and provenance. Add deterministic assertions for critical ordering and forbidden effects—for example, review binds a committed candidate; branch-only workers do not publish; retrieved directives never become authorized commands. Combine traces with filesystem/output evidence.

**Value:** an attractive final answer no longer masks unauthorized actions or skipped work. **Risk:** brittle exact-sequence checks punish equivalent legitimate workflows; use ordering constraints only where order is contractual. Tool regex matching is evaluation, not a shell security policy. Preserve missing traces and interrupted runs as incomplete observations.

**Acceptance:** hand-built good/bad traces yield independently specified results; harmless extra reads do not fail critical-order tests; duplicate calls and argument-level violations are caught; no-tool runs cannot pass a task requiring work; baseline/candidate receive identical grader versions. Pilot Waza separately only if its harness adapters fit—no new runtime dependency is justified yet. Waza's MIT license permits adaptation with notices.

### 4. Agent-readiness audit for consumer repositories

**New · oh-my-slop · Priority: medium-high · Effort: M.** Proposed name: `agent-readiness-audit`, under workflow; manually invoked and read-only by default.

**Source pattern:** Cursor divides compatibility into discovery, startup, verification-loop and documentation reliability [C3]. **Local fit:** setup records tracker/domain/preservation bindings; documentation-lifecycle and testing-workflow own ongoing truthful docs and test tiers. An audit can integrate evidence without owning their policies [L11] [L15] [L16].

**Concrete slice:** inspect actual setup commands, tool versions, skill resolution, required checks, isolation prerequisites and documented paths. Produce passed/failed/blocked/not-tested facts, artifacts and ranked repairs. Run only approved safe checks in a disposable location; a dependency or network restriction is an environment limitation, not a repository defect. Route remediation to existing skills.

**Value:** catches “installed but unusable” consumer setups before a worker burns a whole session. **Risk:** trying startup may install packages, start services or touch data. Default to source preflight; require explicit authority for execution. Omit Cursor's unexplained weighted score and retain the underlying evidence [C3].

**Acceptance:** fixtures distinguish stale docs, wrong tool versions, unavailable tooling and a genuinely broken validation path. The audit leaves source, manifests, live services and user files unchanged. On Cleopatra, enrollment/help probes must not activate execution or open controller state; its own development reference owns that contract [L6].

### 5. Human-readable delivery evidence packet

**Update · oh-my-slop · Priority: medium-high · Effort: S–M.** Targets: the completion/report branches of `implement`, `fix-pr` and `humanify`, with scoped evaluation cases. Keep a shared reference only if it prevents real duplication [L2] [L17] [L18].

**Source pattern:** HumanLayer visual-pr and show-me make change shape comprehensible; Cursor canvas leads with important logic, adds concise pseudocode and concrete before/after traces [H4] [H5] [C5].

**Concrete slice:** add an optional compact evidence view: exact candidate SHA, requirement→evidence rows, passed/failed/unverified/deferred status, one focused before/after trace for surprising behavior, and material caveats. For dense changes, offer one self-contained HTML artifact—not a mandatory generated website or Cursor SDK dependency. Derive diagrams from verified code/contracts and cite the relevant paths.

**Value:** reduces the human's effort to understand a bounded candidate and its gaps. Existing handoff remains a short session map; do not turn it into a second authoritative delivery ledger [L19].

**Risk:** persuasive diagrams can hide missing checks or imply acceptance. Visuals are explanatory, not verification. Keep spec and standards reports independent and complete; never merge or rerank their findings in the packet [L4]. Follow configured Gitea routing, not upstream `gh` defaults. Rendering must escape untrusted content and need no remote assets.

**Acceptance:** a fixture with an unrun live check shows it as unverified; changed candidates stale the packet; raw source names and trace evidence remain recoverable; branch-only delivery creates no PR or tracker writes; the human can see the reject/block path as clearly as success.

### 6. Bounded maintenance control-loop design

**Update · oh-my-slop · Priority: medium · Effort: S–M.** Target: `construction-craft` and its pragmatic-practices reference; route execution to existing planning/implementation workflows [L20].

**Source pattern:** HumanLayer's set point→sensor→controller→actuator design, local-first execution and non-regression dampener [H2] [H3]. **Local overlap:** construction-craft already says to automate repetition and measure tuning; `ponytail-debt` supplies one existing deterministic sensor [L20] [L21]. A second general maintenance skill would duplicate this ground.

**Concrete slice:** add a short decision branch plus reference for recurring work: name the desired property, freeze a measurable sensor, choose one reviewable increment, separate selection from effects when useful, and define interruption, disturbance and human-feedback handling. An example could use reference validation or documented SHORTCUT markers—not a speculative model score. Reuse authoritative commands and approvals rather than accepting `/iterate` comments as executable authority.

**Value:** turns quality decay into small, testable increments rather than an endless “improve the repo” task. **Risk:** backlog inflation and duplicated orchestration. A proposed one-open-change limit must apply to manual and scheduled admission alike unless explicitly authorized otherwise. Empty sensor output is a normal stop condition. No unattended loop, schedule or CI workflow is installed by the design branch.

**Acceptance:** baseline sensor output is reproducible; each selected increment has a scoped ticket/check; disturbance invalidates stale measurements; review backlog stops new work; operator feedback changes only future proposals, not protected authority. Any later durable scheduling is separately scoped Cleopatra work [L3] [L5].

### 7. Failure and stall evidence without invented completion

**Update · Cleopatra · Priority: medium-high for real worker integration · Effort: M.** Targets: `docs/contracts/runtime.md`, future adapter qualification tests, and diagnostic/reporting projections around `runtime.py`, `_capture.py` and `_contained_runtime.py` [L7] [L8].

**Source pattern:** Cursor orchestrate writes synthetic failure handoffs when a worker dies or finishes without the promised structured handoff, retaining the last activity, error and relevant identities [C7]. This investigation's repeated provider timeout is a concrete example of why “agent started” is not “artifact delivered.” It is not evidence that Cleopatra itself has the same bug.

**Concrete slice:** make missing deliverables inspectable: preserve approved artifact references, correlation IDs, last trusted activity, retained capture boundaries and reason classes such as provider timeout, tool failure or unknown termination. A diagnostic envelope can say partial/unknown/blocked without fabricating a worker report. Define a finite no-progress budget and a question/escalation route when a forthcoming adapter can observe it reliably.

**Value:** prevents repeated expensive restarts and makes the next operator action clear. **Already present:** typed capture truncation and runtime uncertainty exist; attention-delivery tests already distinguish lost writes, verified reads and unknown outcomes [L7] [L9]. Do not add a rival JSON recovery journal, retry queue or status database.

**Risk:** a classifier can confuse silence with process cessation. A failure artifact must not release capacity, settle uncertain spend, authorize a retry, waive review or make a stopped effect reversible. Preserve original scope, generation and operation identity. Treat upstream timing heuristics and worker verification prose as diagnostics, not trusted lifecycle facts [C7] [L7].

**Acceptance:** injected lost reply, partial capture, late handoff, malformed report and restart scenarios retain evidence and preserve uncertainty. Scope reduction cannot reset a spent budget; no artifact path crosses its approved root; any retry rechecks current authority and containment through existing contracts. This is an adapter/reporting extension, not a claim that current recovery is absent.

### 8. Content-free operational trace projection

**Update · Cleopatra · Priority: medium · Effort: M.** Targets: a separately approved observability seam around controller/runtime boundaries; its schema/runbook and tests. Do not scatter exporter calls throughout the core.

**Source pattern:** seb1n defines privacy-aware traces and outcome denominators [S4]; current OpenTelemetry GenAI conventions identify agent, operation, model and tool spans, with sensitive content attributes opt-in and still-evolving conventions [F4] [F7].

**Concrete slice:** project trusted retained facts into metadata-only events: delivery/attempt correlation, model route, configuration revision, stage, monotonic duration, bounded reason code, retries, measured usage and unknown-usage flags. Derive cost per verified outcome, stalled-stage counts and evidence completeness from stated denominators. Begin with a bounded local format; defer an exporter and collector dependency until an actual operating question requires them.

**Value:** distinguish model latency, verification overhead, retries and human wait without sending prompts to a telemetry service. **Local overlap:** protected retained records already own authority and accounting; traces are an observation projection, not their replacement [L7] [L8]. Retrospective is already a named Cleopatra concept [L22].

**Risk:** identifiers create high-cardinality metrics; raw content leaks secrets; sampled traces omit effects. Mark missing data unknown rather than zero, pin a convention version, and keep exporter failure independent from authoritative audit failure. A telemetry outage must neither invent success nor bypass a required audit gate.

**Acceptance:** synthetic normal, refusal, timeout, retry and escalation paths correlate; canaries never appear; metric aggregates can be recomputed from documented events; sampling and retention limits are explicit; trace absence cannot settle effect absence. OpenTelemetry Apache-2.0 notices apply to copied material; no production export was tested here.

### 9. CLI protocol contract and conformance tests

**Update · Cleopatra · Priority: medium · Effort: S–M.** Targets: `src/cleopatra/__main__.py`, CLI help/error definitions, `tests/unit/test_arguments.py`, operator transport tests and development docs.

**Source pattern:** Cursor's CLI skill emphasizes non-interactive input, layered help, meaningful failures, retry safety and useful output [C4]. **Already present:** Cleopatra documents explicit help/error exits, JSON inspection, prepared authority operations and unknown/partial outcomes. These are strengths, not missing features [L6].

**Concrete slice:** audit each actual command against a versioned machine-facing contract: stable output schema, inert help, command-specific examples, actionable errors, timeout/refusal/unknown distinctions and request/receipt reconciliation guidance. Add missing examples or schema assertions only where tests expose a real gap. Prefer existing preview/apply semantics to generic `--dry-run` or `--force` flags.

**Value:** makes tool-driven automation safer without wrappers or a second CLI. **Risk:** a machine interface can accidentally imply that preview grants execution or that retry after a timeout is safe. Preserve exact proposal/receipt binding and the protected actor channel. No confirmation-bypass flag should replace human readiness.

**Acceptance:** subprocess fixtures prove help and malformed input do not access configuration/state or dispatch; schemas distinguish refused/unknown/partial; response loss leads to receipt lookup, not blind resubmission; examples match real parser behavior. This proposal does not assert that these existing tests currently fail.

### 10. Bounded skill experimentation with independent evaluation

**Update · oh-my-slop · Priority: experimental, after 1–3 · Effort: L.** Targets: `skill-creator` evaluation workflow and, if justified, a deterministic runner outside installable skill content [L1] [L14].

**Source pattern:** autoresearch's fixed mutation surface, baseline, keep/discard/crash ledger and simplicity criterion [A1] [A2] [A3]; seb1n's held-out data and frozen grading contract [S3].

**Concrete slice:** an operator-approved offline pilot changes one selected skill body/reference surface, not its evaluator, test fixtures, authorization, dependencies or harness policy. Freeze the baseline, model route, inputs and grader version. A separate trusted runner executes baseline and candidate under equal budgets. Keep development and hidden holdout cases apart. Retain every candidate branch and result artifact; publication is a separate reviewed decision.

**Value:** converts repeated skill tuning into reproducible evidence. **Risk:** stochastic overfitting, benchmark leakage, expensive trials and optimizing away necessary behavior. Require critical safety cases to pass, cap total experiments and spend, keep interrupted/missing results in denominators, and require blinded human review for qualitative claims. A few leading examples or self-reported pass counts do not establish improvement.

**Acceptance:** the writer cannot mutate grading/holdout files; an attempted scope escape fails closed; the run stops at the original finite budget; the independent evaluator rejects forged metrics; no primary checkout work is reset or deleted; simplification is accepted only without safety/utility regression. This is a bounded skill-creator experiment, not “autoresearch for all software delivery.” No GPU training, paid evaluation or experiment runner was executed.

## What not to adopt

| Candidate | Decision and reason |
| --- | --- |
| Cursor orchestrate as a second delivery engine | Reject wholesale. Its source offers useful diagnostic patterns; its runtime and authority assumptions would compete with Cleopatra's deliberately Python, human-authorized core [C7] [L5]. |
| Ralph-style indefinite continuation or autoresearch NEVER STOP | Reject as standing authority. The run must have finite approved limits and a real interruption/escalation path; Git-reset instructions risk discarding work [A1] [L3]. |
| Cursor Canvas SDK for reports | Do not depend on it. Adapt the comprehension patterns into portable, escaped HTML or Markdown [C5] [H4]. |
| Another generic advisor, council or multi-agent skill | Defer. Existing council, court-jester, two-axis-review and watchdog already own overlapping jobs; improve scoped invocation/evidence instead [L4] [L12]. |
| Automatic memory editing from continual learning | Defer. Persistent feedback is useful, but changes to standing instructions require review and scoped provenance, not an unreviewed stop hook. The component was retrieved, not operationally qualified. |
| HumanLayer XML tags as a proven adherence upgrade | Unproven locally. Keep mandatory floors explicit and evaluate any rewrite; upstream explanatory assertions are not a paired benchmark [H6] [L1]. |
| React prop-narrowing skill | Low value for this scope: Cleopatra's core is Python and oh-my-slop packages skills/extensions. Reconsider only for a real React consumer [H1] [L5]. |
| seb1n multi-user approval/quorum defaults | Do not import by default. Cleopatra targets one operator; copy invariants about exact-action approval, not an incompatible organizational policy [S5] [L5]. |
| New event bus, outbox service or recovery database | Not justified. Existing durable controller/attention reconciliation is load-bearing; architecture catalogue entries do not establish a local absence [L8] [L9] [M1]. |
| Bulk import of all 101 or 103 skill bodies | Reject. Counts are not capability gains; additional descriptions and duplicate owners add invocation cost without demonstrated lift [L1]. |
| Installing Waza, Ragas, DeepEval or a .NET stack immediately | Defer framework selection. Trial a small trace fixture and compatibility check first; the catalogue is a discovery surface [M2] [F2] [F3]. |

## Adoption order and ownership

1. **Secure the ingestion boundary:** proposal 1, then the watchdog authority/timeout/evidence slice in 2. Validate with synthetic fixtures before any third-party dynamic trials.
2. **Make improvement measurable:** proposal 3. Select a small representative corpus with real negative cases and a stable baseline; do not silently buy model runs.
3. **Improve daily ergonomics:** proposals 4, 5 and 9 as independent bounded slices. Inspect current files again before authoring; concurrent work may have closed a gap.
4. **Add safe repeated work:** proposal 6 as design guidance. A later live loop needs its own scope, human grant, admission limit and forge binding. No unattended schedule follows from adopting the reference.
5. **Qualify worker operation:** proposals 7 and 8 in Cleopatra's authorized adapter/observability work. Preserve correlation, capacity, accounting and question/decision semantics; agree a narrow seam before code.
6. **Run one experiment pilot:** proposal 10 depends on 1–3. Choose one demonstrably weak skill, fixed model route, bounded budget and held-out cases. Report inconclusive results honestly.

**Stop criterion:** do not add a component when the baseline already succeeds, an existing owner can absorb it more cheaply, evidence is missing, or the human has not granted the effects required for its pilot [L1].

## Evidence limits and verification status

- Static inspection does not prove runtime reliability, security, improved model behavior or operational readiness. No measured adoption benefit is claimed.
- All five requested trees were enumerated, but file bodies were sampled, especially Cursor's third-party plugins, the 103-skill collection and the architecture catalogue. This is an opportunity assessment, not exhaustive malware or licensing review.
- Remote snapshots are immutable source pins, not guarantees about future releases. Metadata license detection is incomplete evidence; component-specific notices govern copied content.
- Architecture topics such as C4, modular monolith, inbox and outbox were discovery leads only. No recommended replacement architecture rests on those catalogue summaries.
- The background task timed out twice. Its retained source snapshots were recovered; no final subagent synthesis or successful background deliverable is claimed.
- One guessed evaluation-script path was absent; `aggregate_results.py` is the verified source. The separate GenAI repository is the current convention owner, not the moved pages in the older project [S3] [F4].
- Before this report existed, the local Python suite produced **935 passed / 3 failed**. Failures were in `test_implement_spec_skill.py` and two `test_prompt_templates.py` cases. They are pre-existing findings, not repaired by this research. Post-write validation is recorded separately below; Cleopatra's tests were not run because its tree was read-only.

## Source index

All upstream links below are pinned to inspected commits. Local links point to the files read at the synthesis baseline; proposed new paths above are explicitly labeled proposals.

### Cursor

- [C1] — marketplace manifest: install inventory and plugin sources.
- [C2] — repository plugin validator: metadata/entrypoint conventions.
- [C3] — check-agent-compatibility: behavioral audit decomposition and scoring policy.
- [C4] — cli-for-agents: headless CLI design checklist.
- [C5] — pr-review-canvas: importance-first explanation and concrete traces.
- [C6] — advisor: opt-in, checkpoint-bound consultation and briefing.
- [C7] — orchestrate handoffs: synthetic failures, verification categories and relay policy.
- [C8] — advisor's component-specific MIT license; not a repository-wide grant.

### HumanLayer

- [H1] — plugin marketplace and names.
- [H2] — design-control-loop: local-first components, dampeners, feedback and flow limits.
- [H3] — build-iterated-agentic-loop: related recurring improvement workflow.
- [H4] — show-me: smallest useful explanatory view.
- [H5] — visual-pr: structural PR presentation and publication behavior.
- [H6] — improve-claude-md: claimed XML-tag mechanism, not local proof.
- [H7] — MIT license.

### seb1n

- [S1] — skill-supply-chain-audit: static review and evidence dispositions.
- [S2] — prompt-injection-defense: authority, untrusted inputs and runtime controls.
- [S3] — agent-evaluation: frozen comparisons, holdouts and aggregation contract.
- [S4] — agent-observability: content-free telemetry and trace limits.
- [S5] — human-in-the-loop: exact-action approval, state transitions and oversight policy.
- [S6] — MIT license.
- [S7] — aggregate_results.py: actual helper source, not an executed validation result.

### Autoresearch

- [A1] — program.md: edit scope, baseline, metric, ledger and indefinite reset loop.
- [A2] — prepare.py: fixed training-time constant and evaluation.
- [A3] — train.py: evaluator invocation and separate time reports.

### Architecture catalogue and followed primary sources

- [M1] — skills/subagents/plugins index.
- [M2] — evaluation/test index, including Waza.
- [M3] — harness engineering index.
- [M4] — architecture-documentation index.
- [M5] — CC0 catalogue license.
- [F1] — owning Agent Skills specification.
- [F2] — owning Waza action-sequence grader documentation.
- [F3] — owning Waza tool-constraint grader documentation.
- [F4] — current OpenTelemetry GenAI agent-span conventions; status Development.
- [F5] — older OpenTelemetry page explicitly announcing the move.
- [F6] — Waza action-sequence grader implementation.
- [F7] — current OpenTelemetry content-recording conventions.

### Local fit and existing contracts

- [L1] — skill-creator: creation gate and behavioral evaluation owner.
- [L2] — implement: one-slice worker contract.
- [L3] — implement-spec: supervised, session-local graph implementation.
- [L4] — two-axis-review: independent axes and preserved reports.
- [L5] — Cleopatra AGENTS.md: authority and first-release scope.
- [L6] — Cleopatra development reference: supported CLI and operational limitations.
- [L7] — Cleopatra runtime contract: correlation, uncertainty and truncation.
- [L8] — Cleopatra runtime implementation.
- [L9] — Cleopatra attention tests: lost-write reconciliation and evidence semantics.
- [L10] — Factory retirement ADR.
- [L11] — setup-project-skills: consumer bindings and preservation policy.
- [L12] — watchdog extension: rescue transport and advisory forwarding.
- [L13] — watchdog detectors: normalized message-only rescue context.
- [L14] — skill-creator evaluation workflow.
- [L15] — documentation-lifecycle: truthful documentation owner.
- [L16] — testing-workflow: check execution and test-tier owner.
- [L17] — fix-pr: repair/delivery workflow.
- [L18] — humanify: bounded preparation, decisions and evidence gaps.
- [L19] — handoff: short, temporary session map.
- [L20] — construction-craft: recurring work and measured tuning.
- [L21] — ponytail-debt: existing deterministic SHORTCUT sensor.
- [L22] — Cleopatra glossary: candidate, authority, uncertainty and retrospective concepts.

[C1]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/.cursor-plugin/marketplace.json
[C2]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/scripts/validate-plugins.mjs
[C3]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/agent-compatibility/skills/check-agent-compatibility/SKILL.md
[C4]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/cli-for-agent/skills/cli-for-agents/SKILL.md
[C5]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/pr-review-canvas/skills/pr-review-canvas/SKILL.md
[C6]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/advisor/skills/advisor/SKILL.md
[C7]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/orchestrate/skills/orchestrate/references/handoffs.md
[C8]: https://github.com/cursor/plugins/blob/7022c81efb48d8b5eb15498ce6043a3bd74b694c/advisor/LICENSE
[H1]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/.claude-plugin/marketplace.json
[H2]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/design-control-loop/skills/design-control-loop/SKILL.md
[H3]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/build-iterated-agentic-loop/skills/build-iterated-agentic-loop/SKILL.md
[H4]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/show-me/skills/show-me/SKILL.md
[H5]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/visual-pr/skills/visual-pr/SKILL.md
[H6]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/improve-claude-md/skills/improve-claude-md/SKILL.md
[H7]: https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/LICENSE
[S1]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/agent-security/skill-supply-chain-audit/SKILL.md
[S2]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/agent-security/prompt-injection-defense/SKILL.md
[S3]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/agent-engineering/agent-evaluation/SKILL.md
[S4]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/agent-engineering/agent-observability/SKILL.md
[S5]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/agent-engineering/human-in-the-loop/SKILL.md
[S6]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/LICENSE
[S7]: https://github.com/seb1n/awesome-ai-agent-skills/blob/75865a5d037a4cdaa7f409a4ec14ab9b0292920b/agent-engineering/agent-evaluation/scripts/aggregate_results.py
[A1]: https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/program.md
[A2]: https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/prepare.py
[A3]: https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/train.py
[M1]: https://github.com/mehdihadeli/awesome-software-architecture/blob/686546eb1bb1167229d409b9e9eb996a882aeadc/docs/ai/skills-subagents-plugins.md
[M2]: https://github.com/mehdihadeli/awesome-software-architecture/blob/686546eb1bb1167229d409b9e9eb996a882aeadc/docs/ai/evaluation-test.md
[M3]: https://github.com/mehdihadeli/awesome-software-architecture/blob/686546eb1bb1167229d409b9e9eb996a882aeadc/docs/ai/harness-engineering.md
[M4]: https://github.com/mehdihadeli/awesome-software-architecture/blob/686546eb1bb1167229d409b9e9eb996a882aeadc/docs/foundations/architecture-documententation.md
[M5]: https://github.com/mehdihadeli/awesome-software-architecture/blob/686546eb1bb1167229d409b9e9eb996a882aeadc/LICENSE
[F1]: https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx
[F2]: https://github.com/microsoft/waza/blob/1234308b2f3422b9e1a3f164e177b408d7f9bfe9/docs/graders/action_sequence.md
[F3]: https://github.com/microsoft/waza/blob/1234308b2f3422b9e1a3f164e177b408d7f9bfe9/docs/graders/tool_constraint.md
[F4]: https://github.com/open-telemetry/semantic-conventions-genai/blob/e07f4ebacb08f56db8c4c882d117720333fbca04/docs/gen-ai/gen-ai-agent-spans.md
[F5]: https://github.com/open-telemetry/semantic-conventions/blob/8b49d4206e9299fb0a59284effef7456ea130810/docs/gen-ai/gen-ai-agent-spans.md
[F6]: https://github.com/microsoft/waza/blob/1234308b2f3422b9e1a3f164e177b408d7f9bfe9/internal/graders/action_sequence_grader.go
[F7]: https://github.com/open-telemetry/semantic-conventions-genai/blob/e07f4ebacb08f56db8c4c882d117720333fbca04/docs/gen-ai/gen-ai-spans.md
[L1]: ../../skills/meta/skill-creator/SKILL.md
[L2]: ../../skills/workflow/implement/SKILL.md
[L3]: ../../skills/workflow/implement-spec/SKILL.md
[L4]: ../../skills/workflow/two-axis-review/SKILL.md
[L5]: ../../../cleopatra/AGENTS.md
[L6]: ../../../cleopatra/docs/development.md
[L7]: ../../../cleopatra/docs/contracts/runtime.md
[L8]: ../../../cleopatra/src/cleopatra/runtime.py
[L9]: ../../../cleopatra/tests/unit/test_attention.py
[L10]: ../adr/0003-retire-factory-in-favor-of-cleopatra.md
[L11]: ../../skills/meta/setup-project-skills/SKILL.md
[L12]: ../../extensions/workflow-watchdog/index.ts
[L13]: ../../extensions/workflow-watchdog/lib/detectors.mjs
[L14]: ../../skills/meta/skill-creator/references/evaluation-workflow.md
[L15]: ../../skills/practice/documentation-lifecycle/SKILL.md
[L16]: ../../skills/practice/testing-workflow/SKILL.md
[L17]: ../../skills/workflow/fix-pr/SKILL.md
[L18]: ../../skills/workflow/humanify/SKILL.md
[L19]: ../../skills/workflow/handoff/SKILL.md
[L20]: ../../skills/practice/construction-craft/SKILL.md
[L21]: ../../skills/workflow/ponytail-debt/SKILL.md
[L22]: ../../../cleopatra/CONTEXT.md

## Deliverable validation

- **HTML structure and references:** passed. Ten proposal sections, checked citation links, unique anchors, all requested repositories represented, all upstream file links pinned to fetched snapshots, local citation targets present, no unresolved citation syntax, and no remote assets or scripts.
- **Offline Chromium:** passed at 1440, 768 and 390 pixels. Section navigation and proposal jumps work; tables scroll within their containers without page overflow; print mode retains the report and removes navigation. No browser errors or network asset requests occurred.
- **Browser environment caveat:** the Python Playwright package expected an unavailable browser revision. Validation succeeded using the existing Chromium 1228 binary via an explicit executable path; nothing was installed.
- **Repository reference validator:** passed (`uv run python scripts/validate_refs.py`). This validator is not a remote-link checker; the separate artifact check verified citation paths against retained snapshots and local files.
- **Full Python suite after writing:** **935 passed / 3 failed**, matching the baseline. The untouched failures concern implement-spec's expected eval IDs, refine-ticket argument passthrough, and revmerge decision-routing wording. No successful full-suite claim is made.
- **Scope:** only this Markdown evidence note and its single HTML rendering were added. Proposed skills, extensions, Cleopatra runtime changes, live probes, paid evaluations and tracker operations were not performed. Browser checks were ad-hoc artifact checks, not Cleopatra operational qualification.
