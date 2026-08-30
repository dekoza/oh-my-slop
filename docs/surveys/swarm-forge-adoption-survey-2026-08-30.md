# Adoption survey: SwarmForge vs the Software Factory

**Status:** Decision evidence for map [#75](http://192.168.129.37:30008/minder/oh-my-slop/issues/75), its review sink [#186](http://192.168.129.37:30008/minder/oh-my-slop/issues/186), and the parallel-coordination map [#135](http://192.168.129.37:30008/minder/oh-my-slop/issues/135). Written with the explicit brief that ditching the factory is acceptable if SwarmForge is superior.

## Verdict

**Keep the factory. Do not replace it with SwarmForge, and do not import its transport, its trust model, or its runtime.** SwarmForge is not a better factory; it is a different product — an interactive, operator-at-a-dashboard studio of persistent role agents — whose quality story rests entirely on prompts telling agents to run tools, with nothing checking that they did. Its author's own live-run log on the `squad` branch documents the exact failure modes the factory's zero-trust design exists to close.

SwarmForge is ahead of the factory in exactly one dimension: **pipeline depth**. It runs specification → implementation → cleanup → architecture → mutation hardening → end-to-end QA as separate, narrowly-mandated passes. The factory runs implement → review. That gap is real, it is the thing that produces higher code quality per ticket, and it is the cheapest thing to graft because the factory's phase model is already role-parametric.

Five ideas are worth reimplementing narrowly inside the factory contracts (§ *What to adopt*). Everything else is a trap or a mismatch.

## Evidence boundary

Primary sources, read in full unless noted:

- Fork `github.com/dekoza/swarm-forge`, cloned 2026-08-30. Branch heads: `main` `95e95e4` (2026-08-29), `six-pack` `dc82267`, `four-pack` `9ac9a20`, `two-pack` `5b3e883`, `squad` `b0d63d5` (2026-08-21), `adversaries` `7aa2f3a` (2026-06-26).
- On `main`: `README.md`, `swarmforge/handoff-protocol.md`, `swarmforge/constitution/articles/{engineering,handoffs,workflow}.prompt`, `swarmforge/roles/lieutenant.prompt`, `platoon-brainstorm.md`, `project-board.md`, `AGENTS.md`, `issues.md`; scripts `merge_and_process.bb`, `ready_for_next_guard.bb`, and the audit-gate and launcher regions of `swarm_handoff.bb`, `handoffd.bb`, `swarmforge.bb`.
- On every pack branch: `swarmforge/swarmforge.conf`, every `roles/*.prompt`, every `constitution/articles/{project,local-*}.prompt`.
- On `squad`: `README.md`, `redo.md`, `issues.md`, `swarmforge/{worker-common.prompt,tool-table.edn,squad.conf,clean-architecture.md}`, `roles/squad-leader.*`, `roles/troubleshooter.prompt`, `role-templates/{implementer,analyst,code-reviewer,hardener,qa-procedure-writer,system-analyst}.prompt`, `role-templates/implementer.contract.edn`, `constitution/articles/{handoffs,local-workflow,project}.prompt`.
- Factory side: `docs/specs/software-factory.md` §1–3, §6.1–6.3, §7.1–7.3, §8, §18–20; `README.md`; `CONTEXT.md`; `.pi/factory.json`; git history; Gitea #178, #180, #186; the open-issue list.

Authorship and maturity, from `git log`: `main` has 323 commits, 316 by Robert C. Martin, first 2026-03-31, last 2026-08-29 — active. `squad` has 460 commits and stopped 2026-08-21 while `main` continued in a different direction (multi-project forge with a lieutenant); `main`'s README no longer mentions `squad`. Framework tests: `test/swarmforge/*.clj` ≈ 5,800 lines plus a Playwright suite for the dashboard. Size: `swarmforge/scripts` ≈ 8,000 lines of Babashka. The factory: `factory/lib` ≈ 36,000 lines of ESM, `tests/node/factory_*` ≈ 30,000 lines, one merged factory-authored PR (`#148`, branch `factory/t57/…`), runs #114 referenced in the amendment log, capacity = 1.

## What SwarmForge is

Verified from `README.md` and `handoff-protocol.md` on `main`:

- **Topology.** `swarmforge.conf` names one persistent agent per role. Each role gets its own git worktree under `.worktrees/<role>` (the first `master` role runs in the main checkout) and its own tmux session on a project-private socket. Backends are `claude`, `codex`, `copilot`, `grok`, chosen per line.
- **Transport.** Agents never touch tmux. They write a 4–5 header draft under `./tmp/` and run `swarm_handoff.sh`; `handoffd.bb` copies the file into each recipient's `.swarmforge/handoffs/inbox/new/` and sends one generic wake-up (`You have new handoff mail. If idle, run ready_for_next.sh.`). Queue state is file location (`new` → `in_process` → `completed`); lifecycle timestamps live in file headers. Exactly two message types: `git_handoff` (a 10-hex commit) and `note` (one line, ≤ 80 chars).
- **Merging.** `ready_for_next.sh` runs `merge_and_process.sh <sender> <sha>`, which is a plain `git merge --no-edit` (`merge_and_process.bb:26`). Conflicts belong to the agent: "Parallel cards on one tree will conflict; that is expected" (`handoffs.prompt`).
- **Pipeline.** A card moves forward role by role. `back-one` / `back-all` queue merge-only copies backwards so earlier roles keep up with downstream restructuring; the rule is "structure improves as work moves down the pack" — on a reverse merge adopt the inbound tree, on a forward merge keep your own. `batch` receive mode lets a downstream role take every equal-priority queued handoff as one unit. The last role's broadcast to every other role is the terminal handoff that moves the card to Done.
- **Human gates.** Specifier → coder handoffs hold in the dashboard's Attention list for Approve/Reject; any agent can raise `pack_dashboard_request.sh clarify` and the answer is injected into its pane. Chat goes to a forge-level `lieutenant`, who "does not implement project work".
- **Quality.** Entirely prompt-directed. `engineering.prompt` tells each role which of the author's own tools to install at startup (`crap4clj`, `dry4clj`, `clj-mutate`, `gherkin-parser`, `gherkin-mutator`, plus Go and Java equivalents) and which thresholds to hit (CRAP ≤ 6, mutants killed, soft Gherkin mutation). The framework never runs a test. The single mechanical gate is the **two-call audit** in `swarm_handoff.bb`: the first valid `git_handoff` returns `AUDIT_REQUIRED` and increments the card's audit counter; only an unchanged second call queues it.
- **Trust.** The launcher forces `--yolo` / `--permission-mode bypassPermissions` on every backend (`swarmforge.bb:468-476`). Agents are told to procure "the latest version" of each tool "directly from the listed `github.com/unclebob/...` repositories" and not to "rely on stale cached, vendored, or preinstalled copies".
- **Language.** The tool table covers Go, Clojure, Java. No Python, no JavaScript. `grep -ri python` over every prompt and contract on `main` and `squad` returns nothing.
- **Tracker.** None. Work enters through the dashboard's New Task textbox and lives on a local board file (`pack_board.bb`). There is no issue, PR, or CI integration.
- **Recovery.** "Helper scripts do not provide recovery modes for ambiguous queue state" (`handoff-protocol.md`, *Finalized Decisions*). "Tmux wake-ups are intentionally lossy." On restart an agent runs `ready_for_next.sh`. There is no journal, no idempotent effects, no fault attribution, no budgets, no breaker.

The packs differ only in how many roles the pipeline is cut into (two: coder→cleaner; four: specifier→coder→refactorer→architect; six: specifier→coder→cleaner→architect→hardender→QA). `adversaries` is a coder↔reviewer loop with sequence-numbered `review/recommendations/NNN-recommendations.md` files and a committed `review/approval.md`.

### The `squad` branch

A second design, now stalled: a persistent `squad-leader` that only orchestrates (`may-spawn true`, `forbidden-writes` for every product artifact), transient workers spawned from `role-templates/` with per-role `.contract.edn` capability declarations, a `tool-table.edn` naming required tools and **required evidence headers** per role, config-declared approval gates (`approval_required gherkin true`), per-template concurrency caps, a `squad_next.sh --residual-only` FSM, and a `troubleshooter` agent as the operator's repair channel. Its `redo.md` opens "This tree has a lot of leftover machinery" and lists what to delete.

Its `issues.md` is the most valuable file in the repository, because it is a primary record of a real six-story run (a Wumpus game) under the author's own eyes. Twelve open fumbles, among them:

- Six parallel Gherkin writers "invented synonymous steps and QA CLIs" — four different flags for "put the pieces here" — because each DRY-checked only its own file.
- The cleaner ran coverage against the framework instead of the product; "CRAP on that file is invalid".
- No-arg `swarm_handoff.sh` stamped the wrong HEAD (master's merge commit, read from the process cwd), queued it, and the residual loop re-ran the same invalid command forever: "Nothing behind it moves".
- Agents repeatedly ran `--help` to reconstruct tool argv the assignment had not spelled out.
- The story-independent design produced "a series of little applications" until a *system-analyst* was added to build a running skeleton first.
- Evidence could not ride a git handoff, so agents either dropped it or forged a note file.

Every one of these is a coordination-by-prompt failure. None would be fixed by more prompt text; each is fixed by the framework computing the fact instead of asking the agent to.

## Steelmanned SwarmForge thesis

The strongest reading: software quality comes from *separation of concerns among reviewers*, not from one very careful author. A coder who also cleans, restructures, hardens, and QA-tests their own work does each of those worse than a fresh agent with one narrow mandate and no memory of the compromises. Persistent roles with their own worktrees make each pass cheap to run and keep every role's tree current through backward merge copies. Mutation testing — of code *and* of the Gherkin examples — is the only honest measure of a test suite, and the constitution demands it. The file-based handoff protocol is simple enough to be correct, the daemon owns the only dangerous resource (the tmux socket), and the dashboard gives a human the two controls that matter: approve a spec, answer a question.

That thesis is credible, and the pipeline-depth half of it is right. The factory should take it.

## Where the factory is stronger, with evidence

| Concern | SwarmForge | Factory |
|---|---|---|
| Who runs the checks | The agent, on instruction; framework runs nothing. Squad `issues.md`: coverage measured the wrong tree; `tool-table.edn` has to say "do not invent coverage numbers" | Controller reruns the declared required set at the exact post-rebase commit (§8.2); worker-reported evidence is context only |
| Fault attribution | None. A hung agent sits; a poisoned inbox item loops the leader | Worker vs automation faults, per-tier budgets, monotone breaker, `unrunnable` outranks `failed` (§8.6, §8.10) |
| Durable state and recovery | File locations + headers; explicitly no recovery for ambiguous states | Journal, projections, idempotent effects, leases, reconcile, adoption of live workers (§4–5) |
| Work intake | Dashboard textbox → local board file | Gitea tickets are the queue and the dependency graph (§3) |
| Output | Commits merged by agents into role branches; a human reads the board | Verified, attested, pushed branch + PR; #180 records the decision to merge after review |
| Trust and isolation | `bypassPermissions` forced; tools installed from GitHub `latest` at startup; agents read whatever the worktree ships | Pinned package revision, skill-discovery fence proven per run (#163), declared environment, `dontAsk` with declared allows (§6.8) |
| Base freshness | Long-lived role worktrees merging each other; conflicts are routine and agent-resolved | Pinned base per attempt, rebase inside `verify`, `rebase-dropped-commits` guard (#161) |
| Review independence | Same agent audits itself (`AUDIT_REQUIRED`); `adversaries` adds one reviewer | Two read-only reviewers with cited findings, separate worktrees, never see the builder transcript (§8.4) |
| Language fit for this operator | Go / Clojure / Java tools only | Any declared check command; `.pi/factory.json` already routes Python and Node repos |

## Where SwarmForge is stronger, with evidence

1. **Pipeline depth.** Six-pack `cleaner.prompt`, `architect.prompt`, `hardender.prompt`, `QA.prompt` each carry a narrow, well-written mandate: behavior-preserving cleanup with CRAP/DRY targets; dependency-direction review with a four-phase checklist; mutation hardening with differential runs; end-to-end QA "through the user interface only". The factory has no phase that *changes* code after implementation except repair, and §8.4 makes design smells advisory by construction, so a reviewer can see a structural problem and cannot act on it.
2. **Mutation testing as a first-class bar.** Code mutation and Gherkin-example mutation are named, thresholded, and differential against a manifest. The factory's `checks` block can carry them, but nothing in the spec or the shipped config does.
3. **Batch consolidation.** A downstream role takes several upstream results as one pass. Cheaper than one full pass per ticket when many small tickets land together.
4. **Mid-attempt clarification without losing work.** `clarify` keeps the agent's session and injects the answer. The factory's `needs-human` resume is "a fresh ticket execution with a new attempt chain" (§3.4) — the work is discarded.
5. **Boring substrate.** tmux and files. The factory's amendment log records six separate surprises from Herdr (no `agent stop`, no timestamps, inconsistent wire names, dropped status frames, workspace sprawl, env not reaching the agent). Both systems ultimately scrape pane text for status; SwarmForge's "last pane line that contains `I'm`" is cruder but has no protocol to drift.
6. **The `squad` role contracts.** `.contract.edn` files declare `may-web-search`, `may-spawn`, `may-talk-to-user`, `writes`, `forbidden-writes`, `required-tool-ids` as data. The factory's role tuple (§6.1) carries the same intent inside prompt templates and permission postures; the declarative form is easier to audit.
7. **Contract-first decomposition** (`platoon-brainstorm.md`): interfaces owned by the higher-level component, an accepted contract version is immutable, dependents start only when their contract is accepted. Unimplemented on their side, but it is a sharper rule than `to-tickets` currently states for multi-component maps.

## Honest liabilities on the factory side that this survey does not excuse

- 36k lines of controller for one merged PR, and a spec whose amendment log shows ~25 corrections "found by running". The design is sound; the delivery ratio is not yet evidence of robustness. #186 is open for exactly this reason.
- Quality per ticket today rests on one implementer session plus the `implement`/`tdd` skills. The reviewers cite; they do not refactor. That is the gap SwarmForge exposes.
- The monitor (fifteen open tickets #120–#134) is unbuilt, so the operator surface is a CLI and a SQLite file. SwarmForge has a working board, attention list, and pane pop-outs today.
- Parallel execution needs a second locked specification (#135, nine open grilling tickets). SwarmForge runs six agents now — but on a serial card pipeline, so its real parallelism is pipelining, and its concurrent-card story is "conflicts are expected".
- #178 shows a first-run dialog hang misattributed to the worker tier — the same class of silent misfire SwarmForge's log is full of, and the factory's own log is not yet clean of.

## What to adopt

Ranked by value per unit of change. Every item is expressed against existing factory contracts; none needs SwarmForge code.

1. **Declared post-implement quality phases.** Extend §8.1's pipeline with opt-in, config-declared agent-borne phases between `verify` and `review`: `clean` (entry skill `refactoring-pass`, behavior-preserving, must leave the required set green) and `harden` (entry skill to be written: strengthen tests against a mutation report). Each is a fresh attempt from the prior attempt's tip — §8.5's repair-tier mechanics already do this — with `verify` rerun between phases and the same `Factory-Attempt` trailer. Budgets: one attempt per phase, automation-tier retry only, no product retry (a failing clean pass is discarded, not repaired). Declared per repo in `.pi/factory.json` (`pipeline.phases`), default off, so the cost — two more worker sessions per ticket — is a choice. This is the one adoption that moves code quality.
2. **Mutation and complexity as declared checks.** `mutmut`/`cosmic-ray` (Python), Stryker (JS), and a CRAP-equivalent (`radon cc` joined with coverage) as `advisory` checks whose digest-referenced output is fed into the `harden` prompt as controller-produced fact. SwarmForge's idea done the factory's way: the controller runs it, the agent does not self-report it. Requires only §8.2's existing `checks` block plus a prompt-template slot.
3. **A mechanical requirement trace instead of the two-call audit.** SwarmForge's `AUDIT_REQUIRED` makes the same agent re-read the task before handing off. The factory can get the substance without a second turn: the builder outbox schema gains a mandatory `trace` block mapping each ticket requirement to a file and a test, and `harvest` refuses an outbox without one as `invalid-result` (§6.6). Cheap, typed, and it gives the spec reviewer something to check against.
4. **Resume a `needs-human` ticket from the prior tip.** Change §3.4 so a cleared label claims a *repair-tier* attempt from the paused attempt's tip with the human's answer in the prompt's trusted block, rather than a fresh execution from base. This is SwarmForge's `clarify` without keeping a session alive. Amendment, not silent edit.
5. **Contract-first ordering in `to-tickets`.** For maps spanning components, the skill should emit the interface-contract ticket first, owned by the higher-level component, and make every dependent `blocked-by` it; changing an accepted contract is a new ticket, never an edit. Skill change only; the factory's §3.2 closure rule already enforces the order.

Two smaller notes for #135 (parallel coordination), taken from the squad run rather than the design: (a) parallel writers drift vocabulary unless one shared language is an *input* to every worker — `CONTEXT.md` via `domain-modeling` should be in every closure, not only the reviewer's; (b) the first ticket of a new product must be a running walking skeleton, which `to-tickets`' tracer-bullet rule already says and the squad log confirms the hard way.

## What not to adopt

- **Persistent role sessions and tmux transport.** Long-lived context is why every handoff body has to say "Re-read your role and constitution." The factory's fresh-attempt-per-phase is the stronger discipline.
- **Merge-based propagation (`back-one`/`back-all`) and role worktrees.** It exists to keep six long-lived trees converged; the factory has one branch per attempt and rebases once, inside `verify`.
- **Prompt-only enforcement of quality tools.** The squad log is the counter-evidence.
- **`bypassPermissions` everywhere and "install latest from GitHub at startup".** Non-reproducible runs and an unbounded supply-chain surface; the factory's §6.8 floor forbids both, correctly.
- **The lieutenant chat and the dashboard code.** The monitor spec is locked and derives everything from the journal; a pane-scraping chat rail is a different product.
- **Babashka.** No shared runtime with anything in this package.
- **The Clojure/Java/Go tool chain.** Inapplicable to Python and JavaScript targets; the equivalents belong in `checks`.
- **The `squad` control plane.** Its own author's `redo.md` and `issues.md` say it is not done, and `main` moved on.

## Recommendation on the question actually asked

Ditching the factory for SwarmForge would trade a controller that verifies for a studio that trusts, lose the tracker as the queue, lose recovery, lose Python, and inherit a coordination model whose failure log its author has already published. The rational move is the reverse: keep the factory's substrate and put SwarmForge's pipeline depth on top of it as declared phases, then judge both on #186's three questions once a map has been run through with `clean` and `harden` on.
