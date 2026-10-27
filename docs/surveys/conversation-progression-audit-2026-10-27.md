# Conversation progression audit — 27 October 2026

## Verdict

**Improve transitions between existing workflows before adding more skills.** The agent usually knew how to complete its local job. It often left you to connect that result to the larger outcome: choose the next workflow, compose its invocation, or ask for a missing approval.

There are two distinct problems:

1. **Execution continuation:** finish work already requested and authorized instead of stopping after an answer or intermediate artifact.
2. **Outcome navigation:** when a legitimate boundary prevents continuation, supply the next concrete action, invocation or consequential decision immediately.

The first already has substantial safeguards, including September repairs to `humanify` and `/refine-ticket`. The second remains visible in October, especially after research and fresh-session authorization. A blanket instruction to keep executing would cross valid safety, scope and session boundaries.

This is a proposal-only audit. No skills, prompts, runtime configuration or tracker records were changed. This report is the only repository file added by the audit; pre-existing staged and unstaged work was preserved.

## Evidence and method

**Requested window:** 27 July–27 October 2026. Extraction cutoff: **2026-10-27 12:53:21 UTC**. Actual retained conversation dates begin 28 July for pi and 25 August for Claude Code. Claude evidence ends 9 October; pi evidence continues through the cutoff. This is the available local history, not proof of complete activity across all machines or providers.

Sources:

- pi: `/home/minder/.pi/agent/sessions/`.
- Claude Code: `/home/minder/.claude/projects/`.
- Common Codex and OpenCode locations were checked; no additional full conversation store was established. OpenCode prompt history alone was not substituted for conversations.
- Current repository skill/prompt bodies and relevant Git history. Repository HEAD inspected: `7ee9553`; the checkout also contained ongoing user changes, notably the staged `feature-milestones` skill. Current working-tree material is not necessarily the version used in historical sessions.

The inventory encountered **12,507 pi and 2,222 Claude JSONL files**, including workers. Filtering removed identifiable worker paths/session names, old files, synthetic notifications/continuation summaries, explicit runtime probes, additional `Task:` worker headers, local terminal/control records and this audit's conversation. Eight malformed JSONL lines were skipped; no file read errors were reported. Deduplication used source and message identifiers. Session files, not reconstructed lifelong threads, are the counting unit; forks, worktrees and imported handoffs can split one effort across several files. Heuristic exclusions can miss unlabeled automation. An entry in the user role does not prove a human physically typed it.

Crucially, pi expands a selected skill into a user-message `<skill>` block. The analysis retained the selected skill name but removed its body before counting other invocations or finding nudges. Otherwise, references to other skills inside `implement` inflate usage, and `handoff`'s “What's next” heading creates false nudges. Tool-result text and assistant suggestions were not counted as user invocations.

Explicit selection includes skill expansion, recognizable command metadata and phrases such as “use the X skill.” Observable skill-read/tool-request evidence is separate: it does not prove compliance, and batched call arguments can mention a skill without proving the read completed. Already-loaded system instructions are not always visible as fresh reads. Historical or external names outside the current repo catalog were not included in repo-skill totals.

All normalized operator entries were scanned for explicit routing, English/Polish next-step phrases and terse continuation messages. All **100 next-step candidates** received contextual classification in two disjoint review packets; the coordinator reconciled exact ID/source coverage and independently reread selected original records. A deterministic, month/source-stratified sample of **35 plain openings** and **24 terse continuation contexts** supplemented aggregate parsing. The 100-case review is exhaustive for the stated phrase detector, not for every possible expression of frustration. Ordinary openings outside that sample were not all qualitatively reviewed.

Logged instructions were treated as evidence, never executed. Private operational details and credential values are not reproduced here. Quoted claims about historical tests or deployments remain historical reports, not independently rerun checks.

## 1. How you used skills and commands

### Overall pattern

| Measure | Count |
|---|---:|
| Retained conversation files | 3,639 |
| pi / Claude Code | 2,974 / 665 |
| Retained operator-entry messages | 9,738 |
| Conversations starting with explicit repo-skill/prompt selection | 2,890 |
| Conversations starting without explicit selection | 749 |
| Plain-opening conversations that later explicitly selected a skill | 41 |
| Conversations with no explicit selection anywhere | 708 |
| Of those 708, conversations with observable repo-skill read/request evidence | 636 |
| Conversations with neither explicit selection nor observable repo-skill read/request | 72 |

**“I did not invoke a skill” usually did not mean “the agent used no skills.”** Global disciplines and model-selected references commonly appeared after plain-language requests. Conversely, a logged load is not evidence that the agent followed the skill.

Most frequent explicit opening routes:

| Route | Opening messages selecting it |
|---|---:|
| `two-axis-review` | 886 |
| `implement` | 870 |
| `fix-pr` | 308 |
| `triage` | 221 |
| `wayfinder` | 172 |
| `/fixrev` | 151 |
| `humanify` | 141 |
| `research` | 17 |
| `implement-spec` | 17 |
| `to-tickets` | 15 |
| `to-spec` | 13 |
| `/revmerge` | 10 |

Routes are not mutually exclusive: an opening can name several skills. `/fixrev` and `fix-pr` are two observable entry surfaces for the same repair owner, not independent capabilities. Where pi stored only the expanded handoff, the original slash spelling cannot be reconstructed reliably. These are observed selections, not exact command-keystroke totals or successful-run counts.

The dominant explicit workflow is ticket delivery and PR review/repair. Planning and research happen less frequently but connect those high-volume jobs. That makes their handoffs disproportionately important.

### Plain openings and ordinary continuation

Among the **749** plain openings, simple ordered text heuristics identified **233 PR review/merge requests**, **91 PR repair requests**, and **56 handoff/document imports**. These are partial route counts, not semantic coverage of every opening. Other starts included status questions, feature-level goals, operational investigations, contradiction analysis and small direct fixes.

Typical forms were:

- “review pr …, merge if pass; review as new comment”;
- “fix pr …”;
- an `@/tmp/...` handoff or spec, without naming a workflow;
- “where do we stand, what is missing?” tied to a concrete usable capability;
- a bounded finish/closeout request identifying existing evidence and excluding live operations.

You then mostly continued in ordinary language: **6,099 follow-up messages**, of which **162** explicitly selected a repo route and **5,937** did not. Answers, corrections, reported merges and short approvals carry the conversation forward; repeatedly naming the skill is not the normal interaction model.

The sampled plain starts suggest three different needs, not one missing router:

1. **Recognizable jobs already route well:** natural-language PR review and repair commonly load existing workflows.
2. **Imported state needs an execution contract:** a handoff supplies history, but must distinguish remaining work from authority to perform it.
3. **Feature-level requests need a finish line:** a tested backend, merged PR or completed planning note may not make the capability usable. Preserve that larger goal while respecting each local workflow's limits.

No comparison here establishes that plain openings perform worse than explicit invocations. They differ in task mix, length and purpose.

## 2. What your nudges were doing

### Contextual classification

The phrase detector found **100 candidates across 81 conversation files**, including repeated nudges in the same effort.

| Class | Meaning | Explicit-opening packet | Plain-opening packet | Total |
|---|---|---:|---:|---:|
| A | Authorized agent work was left unfinished | 3 | 4 | **7** |
| H | Local result delivered; concrete larger-goal transition missing | 46 | 11 | **57** |
| G | Necessary gate was already actionable | 5 | 2 | **7** |
| N | New state, new scope or next work after completion | 11 | 12 | **23** |
| M | Meta complaint, interrupted/repeated request or attribution gap | 3 | 3 | **6** |

These are analyst judgments, not measured probabilities or skill failure rates. **H is not A:** supplying a copyable next invocation can improve a correct stop without implying that the agent should execute it. Some boundaries remain judgment calls. All seven A examples predate or coincide with the September refinement repairs; they are historical regression evidence, not demonstrated failures of today's repaired rules.

### Strongest evidence

Source identifiers below resolve to original local JSONL paths in the source index.

| Case | What happened | Interpretation |
|---|---|---|
| Cleopatra, 24 September [S1], lines 224–239 | After your “as recommended,” the agent recorded the choice but stopped with engineering gaps. After “what's next?” it admitted: **“Next is engineering refinement on my side—not another approval question yet.”** | A genuine authorized-work stop. Not a reason to remove readiness or live-action gates. |
| Cleopatra, 27 September [S2], lines 155–168 | After “serial split,” the agent requested graph approval with technical coverage unfinished. Your nudge elicited **“The next step is mine”** and **“not yet ready for your graph approval.”** | Approval was requested before agent-owned preparation was complete. |
| Indyq, 24 October [S3], lines 26–28 | Research returned a report and blockers. Only after **“give me an invocation”** did it provide the bounded next investigation. | Research completion lacked an actionable transition; host access still requires its own authority. |
| Indyq, 24 October [S4], lines 66–72 | The follow-on inventory recommended a small slice. You again requested an invocation; the response finally supplied bounded preparation instructions. | A two-session research-to-planning navigation chain. The reports themselves were delivered. |
| Test-infra, 27 October [S5], lines 114–116; [S6], lines 56–58 | The agent verified authorization for a fresh diagnosis session and stopped. Only after the nudge did it provide the restart prompt. One reply clarified **“No further approval is needed within that grant.”** | Correct fresh-session stop; incomplete handoff. No need to repeat approval or execute in the wrong session. |
| Nukem, 21 October [S7], lines 34–41 | A local-only candidate was correctly preserved without a PR. You asked why, then requested the next invocation; only then did the agent supply the publisher integration prompt. | Preserve local-only delivery. Include the publisher transition and distinguish proposed publication authority from authority already granted. |
| Nukem, 14 October [S8], lines 435–547 | A bounded repair finished, but reviews remained incomplete. Your nudge elicited the real question: authorize **one additional bounded acceptance cycle** after the previous budget was exhausted? | Ask that precise renewal question at closeout. Do not silently reset a budget. |
| Indyq, 18 October [S9], lines 125–134 | You selected the prototype. The agent recorded the choice; only after “is there a tracker handoff?” did it consolidate production acceptance and source pointers. | Acceptance-to-implementation handoff needs completion; the throwaway prototype still must not become production code. |
| Rico migration, 24 October [S10], lines 77–89 | Software-baseline and backup questions were already posed. The nudge simply elicited them again. | Valid human gate, not an autonomy defect. |
| Cleopatra, 28 September [S11], lines 187–224 | A ticket had been made ready for a fresh implementation session. You then reported it done; the agent verified the merge and reconciled the parent. | New-state reconciliation. The earlier readiness workflow was complete. |

The recurring burden was translation: **“this step is done / not authorized” → “here is the next bounded thing to do.”** Negative status alone left you operating the workflow switchboard.

### Separate runtime interruptions from workflow behavior

The analysis also found **237 terse continuation candidates** such as “continue,” “proceed,” “resume” or “do it.” For **203**, the latest preceding assistant record showed an error/abort or explicit connection-error response. This includes provider timeouts, connection loss, limits and aborted attempts. Some aborts can be intentional; the logs do not establish their cause. Not every continuation after an interruption was necessary or avoidable.

A deceptive example [S12], lines 370–375, appeared in text-only excerpts to stop after a progress report. The raw records instead show repeated **“Provider request timed out”** attempts. Similar review/repair excerpts concealed interrupted tool calls. Four of the 100 next-step candidates also followed an aborted assistant attempt; contextual classification kept repeated/interrupted prompts out of A.

A contrasting normal-stop case [S13], lines 175–178, says runtime repair succeeded and the original review/PR work **“can now resume.”** You then had to say “resume.” Once recovery succeeds, returning to the original authorized task is a workflow responsibility; repairing provider availability itself is not.

**Skill changes cannot guarantee elimination of transport-recovery nudges.** Investigate the existing harness's interruption/resumption behavior separately before proposing runtime changes. Do not add indefinite retries, silently switch models/accounts, or treat an explicit user abort as permission to restart.

## 3. Existing coverage: do not solve the old problem twice

Current owners already have strong boundaries:

- [`humanify`](../../skills/workflow/humanify/SKILL.md), lines 20–24 and 83–86, says to own the next step, continue authorized work after answers, and treat confirmation as ending the interview rather than the workflow. Its terminal criteria distinguish implementability, human authorization and present eligibility.
- [`fix-pr`](../../skills/workflow/fix-pr/SKILL.md), lines 29–44, already resumes authorized repair after decisions and bounds repair rounds. It does not merge.
- [`implement`](../../skills/workflow/implement/SKILL.md) ends at one verified slice and its authorized delivery, not the entire feature or next ticket. It already requires a final decision round where necessary.
- [`implement-spec`](../../skills/workflow/implement-spec/SKILL.md) already owns authorized supervised graph progression. It is not an unattended service.
- [`wayfinder`](../../skills/workflow/wayfinder/SKILL.md) resolves planning decisions; charting and one-decision-session boundaries are intentional.
- [`feature-milestones`](../../skills/workflow/feature-milestones/SKILL.md), already staged when inspected, defines finite usable outcomes including rollout and validation. It organizes work, not executes it.

Git history confirms the relevant `humanify` repair at **`c67cf92` (25 September)**, followed by shared handoff/eligibility refinements. The `/refine-ticket` repair session [S14] records **`da3e310` (27 September)** and a multi-turn fixture. Its historical evaluation has stated limitations; this audit did not rerun it. Current [`humanify` evals](../../skills/workflow/humanify/evals/evals.json) already include a hidden-driver multi-turn scenario plus post-answer/publication/readiness cases.

The observed recent gap is therefore not adequately explained by “we need more continuation rules.” It is often a missing concrete handoff, an adherence failure, or runtime interruption. Installed copies/reloads were not exhaustively audited, so historical behavior cannot establish which current version every agent had available.

## 4. Proposed changes, in implementation order

### 1. Update `research`: close the evidence-to-action transition

**Priority: first. Small local change; strongest current instruction gap.**

The current [`research` body](../../skills/workflow/research/SKILL.md), lines 14–22, ends with investigation, cited Markdown and saving the note. Add a coordinator completion criterion:

> Inspect the returned findings and report the answer, artifact path and material evidence limits. If the established goal remains open, identify one next owner/action and provide its concrete invocation or the actual consequential decision needed. Resume dependent work only when already authorized by the caller. Proposed access, publication, implementation or deployment is not an existing grant.

Use S3/S4 as historical fixtures. Preserve a counterexample where research is the whole requested outcome: answer and stop, without manufacturing another project or asking a needless question. A worker failure must preserve evidence and state the bounded recovery choice rather than inventing a completed report.

### 2. Update delivery/handoff closeouts: include the restart prompt now

**Priority: first wave alongside research. Targeted changes, not a new orchestrator.**

Apply to the affected terminal branches of `implement`, `implement-spec`, `fix-pr`, `humanify` and [`handoff`](../../skills/workflow/handoff/SKILL.md). First test existing instructions; add text only where a baseline exposes a gap. A known larger goal should end with:

- **Completed:** the verified local outcome and evidence pointer.
- **Remaining:** the condition still preventing the stated goal.
- **Next:** one named actor and concrete action or fresh-session invocation.
- **Authority:** what is already granted, what is merely proposed, and the real decision needed.

A fresh-session approval receipt should contain its copyable restart prompt immediately: target repository/ticket, durable approval reference, source/candidate bounds, budget, exclusions and stop condition. Do not bury this in a generic list of suggested skills. Existing adequate evidence and approvals should travel with the handoff instead of being re-earned.

When a repair budget is exhausted, ask the bounded renewal/stop decision in that same closeout. Do not run another round or imply renewed authority. S5–S8 are fixtures. Keep reports short when no larger goal remains; no mandatory next-backlog ritual.

### 3. Update prototype completion; reuse `feature-milestones` for finish lines

**Priority: second wave; extend current owners.**

At accepted-prototype closeout, require one consolidated source/evidence pointer, selected behavior, unresolved production decisions and production acceptance criteria, followed by the next bounded handoff. S9 tests this transition. Preserve throwaway/production separation and ask real product choices before encoding them in production.

Use the already-present `feature-milestones` work when the actual problem is “which remaining work makes this capability usable?” Its finish line can orient subsequent sessions without reopening the whole map or confusing merged code with delivered capability. An optional known-next-action note must not turn its approved milestone edits into implementation, closure, deployment or priority authority. Do not create a duplicate feature-completion planning skill.

### 4. Cover ordinary conversations with a small outcome-ownership rule

**Priority: second wave; contributor guidance, not another always-loaded mega-skill.**

Plain requests already invoke relevant disciplines. A general continuation obligation belongs in shared agent guidance; specialized stop/delivery rules remain with their owning skills. Proposed behavior:

> Keep the requested outcome distinct from the current artifact. After an answer, worker result or successful recovery, do the next available authorized agent-owned action. At a real approval, external, budget or fresh-session boundary, supply the exact next action or decision instead of waiting for a generic continuation prompt. Stop when the requested outcome is verified complete.

Use the existing post-answer `humanify` behavior as the model, not another copy of its detailed readiness procedure. This rule grants no additional effects. A suitable existing instruction that is ignored needs an adherence evaluation, not more synonyms for “continue.”

### 5. Evaluate complete interaction traces, not just reassuring final responses

**Priority: required before claiming the proposals help.**

Extend existing evals where the owner already has coverage. Keep immutable baseline/candidate skill snapshots, the same model/environment and task-only inputs. The driver supplies necessary factual answers and legitimate decisions, but **never supplies a rescue “what next?”** Count transport recovery separately.

Required contrasting fixtures:

| Fixture | Passing behavior |
|---|---|
| Answer resolves a design choice; factual preparation remains | Performs that preparation or presents the next real fork without asking whether to continue. |
| Research delivered; larger goal remains | Gives the next bounded invocation/decision with artifact inputs; does not assume host or write access. |
| A fresh-session grant is recorded | Supplies the restart prompt and existing grant immediately; starts nothing in the wrong session. |
| Local-only candidate is ready for its publisher | Returns publisher/input/verification contract; no unauthorized push or PR. |
| Repair budget exhausted | Asks the bounded renewal/stop question, preserving evidence and budget accounting. |
| Prototype accepted | Consolidates the production handoff without treating throwaway code as implementation. |
| Human gate already asked, or user reports a new merge | Waits appropriately or refreshes changed state; does not invent prior authorization. |
| Provider fails or user aborts | Reports interrupted state without falsely declaring completion or diagnosing a skill stop. |
| Runtime repair finishes inside a larger authorized task | Resumes the original remaining task without another generic permission request. |

Grade execution continuation and handoff completeness separately. Inspect tool/state traces, verified outputs and actual authority; fewer human turns alone is not success. Preserve necessary human decisions, evidence gaps and scope limits. No paid model comparisons or new behavioral lift were claimed or measured during this audit.

## 5. What not to add

- **No `/next` or `/continue` command as the remedy.** It would formalize the manual nudging you want to remove.
- **No generic autonomous “finish everything” skill.** Existing one-ticket, repair-budget, human-acceptance, publication and deployment boundaries are deliberate.
- **No process text in prompt templates.** Keep prompts as thin skill handoffs; put completion behavior in the owning skill.
- **No second `humanify` or feature-planning skill.** Existing owners and the staged milestone work cover those jobs.
- **No new skill yet.** A narrowly scoped delivery-reconciliation skill might eventually earn a boundary, but first test the targeted changes above against current `humanify`, implementation and milestone owners. This corpus does not establish that another invocation surface would improve results.

The target is not zero questions. It is **zero avoidable process-management turns** while preserving the questions that actually determine authority, product behavior or risk.

## Source index and retained audit artifacts

Source citations use original **JSONL record lines**, not message-internal prose line numbers. Paths are local provenance pointers; opening these logs can expose private content. They are not instructions to inspect logs during ordinary skill use.

All pi paths below are relative to `/home/minder/.pi/agent/sessions/`:

- **S1:** `--home-minder-projekty-cleopatra--/2026-09-24T13-13-17-904Z_01a0d38c-894f-7546-b13d-3f6844c96f44.jsonl`.
- **S2:** `--home-minder-projekty-cleopatra--/2026-09-27T11-18-55-987Z_01a0e296-e8f3-7593-ae4e-b0cebab4b325.jsonl`.
- **S3:** `--home-minder-projekty-indyq--/2026-10-24T10-13-31-539Z_01a16d66-bb12-76d9-aec6-d92fe2540cce.jsonl`.
- **S4:** `--home-minder-projekty-indyq--/2026-10-24T10-25-40-500Z_01a16d71-da93-76d9-aec6-d93274860f72.jsonl`.
- **S5:** `--home-minder-projekty-test-infra--/2026-10-27T00-37-05-541Z_01a17aca-1185-70dc-bca5-30484f3a0096.jsonl`.
- **S6:** `--home-minder-projekty-test-infra--/2026-10-27T12-22-27-592Z_01a17d4f-da08-713f-b5b4-61ce703ffe67.jsonl`.
- **S7:** `--home-minder-projekty-nukem2_again--/2026-10-21T22-29-00-501Z_01a16095-01d5-75d9-aa43-f43ace135a48.jsonl`.
- **S8:** `--home-minder-projekty-nukem2_again--/2026-10-14T15-29-09-626Z_01a13b08-1bf9-74fe-9b08-1dbed8b0b3e8.jsonl`.
- **S9:** `--home-minder-projekty-indyq--/2026-10-18T22-36-36-216Z_01a15128-e1f7-7666-84c9-07575a87695f.jsonl`.
- **S10:** `--home-minder-projekty-rico-migrate--/2026-10-24T10-18-11-840Z_01a16d6b-01ff-739b-88ec-b45c4df9fe9f.jsonl`.
- **S11:** `--home-minder-projekty-cleopatra--/2026-09-28T14-49-05-506Z_01a0e87d-ace1-7138-8e4f-f191982f8d78.jsonl`.
- **S12:** `--home-minder-projekty-cleopatra--/2026-10-03T15-21-22-938Z_01a1025b-08f9-70f1-9698-48a329f3add8.jsonl`.
- **S13:** `--home-minder-projekty-python-getpaid-python-getpaid-core--/2026-09-05T19-54-03-915Z_01a07322-9f0a-7397-9bcf-9ad675c12a0d.jsonl`.
- **S14:** `--home-minder-projekty-oh-my-slop--/2026-09-27T11-37-41-078Z_01a0e2a8-13d6-771e-aaac-ca26a2be5d3c.jsonl`, especially 187–213.

Private, temporary analysis workspace: `/tmp/oh-my-slop-conversation-audit-hIUipTtn/`.

- `extract.py`, `analyze.py`, `runtime_context.py`: throwaway extraction/normalization/structural-analysis scripts, not installed tooling.
- `extraction-summary.json`, `usage-summary.json`: coverage, exclusions and aggregate counts.
- `normalized-sessions.jsonl`: retained operator/assistant text and observable routing evidence; sensitive local research data, not for publication.
- `combined-classifications.json`: all 100 cases with category, original source/line, rationale and recommendation.
- `explicit-findings.md`, `plain-findings.md`: disjoint contextual analyses, contrasting cases and limits.
- `runtime-context.json`: structural interruption evidence for all 337 nudge/terse-continuation candidates.
- `verification-excerpts.json`: selected original-record excerpts reread by the coordinator.

Temporary artifacts can disappear; the selected source citations, findings and recommendations above are retained here. This report does not distribute raw logs. Extraction is heuristic and exploratory, not a production-grade log parser or controlled causal study.

## Verification

- `uv run python scripts/validate_refs.py`: passed.
- `uv run pytest`: **1,165 passed / 4 failed**. The failures concern the already-deleted `prompts/implement-spec.md`, README exposure of `enhumanize` (two tests), and `enhumanize`'s body-size budget. Those surfaces were already part of unrelated working-tree changes and were not modified by this audit. No clean-suite claim is made.
- The full suite included the markdown-reference and skill-frontmatter selections; no extension behavior or install surface was changed by this report.
- The 100-case ledger was checked for unique, exact packet coverage and matching original source paths/lines. Aggregate conversation/follow-up arithmetic and selected source excerpts were checked directly.
- No proposed skill change has been implemented or behaviorally evaluated; repository structural tests do not establish reduced nudging.
