# pstack versus oh-my-slop: comparative analysis and adoption plan

25 October 2026 · Source survey · Proposals only

## Verdict

**Adopt pstack's evidence-producing techniques, not its operating policy.** Its strongest contribution is the connection between understanding code, shaping interfaces, exercising the real product and making the evidence reviewable. Our strongest contribution is the connection between scoped human decisions, executable briefs, protected work, independent review and authorized delivery.

Those are complementary strengths. Replacing our workflows with `poteto-mode` would discard useful contracts. Adding all its principles as separate skills would mostly duplicate existing owners. The useful unit of adoption is usually a small reference, branch or evidence obligation inside a skill we already have.

The claim that pstack is “one of the best” is motivation for inspection, not an established ranking. This survey assesses source contracts and implementation surfaces. It does not compare model success rates, cost or production reliability, and does not establish superiority over mattpocock's set. Our relationship to that set is already documented in the [September source survey](mattpocock-skills-sync-2026-09-29.md); this is a comparison against our **current tree**, not an assumption that we still match upstream.

### Recommended order

| Priority | Candidate | Default destination | Decision |
| --- | --- | --- | --- |
| 1 | Project-specific runtime verification contracts and feature maps | `testing-workflow` / `webapp-testing`, with project-local artifacts | **Adapt first** |
| 2 | Executable blast-radius analysis | `codebase-design`, consumed by implementation/review | **Adapt** |
| 3 | Benchmark validity and measurement calibration | `construction-craft` performance reference | **Adapt** |
| 4 | Shared-premise escalation after repeated failed fixes | `diagnosing-bugs` | **Adapt a narrow recovery branch** |
| 5 | Design-selection criteria and base/graft provenance | Existing `design-it-twice` reference | **Adapt selectively** |
| 6 | Code explanation with a separate historical-evidence track | `research` reference; explanation entry point only if needed | **Pilot** |
| 7 | Coverage receipts, decision trails and returning-human catch-up | Existing coordinator, handoff and presentation owners | **Adapt selectively** |
| 8 | One-property formal verification, with drift maintenance | New opt-in boundary only after a useful pilot | **Defer broad port; pilot narrowly** |
| 9 | Situation-based help that recommends without executing | README/onboarding first | **Adopt the navigation pattern** |
| 10 | Other principle refinements and retrospective lenses | Existing practice/meta skills | **Only against a demonstrated gap** |

Priorities and effort below are analyst judgments, not measured gains. No skill change, installation, automation activation or behavioral trial is authorized by this report.

## Evidence and scope

### Inspected baseline

- pstack: local `../cudze/cursor-plugins/pstack/`, in `cursor/plugins` commit **`99b609a72323b70204eab407c622f436e858e112`**. The pstack subtree had no reported working-tree changes. Both plugin manifests report version **0.15.32**. Upstream citations below use that immutable commit, not moving `main` links. [P25]
- oh-my-slop: **`de4f9e2412907f1fd5d2f569ad090259ec9efe7c`**, plus the existing working-tree deletion of `prompts/implement-spec.md`. That deletion was present before research and was left untouched. Local links are navigable working-tree references, not immutable claims about future revisions.
- Research covered the top-level skill bodies through divided reading, all 23 mode playbooks, relevant disclosed references, both agents, manifests, the Claude adapter and the dormant Benny pack. Script inspection was selective; this was not an exhaustive code/security audit. The main pass independently checked the principal adoption mechanisms and policy conflicts.
- No upstream helpers, bootstrap commands, installers, automation services, external model trials or forge mutations were executed. Source instructions were treated as evidence, not followed. No live web search was necessary for the local-source comparison.
- Public permalinks locate the inspected source; this survey did not separately fetch them to verify HTTP availability.

### Inventory, not a quality score

| Surface | pstack | oh-my-slop |
| --- | --- | --- |
| Top-level/installable skill roots | 58 under `pstack/skills/` | 71 across the four buckets |
| Manual-only declarations | 57 | 16 |
| Specialized principle leaves | 24 of the 58 | Practices grouped into existing discipline/reference boundaries |
| Main workflow organization | Personal mode, 23 playbooks, routed subordinate skills | 30 workflow, 20 practice, 16 reference and 5 meta skills |
| Skill-body lines, including frontmatter | 2,380 | 9,436 |
| Evaluation-definition files at owning-root `evals/evals.json` | None found under the inspected pstack subtree | 52 |
| Other verification assets | Script tests, an evaluation playbook, review/measurement procedures | Repository regression tests, skill eval definitions and evaluation tooling |

The three skills under Benny's automation subtree are **not** part of the 58 top-level skills. Our two nested skill-creator fixture bodies are **not** additional installed roots. Counts are reproducible with `Path('skills').glob('*/*/SKILL.md')` locally and `Path('pstack/skills').glob('*/SKILL.md')` upstream; manual-only counts match the exact frontmatter line `disable-model-invocation: true`.

Line totals exclude references, playbooks, agents and scripts, so they do **not** measure full execution context or runtime token cost. Absence of a particular eval-file convention is not proof of no evaluation. Conversely, our eval definitions and structural tests are not proof that our agents perform better. [P1] [P2] [L1]

Our greater detail also has a visible cost: `diagnosing-bugs/SKILL.md` is 592 lines and `council/SKILL.md` is 511, while our current authoring standard asks for skill bodies below 500 lines. These are candidates for evidence-led disclosure, not permission for a cleanup in this task. Their size does not establish behavioral failure, but we should not mistake accumulation for depth. [L1]

## What differs in substance

### 1. A routed mode versus a discoverable library

pstack asks the user to invoke one mode. That mode carries the routing rules, an inline principles index and playbooks; the delegate wrapper reloads that operating context. This makes a large toolkit approachable through one habitual entry point. Most subordinate skills are manual-only, so the mode is important to reaching them. [P2] [P3]

Our library makes many practices and references model-discoverable and keeps manual workflows behind explicit entry points. Project setup supplies tracker/domain routing; prompt templates forward arguments rather than becoming secondary process documents. This is more composable across repositories and stacks, but places more navigation work on descriptions, project instructions and the human. [L1] [L2]

**Lesson:** improve situation-based navigation. Do not add a second universal controller with overlapping authority. A routing index should contain conditions and pointers, not another normative copy of every rule.

There is a concrete maintenance trap in pstack: some principle files put substantive behavior in the description while their bodies are near-stubs; the mode also repeats operational summaries inline. For example, context-window delegation appears in both the description and mode index, while the leaf body mainly specifies phase/scope budgets. A port must inspect frontmatter, index and body together. Our model-invocation choice should determine discovery, not silently determine whether an essential rule survives extraction. [P2] [P4]

### 2. Engineering depth versus work governance

pstack pushes code comprehension, caller-facing design and real-surface proof into the ordinary engineering loop. Its README explicitly declines a default planning-skills layer and leans on Cursor's plan mode and code. Our planning/implementation chain deliberately distinguishes decision, specification, ticket sufficiency, readiness authorization, execution eligibility, candidate review, publication and human acceptance. [P1] [L3]

Neither “less planning” nor “more explicit gates” wins universally. An isolated technical change benefits from pstack's direct path. A multi-session project with external effects benefits from our stronger ownership and authority model. Port the technical depth into a sufficient brief; do not make every small change pass through a new planning ceremony or remove existing gates because code is reversible.

### 3. Verification reach versus verification authority

pstack's generated verification skills and feature maps make app behavior directly exercisable. Its formal-verification family reaches cases ordinary examples may miss. Its blast-radius procedure turns a reassuring assumption into a check. These are the most promising capability transfers. [P5] [P6] [P7]

Our current strengths are TDD, test-tier selection, ad-hoc browser evidence, exact-candidate review and evidence-bound delivery. Those answer different questions: **what ran, what does it prove, and which candidate may be delivered?** More runtime evidence should strengthen these contracts, not substitute for them. [L4] [L5] [L6]

### 4. Concision versus complete contracts

pstack often expresses a memorable behavioral intervention in a few lines. `sharpen`, for example, asks for deeper methods, rawer evidence and an outside check without enlarging scope. Several of our skills already own the corresponding behavior, but are much longer. That is a reason to test local disclosure and placement, not evidence that every shorter source is better. [P8] [L1]

Its compactness also relies on the mode, references, companion plugin and host features. `control-cli`, `control-ui` and `deslop` are not bundled in pstack; the README names `cursor-team-kit` as their owner. Copying a leaf does not bring those capabilities with it. [P1]

### 5. Shared names conceal different contracts

pstack's `tdd` is principally a bug-fix technique with an obvious, cheap local test path. It explicitly permits skipping a new test when the path is unclear, expensive or integration-heavy. Ours is a mandatory discipline for implementation, with three narrow exceptions and a diagnosis route when a reproducing test is missing. Retain our contract; borrow concrete fail-before/pass-after evidence, not the broader waiver. [P34] [L16]

Our framework references are also a distinct product surface: Django/allauth/DRF, HTMX, Tabler, Docker, async Python and other API guidance sit alongside workflows. pstack concentrates more on general engineering techniques and TypeScript-specific guidance. Its language-independent verification ideas are still portable; neither skill count nor framework breadth measures the quality of its engineering loop.

## Adoption candidates in detail

### 1. Generate and maintain a project-local verification contract

**What to take.** `create-verification-skill` builds a project-specific way to exercise behavior, backed by a user-facing feature map. Its maintenance partner treats source inspection and live verification as distinct work. Benny adds declared control capabilities and a particularly useful existing-fix branch: verify a concrete PR/commit rather than authoring a competing patch. [P5] [P9]

**What we already have.** `testing-workflow` owns execution/tier policy; `webapp-testing` owns ad-hoc browser evidence; TDD owns regression construction. The gap is not “we lack testing.” It is a reusable project-specific bridge from a feature or symptom to setup, real actions, observation and cleanup. [L4] [L5]

**Adaptation.** Start with one project-local verification reference or script, not four new global skills. Record feature identity, fixtures, supported control surface, exact action path, discriminating state, evidence location, candidate/environment identity and resource ownership. Retain the useful launch/doctor/drive/evidence/cleanup separation: reach a usable empty-state instance, confirm the build/auth/port really belong to the run, exercise actions and side effects, stop only owned resources, and verify that cleanup leaves proof artifacts intact. Mark unsupported capabilities honestly. Generation proves one feature, not every seeded map entry: mark the remaining entries unverified, and report maintenance coverage at the feature/entry-point granularity actually exercised. Keep feature coverage stable enough to survive implementation renames; derive cheap facts rather than duplicating configuration.

Keep creation and drift maintenance as explicit branches of the same owner unless independent invocation proves useful. A global generator skill can come later if two projects show the same recurring need. Preserve targeted E2E policy, installation consent and resource lifecycle rules. A CLI feature needs a CLI adapter, not a fabricated browser flow.

**Existing-fix variation.** Require baseline and patched revisions under equivalent inputs. Confirm the symptom before claiming its disappearance. Upstream's two baseline and two patched repetitions are a useful minimum protocol, not a statistical guarantee for intermittent bugs. No baseline, unbuildable candidate or missing discriminator means **inconclusive**, not fixed. Keep publication, issue-state changes and cleanup separately authorized. [P9]

**Acceptance experiment.** Use one persistence/restart flow, one CLI or browser interaction, and one unavailable capability. The candidate must produce rerunnable evidence for the supported flows, reject a screenshot-only proxy, detect a stale feature map and report the missing capability without installing tools or claiming success.

**Effort:** medium for one project; larger for a cross-platform generator. **Expected value:** high, pending a paired trial.

### 2. Turn blast-radius assertions into executable evidence

**What to take.** A small diff is not necessarily a small behavioral change. Trace the consumers and prove the particular fact on which the safety argument depends. [P6]

**What we already have.** `to-tickets` inspects impact surfaces and ordering; `codebase-design` owns interfaces and seams; reviews inspect the actual change. Do not add a rival definition of impact surface or a mandatory extra review axis. [L3] [L7]

**Adaptation.** Add a bounded reference to `codebase-design`, reached when a change relies on a shared default, fallback, representation, parser rule or apparently unreachable state. The result should identify the changed fact, direct/indirect consumers, the safety premise, its executable discriminator and uncovered consumers. A proof about one layer must not silently certify every caller.

Inspection-only requests remain inspection-only: propose the probe if running code would exceed scope. `implement` can execute it when already authorized, while `pr` can present its evidence. Avoid making code execution a precondition for an ordinary source explanation.

**Acceptance experiment.** Give baseline and candidate a tiny shared-default change and a serialization change with an overlooked consumer. Require the candidate to find the affected consumer and falsify the original safety premise. Include a genuinely local change so it does not manufacture an expensive audit every time.

**Effort:** small/medium. **Expected value:** high for deceptive small changes.

### 3. Audit the number before optimizing it

**What to take.** `benchmark-checklist` and “Explain the Number” insist on a measured limiter, comparable treatment, repeat runs/spread, work and error counts, and relevance to the actual complaint. Hillclimb first proves the instrument can distinguish contrasting workloads, then freezes it before optimization. [P10] [P26]

**What we already have.** `construction-craft` already requires target, repeatable baseline, measured bottleneck, one changed variable and comparable remeasurement. `skill-creator` already protects baseline/candidate conditions. The incremental value is stronger **instrument validity**, not another generic “measure first” rule. [L8] [L1]

**Adaptation.** Extend the existing performance reference with a short validity checklist: what bounds the result; whether each arm completed equivalent work; errors/cache/skips; run count and spread; load-generator or environment bottlenecks; and end-to-end relevance. Require a sensitivity check before freezing a new harness. Apply the corresponding trial-completeness questions to skill evals without pretending model behavior always has a single hardware-style limiter.

Do not import minimum iteration quotas, unlimited plateau chasing, automatic model delegation or destructive rejection/reset mechanics. Use a bounded experiment budget and preserve unrelated changes.

**Acceptance experiment.** Supply a false speedup caused by skipped work, a warm-cache asymmetry and a load-generator ceiling, plus one real improvement. The candidate should reject the three misleading claims and retain the valid one with uncertainty, not reject all benchmarks indiscriminately.

A measured timing difference can be real even when its cause is not yet attributed. Separate that observation from a causal speedup claim or an adoption recommendation; do not turn “name the limiter” into a prohibition on reporting honest bounded observations. Five alternating runs are a useful starting heuristic, not automatic statistical sufficiency.

**Effort:** small for the reference; medium for useful fixtures. **Expected value:** high when performance claims drive decisions.

### 4. Test the shared premise before trying a third fix

**What to take.** “Attack the Premise” gives a precise recovery trigger: two fixes assume the same fact and fail the same gate; write down that fact and make a discriminating observation before another fix assumes it. [P35]

**What we already have.** `diagnosing-bugs` already requires discriminating experiments, confirmed/refuted/inconclusive outcomes, failed-fix feedback and escalation after about three refuted hypotheses. Its body and feedback-loop reference do not contain this earlier shared-premise trigger. This is a narrow addition, not a missing debugging method. [L18]

**Adaptation.** Add the branch beside Phase 3's escalation rule. Distinguish failed fixes from hypotheses and infrastructure failures. Require evidence that the fixes really share a premise, then test it directly; preserve the permanent regression and existing human-escalation boundary. A disproved premise does not authorize a broader rewrite.

**Acceptance experiment.** Two cache fixes fail because requests reach a different process. Require a process-identity probe before a third cache change. Include unrelated failures as a control: the agent must not invent a shared cause merely because two commands failed.

**Effort:** small. **Expected value:** a concrete, cheap intervention against repeated patching, pending behavioral comparison.

### 5. Improve design selection rather than adding another architect

**What to take.** `architect` makes the usage, data shape and module interface explicit before implementation; competing designs expose trade-offs rather than decorating a preferred answer. `arena` supplies a best-of/grafting pattern. [P11]

**What we already have.** Our `design-it-twice` reference already generates three or more distinct interfaces under different constraints, requires usage examples, compares depth/locality/seams and recommends a hybrid when useful. `construction-craft`, `prototype` and the architecture workflow also cover data, experiments and design alternatives. Alternative design itself is not a gap. [L7] [L8] [L9] [L19]

**Adaptation.** Test the narrower arena additions: explicit task-specific criteria, a named selected base, the source of each incorporated contribution, rejected ideas and their reasons, dropouts and final verification. Caller-first sketching is a possible ordering refinement, not a new capability. Optional independent judgment can help a novel boundary; it is not justified for every function crossing. Agreement between models is correlated evidence, not proof. [P36]

Keep scope/fidelity inherited from the caller. Architecture proposes a shape; it does not authorize implementation. Reuse an accepted interface instead of reopening it on every slice. Do not require pstack's parallel design panel or fixed model roles by default.

**Acceptance experiment.** Give candidates different useful strengths, with the most polished violating an existing contract. Compare the current local protocol with explicit criterion/base/graft reporting. Require coherent synthesis, rejection of the invalid candidate and no reopening of an already-settled interface.

**Effort:** small for reporting refinements; medium if a separately budgeted cross-judge proves useful.

### 6. Separate “how it works” from “why it became this way”

**What to take.** `how` builds an execution/model explanation; `why` investigates historical rationale and calibrates confidence. Their composition in `teach` preserves historical uncertainty rather than smoothing it away for readability. [P12] [P27]

**What we already have.** `research` requires cited primary-source findings. `git-discipline` already calls for history/blame in unfamiliar code. Our `teach` is a multi-session learning workspace, **not** pstack's one-off subsystem explanation. Matching names do not imply interchangeable boundaries. [L10] [L13] [L17]

**Adaptation.** Pilot a `research` reference separating observed execution from historical intent. Start with code, tests and the relevant history; consult only authorized linked issues/docs. Return an executable or source-grounded flow, competing explanations, confirmed rationale, plausible inference and unavailable evidence. Keep artifact citations and uncertainty attached to the claim.

Do not import automatic Slack/Notion/observability/warehouse sweeps or arbitrary archive searches. A service being available is not permission to read everything. Consider a separate explanation skill only if one-off walkthroughs recur and the research output boundary proves unsuitable. Preserve the existing `teach` name and behavior.

**Acceptance experiment.** Use a stale rationale document, a commit that contradicts an attractive origin story, and an unavailable referenced discussion. Require a useful mechanism explanation without inventing historical intent or broadening read permissions.

**Effort:** medium. **Expected value:** good for unfamiliar code and review onboarding.

### 7. Make parallel coverage and human catch-up explicit

There are three related but different transfers:

1. **Coverage receipts.** `swarm` distinguishes partitions, races and best-of selection. Required slices need terminal evidence; a missing lane is a gap, not a pass. Results missing the requested SHA/method are rejected rather than silently aggregated. Add this compact obligation to existing multi-agent callers where it is not already explicit. Retain their concurrency/resource budgets and independent-evidence rules. A race loser is not a missing required coverage slice. [P13] [L6]
2. **Decision trail.** `show-me-your-work` logs meaningful forks, rejected approaches, evidence pointers and results, then checks the trail against the selected transcript. An append-only correction is better than rewriting the story. Use an optional run-local artifact, one writer, redacted content and source references. Do not add a mandatory ledger to every small ticket or require another model family just to format it. Its helper neutralizes spreadsheet formula prefixes, but that formatting is not tamper resistance or proof validation. [P14]
3. **Returning-human catch-up.** `ketchup` answers what changed since the human's last actual message, what remains incomplete and what genuinely needs their decision. Our `handoff` prepares a fresh agent; it is not exactly this artifact. Adapt the bounded catch-up behavior, with `grilling` still owning every decision request. No new app runs, publication or paid work should be started merely to make a status response prettier. [P15] [L11] [L12]

**Acceptance experiment.** Drop a required coverage worker; supply one stale-head result; include a decision made but omitted from a trail; and return a human to several already-settled decisions plus one genuine open call. The result must preserve gaps, reject stale certification, recover the real pivot and ask only the unresolved scoped question.

**Effort:** small per existing owner. **Expected value:** moderate/high for longer sessions, low for trivial changes.

### 8. Pilot one-property formal verification, not a general proof platform

pstack supplies creation, maintenance and statechart workflows rather than treating a generated model as permanent truth. That is a distinct capability worth investigating for retries, concurrency and lifecycle invariants beyond ordinary example tests. [P7] [P28]

A safe first adoption should select **one concrete invariant** from a current project, a fitting checker, a bounded model and an implementation-to-model mapping. Preserve the counterexample, the limits of the explored state space, covered files/functions, the last confirmed synchronization point and a rerunnable command. Record dirty-tree content as well as HEAD: a commit alone does not identify uncommitted code. Include moved code and new writers in drift inspection. Change the implementation and verify that drift is detected; deliberately break the invariant and verify the checker catches it. Keep blocked checks' synchronization points unchanged.

A model passing does not prove the running application implements the model. A statechart is an explanatory projection, not automatically the authoritative spec. Do not add TLA+, tool downloads, generators or their runtime dependencies to this package merely because the upstream helper exists. Any code port needs dependency/license review, local tests and a separate authorized implementation slice.

The bundled `statechart` is a substantial toolchain, not just a prompt: it imports JavaScript mappings as executable code, can install TLC/Java through `mise`, and publishes generated output directories. Adopting it needs separate input-trust, install-consent and occupied-output protection. Begin with the synchronization/mutation protocol before deciding whether diagram generation earns that dependency surface. This is a source-derived port concern, not a demonstrated exploit. [P37] [P40]

**Acceptance experiment.** Use a duplicate/reordered retry or lease-expiry case with a real counterexample; pair it with a model that omits the faulty transition. Require the candidate to expose the omission rather than announce a proof of application correctness.

**Effort:** large relative to a prose adaptation. **Expected value:** potentially high for the right invariant; low for routine CRUD. Broad adoption remains deferred.

### 9. Improve navigation without starting another workflow

`poteto-help` answers the question, reads the owning source and hands back a usable prompt. It explicitly distinguishes help from permission to spend tokens on the work. That is a good product boundary. [P16]

Start by adding a compact situation-to-owner guide to our README: understand unfamiliar code; investigate a bug; settle a decision; build one slice; supervise a graph; inspect a change; return after stepping away. Link current owners and their limits. Add a manual help router only if the guide proves insufficient. Keep process out of prompt templates and preserve public names. [L2] [L3]

**Acceptance experiment.** Ask which workflow fits a question. The candidate should recommend the correct existing owner without launching workers, publishing tickets or claiming a manual-only skill is unavailable merely because it was absent from the model catalog.

**Effort:** small. **Expected value:** immediate usability, not demonstrated runtime correctness.

### 10. Retain narrow review, writing and reference refinements

- **Review filtering:** `interrogate`'s lead asks whether the alleged bad input can reach the code and distinguishes a concrete failure from “I would write it differently.” Apply that scrutiny inside each local review axis if a baseline shows false positives. Preserve independent spec/standards findings and their severity; do not replace them with one merged, reranked verdict or dismiss a lone security finding because other models missed it. [P38]
- **Retrospective routing:** `reflect` distinguishes a missing instruction from a missed trigger, reads the destination before adding prose and sends mechanical rules toward enforcement. These are useful lenses, but `retro` and `skill-creator` already own most of the work. Improve placement, triggering or wiring instead of duplicating clear rules. Keep the existing proposal-only boundary. [P21] [L1] [L15]
- **Language reference:** TypeScript discriminants, branded identifiers, schema-derived types and exhaustiveness checks may earn a dedicated reference if repeated extension work needs one. Verify examples before copying: the inspected time-range example claims that `durationMs: number` prevents a negative range, but `number` permits negative and non-finite values. Retain boundary validation or a validated semantic type. This is a concrete source error, not a reason to discard the entire reference. [P39]
- **Writing:** prefer pstack's specific clarity examples over wholesale punctuation bans or a renamed `unslop` layer. We already own plain language, evidence integrity, agent-facing prose and documentation lifecycle. Keep epistemic uncertainty and the project's defined terminology even when a style rule wants them removed.

These are low-priority, gap-driven adaptations, not four new skills. Use a reachable/non-reachable review pair, a missed-trigger versus already-covered retrospective pair and compile/runtime TypeScript cases as discriminating evaluations.

## What not to import

| Upstream default or surface | Concrete conflict or cost | Local decision |
| --- | --- | --- |
| Mode autonomy for team chat, ticket updates and starting evals | “Reversible” is not scoped permission for external effects or spending | Keep effect-specific grants and `grilling`; useful autonomy stays inside the approved scope. [P2] [L12] |
| Hard-reset recovery between delegates; treating untracked changes as disposable scratch | Can permanently lose uncommitted/untracked work; branch refs cannot recover those bytes | Do not port. Preserve occupied worktrees and require explicit destructive-action requests with recovery prerequisites. No such command was run here. [P17] [P29] [L13] |
| Published-history rewrites and automatic stack shipping | Mechanical lease protection is not human authorization; delivery topology differs | Preserve additive repair and the caller's publication/merge boundary. [P17] [L6] |
| GitHub/Origin CLI fallback | Our configured Gitea agent tracker and GitHub intake split are authoritative | Route by project configuration, never whichever forge CLI happens to exist. [P17] [L2] |
| Orchestrate/Autopilot and persistent orchestration store | Introduces a durable controller this package deliberately does not own | Do not recreate Factory. Preserve the external Cleopatra boundary; assume no integration API. [P31] [L14] |
| Fixed ten-lane live/performance verification and broad mandatory design panels | Cost and surface do not scale to the change; missing modalities can masquerade as rigor | Keep targeted checks, explicit coverage and resource admission, not a fixed agent count. [P18] [L4] |
| `no-comments` and Comment Sicko's deletion bias | The caller can delete constraint comments even when approval to encode them is withheld | Keep useful intent/constraint comments until an authorized structural replacement exists. Do not import the persona as standards policy. [P19] |
| Boundary discipline's unconditional trust of internal types | Types do not eliminate mutation, broken invariants or incorrectly modeled runtime boundaries | Preserve local distinction between external validation, legitimate business errors and internal assertions/invariants. [P20] [L8] |
| Internal-API deletion and temporary-breakage preferences | Unsafe when external consumers or rollout compatibility exist | Preserve compatibility analysis, expand–contract and verifiable migration units. [P30] [L3] |
| Automatic backlog filing in `reflect` | Approval for proposed skill edits is not authority for tracker writes | Reuse `retro`'s proposal-only contract and selected-session scope. [P21] [L15] |
| Cursor/Bun/model-specific helpers and companion control skills | A translated tool name does not establish capability, entitlement or isolation | Reuse protocol ideas; adapt to actual harness capabilities. Never treat a worktree as VM/service isolation or a collapsed model panel as cross-model diversity. [P1] [P22] |
| Benny and `make-bot-ui` deployment recipes | Dormant automation and webhook/network assumptions are not established local services | Keep them deferred. Any future adoption needs separate scope, credential isolation, routing, threat model and runtime tests. [P9] [P23] |

This is not a claim that pstack has no gates. Its multi-phase plan requires a go-ahead, Babysit separates merge-readiness from merging, and Benny setup is opt-in. The problem is particular incompatible defaults, not the mere existence of autonomy. [P18] [P9]

The watcher/orchestration launchers may bootstrap dependencies inside their script directory. Even a help/status probe is therefore not necessarily read-only. They were not run during this survey. [P32]

## Non-principle skill-family map

These groups account for all 34 non-principle top-level skills. Read the principle table separately; the automation pack is additional, dormant scope. The upstream [skill directory][P33] contains the pinned bodies.

| pstack leaves | Local equivalent or gap | Recommendation |
| --- | --- | --- |
| `poteto-mode`, `poteto-help`, `setup-pstack`, `figure-it-out` | README routing, project setup, bounded workflows; no personal universal mode | Adopt help/navigation and falsifiable bespoke steps, not a competing controller or global model policy. |
| `how`, `why`, `teach` | `research`, history inspection, multi-session `teach`; one-off explanation differs | Pilot mechanism/rationale separation; preserve the local teaching boundary. |
| `architect`, `arena` | `codebase-design`, architecture scan, `prototype`, council/eval comparisons | Adapt selection provenance; keep parallel alternatives optional and budgeted. |
| `blast-radius`, `interrogate` | Impact surfaces, two-axis review, skeptical finding verification | Adapt executable safety premises and report only substantiated findings; preserve distinct review axes. |
| `create-verification-skill`, `maintain-verification-skill` | Test execution and ad-hoc UI evidence; project verification map is the clearest gap | First pilot. |
| `create-formal-verification-skill`, `maintain-formal-verification-skill`, `statechart` | Data/state reasoning exists; no matching dedicated proof lifecycle | One-property opt-in pilot; no wholesale script port. |
| `benchmark-checklist`, `tdd`, `typescript-best-practices` | Existing measurement and stronger local TDD; no dedicated TypeScript reference | Adapt instrument checks; retain TDD; consider TypeScript reference only on demonstrated recurring need. |
| `swarm`, `show-me-your-work` | Existing multi-agent callers and candidate evidence | Transfer coverage/decision receipts, not new scheduling machinery. |
| `correct`, `reflect`, `automate-me` | `retro`, skill-creator, configured rules and persistent-memory controls | Selected evidence and approved evaluated changes, not automatic policy promotion or filing. |
| `recall`, `ketchup`, `ketchup-video`, `bro` | `handoff`, memory, ordinary status responses; returning-human catch-up is distinct | Text-first bounded catch-up; history access stays scoped; defer video. |
| `in-your-own-words`, `sharpen` | Bounded grilling and ordinary intent confirmation | Optional prompt techniques; do not turn restatement into authorization or deeper methods into wider scope. |
| `no-comments`, `unslop`, `technical-writing`, `make-bot-ui` | Comment/design discipline, documentation owners; bot deployment is different infrastructure | Reject deletion bias; borrow precise prose rules selectively; defer the bot recipe. |

## Principle-by-principle transfer map

All 24 principles were read. Most are already owned locally. Treat the following as a deduplication map, not instructions to edit every named skill.

| pstack principle | Existing local home | Disposition |
| --- | --- | --- |
| Attack the Premise | `diagnosing-bugs` | Candidate 4: a concrete earlier shared-premise trigger, alongside existing falsification/escalation. |
| Boundary Discipline | `construction-craft`, `codebase-design` | Covered in substance; reject unconditional internal trust. |
| Build the Lever | `construction-craft`, `skill-creator` | Useful rerunnable-artifact emphasis; do not mandate a new tool for every nontrivial one-off. |
| Encode Lessons in Structure | `retro`, `skill-creator` | Already a local creation/enforcement decision. |
| Exhaust the Design Space | `prototype`, architecture workflow | Existing competing-prototype boundary; no automatic panel. |
| Experience First | `ui-design-direction`, `prototype`, `pr` | Preserve user/maintainer framing without adding another principle skill. |
| Explain the Number | `construction-craft`, `skill-creator` | Candidate 3: concrete validity refinements. |
| Fix Root Causes | `diagnosing-bugs` | Existing owner; keep fixes inside the authorized scope. |
| Foundational Thinking | `construction-craft`, `to-tickets` | Data-first/scaffolding/contracts are already explicit. |
| Guard the Context Window | Existing worker/coordinator briefs | Improve bounded evidence transport only where needed; no extra standalone policy. |
| Laziness Protocol | `ponytail-audit`, `refactoring-pass` | Existing subtraction/minimal-change guidance. |
| Make Operations Idempotent | `data-intensive`, `production-readiness` | Existing retries/reconciliation concerns; specialize to a real failure. |
| Migrate Callers Then Delete Legacy APIs | `refactoring-pass`, `to-tickets` | Only for owned internal APIs; preserve external migration paths. |
| Minimize Reader Load | `codebase-design`, `ponytail-audit` | Two useful review questions: layers to trace, state to retain. Evaluate as wording, not a new metric. |
| Model the Domain | `domain-driven-design`, `construction-craft`, `codebase-design` | Broadly covered; retain lightweight shapes for technical problems. |
| Never Block on the Human | `grilling` plus caller authority | Do discoverable/routine authorized work; do not replace unanswered user decisions with defaults. |
| Outcome-Oriented Execution | `refactoring-pass`, migration briefs | Only explicitly bounded transitional breakage; no weakening of accepted verification gates. |
| Prove It Works | `tdd`, `testing-workflow`, `webapp-testing`, implementation owners | Covered principle; candidates 1–2 add concrete reach. |
| Redesign from First Principles | Architecture workflow, `codebase-design` | Design lens, not permission for a larger rewrite. |
| Separate Before Serializing Shared State | `construction-craft`, runtime owners | Useful explicit isolation-first question; structural enforcement already fits local ownership rules. |
| Sequence Verifiable Units | `tdd`, `refactoring-pass`, `implement-spec` | Already present; reject automatic rebase and failing-only delivery commits. |
| Subtract Before You Add | `ponytail-audit`, `refactoring-pass` | Already present; no unrelated cleanup sweep. |
| Test Behavior, Not Implementation | `tdd`, `testing-workflow` | Useful paired thought experiment: breaks on a behavioral mutation, survives an internal refactor. |
| Type System Discipline | `construction-craft`, `domain-driven-design` | Mostly covered; a TypeScript reference is separate, optional scope. |

Other leaves also largely map to current owners: `correct`/`reflect` to `retro` plus authorized skill evaluation; `unslop`/`technical-writing` to existing prose and documentation guidance; `arena` to optional design/eval comparisons; `bro` to ordinary plain-language reporting. `sharpen` is a compact prompt-depth technique, not a reason to reopen scoped decisions. `recall` adds historical retrieval but must not turn memory into current authority. `ketchup-video` is a presentation expense, not a correctness capability. `automate-me` should not automatically promote observed behavior into standing preferences. [P8] [P15] [P21] [P23] [L1] [L15]

## Implementation sequence and measurement gates

1. **Pick one concrete runtime-verification pilot.** Capture current behavior before modifying skill prose. Reuse an existing project harness if possible; do not begin with a universal generator.
2. **Run separate small adaptations for blast-radius, benchmark validity and the shared-premise trigger.** Keep their ownership distinct. Each needs an observed baseline gap, one narrow candidate and a negative/near-miss case to detect overreach.
3. **Test design-selection provenance and source-grounded explanation only where the current workflow struggles.** A successful baseline is a reason not to add instructions.
4. **Add lightweight coordination/navigation improvements where their cost is justified.** Reuse existing ledgers and briefs rather than creating another store. Catch-up output must preserve settled decisions.
5. **Pilot formal verification separately.** Require a real invariant, counterexample and drift test before proposing a shipped skill or helper port.

For every material skill change, follow the existing [skill-creator](../../skills/meta/skill-creator/SKILL.md) workflow: preserve the old version, use the same task/model/environment, predeclare observable assertions, run baseline and candidate, inspect action traces and artifacts, and leave qualitative assessment to the user. Include pressure cases involving unavailable tools, scope limits and existing user work. Trigger evals are needed when the corresponding discovery policy requires them. Repository tests validate package/reference contracts; they cannot replace behavioral comparison. [L1]

A first adoption tranche should therefore be **three core adaptations plus one small recovery experiment, not a skillset import**: one project verification pilot, one executable-impact reference, one benchmark-validity refinement and the shared-premise branch. Stop or narrow any candidate whose baseline already succeeds or whose evidence does not improve. Proposed evaluations here have **not** run.

## Licensing and packaging

pstack carries **MIT, copyright 2026 Lauren Tan**. Copying scripts or substantial skill text requires preserving its copyright and permission notice. Our root Unlicense does not erase that requirement. Use the existing per-component attribution practice and retain the actual notice for any copied material; an “adapted from” label alone is not the full MIT notice. High-level independently written adaptations should still record their source. [P24]

A future code port is an install-surface change, not just prose: inspect dependencies, companion features, bootstrapping and entrypoints; add real filesystem/subprocess tests; run the relevant Python, reference, Node and installability checks. Preserve skill names, prompt names, the `docs/agents/` contract and configured tracker routing. No manifest or entrypoint was changed by this survey. [L2]

## Validation and limitations

Before writing this report, the required local baseline was **1,122 passed, 1 failed** from `uv run pytest`. The sole failure is `test_implement_spec_passes_arguments_to_the_manual_coordinator`, which expects the already-deleted `prompts/implement-spec.md`. Reference validation passed. That is a working-tree defect outside this report, not evidence against pstack and not permission to restore the file.

The required targeted command, `uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py`, passed **371 tests**. The report's relative links and pinned upstream source paths were also checked against the local trees; no missing path was found. The first ad-hoc link-check command had a quoting error and was corrected before that check passed. This check establishes filesystem targets, not hosted HTTP availability or every external anchor.

This report is a source-derived adoption backlog, not a completed port, benchmark, security certification or promise of agent improvement. No extension/manifest code changed, so no separate Node command was required. No pstack runtime, paid probe, live application pilot or formal checker was exercised.

## Sources

Upstream links are pinned to the inspected `cursor/plugins` commit. Local links identify the current authoritative owner rather than copying its process into this report.

[P1]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/README.md
[P2]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/SKILL.md
[P3]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/agents/poteto-agent.md
[P4]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/principle-guard-the-context-window/SKILL.md
[P5]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/create-verification-skill/SKILL.md
[P6]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/blast-radius/SKILL.md
[P7]: https://github.com/cursor/plugins/tree/99b609a72323b70204eab407c622f436e858e112/pstack/skills/create-formal-verification-skill
[P8]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/sharpen/SKILL.md
[P9]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md
[P10]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/benchmark-checklist/SKILL.md
[P11]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/architect/SKILL.md
[P12]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/why/SKILL.md
[P13]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/swarm/SKILL.md
[P14]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/show-me-your-work/SKILL.md
[P15]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/ketchup/SKILL.md
[P16]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-help/SKILL.md
[P17]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/opening-a-pr.md
[P18]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/multi-phase-plan.md
[P19]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/no-comments/SKILL.md
[P20]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/principle-boundary-discipline/SKILL.md
[P21]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/reflect/SKILL.md
[P22]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/docs/harness/claude-code.md
[P23]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/make-bot-ui/SKILL.md
[P24]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/LICENSE
[P25]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/.cursor-plugin/plugin.json
[P26]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/hillclimb.md
[P27]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/teach/SKILL.md
[P28]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/maintain-formal-verification-skill/SKILL.md
[P29]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/worktree-cleanup.md
[P30]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md
[P31]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/orchestrate.md
[P32]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/scripts/bootstrap.ts
[P33]: https://github.com/cursor/plugins/tree/99b609a72323b70204eab407c622f436e858e112/pstack/skills
[P34]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/tdd/SKILL.md
[P35]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/principle-attack-the-premise/SKILL.md
[P36]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/arena/SKILL.md
[P37]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/statechart/scripts/statechart.mjs
[P38]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/interrogate/references/lead-judgment.md
[P39]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/typescript-best-practices/references/patterns.md
[P40]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/statechart/scripts/tlc-tools.mjs
[L1]: ../../skills/meta/skill-creator/SKILL.md
[L2]: ../../AGENTS.md
[L3]: ../../skills/workflow/to-tickets/SKILL.md
[L4]: ../../skills/practice/testing-workflow/SKILL.md
[L5]: ../../skills/practice/webapp-testing/SKILL.md
[L6]: ../../skills/workflow/implement-spec/SKILL.md
[L7]: ../../skills/practice/codebase-design/SKILL.md
[L8]: ../../skills/practice/construction-craft/references/construction-decisions.md
[L9]: ../../skills/workflow/prototype/SKILL.md
[L10]: ../../skills/workflow/research/SKILL.md
[L11]: ../../skills/workflow/handoff/SKILL.md
[L12]: ../../skills/workflow/grilling/SKILL.md
[L13]: ../../skills/practice/git-discipline/SKILL.md
[L14]: ../adr/0003-retire-factory-in-favor-of-cleopatra.md
[L15]: ../../skills/workflow/retro/SKILL.md
[L16]: ../../skills/practice/tdd/SKILL.md
[L17]: ../../skills/workflow/teach/SKILL.md
[L18]: ../../skills/practice/diagnosing-bugs/SKILL.md#phase-3--hypothesise
[L19]: ../../skills/practice/codebase-design/references/design-it-twice.md
