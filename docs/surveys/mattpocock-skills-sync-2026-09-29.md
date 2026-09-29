# Survey: mattpocock skills v1.3 source rollout (2026-09-29)

## Verdict

**Do not bulk-sync. Adapt `pr` and `retro`, repair the existing worker contracts, and reconsider `implement-spec` as a supervised workflow candidate.** The previous rejection based on Factory is withdrawn: Factory was an unusable, never fully utilized proof-of-concept, not an operational substitute. It has been retired in favor of the separate **Cleopatra** project; see [the retirement decision](../adr/0003-retire-factory-in-favor-of-cleopatra.md).

Cleopatra's ownership comes from the owner's explicit decision, not inspection of its implementation. No Cleopatra command, scheduling policy, supported integration or operational guarantee is assumed here. A reusable supervised skill and an external durable orchestrator are different artifacts; establish their boundary before adding either integration.

Our bounded grilling, impact-aware ticket graphs, tracker binding, work protection and split review axes remain deliberate adaptations. Preserve them. Source inspection identifies candidate improvements; it does **not** establish improved model behavior.

## Provenance and coverage

- Upstream inspected at [`d81f3a183412e71a5b1e84ca21bc1a35eea03a60`](https://github.com/mattpocock/skills/commit/d81f3a183412e71a5b1e84ca21bc1a35eea03a60), merged September 29. [PR #1120](https://github.com/mattpocock/skills/pull/1120) describes the v1.3 rollout and remaining rough edges.
- **Publication caveat:** at inspection, GitHub's [releases API](https://api.github.com/repos/mattpocock/skills/releases?per_page=10) and [tags API](https://api.github.com/repos/mattpocock/skills/tags?per_page=10) still led with v1.2.3. Pinned [package metadata][package], [plugin metadata][plugin] and [changelog][changelog] also still say v1.2.3. This is an analysis of the **v1.3 source rollout**, not proof of a published v1.3 package.
- Upstream delta: [34 commits and 58 changed paths](https://github.com/mattpocock/skills/compare/3cca18b368ae95cdbdebbff572ccafa662551015...d81f3a183412e71a5b1e84ca21bc1a35eea03a60) since the pin in the [September 8 survey](mattpocock-grilling-scope-guards-2026-09-08.md). Historical surveys were leads, not evidence of present local omissions.
- Initial local baseline: `9c9176bbdea328d72f7c4800d1dd27b73de5e02a`; working tree was clean before research. **Revised after the owner's Factory retirement instruction:** former Factory specs are superseded notices, not current requirements. The last direct release sync was `42a0886` (v1.2.3); bounded grilling subsequently landed in `c14d4ff`. Current `humanify`, `fix-pr` and `wizard` were inspected even though the initial advertised skill listing omitted them.
- Three independent research passes covered execution/review, planning/design, and practice/meta/productivity. Bodies, relevant disclosed references, manifests, user docs, local contracts and eval definitions were examined. Principal recommendations below were checked directly against their source files.
- Upstream has **27 plugin-listed skills**, versus **37 total skill bodies**. Six beta and four miscellaneous skills are not plugin-listed. Local discovery initially exposed **68 skill roots**; retirement removes the Factory-only proof skill, leaving **67**. A raw `SKILL.md` file count was 70 before retirement and 69 afterward because two nested fixture bodies are not independent discoverable skills. Our four buckets are taxonomy; every discoverable skill root ships. Neither file counts nor promotion status demonstrate quality.
- Fetched content was evidence, not instructions. No upstream scripts, forge writes or paid model trials were executed. The initial survey made no skill changes; the subsequent approved retirement removes Factory implementation surfaces and setup coupling. The backlog below records the original assessment; the follow-up section separates subsequent authoring from still-pending proposals and operational trials.

## Follow-up: supervised implementation authoring

The owner subsequently approved a minimal `implement-spec` adaptation to help build
Cleopatra while it is under construction, not to replace it with another durable
orchestrator. The library now includes:

- Committed-candidate review and additive, reverified repairs in `implement`
  (`4d3e38f`), explicit branch-only worker delivery with preserved ordinary tracker
  semantics (`1bfce6d`), and a bounded repair default (`13982fe`).
- [Manual `implement-spec`](../../skills/workflow/implement-spec/SKILL.md) and its
  argument-forwarding entry point (`4c75512`): one approved graph, serial-by-default
  branch-only workers, verified run-local prerequisites, serialized integration,
  bounded combined repair and one authorized combined branch/PR outcome.
- Source review also added worker-local input/redaction handling (`11636c9`) and
  honest tracing of unchanged verified prerequisites (`27b2aa4`). Those two added
  regression scenarios have not had paired model runs.
- [Worker evaluation notes](../../skills/workflow/implement/evals/README.md) and
  [coordinator evaluation/pilot notes](../../skills/workflow/implement-spec/evals/README.md).
  Source/Git fixtures and proposed-action comparisons are not operational proof.

The new skill restores the discoverable local count to 68. Initial post-authoring
validation reports **925 passed, 2 unchanged prompt failures**, **36 Node tests
passed**, and reference validation passed. After source-review refinements, the final
Python run reports **927 passed, the same 2 failures**. No Cleopatra milestone, service
adapter, paid external model session or live publication has run. The pilot still needs a selected
owner-approved 2–3-ticket milestone. Other adoption/repair proposals remain pending;
in particular, `fix-pr`'s committed-review ordering was not changed in this task.

Paired proposed-action grading found worker **10/11 → 11/11** assertions (one
run-local eligibility distinction) and coordinator **12/12 → 12/12**. The strong
baseline and leading prompts do not establish operational improvement. Standard
review viewers and analyst notes were generated; human qualitative review and the
actual Cleopatra pilot remain pending. The two later worker-source refinements
are covered by static regressions, not those initial paired model runs.

## What is genuinely new

| Upstream change since September 8 | Assessment for this repo |
| --- | --- |
| `implement-spec` graduates from beta, with explicit TDD, integration-branch synchronization and conditional/delayed draft PR | **Reopen as a supervised workflow candidate.** There is no operational Factory capability to duplicate. Resolve run-local readiness, bounded integration/review and Cleopatra's external ownership before adoption. |
| `pr` is added and graduates | Useful narrow candidate: concise, evidence-oriented PR presentation. Adapt, do not copy its entire template. |
| `retro` graduates; adds existing-check discovery and mechanical-versus-judgment classification | Useful opt-in candidate: session evidence → ranked environment improvements. |
| `resolving-merge-conflicts` is removed with no replacement | Do not follow the deletion: current `fix-pr` depends on our version. Harden its standalone contract instead. |
| `CONTEXT.md` / `CONTEXT-MAP.md` become `GLOSSARY.md` / `GLOSSARY-MAP.md` | Keep configured authority and existing consumer layouts. No blind filename replacement. |
| Router and neighboring user docs advertise the new flow | Update our own execution guidance if needed; do not import the upstream router's branding or unsupported assumptions. |

The operative `implement`, `code-review`, grilling, prototype, to-spec and to-tickets bodies were **not changed** in this delta. Most useful older gaps below predate v1.3. Graduation and documentation updates must not be misreported as newly invented behavior.

## Recommended backlog, in order

### 1. Correctness and authority repairs before adding skills

**A. Commit the candidate before committed-diff review.**

At the inspected baseline, [implement](../../skills/workflow/implement/SKILL.md), lines 73–77, requested review before its explicit commit. That worker contract has since been repaired as recorded above. [fix-pr](../../skills/workflow/fix-pr/SKILL.md), lines 78–84, likewise reviews before “Commit the reviewed repair.” Yet [review-spec](../../skills/workflow/review-spec/SKILL.md), lines 26–37, and [review-standards](../../skills/workflow/review-standards/SKILL.md), lines 28–39, inspect `<base>...HEAD`.

At that baseline, an intermediate commit could avoid the problem, but neither worker contract required it. A new slice can produce an empty reviewed diff; a PR repair can review old commits while omitting uncommitted fixes. Upstream has the same inherited ordering, and its [review documentation acknowledges invisible uncommitted work][review-docs]. This is a source-contract defect, not an observed failed model run.

**Slice:** require a candidate commit and recorded base/head before review; commit repairs before affected re-review; bind publication to the reviewed candidate. Keep additive commits safe on published branches. Test new uncommitted work, an uncommitted repair to an existing PR, and a change after review.

**B. Make publication and readiness authorization distinct everywhere.**

[The label contract](../agents/triage-labels.md), lines 30–45, explicitly says publication approval is not readiness approval. [humanify](../../skills/workflow/humanify/SKILL.md) owns scoped human-authorized readiness, and `/refine-ticket` already routes there. However:

- [to-spec](../../skills/workflow/to-spec/SKILL.md), line 25, automatically labels the synthesized parent spec `ready-for-agent`, “no further triage needed.”
- [qa](../../skills/workflow/qa/SKILL.md), lines 60–72, treats concrete reproduction and unambiguous expected behavior as sufficient for agent readiness.
- [to-tickets](../../skills/workflow/to-tickets/SKILL.md), lines 100 and 111, approves a graph and defaults published tickets to agent readiness without distinguishing publication approval from scoped authorization.

**Slice:** honor the existing project-policy/label owner. Explicitly combined publication/readiness approval can be sufficient; do not invent a second ceremony where authorization is already clear. Otherwise preserve pending preparation or human approval honestly. A parent spec is an input, not automatically an implementation target. Keep QA lightweight; only executable breakdowns need to-tickets' inspected impact and native-edge verification. Different symptoms alone do not prove independent mutable surfaces.

**C. Make conflict resolution safe when invoked alone.**

[resolving-merge-conflicts](../../skills/practice/resolving-merge-conflicts/SKILL.md), lines 10–20, still says “Always resolve; never `--abort`,” picks between incompatible intents, and says “Stage everything.” [fix-pr](../../skills/workflow/fix-pr/SKILL.md) adds stronger ownership, human-decision and inspected-staging rules, but the standalone skill remains invocable without that wrapper.

**Slice:** establish the authorized operation and ownership, stage only inspected resolution paths, and pause on consequential unresolved semantics. Neither blind continuation nor blind abort is safe. An abort can discard resolution edits; preserve and attribute them before discussing an authorized abort. Keep primary-source intent analysis and combined-result tests. Do not delete this public skill without a replacement/migration and dependency updates.

**D. Restore test-before-fix ordering in diagnosis.**

[diagnosing-bugs](../../skills/practice/diagnosing-bugs/SKILL.md), lines 530–539, applies the fix and then creates the permanent regression test, contrary to [our TDD discipline](../../skills/practice/tdd/SKILL.md). Upstream [writes the representative regression test first, then replays the original scenario][diagnosis]. This useful difference already existed in August.

**Slice:** promote the minimized repro to a red regression test before the production fix; exercise the real caller pattern rather than a shallow substitute; report absent representative coverage honestly. Re-run the original scenario after green, tag and verify removal of temporary instrumentation, and preserve our escalation after repeated hypothesis refutation. Trial ranked hypotheses separately; do not replace the escalation stop or copy unconditional artifact deletion. Keep testing-workflow as the execution-policy owner.

### 2. Adopt PR presentation, without adding publication authority

Upstream [`pr`][pr] is a model-invoked reference, not a publisher. Its useful ideas are the smallest diagram/diff/tree that explains the change, claim-linked before/after evidence, and explicit reversibility/blast radius. Preserve [its attribution to Dex Horthy's show-me][pr-credits] if adapting it.

**Recommended artifact:** a lean PR-body reference, either an independently triggered skill or a shared reference if it does not need independent discovery. Decide that creation gate before choosing a public name.

Local adaptations must:

- Honor repository PR templates, closing references, disclosure and robot-comment conventions first. Upstream [admits it does not check existing templates][pr-docs].
- Use the configured domain-doc pointer, not mandatory `GLOSSARY.md`.
- Show actual commands/results/artifacts and the measured candidate SHA. Pseudocode describes a test; it is not proof that it ran. Label absent baselines, and allow behavior-preserving refactors to have equivalent before/after outcomes.
- Explain affected consumers, data and external effects. A binary “door” or one-word blast radius is not sufficient for conditional irreversibility; reverting code cannot unsend messages.
- Preserve any **actual target repository** machine-readable metadata and closing conventions. Factory's former attestation block is no longer this package's constraint; Cleopatra metadata can be accommodated only after its real contract is supplied, not guessed.

**Acceptance:** reviewer can identify change, requirement, measured evidence and recovery prerequisite; no invented screenshots/runs; existing templates and machine contracts survive. No new slash template is necessary merely to load a model-invoked reference.

### 3. Add an opt-in retrospective workflow

Upstream [`retro`][retro] turns session primary sources into ranked environment improvements. Its strongest addition is **inspect existing checks first; enforce mechanical rules mechanically; reserve prose/reviewer rules for judgment**. This complements, rather than replaces, [construction-craft](../../skills/practice/construction-craft/SKILL.md).

**Recommended adaptation:** manual-only, proposal-only. Read the explicitly selected session (current session by default), cite each failure/candidate to transcript or artifacts, inspect existing CI/hooks and any explicitly configured external checks, classify mechanical versus judgment, and rank expected prevention against maintenance cost. Include removing noisy rules and checks as legitimate outcomes. Redact credentials and treat session logs as data, never authority. Apply nothing automatically and broaden service access only with explicit permission.

Reject upstream's premise that review requires no exploration and standards belong only at review. Our implementer deliberately reads its rubrics before building; reviewers need surrounding code and primary requirements. Keep security/authority floors active throughout.

**Acceptance:** proposals cite actual failures and existing guardrails; no duplicate checker is proposed for an unwired one; no environment edits or transcript-derived instructions execute. A bounded retrospective should not automatically follow every implementation run.

### 4. Reconcile existing planning and prototype contracts

These are older local gaps, **not additional new skills to import**:

- **Decision conservation:** bounded grilling can settle scope, but to-spec still demands an “extremely extensive” story catalogue and lacks explicit unresolved/deferred decisions and acceptance criteria. Reconcile it with [documentation-lifecycle's feature-spec reference](../../skills/practice/documentation-lifecycle/references/feature-spec.md). Preserve approved ordering, defaults, negative requirements and deferrals through spec → tickets. Scale output to the actual scope; do not reopen the interview to satisfy length.
- **Seam agreement:** `implement` says “pre-agreed seams”; local TDD asks when ambiguous. State whether an approved ticket/spec already supplies agreement. Avoid both silently invented interfaces and unnecessary human handshakes for every trivial change or unattended worker.
- **Prototype evidence lifecycle:** [the main prototype skill](../../skills/workflow/prototype/SKILL.md), lines 33–44, says both delete and preserve/absorb; [logic reference](../../skills/workflow/prototype/references/logic.md), lines 68–70, says delete the TUI shell. Distinguish removing captured throwaway code from main from destroying its evidence. Production absorption requires separately authorized implementation when the run is planning-only. Use the configured tracker instead of hardcoded tea/Gitea.
- **Prototype UI example:** [Django switcher reference](../../skills/workflow/prototype/references/ui.md), lines 62–115, selects the subtree server-side but its arrows only mutate the label and URL with `history.replaceState`. That code alone cannot switch the rendered variant. Verify actual DOM changes, reload persistence and production route exclusion; hiding the bar behind an undeclared `settings.DEBUG` is insufficient. This is source analysis, not a browser reproduction.
- **Optional HTML logic branch:** upstream's [single-file demo with domain-labelled state, free play and walkthroughs][prototype-logic] is useful for non-developer reviewers, but predates this release. Offer it alongside project-native TUI logic prototypes, not as a replacement requiring Python logic to be rewritten in JavaScript.
- **Authority is not body loading:** [architecture skill](../../skills/workflow/improve-codebase-architecture/SKILL.md), lines 21–25, equates reading its body with user invocation. Research/review can read a manual-only body without authorizing execution. Likewise Wayfinder Notes cannot become an agent-authored execution license. Require actual attributed operator authority while respecting explicitly read-only scope.

Further bounded maintenance candidates in [deepening guidance](../../skills/practice/codebase-design/references/deepening.md) and [HTML reports](../../skills/workflow/improve-codebase-architecture/references/html-report.md): make module-depth method counts inspection heuristics rather than verdicts; delete old tests only after replacement coverage preserves their unique contracts; bound database substitutes by represented semantics; make reports readable offline and escape source-derived content. Do not bundle these into the adoption slices.

## What to keep or decline

### Reopen `implement-spec`; keep orchestration boundaries explicit

**The earlier “we already have Factory” argument was wrong and is withdrawn.** Passing component tests, elaborate specifications and source modules did not establish a usable execution path. Neither Factory's closure-only scheduler nor its one-PR-per-ticket/attestation policy constrains a future skill now.

Upstream [implement-spec][implement-spec] answers a real remaining skill-library use case: a human asks one session to complete a scoped spec through isolated ticket workers and one integration branch, without operating a durable automation service. Its promotion makes it a credible **adaptation candidate**, not proof of safe execution.

**Recommend a bounded, opt-in supervised pilot**, not transplanting the raw body and not rebuilding Factory inside a skill. Cleopatra is the designated successor orchestration project; first establish whether this supervised run is wanted independently, or should instead be handed to Cleopatra through a subsequently documented interface. Do not ship a persistent scheduler, recovery database, model allocator or invented Cleopatra adapter here.

A candidate must fix upstream's documented rough edges:

- **Separate durable tracker closure from run-local integration readiness.** In a whole-spec PR, native blockers can stay open until the final merge. Explicitly compute the authorized run's frontier from verified integrated ticket commits without closing tracker issues early or claiming a global edge is satisfied. The existing glossary's closed-blocker convention still governs ordinary tracker/Wayfinder work; a supervised run's distinct meaning must be documented, not silently substituted. Do not infer Cleopatra's semantics.
- **Serialize integration and verify the new combined candidate.** A worker merging the current integration tip does not guarantee fast-forward landing if that tip moves before integration. Reconcile at the integration owner, test the actual result and review committed SHAs.
- **Preserve graph and resource admission.** Only approved scope, authorized work and proven-disjoint mutable impacts may run concurrently. Cap workers by available resources and stop on unknown ownership, missing prerequisites or new collision edges.
- **Bound repair.** Fix blocking findings, reverify/review the candidate and stop at an explicit repair budget or human decision. Advisory smells are not a mandate for an unending cleanup loop.
- **Protect work.** No automatic reset of a mismatched worktree or unconditional cleanup. Its [documentation's primary-checkout test workaround][implement-spec-docs] remains unsafe: provide isolated declared prerequisites and report missing coverage, rather than testing different code in the operator checkout.
- **Make worker/publisher ownership explicit.** At the inspected baseline, manual `implement` always published one slice. The subsequent adaptation adds an explicit branch-only completion handoff, with the integration owner publishing the combined result. Likewise an external orchestrator must supply its own authorized worker contract; no Cleopatra permissions are presumed.

**Pilot acceptance:** a two-ticket dependent graph advances after verified integration while tracker issues remain open; overlapping work is serialized; a moved integration tip is reverified; red or skipped required tests cannot produce success; review/repair stops at its budget; no untracked files disappear; the final deliverable matches the agreed branch/PR shape. Compare against manually dispatching the same slices and inspect actual Git/filesystem effects, not just proposed-action text. No such pilot has run.

**Default today:** `implement` for one ticket; Cleopatra is the separately owned successor project, with availability/setup established there. `implement-spec` is now **evaluate/adapt**, not **reject because Factory covers it**. If all orchestration is intended to reside exclusively in Cleopatra, defer the pilot for that explicit ownership reason—not a fictional local capability.

### Keep public names and configured glossary locations

Upstream [requires the GLOSSARY rename][rename]. Our [domain contract](../agents/domain.md) already owns configured glossary locations, and `CONTEXT.md` is the established workflow glossary. `writing-great-skills` also owns a separate authoring glossary.

**Default:** no rename of CONTEXT files or `writing-great-skills`. Honor configured CONTEXT, GLOSSARY or custom locations; if discovery finds competing files without configured authority, ask rather than creating a second glossary. Any new default requires an explicit migration and coordinated setup/reference/eval updates.

The older `writing-for-agents` rename/restructure is not new in this rollout. Borrow only useful co-location and real-context-boundary clarification; retain our trust boundary, vocabulary ownership and skill-creator eval workflow. Scope broadening to AGENTS/CLAUDE authoring needs demonstrated trigger cases, not another overlapping skill.

### Disposition of the remaining skill families

| Family / item | Next step |
| --- | --- |
| Grilling and wrappers | Keep bounded scope/value admission and human confirmation. Test multi-turn wrapper and synthesis composition; do not return to exhaustive whole-tree traversal. |
| code-review → two-axis-review / review-spec / review-standards | Keep independent read-only axes, sequential fallback and advisory smell treatment. Repair committed-candidate boundary. Give `/revmerge` a distinct action owner if it continues to publish/merge; do not give write authority to the review leaves. |
| Wayfinder, triage, to-tickets, domain-modeling, architecture | Keep stronger tracker/impact/history contracts. Reconcile readiness, authority and decision conservation rather than wholesale replacement. |
| QA | Keep conversational issue capture despite upstream retirement. Do not claim symptom separation proves safe implementation concurrency. |
| TDD | Keep mandatory red-green-refactor and local Python/Django/httpx adaptations; independent expectations and tautological-test warnings are already present. Clarify seam authority. |
| setup-project-skills | Keep two-tracker routing, preservation and resync contracts. Factory configuration generation is removed; do not replace it with speculative Cleopatra setup. |
| Research, handoff, teach, to-questionnaire, wizard | Already adapted; retain. No material new operative body behavior warrants a re-port. |
| wait-what | Do not add by default: permanent critical-partner language guidance already owns the adjacent behavior, and no new behavioral evidence overturns the previous non-adoption. |
| git-guardrails-claude-code | Already local; upstream has the same [regex matcher](../../skills/meta/git-guardrails-claude-code/scripts/block-dangerous-git.sh), not a security upgrade. Separately characterize/qualify coverage for Git options, `checkout -- .`, compound commands and malformed input using non-destructive fixtures. |
| ask-matt | Do not import branding or a second workflow authority. A local flow map is justified only if users actually struggle to select the existing entry points. |
| [claude-handoff][claude-handoff] | Defer automatic launching; existing handoff owns the artifact. Dispatch would need consent and lifecycle safeguards. |
| [setup-ts-deep-modules][ts-modules] | Defer opinionated TS topology/tool installation. Harvest boundary-rule pass/fail/pass testing only for an actual target stack. |
| [writing-fragments][fragments] / [writing-shape][shape] / [writing-beats][beats] | Defer editorial workflows until a concrete editorial need; do not install all three as engineering maintenance. |
| [loop-me][loop-me] | Reject for this scope: another planner with unbounded “no question remains” completion, not a missing software workflow. |
| [setup-pre-commit][pre-commit] | No direct port of Husky/lint-staged/Prettier and broad staged-file mutation. Use existing stack-native checks if a real setup task is approved. |
| [scaffold-exercises][exercises] / [migrate-to-shoehorn][shoehorn] | Reject generic adoption: course-specific and narrow TS fixture/dependency workflows respectively. |

**No experimental bucket under `skills/`.** Our [repository policy](../../AGENTS.md) says every skill ships and permits exactly four taxonomy buckets. Upstream's plugin allow-list differs from direct installers and its maintainer symlink script. Keep experiments outside the installable tree until accepted; do not copy installer scripts or assume beta directories hide them from pi.

## Execution proposal and evidence gates

Approve separate ticket-sized slices, not one sync commit:

1. **Committed-candidate review** across implement/fix-pr and publication.
2. **Readiness authorization reconciliation** across spec/QA/ticket producers and existing humanify policy.
3. **Standalone conflict safety**, preserving its public name and fix-pr dependency.
4. **Diagnosis ordering and original-scenario verification**; trial hypothesis ranking separately.
5. **PR evidence presentation** and **manual retro**, independently evaluated and approved.
6. **Supervised `implement-spec` boundary decision and pilot**, including branch-only workers, run-local readiness and bounded integration; no durable in-repo orchestrator.
7. **Planning/prototype reconciliation**, starting with decision conservation and the broken switcher example; optional HTML output afterward.

For each changed skill: snapshot current baseline; reproduce the relevant failure; use the same prompt/model/environment for candidate comparison; preserve existing eval controls and add targeted regression cases. Use real filesystem/Git/tracker fixtures where the property is operational. A one-response proposed-action simulation or skill-load receipt does not prove publication, safe mutation or multi-turn handoff correctness. Human review remains necessary for qualitative claims.

Run relevant repository mandatory checks. Do not launch paid live probes or broad product E2E suites merely to validate a documentation adaptation. No candidate behavioral evaluation ran for the original survey; the follow-up section records the later proposed-action comparisons and their limits.

## Validation and unrelated existing failures

Before adding this survey, on the clean local baseline:

- `uv run pytest`: **921 passed, 2 failed** (96.99s). Failures: `test_refine_ticket_routes_explicit_ticket_through_authorized_readiness` (missing `$@` passthrough) and `test_revmerge_routes_user_decisions_through_grilling` (missing expected decision-routing clause). These predate this document and were not repaired. Their broader prompt-owner design should be resolved deliberately, not patched blindly to satisfy strings.
- `uv run python scripts/validate_refs.py`: exit 0. This validator scans skill references, **not this survey**.

After adding the document:

- `uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py`: **356 passed** (1.49s).
- `uv run python scripts/validate_refs.py`: exit 0.
- Separate survey-link/pinned-line check: **28 local links, 22 source-reference uses and 22 pinned source files/line ranges passed**. An initial out-of-range retro citation was caught and corrected. This checks existence/ranges, not semantic correctness or live GitHub rendering.

These are the **initial survey's** results, not retirement validation. Initial logs: `/tmp/mattpocock-v1.3-survey-{pytest,targeted,refs,refs-post}.log`.

### After Factory retirement

- The pre-removal retirement regression selection failed all four tests as expected; Factory's existing Node baseline passed **1,931 tests** before its subjects were removed. These results do not demonstrate that Factory was operational.
- Affected package/setup/plugin/tracker/skill/reference/quality-tool selection: **673 passed**. The independent Claude plugin generator remains covered, including installed-CLI checks without a paid model turn.
- `node --test tests/node/*.mjs`: **36 passed**, covering the two retained extensions.
- `uv run python scripts/validate_refs.py`: exit 0.
- Final `uv run pytest`: **909 passed, 2 failed** (14.67s). Only the same two pre-existing prompt failures remain; the changed install/setup/retirement surfaces pass. An intermediate run caught an incorrect README skill count, corrected to 67 discoverable roots; its 19-test regression selection then passed. The lower suite totals reflect removal of dedicated Factory tests and the proof-only skill, not equivalent retained Factory coverage.
- Rechecked survey links: **26 local links, 22 source-reference uses and 22 pinned source ranges passed**. Retirement ADR, spec-notice and archive README links also passed. These checks establish existence/ranges, not semantic correctness or live rendering.
- Logs: `/tmp/factory-retirement-{red,node-baseline,targeted,node,refs,doc-links,count-regression,pytest-final}.log`.

The setup, Wayfinder and ticket-skill changes remove retired contracts and preserve shared behavior; their eval expectations were updated, but **baseline/candidate model comparisons were not run**. At the retirement stage, no Cleopatra integration, external migration, paid live probe or upstream-adaptation trial was performed. The later authoring/comparison is recorded above. Static validation does not establish improved agent behavior.

## Pinned sources

[package]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/package.json#L1-L5
[plugin]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/.claude-plugin/plugin.json#L1-L49
[changelog]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/CHANGELOG.md#L1-L5
[review-docs]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/docs/engineering/code-review.md#L74-L76
[diagnosis]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/diagnosing-bugs/SKILL.md#L90-L138
[pr]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/pr/SKILL.md#L1-L170
[pr-credits]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/pr/CREDITS.md#L1-L3
[pr-docs]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/docs/engineering/pr.md#L29-L45
[retro]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/retro/SKILL.md#L1-L44
[prototype-logic]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/prototype/LOGIC.md#L3-L57
[implement-spec]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement-spec/SKILL.md#L1-L40
[implement-spec-docs]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/docs/engineering/implement-spec.md#L44-L75
[rename]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/.changeset/rename-context-to-glossary.md#L1-L7
[claude-handoff]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/in-progress/claude-handoff/SKILL.md#L8-L18
[ts-modules]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/in-progress/setup-ts-deep-modules/SKILL.md#L17-L32
[fragments]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/in-progress/writing-fragments/SKILL.md#L8-L20
[shape]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/in-progress/writing-shape/SKILL.md#L8-L25
[beats]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/in-progress/writing-beats/SKILL.md#L8-L23
[loop-me]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/in-progress/loop-me/SKILL.md#L8-L30
[pre-commit]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/misc/setup-pre-commit/SKILL.md#L15-L45
[exercises]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/misc/scaffold-exercises/SKILL.md#L8-L30
[shoehorn]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/misc/migrate-to-shoehorn/SKILL.md#L10-L25
