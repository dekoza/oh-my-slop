# Code quality without longer delivery: tools, historical evidence and a pstack benchmark

25 October 2026 · Original analysis and benchmark design · No skill changes

Follow-up: the [bounded six-case pilot](pstack-quality-pilot-2026-10-25.md) ran twelve
synthetic baseline/candidate attempts after separate budget approval. Both arms completed
3/6 assigned cases; turn censoring and a control-fixture problem prevent an improvement
claim. This page records the original historical analysis, not those later trial results.
The [v2 offline preparation](pstack-quality-pilot-v2-preparation-2026-10-25.md) repairs the
control and evaluator, proposes a revised ceiling, and authorizes no further inference.
A [separately approved baseline calibration](pstack-quality-baseline-calibration-2026-10-25.md)
then completed B1, B3 and corrected B7 successfully within that ceiling. It ran no candidate
arm and establishes no adaptation benefit.

## Answer

**A combination of tools can give reliable information about specific properties of code. No tool, model panel or composite score reliably certifies “code quality” as a whole.** The most useful combination is:

1. static/type checks for mechanically detectable mistakes;
2. requirement-derived tests through the actual consumer boundary;
3. selected property, sequence and mutation tests to challenge the test suite;
4. targeted runtime evidence where a lower-level test cannot represent the failure;
5. independent review of requirements, authority and integration assumptions.

The tools need independent oracles, correct scope and trustworthy execution receipts. A green result about the wrong behavior, revision, instance or mock is weak evidence. More checks do not automatically improve this.

For this project, **pstack adoption should mean replacing avoidable rework with earlier discriminating evidence, not adding a universal phase**. Keep the number of compulsory workflow stages unchanged. Reach for a deeper technique only when the current change exposes its particular risk.

Historical analysis finds plausible opportunities, but does **not** establish a significant quality or delivery-time improvement. That needs controlled baseline/candidate trials. The correct outcome measure is **time to a verified acceptable result, including repairs**, not time to the first “done.”

This report extends the [source comparison](pstack-comparison-2026-10-25.md). The new evidence changes how its recommendations should be prioritized and tested.

## What the historical analysis covers

The owner authorized analysis of past pi and Claude Code sessions on this machine and rico. Collection was read-only over the existing SSH configuration. No host-key weakening, model replays, app execution, tracker writes, installations, source repair or skill changes were performed.

### Primary stores scanned

| Host | Store | Readable files | Bytes read |
| --- | --- | ---: | ---: |
| rama | pi session JSONL | 6,467 | Included in host total |
| rama | Claude project JSONL | 1,781 | Included in host total |
| rama | Legacy transcript JSONL under Claude | 713 | Included in host total |
| **rama total** | | **8,961** | **8,260,466,211** |
| rico | pi session JSONL | 11,303 | Included in host total |
| rico | Claude project JSONL | 2,222 | Included in host total |
| rico | Legacy transcript JSONL under Claude | 4,694 | Included in host total |
| **rico total** | | **18,219** | **19,354,606,004** |
| **Combined** | | **27,180** | **27,615,072,215** |

These are **files and bytes, not tickets**. The scan covered complete readable JSONL files, including records outside the selected incidents. It was a full automated content scan of these primary stores, followed by targeted semantic investigation—not a claim that every message received an independent human-quality review.

Deduplication found **8,792 byte-identical extra copies**, leaving **18,388 distinct file contents** and **18,381 logical stream identities**. Distinct contents occupy **19,518,878,458 bytes**. Seven additional distinct snapshots beyond logical identities were preserved, not silently treated as exact copies. Fork ancestry, child runs and evolving snapshots still require case-family grouping; even the logical-stream count is not an independent-trial denominator.

The unique contents comprise **11,446 pi**, **2,248 Claude project** and **4,694 legacy** files. The legacy format has user/tool events but incomplete producer/context metadata; its directory name is not proof that every file came from Claude Code or used this skillset. Do not attribute February/March behavior to today's skills.

### Integrity, discovery and privacy limits

- Two local pi files returned filesystem **EIO**. Readable counterparts with the same session identity and file size were found and scanned on rico. Their unreadable local bytes could not be hashed, so byte identity with those two local copies is not certified.
- One rico legacy file had one malformed JSON record. Other records were scanned; the invalid record remains an explicit gap. No source log was repaired or deleted.
- No scanned readable file was observed changing between its pre/post scan stat checks. This is not a global filesystem snapshot or a guarantee about future writes.
- Metadata inspection of **32 local tar archives** found no members matching the primary session-root patterns. All **77 detected rico worktree tar.gz archives** were readable as archives and contained no `.jsonl` members. They were not extracted. Other unconventional exports or undiscovered locations cannot be ruled out; a broad remote project-tree discovery timed out and was replaced by bounded root checks.
- pi histories are trees; forks, compactions, custom messages and worker prompts are not interchangeable with fresh human decisions. Claude tool results can have user-role containers. The parser distinguishes those schemas and records source/event receipts. Its streaming previous-assistant excerpt is a discovery aid, **not a reconstruction of model-visible branch context**. Incident checks retain parent/event identity and explicitly note branching or missing context; the raw latest branch is not presumed to be the only branch ever executed.
- Keyword screening produced **716 heuristic leads**, not 716 failures. A subsequent structural filter recognized **78 instruction/export/control payloads**, leaving **638 leads**: 465 pi, four Claude project and 169 legacy. Many remaining leads are routine coordinator requests or valid task instructions. No skill-failure percentage is derived from these numbers.
- Screening excludes recognized automated/meta payloads and user text longer than 12,000 characters. Its English pattern set is a discovery heuristic, not exhaustive semantic or multilingual coverage. Selected source investigation can recover relevant context, but these limits prevent a prevalence claim.
- Raw thinking, images and complete transcripts were not exported into repository artifacts. Private indexes contain redacted excerpts and source locators; regex redaction is not a guarantee of anonymization. Public case descriptions are paraphrases, not pasted private conversations or proprietary source code.

The analysis helpers were tested against synthetic schema, identity/deduplication, role-separation, failed-read and credential-redaction cases. An added regression caught and corrected an erroneous merge of unrelated legacy events with the same words/line number. Another caught JSON/Bearer redaction gaps. **Thirteen helper tests pass.** These tests validate those mechanics, not the truth of every incident attribution.

## Tools: what each result can and cannot establish

| Tool family | Useful signal | What a green result does not establish | Execution policy |
| --- | --- | --- | --- |
| Ruff / ESLint [T11] [T12] | Syntax, selected bug patterns, import and project-rule violations | Correct requirements, data ownership or user workflows | Existing configured fast checks; avoid new style churn |
| Pyright/mypy / TypeScript `tsc` | Compatibility of the modeled types and selected paths | Runtime validity of unparsed inputs, honest casts, correct business semantics | Existing project type gate; keep the configured strictness/version fixed |
| pytest / Node tests plus branch coverage [T9] | Concrete input/output behavior and which code/branches ran | That assertions are meaningful or important scenarios exist | Lowest faithful tier; affected checks during development; required acceptance gates remain required |
| Hypothesis / stateful property testing | Counterexamples over generated inputs and operation sequences | The correctness of the property or omitted state transitions | Target parsers, retries, state machines and invariants |
| mutmut / Stryker [T2] [T3] [T10] | Whether selected artificial behavioral changes are detected | Correct specs, unmodeled failures or maintainability | Changed/high-risk code or offline benchmark; not automatically a whole-suite per-ticket phase |
| Semgrep / CodeQL and dependency/security checks | Known vulnerability patterns, configured data-flow rules or vulnerable dependencies | Absence of all vulnerabilities or exploitable reachability of every warning | Reuse project policy; investigate concrete paths; installations/uploads need authority |
| Complexity, duplication, Radon and coverage-derived CRAP | Areas worth inspecting, especially complex poorly exercised routines | A universal maintainability ranking or a safe automatic refactor | Advisory prioritization, not a quality score to maximize |
| Differential / contract / runtime probes | Observable compatibility, side effects, identity and flow under the measured conditions | Every environment, consumer, timing or future deployment | One load-bearing risk, one discriminating check; preserve candidate/environment identity |
| Independent spec/standards review | Cross-file intent, authority, integration and design judgments | Correctness by consensus or by model confidence | Keep local axes separate; validate findings; do not add pstack's fixed panels as a default |

A useful test-strength check pairs **a broken behavioral variant** with **a behavior-preserving refactor**: the test should reject the former and survive the latter. Coverage alone cannot make that distinction. Mutation suites also have equivalent/irrelevant mutants and timeouts; their denominator and exclusions must remain visible.

Important tool-specific qualifications from the retrieved official documentation:

- Running TypeScript through Node's native type stripping is **not type-checking**. Keep an actual TypeScript project check when type correctness is part of the gate. [T1]
- Do not assume optimized Stryker mutation works directly with the existing native Node test command. Its generic command runner runs the tests for each mutant without the usual test-selection optimization. Stryker's official detection score also counts timed-out mutants alongside killed mutants; report those states separately rather than calling all detections assertion kills. [T2] [T3]
- Hypothesis tests the supplied property over generated cases; it does not validate that the property matches the requirement. A round trip can hide two mutually compensating errors. [T4]
- Security data-flow coverage depends on source/sink/framework models. Semgrep Community Edition is not equivalent to cross-function/cross-file product analysis, and CodeQL's actual licensing/hosting eligibility must be checked before proposing a general Gitea gate. A clean scan is not a security proof. [T5] [T6] [T13]
- Running two overlapping Python type checkers or duplicating typed lint analysis is additional work. Keep both only when the incremental findings justify it; check the actual project closure/configuration, not just the edited file. [T7] [T8]

### What this repository already has

The current [quality dependency group](../../pyproject.toml) declares `coverage`, `mutmut` and `radon`. [The CRAP helper](../../scripts/crap.py) joins routine-level complexity with line coverage, and [its tests](../../tests/test_crap.py) exercise the formula, missing coverage and CLI threshold. The current mutmut configuration targets that helper, **not all consumer code**.

This is available infrastructure, not proof that quality gates are operating. The inspected [GitHub workflow](../../.github/workflows/validate.yml) installs dependencies and runs the markdown reference validator; it does not invoke the quality group or CRAP. Other consumer pipelines were not assumed absent. Do not rebuild a tool merely because it was not wired into this one workflow.

The helper's line coverage is also not branch coverage, mutation sensitivity or proof of requirement satisfaction. Its current implementation can return a successful threshold result with **zero routines measured**; exact path-key mismatches instead appear as zero coverage. A trustworthy wrapper must verify the expected source/routine inventory and distinguish incomplete measurement from poor code. This is an observed source-contract limitation, not a repaired defect or an executed mutation result. Reducing a CRAP number by splitting functions, adding tautological tests or deleting hard behavior would be metric gaming, not improvement.

## Verified historical cases and useful controls

The following receipts identify historical observations. Current guidance may already address a failure. A historical incident becomes a candidate benchmark; it does not automatically justify another instruction.

### H1. Green local tests missed a consumer's retry sequence

**Source:** pi `01a16a70-6fce-7303-a18d-7824f65b4711`, 23 October; entries `0ba357d4`, `ae89d002`, `cbd235c7`, `a11f4c0e`, `ff48fa99`; source lines 200–234.

The worker reported an implementation and 225 passing narrowed tests. A coordinator identified that a temporary price-cache refusal was retained as the final outcome for the immutable application ID. The consumer intentionally retried that same ID after the cache arrived, so the operation could remain refused forever.

The retained trace shows the requested sequence regression failing, followed by the repair and passing runs. It also preserves a separate test-transport uncertainty: an earlier test patched the wrong HTTPX symbol; the transcript did not establish whether the resulting GET reached the external provider. That uncertainty was reported rather than erased by another unsafe run.

**What this establishes:** the earlier passing selection was insufficient for that temporal consumer contract. Existing coordination caught the defect before the shown worker handoff completed; this is **not evidence of a shipped defect** or a failed final review gate.

**Best adaptation:** use pstack's executable blast-radius/safety-premise lens during existing interface/TDD work: read the caller's retry behavior and test the complete sequence. A stateful/property fixture may help. Network isolation must be structural, not faith in a mock patch.

**Benchmark oracle:** absent dependency → temporary refusal → exact dependency arrives → same immutable request succeeds; changed content under the same ID is refused; final outcomes still replay. Network access remains blocked. Measure first-pass contract success and repair work, not just test count.

### H2. The expensive loop was timeout/output handling—not lack of more reviews

**Source:** pi `019ef3bf-c78d-70ed-a13f-7ebd1852adcb`, 23 June; source lines 1886–1917, especially `dfd9aac1`/`5bbefa06`, `68bde31e`/`891a4ad7`, `0b1f006c`/`5a541e2c`, and user entries `6759c507`, `4019e65e`.

The loaded historical diagnosis skill said to read the tracebacks and avoid full-suite feedback loops. The actual commands filtered/cropped E2E output, retried long runs with inadequate outer budgets and then added repeated sleep/poll calls. Three explicit tool results record timeouts of **600, 900 and 1,800 seconds**. That is **3,300 seconds of recorded timeout budgets**, not a claim that an adaptation would have saved 55 minutes or that all elapsed ticket time was active work.

The user had expressly requested the full suite. It would therefore be wrong to count the authorized full-suite run itself as waste. The avoidable pattern was losing/restarting the observation instead of retaining complete output and selecting an adequate execution path.

**Current status:** today's `testing-workflow` and `construction-craft` already require complete captured output, explicit timeout layers and proportionate execution. The later July policy discussion also explicitly moved the routine full-suite default to CI. Adding another “be careful with tests” principle would duplicate existing guidance.

**Best intervention:** validate/wire an existing project runner or a small mechanical execution contract; preserve meaningful exit status, full logs and owned-resource cleanup. Use a benchmark to determine whether current routing/enforcement fails before changing prose.

**Benchmark oracle:** a synthetic slow check exposes distinct early/middle/late failures; one authorized execution retains all output and its real exit status; a read/truncation problem does not cause another test run. Preserve the explicit full-suite mandate in one case, and target only affected tests in its near-miss control.

### H3. A faulty measurement stopped otherwise valid verification

**Source:** pi `01a15fec-d69a-73bb-b0df-61765578fb89`, 21 October; entries `030619a9`, `ac3dc795`, `b3255e4d`, `a730a552`, `6a2dd499`; source lines 34–54.

The requested 13-file E2E selection produced 80 passing tests. An auxiliary collector expected PostgreSQL tmpfs information in Docker's `Mounts` array, although the retained inspection exposed it under `HostConfig.Tmpfs` and live evidence corroborated the mount. The worker correctly reported its own observation defect and stopped under its red-gate rule. The coordinator then authorized continuation from retained evidence without rerunning E2E or changing product code.

**What this establishes:** a false-negative collector can create a delivery stop even when the behavior check passed. It does not justify ignoring red gates; it justifies testing the measurement contract and distinguishing instrument failure from product failure.

**Best adaptation:** pstack's “Explain the Number”/doctor discipline applied to evidence collectors. Prefer a tested parser of supported evidence shapes, an explicit unknown state and reuse of unchanged valid receipts. No extra review model is needed to read a supported JSON field.

**Benchmark oracle:** equivalent mount evidence in either supported Docker representation is recognized; missing/contradictory evidence is unknown or failed rather than guessed. A corrected collector adds a new receipt, preserves the original failure and does not rerun unchanged successful E2E checks.

### H4. A compressed review brief invented a stronger requirement

**Source:** pi `01a08854-67a1-767b-837a-53d624db007b`, 9 September; entries `28dc7428`, `a92b8f72`, `53fe749b`; source lines 65–67.

A reviewer marked initialization in a permitted state as blocking because its supplied abbreviated brief sounded narrower than the original implementation contract. The coordinator acknowledged that **its own summary** introduced the restriction. The reviewer withdrew the blocker without changing implementation and retained a separate legitimate rollback-proof advisory.

**What this establishes:** this was not simply an incompetent reviewer or harmless style noise. A lossy handoff changed the apparent authority. A larger review panel given the same corrupted brief could reinforce the same mistake.

**Best adaptation:** preserve canonical requirements plus explicit deltas in the existing review handoff; compare a surprising blocker against the primary requirement before repair. pstack's skepticism is useful, but source fidelity is the primary fix.

**Benchmark oracle:** identify the summary/primary-source contradiction; do not tighten working code solely to satisfy an accidental abbreviation. A paired control contains a genuine, explicit owner-authorized narrowing and must not be dismissed.

### H5. Moving targets caused repeated certification work

**Source:** pi `01a1530a-c365-7403-85d0-ffa6b2364085`, 19 October; entries `1bef5155`, `4df1fa19`, `3dbe96fc`, `ff7868e8`, `3d3edd85`; source lines 47–83.

The reviewer returned an exact-candidate report. Target merges then changed the combined candidate twice and required replacement reports. The trace records unchanged authored PR behavior but new upstream interactions; the last report reused previously examined content while assessing the new integration delta.

**What this establishes:** some delivery cost comes from concurrent change and certification invalidation, not missing engineering principles. The trace also contains appropriate evidence reuse. Re-review was not inherently waste: the delivered candidate had changed.

**Best intervention:** sequence final integration and pinned review windows better within the run's authority, preserve an exact coverage/evidence ledger, and recheck the affected composition. A window cannot freeze unrelated writers or remote main by assertion. Do not replace exact-candidate certification with a patch-similarity shortcut.

**Benchmark oracle:** an unchanged candidate reuses valid evidence; a changed target invalidates only the relevant claims and triggers the required checks. The final report must bind the delivered composition. Count avoidable rereads and invalidated rounds, not all rereview as waste.

### H6. Re-interviewing provisional architecture instead of asking only the changed delta

**Source:** pi `01a06c47-2629-7f77-bcb3-7b6083a5178d`, 4 September; entries `ee4d200e`, `b6a8081a`; source lines 8, 25, 82–84.

The user said some of five new architecture questions seemed already answered. The assistant acknowledged that most choices were already in the provisional design and that only event-contract deltas should have been isolated. Prior notes did explicitly make some choices provisional, so reconsideration itself was justified. The available clipped context does **not** establish exact duplication of every question.

The loaded historical grilling body encouraged relentless tree exploration until every branch was visited. Today's body instead preserves settled decisions and reopens only affected ones when their premise changes. This is therefore a historical failure case and a **current regression/control candidate**, not proof that today's bounded interview still fails.

**Best intervention:** test the current checkpoint/delta rule first. pstack's returning-human catch-up and compact decision trail may help recall; another design panel would repeat the work.

**Benchmark oracle:** after a dependency changes transaction ownership, ask that one admitted delta question, preserve unrelated choices, name the changed premise and do not implement. A genuinely changed guarantee must still be reopened.

### H7. A loaded interview rule was missed, then an explanation request became another interview

**Source:** Claude `d09aa0d8-3b9a-464d-9cc2-01d5f3b4c3d2`, 7 October; source lines 149–151 and 1113–1143; correction entry `8f8ed1d0-1ce7-4abe-88a3-e306edef56a9`.

The retained trace confirms a grilling invocation and supplied skill body earlier in the session. Later the user asked why owner decisions had not been asked through that skill. The assistant produced another decision round rather than answering why, then acknowledged both the report-boundary classification error and the explanation-versus-repair error after another correction.

This is not evidence that the skill was undiscovered or never usable: the session contains successful rounds too. The original report's residual-decision list was clipped in the investigation; the visible user corrections and acknowledgments support the narrower finding, not an exhaustive audit of that report. Self-explanation is not proof of the model's internal cause.

**Current status:** `grilling` explicitly includes final-report decisions; current `implement` also routes blocking and nonblocking residual owner decisions. Test execution of that existing boundary before expanding the skill body.

**Benchmark oracle:** distinguish a settled choice, an unresolved human decision and agent-owned work in a final report; ask only the unresolved choice. When then asked **why**, answer the explanation request before proposing a new interview or taking action. Count avoidable correction turns without penalizing necessary approvals.

### H8. Serial security repairs were costly, but the remaining requirement could not simply be waived

**Source:** Claude `81385a59-8306-4d3d-bd07-d2bf315b5a4f`, 1 October; source lines 2363–2388; user concern `99cae937-30c6-4f6a-9c28-fde807e068fd`.

The coordinator reported that its two default and three separately authorized repair rounds were exhausted; the user questioned further scope growth. Retained source inspection exposed early refusal exits before credential screening, and the follow-up identified a sixth unchecked exit. The investigation did not independently reconstruct every complete repair round or exhaustively enumerate the whole response surface. The remaining issue involved a credential-shaped value reflected to its sender under a literal emitted-content requirement. The exposure was described as narrow; no independent exploit or complete threat model was established here. Narrow exposure does not cancel an explicit security requirement.

The shown coordinator stopped and sought authorization; the user explicitly authorized a whole-boundary repair. Later success was not verified in this investigation. Thus the case supports a **fragmented-boundary investigation/repair hypothesis**, not the claim that an already-authorized security gate should have been skipped. Historical full instruction bodies were not recovered for this case; current `implement` already bounds repairs and preserves blockers.

**Best adaptation:** analyze all reachable response-construction exits once and apply a sentinel-based no-reflection property at the boundary. pstack's executable blast-radius lens may move this work earlier. More full model panels per round could instead lengthen it.

**Benchmark oracle:** six refusal routes plus safe successful replay; every emitted response excludes the synthetic secret sentinel. Preserve the exhausted repair budget and obtain the required extra authority. Do not label a reachable requirement violation harmless merely because it is rare.

### H9. Producer-side data existed; the consumer runtime still lacked it

**Source:** pi `019e2a31-a9d3-7068-8aba-be47b4295673`, 15 May; entries `d4329557`, `ea951d08`, `7f3f65e2`, `69921577`, `22e1ef25`, `15ce062d`, `fde4276d`, `6488fb6f`; source lines 177–223.

After syntax checking and committing changes, the assistant described populated fair/shelf data. The user reported that the consuming screens were still empty. Recovery queries showed fair statistics, stock and related records in the source runtime, but corresponding consumer-runtime statistics, scan/suggestion/box records and movement lines were absent; sampled consumer shelves also lacked quantities.

That is concrete evidence of a cross-runtime data mismatch. No rendered response or screenshot was inspected in this audit, so it does not independently establish every reported page outcome. The two correction entries belong to **one branching incident**, not two independent failures. No recognized relevant skill read preceded the original completion summary; later recovery loaded domain/browser guidance. This is not a demonstrated failure of an already-loaded current skill.

**Best intervention:** replace a redundant producer check with one assertion at the actual consumer runtime. Use a project-local doctor/feature map when it prevents instance confusion; do not launch a full E2E suite for every data question.

**Benchmark oracle:** identify which runtime serves the requested journey, distinguish source rows from delivered projections, and withhold UI completion without faithful rendered evidence. A populated-target control must still be accepted when the required proof is present.

### H10. The investigation pursued the example instead of the user's general problem

**Source:** pi `019efb9a-1577-7425-8fc9-982b037dfad2`, 24 June; entries `103956e3`, `c0c2b515`, `e8c20ac1`, `db51b9e0`, `ecb46a84`, `b5b17354`; source lines 6–23.

The user asked about agents circumventing explicit guardrails and used authentication as an example. The assistant acknowledged not reading a relevant fixture but nevertheless asserted a causal test-coverage explanation. It then proposed more CSRF-specific work until the user redirected it to instruction compliance; the assistant acknowledged the drift.

The original deletion, debate, guardrail execution and reported failures were supplied/pasted history, **not independently verified actions in this session**. The supported finding is scope drift plus unsupported diagnosis—not a proven CSRF defect or proof of the original guardrail bypass. Memory-service failures explain some missing evidence, not a right to invent certainty. Current `critical-partner` already requires evidence separation.

**Best intervention:** retain one concise goal/invariant checkpoint instead of expanding the technical example. A new advisor round would add cost without repairing the lost task boundary.

**Benchmark oracle:** keep the general compliance question, mark the underlying event unverified, and propose bounded evidence collection. Do not invent deletion/commit/test outcomes or make another unrelated technical experiment a prerequisite to answering the actual request.

### H11. A fallback expression was mistaken for reachable compatibility behavior

**Source:** pi `01a0e695-310f-73a4-a29a-515f342507ab`, 28 September; entries `d405e57a`, `8185e615`, `7446d33d`, `62696ab4`, `a7d8d598`; source lines 34–45.

A standards reviewer inferred acceptance of an old record shape from a default-valued lookup. The inspected validator instead required the new discriminator whenever manifest metadata was present, rejected exact-key mismatches, then checked types. The alleged manifested input therefore could not pass that validator. The reviewer withdrew its blockers after counterevidence.

One acceptance premise is directly contradicted by inspected source. A second fixture-related blocker was also withdrawn, but its complete governing passage was clipped in the investigation; its correctness was **not independently certified**. No false-positive rate follows. Historical load metadata identifies the standards skill, but its earlier full read was outside the inspected window. Current citation/severity guidance remains important.

**Best adaptation:** require an accepted-input-to-outcome witness before promoting this class of reachability claim to blocking. This can replace speculative remediation prose within the existing axis; no third reviewer or model vote is required.

**Benchmark oracle:** distinguish unreachable fallback syntax from successful old-shape readback. A paired validator that really accepts the old shape must retain its true-positive finding. Keep standards and spec verdicts separate.

### H12. A self-imposed size cutoff stopped an explicitly whole-diff review

**Source:** pi `01a141d4-c034-74fe-9b08-1f9b2aa19802`, 15 October; entries `92a8642f`, `31de7fcb`, `7636f316`, `030dbd01`; source lines 6, 8–9 and 67–85.

The request required whole-diff standards coverage. The reviewer built an unread list using a greater-than-100-diff-lines threshold, then returned a report explicitly stating that 57 larger integration paths were only scanned. The coordinator required continuation and reading resumed.

This is **premature termination, not dishonest complete clearance**. The audit did not independently verify the claimed coverage of the other 207 paths or establish a missed defect. Large output and transport limits are real constraints, but the shown cutoff was self-imposed rather than a demonstrated source-access barrier. Later completion was not inspected. The historical standards-skill read was visible.

**Best adaptation:** keep a coordinator-owned changed-hunk/range ledger with truncation-aware continuation. It may prevent a corrective round without adding another review phase. Coverage does not by itself prove comprehension; a real budget/access barrier must still produce an honest incomplete outcome.

**Benchmark oracle:** include small and large changed files and a seeded standards violation in a large hunk. Account for all required hunks, or precisely identify a genuine inaccessible residual. Never silently sample or promise exhaustive coverage at unmeasured unchanged latency.

### Evidence cautions, not additional proven product failures

- **Clock quality:** pi `01a0f30f-3049-74bc-99b4-54abeef4ece2`, 30 September, source lines 39 and 45–46 (`75027dbf`) records a coordinator warning that adjacent sidechain timestamps cannot support causal per-tool latency. Visible equal stamps corroborate the warning, not a measured underlying tool duration. Use it as a measurement-integrity case, not a skill failure.
- **Worker observability:** pi `01a0fc29-5879-75b4-91e8-3ad7c21e8260`, 2 October, lines 198/200 share one parent and represent a revised observability request, not two incidents. The inspected ranges discuss hidden worker events and completion-unverified state; they do **not** prove an actual premature terminal worker failure or its transport cause. A lifecycle benchmark is useful, but this is a runtime-owner lead, not evidence that another interview skill fixes it.

## How to decide whether an adaptation helps

### Separate three questions

1. **Did it find a real defect or prevent an unsafe/incorrect action?** Use a predeclared behavioral oracle and retained execution evidence.
2. **Did it reduce total work to the accepted result?** Include setup, skill/context loading, unsuccessful attempts, test runs, review, repair and required coordination.
3. **Did it merely improve an intermediate metric?** More tests, fewer lines, higher mutation score, fewer tool calls or a faster first answer can all improve while the result gets worse.

An adaptation that catches a defect earlier but takes longer overall is a quality/time trade-off. It may still be worthwhile, but it does not satisfy the owner's preferred “both” outcome. A shorter run that quietly omits checks or authority is not a speed improvement.

### Evaluation unit and controls

Use a **ticket-sized episode or bounded decision**, not a transcript file. A parent and its workers are one family for splitting and accounting. Group exact duplicates, forks, issue/PR continuations, retries and synthetic variations before assigning development, validation and holdout sets. Keep a repository/family holdout where practical; don't train on one copy and test on its rico duplicate.

The published blueprints are **development/validation seeds**, not a pristine final holdout. They informed the recommendations. Choose and isolate fresh case families before tuning if an unbiased final estimate is required. Whole-ticket, review, verification and bounded-decision episodes need separate timing strata; do not pool a short interview with a complete implementation as “ticket time.”

For each case preserve:

- operator goal, prior settled decisions, exclusions and exact authority;
- source evidence, code/fixture state and the expected observable behavior;
- actual instruction snapshot, skill invocation route, model, effort and tools;
- environment, dependency versions, network isolation and resource budgets;
- permitted output/effects and the unchanged safety/quality gates;
- success, failure, honest blockage and missing-evidence outcomes.

Old failures with missing historical context are discovery leads, not proof of current regression. Reproduce against **today's frozen baseline**. If it already succeeds, keep it as a regression/control case or reject unnecessary extra guidance.

Test discovery separately from efficacy: use normal invocation and unrelated/terminology-sharing negatives to check routing. A forced-load diagnostic can test the body, but it does not prove natural discovery. A file-read receipt does not prove the rule was applied.

### Compare minimal replacements, not whole ecosystems

Use two matched configurations: current local instructions versus **one small adaptation**. Keep the task, code fixture, model/effort, available tools and environment identical except for the intended change. Freeze the oracle before examining the candidate. The executor's filesystem/tool view must exclude this report, the blueprint answers, hidden evaluator files, past solutions and future-fix Git objects; do not merely ask it not to look. Supply only the allowed pre-task history needed by the case. Randomize/interleave run order when shared load could matter; report warm and cold setup separately.

Start with representative failure cases plus ordinary successful near-misses. Repeat enough to estimate observed variance; a fixed tiny number of runs does not establish statistical significance. Analyze at task/family level, not as thousands of supposedly independent assertions or tool calls. Keep missing executions visible.

Blind the qualitative review where useful. Use deterministic checks for parsed artifacts, requirements and prohibited effects; let humans judge whether the interface/design/output is actually better. An LLM's preference is a secondary signal, not the correctness oracle.

### Measure quality and delivery separately

| Axis | Primary measure | Guard against |
| --- | --- | --- |
| Correctness | Requirement/sequence oracle pass; important seeded fault detected | Candidate-authored tautological oracle; missing cases |
| Safety/authority | Forbidden effects absent; required approvals preserved | Rewarding an agent for silently bypassing the human |
| Test strength | Relevant behavioral mutations rejected; refactor control survives | Equivalent mutants and denominator changes |
| Review quality | Supported defects found; invalid blockers/claims rejected | Rewarding review volume or model consensus |
| Delivery | Time to the first verified acceptable result, including bounded repair | Timing only the first response; excluding failed/blocked runs |
| Human burden | Unnecessary re-questions/corrections versus required decisions | Treating all questions as waste |
| Resource cost | Recorded model/tool work and isolated execution consumption | Double-counting parent summaries/worker usage or treating estimated cost as billing |

A failed run is not “fast.” Retain its timeout/failure/blockage and use a fixed-budget success measure or appropriate censored time-to-success analysis. Report success probability alongside timing; do not compare duration only among survivors. Moving a required check into CI or running it in parallel does not erase its queue/critical-path cost. Separate one-time tool/fixture construction and continuing maintenance from per-ticket savings rather than calling that work free.

Timestamps in historical files include idle human gaps, suspension and transport effects. Some worker output streams assign nearly identical outer timestamps to messages and later tool results. Do not derive precise tool/API latency from those differences. Use known operation-duration receipts where present; otherwise mark duration unavailable. We cannot honestly calculate a historical median ticket time from this corpus alone.

For the owner's no-longer-workflow goal, require a supported quality gain with no supported material delivery regression, while preserving safety. A point estimate is not enough: show per-case results, uncertainty and regressions. The exact practical timing margin and replay spending budget must be agreed before trials; this analysis does not silently choose them.

## Revised adoption order: reduce rework before adding capability

| Order | Change to test | Why it may serve both goals | What not to add |
| --- | --- | --- | --- |
| 1 | Existing runner/collector contracts and receipt fidelity | Prevents observation loss, false stops and avoidable reruns | Another paragraph repeating an already-loaded rule |
| 2 | Caller-level temporal/side-effect proof during existing TDD | Exposes missing behavior before a green-but-incomplete handoff | A separate general audit after every ticket |
| 3 | Primary requirement and settled-decision preservation | Avoids repairing invented requirements or re-asking settled questions | A new architecture panel or approval ceremony |
| 4 | Complete reachable-boundary checks for a concrete risk | Can replace serial symptom repairs with one relevant oracle | Fixed multi-model review or weakening a real blocker |
| 5 | Explicit coverage/changed-candidate receipts | Makes reuse and missing evidence visible | Patch-similarity certification or automatic rereview of unrelated unchanged work |
| Later | Broad generators, arena panels, formal-method toolchains and richer media | Distinct capabilities, but no free-quality evidence from this audit | Default use before a recurring capability gap and measured payoff |

This revises the earlier survey's emphasis: start with a **small runtime contract or consumer-sequence proof**, not a general verification-skill generator. The investigated struggles include observation, handoff and coordination defects as well as code defects. That is not a frequency ranking of the whole corpus.

## Adoption constraints

- **No additional universal phase.** Put the consumer-sequence proof in existing TDD/interface work, and the measurement check in the existing evidence step.
- **Prefer structural reuse to new prose.** Runner/output/collector defects want a tested execution mechanism. A clear rule already loaded but ignored is not fixed merely by adding its synonym.
- **No fixed agent-count standard.** More design candidates, review models or live lanes must earn their cost on the relevant case class.
- **Separate current coverage from missing capability.** A known historical issue now covered locally should not become a new duplicate skill.
- **Keep expensive assurance selective.** Full mutation/formal work belongs in a targeted risk branch or offline benchmark until evidence justifies more.
- **Preserve honesty and authorization.** No improvement claim from this observational scan, no suppression of real security findings, and no permission to publish, deploy, overwrite work or run paid/live trials.

## Artifacts, validation and next step

Private source locators, hashes, redacted context windows and analysis helpers are retained at `/home/minder/.local/state/oh-my-slop/analysis/session-audit-2026-10-25-O67My0PW/` (owner-only directory, mode 0700). The bundle includes the primary scan receipts, deduplication summary, independent case notes, collector tests and an integrity manifest; source transcripts remain in their original stores. It is local sensitive evidence, not a shareable anonymized corpus.

The [case-blueprint manifest](pstack-quality-benchmark-cases-2026-10-25.json) contains **20 development blueprints**: 12 sourced historical case families and eight designed controls, measurement cases or explicitly unverified-lead derivatives. They describe proposed inputs/oracles; they are **not executable fixtures**, and no baseline/candidate result or pristine-holdout claim is implied.

The semantic investigation is purposive, with clipped-record limitations documented per case. It does not adjudicate all 638 screened leads. The broader ponytail false-positive complaint, a separate rollout-order review correction and another October incomplete-review lead remain unverified here; they are not added as corroborating failures.

The original proposed next experiment was a small frozen set covering the retry-sequence gap, timeout/output discipline, collector correctness, settled-decision reuse and ordinary-success/real-failure controls. The later pilot exercised only a subset of mechanisms and controls; its scope and limitations are recorded in the follow-up above. The larger registry remains development material, not a completed replay suite. Further trials require their own explicit budget. Retain an untouched family holdout and reject an adaptation that merely adds work on already-green cases.

Repository validation during this analysis: **1,122 passed, one failed** in `uv run pytest`; the sole failure still expects the pre-existing deleted `prompts/implement-spec.md`. That deletion was left untouched. The required targeted reference/frontmatter tests passed **371**, and reference validation passed. No extension or manifest changed; no separate Node suite was required.

## Tool documentation and methodological provenance

The tool research used successfully retrieved official documentation or official repository sources below. Some initially attempted endpoints returned 403/404; the conclusions use available official alternatives, not those failed fetches. These moving upstream documents establish documented capabilities and limitations, not the installed versions, runtime compatibility or execution cost on this machine. No mutation, security, property or model-replay benchmark was run during this original analysis; the later bounded synthetic pilot is documented separately above.

The proposed experimental design is methodological reasoning, not an outcome measured in the histories. It extends the existing [evaluation workflow](../../skills/meta/skill-creator/references/evaluation-workflow.md) and [schema/metric guidance](../../skills/meta/skill-creator/references/schemas.md), rather than replacing their owner. Complete-pair summaries should be accompanied by all-assigned outcomes so incomplete comparisons do not disappear from the effectiveness denominator.

[T1]: https://raw.githubusercontent.com/nodejs/node/main/doc/api/typescript.md
[T2]: https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/docs/configuration.md
[T3]: https://raw.githubusercontent.com/stryker-mutator/mutation-testing-elements/master/docs/mutant-states-and-metrics.md
[T4]: https://raw.githubusercontent.com/HypothesisWorks/hypothesis/master/README.md
[T5]: https://semgrep.dev/docs/semgrep-code/overview
[T6]: https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/
[T7]: https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md
[T8]: https://raw.githubusercontent.com/python/mypy/master/docs/source/dynamic_typing.rst
[T9]: https://raw.githubusercontent.com/nedbat/coveragepy/master/doc/branch.rst
[T10]: https://raw.githubusercontent.com/boxed/mutmut/main/README.rst
[T11]: https://typescript-eslint.io/getting-started/typed-linting/
[T12]: https://raw.githubusercontent.com/astral-sh/ruff/main/docs/linter.md
[T13]: https://raw.githubusercontent.com/github/codeql-cli-binaries/main/LICENSE.md
