# `factory/` AGENTS.md

The Software Factory's operator binary. This file holds the rules for `factory/` alone; the
repository [`AGENTS.md`](../AGENTS.md) stays the authority for repo-wide rules, and its
`## Mandatory commands` section — including `node --test tests/node/factory_*.test.mjs` for any
change here — is the only place checks are declared as prose.

## How to read this file

One row, one invariant: **the rule** — the module that owns it · the spec section it answers to.
Module paths are relative to `factory/lib/`; everything else is relative to the repository root.

**The reasoning is not here, and must never move here.** It lives in two places:
[`docs/specs/software-factory.md`](../docs/specs/software-factory.md) for the decision — the
authority, and what a change cites — and the owning module's own comments for how the invariant
is held, which is where you will find why the rejected alternative fails. Those comments run to
roughly 64,000 words across the 52 modules named below; this file is an index into them, and a
row that needs a paragraph to state is a row whose module is missing that paragraph.

A new invariant is a new row, not a new paragraph. `tests/test_factory_agents_index.py` holds
the shape and the budget: every row names a module that exists, every `§` is a section the spec
actually has, and the file stays under its line ceiling. When the ceiling is reached, the
question is which rows have become the module's job to state, not what the ceiling should be.

## Shape and packaging

- **Plain ESM under Node (`.mjs`), no build step.** TypeScript is reserved for the pi extension
  entries under `extensions/`. — `factory/`
- **One package, one version.** The binary ships from the root `package.json`'s `bin`; `factory/`
  is never separately installable and never grows its own `package.json`. — `package.json`
- **`proof/` is the only area unreachable from the binary, deliberately.** §6.7's acceptance
  matrix runs by hand from `tests/live/prove-skill-loading.mjs`, spends real turns, and records
  under `docs/proofs/`. Nothing in a run may come to depend on it. — `proof/matrix.mjs` · §6.7

## Configuration

- **Config is fail-closed and repo-bound**: one file at `<repo root>/.pi/factory.json`, no
  `--config`, no env overrides, no merge layering, no warn-and-continue path. — `config/load.mjs`
  · §11.2
- **Defaults exist only where an upstream decision already fixed the value** (`budgets`,
  `retention`); everywhere else absence refuses. — `config/defaults.mjs`
- **Budget bounds are per-key**, never one block-wide `max`. — `config/defaults.mjs` · §11.6
- **§6.8's `worker` block is *additions* to floors that live in code**, so its absent form is the
  empty addition, spelled once so no consumer branches on `undefined`. — `config/worker.mjs` ·
  §6.8
- **`factory migrate` is the only verb that writes the operator's config**, and the only verb
  exempt from the load — which is why it is a sibling of `doctor` rather than a flag on it. —
  `migrate/verb.mjs` · §11.8
- **§11.8's legacy-key disposition table is data**: one row maps and reports, a legacy key no row
  names refuses the migration, the five holes it leaves are `TODO` sentinels the loader
  hard-fails on, and `.pi/factory.v1.json` is preserved before anything is written. —
  `migrate/document.mjs` · §11.8
- **`AGENTS.md` is read in exactly one place**, once, at migration, only to draft the initial
  `checks` block for human review. No runtime parse, and no automated agreement check —
  thereafter this document and `checks` are kept in step by hand. — `migrate/matrix.mjs` · §11.6,
  §8.2

## Policy that is not configuration

- **Each piece has exactly one home**: the label vocabulary — `tracker/labels.mjs`;
  `MAX_SUPPORTED_TICKET_CONCURRENCY` — `config/concurrency.mjs`; `MAX_PANES_PER_TICKET` —
  `capacity/plan.mjs`; the closed domain enums (phases, run lifecycles, end reasons,
  dispositions, attempt outcomes) — `domain/vocabulary.mjs`; the event-kind enumeration —
  `state/events.mjs`.
- **The scheduler is capacity-parametric and never reads the ceiling.** —
  `controller/scheduler.mjs` · guard: `tests/node/factory_config_semantics.test.mjs`
- **Six run end reasons plus one controller exit outcome, as two values and never a union
  collection.** — `domain/vocabulary.mjs` · §10.3
- **§10.3's seven-row exit table sits beside them**, with import-time checks refusing a member
  with no row, a row naming no member, and an outcome that leaked into the reasons. —
  `cli/exit-codes.mjs` · §10.3
- **`controller-lost` maps to no exit code** and `exitCodeForEndReason` refuses it; it refuses
  `lease-lost` too, whose `EXIT_LEASE_LOST` names a process's exit and is refused by the `run`
  projector on a `run.ended`. — `cli/exit-codes.mjs` · §10.3
- **Exit `1` means usage or config-load failure and nothing else**; `0`, `2`–`6` and `9` belong
  to the run end-reason table, and `7` and `8` are verb-level markers that exist before any run
  does. — `cli/exit-codes.mjs` · §10.3
- **Neither the exit table nor `--json`'s `schema_version` is reachable from configuration.** —
  `cli/exit-codes.mjs` · §10.3
- **Every command answers from one structured value**, rendered human by default and `--json` on
  request. A verb that cannot do its job says what is missing; it never goes quiet and never
  half-runs. — `cli/` · §10.2
- **The envelope's `ok` tracks the exit code**, not "a report came back": a failed run still
  prints its report, and `error` is for a refusal. — §10.3

## Durable state

- **One SQLite store per repository** under the pi SDK's `getAgentDir()`. `node:sqlite` is
  imported by exactly one module, and `PI_AGENT_DIR` is never read. — `state/sqlite.mjs` · guard:
  `tests/node/factory_state_*.test.mjs`
- **An event and every projection it changes commit in one transaction, written from one place.**
  — `appendEvent` in `state/store.mjs`
- **`effect` and `lease` rows are canonical, not projections** — same transaction, never rebuilt
  from the journal. — `state/store.mjs`
- **The projection tables are the monitor's versioned read contract**: a projector whose output
  changes bumps its `version`, the head compare at open is fail-closed, and a missing head is a
  mismatch rather than a skipped check. — `state/projections.mjs`
- **A mismatched reader refuses that projection alone** (`projection-unreadable`) and still
  answers from the rest. — `state/projections.mjs`
- **Every lock is one row and one compare-and-swap, from one module.** — `state/leases.mjs`
- **The holder token is the only ownership proof**: the identity blob is advisory, nothing tests
  a pid, and no path removes a row without comparing the token. — `state/leases.mjs`
- **Fencing generations come from the one DB-wide counter**, so they order every lease against
  every other. — `state/leases.mjs`
- **The `controller` lease is the only row a clock may free**, and the TTL belongs to the lease
  object rather than to its caller; every other row is settled by its superseded generation and a
  probe. — `state/leases.mjs`
- **A lost controller lease is terminal**: stop issuing effects, emit, exit 6, never reacquire,
  and never self-close a run a successor may already have adopted. — `controller/lease-guard.mjs`
- **Every record moving a run's lifecycle goes through `hold.append`**, which compares the token
  inside the write's own transaction; a holder's in-memory latch is not proof. —
  `controller/lease-guard.mjs` · §14.5
- **A loss conceded before `run.started` commits names no run** — the loss event carries
  `run: null` and the exit-6 report names no phantom run. — `controller/lease-guard.mjs`
- **Integrity failure is never repaired**: the damaged database is quarantined byte-for-byte and
  replaced by a minimal fresh store carrying a typed `journal.integrity-failed` fact; a hash-chain
  break scopes to its own stream. — `state/quarantine.mjs`, `state/integrity.mjs`
- **Only projections are rebuildable**, only under a `REBUILD_REASONS` member, and every rebuild
  emits its reason, projector versions, and resulting head. — `state/rebuild.mjs`
- **The rebuild handle carries no `append` and no `transaction`.** — `openStoreForRebuild` in
  `state/rebuild.mjs`
- **Two ways only for a record to leave the journal** — whole-stream deletion for a run stream,
  front-truncation for `controller.heartbeat` — recording `stream.truncated {stream, up_to_seq,
  up_to_hash}` on the indefinite `controller` stream. Any other `DELETE FROM event`, and any
  renumbering or rewriting, is §14.7 broken. — `state/truncation.mjs` · §14.7 · guard:
  `tests/node/factory_state_integrity.test.mjs`
- **A global sequence hole is expected residue, never tampering**; only per-stream contiguity is
  verified. — `state/integrity.mjs`

## Effects and artifacts

- **Every mutation outside the database is an effect**: a requested/resolved pair keyed by §4.5's
  grammar, built in one place and written in one place. — `effects/keys.mjs`,
  `effects/records.mjs` · §4.5
- **An effect kind with no probe cannot be registered**, refused at construction; a new kind is a
  row in the catalogue and nothing else. — `effects/catalogue.mjs` · §5.3
- **Reads are not effects**: they appear in the catalogue only as a probe's `call`, and get
  durable observation cursors instead. — `effects/catalogue.mjs`
- **The payload digest sits beside the effect key, never in it.** Re-issuing a key with an
  identical payload returns the committed result; a different payload is a typed conflict. —
  `effects/records.mjs` · §4.5
- **When an effect key names an attempt, and when the slot is `-`, is one rule with one home**:
  the attempt when the subject is that attempt's own work (branch, worktree, evidence ref, pane),
  the ticket execution when the subject is something one ticket execution has exactly one of
  (`push`, `pr-create`, `assign`, `label-add`, `comment-post`). — `effects/keys.mjs` · §4.5
- **`pushAttemptBranch` takes no attempt parameter at all** — the wrong key is not something a
  caller can ask for. — `git/integrate.mjs`
- **An artifact is never referenced by path** — only content or an address, never a location. —
  `artifacts/blobs.mjs`, `artifacts/writes.mjs` · §12.1
- **The ledger row is canonical and keyed by content**, stamped with the later producer, with no
  reference counting. — `artifacts/ledger.mjs` · §12.1
- **The retention class is derived from the producer, never passed**, and byte accounting per
  class is a `GROUP BY` over the ledger. — `artifacts/ledger.mjs`
- **Large output goes in as bytes and comes back as §6.6's reference**; the bytes themselves
  never enter an outbox or an event payload. — `artifacts/writes.mjs` · §6.6

## Capacity, exhaustion, and dispatch

- **Capacity is arbitrated by named rows, never by a counter**: `capacity:ticket:<i>` and
  `capacity:model:<class>:<i>` are compare-and-swap holds on the lease primitive. —
  `capacity/slots.mjs` · §9.4
- **The resource class is derived from the profile (`resourceClassOf`), never declared**, and the
  pane bound is derived from the ceiling — **so no pane knob exists in config**. —
  `capacity/plan.mjs`
- **Slots carry no TTL**: a row records the generation of the *controller* lease that took it,
  and a superseded row is settled by probing its holder. — `reclaim` in `capacity/slots.mjs`,
  over `worker/adoption.mjs`'s probe · §5.5
- **The ticket slot spans the whole ticket execution and the model slot spans one attempt**,
  which is what makes hold-and-wait unconstructible. — `capacity/slots.mjs`
- **`capacity/report.mjs` is the one derivation of §9.7's numbers**: `held` is the rows,
  `waiting` is a walk over the journal, never a second tally. — `capacity/report.mjs` · §9.7
- **A capacity row settles three ways, and a lane is adopted whole or not at all**: a provable
  holder is transferred onto this generation on the predecessor's token in one transaction, a
  disproved one has its attempt settled first and its row released second, and an unanswerable
  read moves nothing. — `capacity/slots.mjs` · §9.4, §15
- **The transfer is gated on `preflight.ok` and on there being an executor**, and whatever a run
  adopted and never ran is released before it ends. — `capacity/slots.mjs`
- **What is still held at the end is named on the report** (`unsettled`). — `capacity/report.mjs`
  · §9.7
- **Provider exhaustion is a time-boxed capacity state, not a routing preference**: a quota or
  rate refusal is observed in the pane tail and typed `provider-refused`, overriding the three
  silence-based verdicts while a valid outbox still wins. — `matchRefusal` in
  `capacity/exhaustion.mjs` · §9.8
- **The refusal becomes a `capacity.exhausted` memo** naming the resource class and an expiry, on
  the `controller` stream with no run in the envelope; dispatch gates on it before launch. —
  `capacity/exhaustion.mjs` · §9.8
- **An expiry re-admits by probe, never by the clock**, and only an admission writes
  `capacity.admitted`. — `worker/readmit.mjs` · §9.8
- **A run left holding claimable work whose every route is memo-locked at the final scheduling
  decision ends `capacity-exhausted` (exit 9)** rather than draining. — `controller/scheduler.mjs`
  · §9.8
- **Dispatch answers with a route, not a class**: `dispatchOrder` is the declared profile then
  §11.5's fallbacks for that role, and `selectRoute` takes the first candidate whose class the
  memo has not locked. — `worker/dispatch.mjs` · §9.9, §11.5
- **There is one implementation of §11.5's resolution**; `capacity/plan.mjs` translates its
  refusal into a capacity one and adds nothing. — `capacity/plan.mjs` · §11.5
- **The decision is made before the claim and travels with the lane**, riding every mint
  (`attempt.launched`'s `routing`) and §8.9's block; **a launch reads the mint back** rather than
  the decision it just made. — `worker/dispatch.mjs` · §9.9
- **`provider-refused` routes to a `reroute` action that spends no budget**, bounded by each
  routable profile being *refused* at most once per ticket execution — derived from the attempts
  whose stage routed to a reroute, never a counter and never merely *dispatched*. —
  `pipeline/retry.mjs` · §8.10
- **Running out is `routes-exhausted`, one of §8.10's phase-less rows** — no attempt has it. —
  `pipeline/stages.mjs` · §8.10
- **A route is decided by the memo alone, never by the preflight**, which proves a profile's flag
  spelling and not that its model value resolves. — `worker/dispatch.mjs`

## The worker seam

- **§6.1's seam is four operations** — `preflight(role, package_rev)` · `launch` ·
  `awaitCompletion` · `cancel` — built by `createWorkerAdapter`, which refuses a missing or
  invented operation and validates every role as §6.1's five-slot tuple. — `worker/adapter.mjs` ·
  §6.1
- **The adapter knows nothing about which roles exist**: the role inventory is data, and a role's
  closure is computed from the pinned revision's `requires:` frontmatter, never hardcoded. —
  `worker/roles.mjs`, `worker/closure.mjs` · §6.1
- **Layer 1 is static** — readable SKILL.md for the whole closure, frontmatter and reference
  validation, symlink containment, and §6.8's one conflict predicate, where shadowed, duplicated,
  disabled and missing are one typed failure naming the offending source. — `worker/preflight.mjs`
  · §6.2, §6.8
- **Layer 2 is one disposable live probe per runtime per revision** on the production path — pi:
  an RPC session over `--no-skills --skill <root>` requiring `skill:<name>` command records;
  Claude: the §6.3 generator's plugin, then `plugin validate --strict`, the component diff, and
  the `initialize` control-request over stream-json. — `worker/probe.mjs`, `worker/plugin.mjs` ·
  §6.2, §6.3
- **The generated Claude plugin is cached per tree digest beside `state.db` and immutable** —
  factory infrastructure like the bare clone, not an effect. — `worker/plugin.mjs`
- **§9.7's capacity observation is folded into that same probe**, so a declared size above an
  observed `max_instances` and an unreachable required class are red checks naming the class, the
  endpoint, and the fix — never a silent clamp or a quiet capacity 0. — `worker/probe.mjs` · §9.7
- **`profile-flags` is a separate check whose cardinality is the profile's**: one session per
  distinct profile the active routing can dispatch, running that profile's own launch argv so the
  installed binary accepts or refuses `--model` / `--effort` / `--thinking` before a pane depends
  on the spelling. It costs no model call. — `worker/preflight.mjs` · §6.2
- **Layer 3 re-records the run-keyed handshake per attempt**, so package drift arrives as §4.5's
  typed payload conflict — a failure, never a new pin — and persists the observed resolved model
  id per attempt (`attempt.rechecked`), refusing a declared model that resolves to two ids within
  one run. — `worker/recheck.mjs` · §6.2, §11.7
- **The probes' IO lives behind one module and is injected in tests**, exactly as the Herdr probe
  is. — `worker/transports.mjs`
- **The package handshake resolves §11.7's four participating artifacts from the one manifest
  that declares them** — binary, factory extension, monitor extension when present, skills root —
  and proves they are one package. — `package/handshake.mjs`, `package/participants.mjs` · §11.7
- **The running executable is the anchor**; there is no configured package root. —
  `package/handshake.mjs` · §11.7
- **The deterministic tree digest is authoritative uniformly for every install shape**, with the
  git commit and a dirty flag recorded beside it as metadata only — checkouts are never
  special-cased. — `package/tree.mjs` · §11.7
- **Findings are data rather than exceptions**, since `doctor` runs the same handshake in report
  mode; `assertPackageIntact` is the one place they become the automation failure before first
  claim, with no severity ladder and no compatibility pass. — `package/findings.mjs` · §10.5,
  §14.35
- **`package.expect` declares a name and a version and nothing else** — a hand-declared digest is
  refused at load. — `package/version.mjs` · §11.7

## The worker's world

- **A worker's environment is built, never inherited.** One controller-owned config root per
  runtime beside `state.db` (`CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`), and a session's whole
  binding — env, flags, settings file — comes from it, including the preflight probes'. —
  `worker/environment.mjs` · §6.8
- **Three closed lists cross in and nothing else**: capability artifacts (credentials, the model
  catalogue, §6.5's agent-state integration), the declared worker-context file, and declared pi
  extensions. Promotion is declared and recorded; live inheritance is never a channel. —
  `worker/environment.mjs` · §6.8
- **The agent-state integration is version-observed out of the file's own `HERDR_INTEGRATION_*`
  header rather than assumed**, and copied into the run's roots and digested. —
  `worker/environment.mjs` · §6.5
- **`worker-agent-state` is a named red ending the run `baseline-red` before the first claim** —
  missing, unversioned, mis-identified, or outdated — per runtime the active routing can dispatch
  to, so `no-transcript-pointer` is an anomaly and never 15/15 nulls. — `worker/preflight.mjs` ·
  §6.5
- **Permissions derive from the role's posture, never from a profile**, and the deny floor (`git
  push`, `tea`, `gh`, in every spelling the matcher accepts) has one home. —
  `worker/permissions.mjs` · §6.8, §11.4
- **The builder binding is `dontAsk` plus broad tool-family allows** — never a per-command
  allowlist, never `acceptEdits`, which still prompts for Bash. — `worker/permissions.mjs` · §6.8
- **The reviewer binding is `dontAsk`** — plan mode requires an interactive approval — with edit
  tools still withheld. — `worker/permissions.mjs` · §6.8
- **Overrides may only add denies**: the config surface has no allow channel and no remove
  channel, and an inverted rule spelling fails to parse. — `config/worker.mjs` · §6.8
- **The floor's non-permission half is a disabled `pushurl` in every attempt worktree**,
  worktree-scoped so §7.5's integration push from the clone still works. — `git/attempt.mjs` ·
  §7.5
- **Pre-trust is per runtime's own resolution rule, not per path**: pi walks up to the nearest
  `trust.json` entry over **canonical** spellings — symlinks resolved, as pi resolves them before
  keying and before the walk — and Claude keys `.claude.json`'s `projects` map exactly, for a
  linked worktree on the repository's git common directory. — `worker/trust.mjs` · §6.8
- **What the writer writes is what the check reads back**, derived from the constants rather than
  hand-listed, so a fifth settled key cannot become a fourth unproven one. — `worker/trust.mjs`,
  `worker/preflight.mjs` · §6.8
- **The guarantee is the state predicate preflight asserts, not a green probe** — a `--print`
  probe never meets the dialog at all — and it reaches exactly as far as controller-owned state:
  interstitials gated on anything else are attribution's, not prevention's. — `worker/trust.mjs` ·
  §6.8
- **Every session's binding carries the flags that keep an interstitial off a pane**: Claude's
  browser fence and pi's trust approval, on the worker binding beside the discovery fence, and
  therefore on both postures and on the probes. — `worker/claude.mjs`, `worker/pi.mjs` · §6.8 ·
  evidence: `tests/live/claude-chrome-cache.mjs`
- **`createAttemptWorktree` requires the environment handle** and applies both the pushurl and
  the pre-trust outside the effect, so a re-entered attempt converges. — `git/attempt.mjs`

## Attempts

- **The attempt path is one order, and every step of it is where a crash puts it.** —
  `worker/lifecycle.mjs` · §6.4–§6.6
- **The manifest and the rendered prompt are written first**, into the controller-owned
  `attempts/<attempt_id>/` beside `state.db` — factory infrastructure, never an effect, and
  outside the worktree by topology so §12.7's eager deletion cannot take a result with it. —
  `worker/lifecycle.mjs` · §12.7
- **`attempt.launched` is the mint**: the projections refuse an attempt-scoped record for a tuple
  nothing minted. — `worker/lifecycle.mjs` · §6.4
- **One `agent-start` effect covers pane, stamp, identity variables, and agent.** —
  `worker/lifecycle.mjs` · §6.4
- **The pane is a tab in the run's own workspace**, opened by one `workspace-open` effect keyed
  by the *run*, adopted by every later attempt and every re-entering controller, and probed by
  the run's deterministic label because Herdr stamps no token on a workspace. —
  `worker/workspace.mjs` · §6.4
- **The `FACTORY_ATTEMPT` token is stamped before the agent**, and the probe asks for the token
  *and* a live agent, so an early stamp cannot fake a start. — `worker/lifecycle.mjs`
- **§6.5's identity travels on two channels** — the prompt, and `FACTORY_*` variables declared on
  the attempt's `tab create` rather than typed at its shell. — `worker/lifecycle.mjs` · §6.5
- **`workspace create` and `tab create` take `--env` and `agent start` takes none**, which is
  what puts the binding at the tab; a value crosses as one argv element, so no quoting helper
  survives here. — `controller/herdr-control.mjs` · evidence:
  `tests/live/herdr-tab-env-reaches-agent.mjs`
- **Identity is applied last**, so a declared binding cannot shadow it. — `worker/environment.mjs`
- **The transcript pointer is polled out of Herdr with backoff and never computed.** —
  `worker/lifecycle.mjs` · §6.5
- **The pin is compared before the prompt** — the prompt is the first thing that spends. —
  `worker/lifecycle.mjs` · §6.2
- **`attempt.correlated` is what makes a launch finished**, and carries the agent kind on payload
  v2 so §5.5's third adoption test compares against an observation rather than a derivation. —
  `worker/lifecycle.mjs` · §5.5
- **A re-entry finishes an uncorrelated attempt and refuses a correlated one**, whose live worker
  is adopted instead. — `worker/lifecycle.mjs`, `worker/adoption.mjs` · §6.4
- **Every runtime difference is two values**: the Herdr agent kind, and the name `prompt.mjs`
  turns into `/skill:<name>` or `/<plugin>:<name>`. — `worker/claude.mjs`, `worker/pi.mjs`
- **§2.1's attempt ordinal is allocated against the record**, never derived from the attempt
  being answered. — `allocateAttempt` in `worker/attempt.mjs` · §2.1
- **Idempotency is the minter's purpose, not the counter's**: a caller says what it is minting
  *for*, and a record already naming that purpose hands back the same id. — `mintAttempt` in
  `worker/attempt.mjs` · §8.4, §8.5
- **The first prompt is one renderer parameterised by the role, not four templates**, and it is
  deterministic — nothing in it reads a clock or a directory, which is what lets its digest ride
  `attempt.launched`. — `worker/prompt.mjs` · §6.4
- **§6.4's completion-protocol obligation lives only in the prompt renderer** — a package skill
  stating it would be a factory dependency inside a product the factory does not own. —
  `worker/prompt.mjs` · §6.4 · guard: `tests/node/factory_worker_prompt.test.mjs`
- **Workers get no tracker credential**, so the ticket arrives as a claim-time snapshot dated by
  the tracker's own clock. — `tracker/snapshot.mjs` · §6.8

## Waiting, adoption, and Herdr

- **§6.6's wait is first-signal-wins over two sources answering different questions**: Herdr is
  subscribed to, because a poll cannot see `working → blocked → working` between samples, while
  the outbox is a file that appears once and is re-read on an interval. — `worker/outbox.mjs`,
  `controller/herdr-events.mjs` · §5.1, §6.6
- **Liveness means "still working", not "the process exists"** — neither harness exits when a
  turn ends. — `controller/herdr-events.mjs` · §6.6
- **The state table is one function**, with the two silences split by fault: `no-result` is the
  worker's, `dead-worker` is the automation's. — `decideOutcome` in `worker/outbox.mjs` · §8.10
- **A pane never observed working had no turn to end**, so both silence rows become
  `worker-never-started` on the automation budget — a state predicate over the working status
  alone, never a launch window, and read from the attempt's durable observation records so a
  controller re-entry answers the same. The wait's own seed read is recorded for that reason. —
  `observedWorking` in `worker/lifecycle.mjs` · §6.6, §8.10
- **A settled worker gets a grace before its silence is called silent-completion.** —
  `worker/outbox.mjs` · §6.6
- **An attempt ends once**: the projector refuses a second `attempt.ended`. —
  `state/projections.mjs`
- **A subscription is re-established by pane id** after a Herdr server restart — polling covers
  the gap and stops when the socket takes the question back, and the recovery clears the flag
  that would otherwise charge the automation for the worker's next silence. —
  `controller/herdr-events.mjs` · §5.1
- **Adoption asks §5.5's five tests together and answers three ways** — token · pane alive ·
  agent kind · recorded worktree · outbox path intact, each able to prevent adoption on its own;
  the third answer exists because an unanswerable read and an unreadable path both taught the
  process nothing. — `worker/adoption.mjs` · §5.2, §5.5, §12.4
- **The adoption module mutates nothing and asks about nothing but the pane** — no quit sequence
  and no pid in it. — `worker/adoption.mjs` · §5.5 · guard:
  `tests/node/factory_worker_adoption.test.mjs`
- **What a row may be adopted *for* is re-derived from the journal**, never read off the advisory
  identity blob: unfinished and correlated. — `worker/adoption.mjs` · §6.4
- **Acting on the verdict belongs to the modules that own the writes**: `capacity/slots.mjs`
  moves the row, and `settleUnadoptable` ends the attempt through the same `settle()` every other
  ending uses. It stops no agent. — `worker/lifecycle.mjs` · §13.B
- **Herdr has no `agent stop`** — verified against protocol 19 — so §13.B's "the controller stops
  agents and never closes panes", nor tabs, nor the run's workspace, is `agent send-keys` with the
  harness's own quit sequence. — `controller/herdr-control.mjs` · §13.B
- **The quit sequence is two calls, and the grouping is load-bearing**: `esc` alone, a settle,
  then `ctrl+c ctrl+c` together. A change to either half is a claim about somebody else's TUI —
  re-run the probe rather than reasoning about it. — `AGENT_STOP_KEY_CALLS` in
  `controller/herdr-control.mjs` · evidence: `tests/live/herdr-agent-quit-sequence.mjs`
- **A harness that ignores the quit sequence leaves a wedged pane recorded as an anomaly and
  never escalated.** — `controller/herdr-control.mjs` · §13.B
- **The availability probe and the commands are two modules**, because "the factory checks the
  multiplexer, it does not manage one" is checkable only as *the probe imports nothing that can
  start a process*. — `controller/herdr.mjs`, `controller/herdr-control.mjs`
- **Herdr dates nothing**, so `EVENT_SOURCES` declares `statesTime: false` for it and §4.3's
  `occurred_at_raw` is refused on that source rather than filled with our clock under Herdr's
  name; `observed_at` dates the record. — `state/events.mjs` · §4.3
- **Herdr's foreign id names the fact, not the pane** — a transition's ordinal within the
  attempt, a reading's own liveness — or §5.1's dedup index would suppress every sighting after
  the first. — `controller/herdr-events.mjs` · §5.1

## Git isolation

- **Git operates exclusively on a factory-private bare clone** beside `state.db`; the operator's
  checkout is never read or written, and the protection is topological. — `git/clone.mjs`,
  `git/repo.mjs` · guard: `tests/node/factory_controller_start.test.mjs`
- **The clone is `init --bare` plus a refspec-less named remote**, never `git clone`, so every
  ref in it is one the factory wrote deliberately. — `git/clone.mjs` · §14.11
- **Fetches pin the base under `refs/factory/base/*` with `--no-tags`, serialized per handle.** —
  `git/clone.mjs` · §7.7
- **Structural damage means rebuild, never in-place repair**; a drifted remote URL converges by
  `set-url`, because a rebuild would discard attempt branches that are the only copy of unpushed
  work. — `git/clone.mjs`
- **Branch and worktree are effects with the pinned base in both payloads**, so §7.2's "never
  chased mid-attempt" arrives as a typed payload conflict. — `git/attempt.mjs` · §7.2
- **The per-worktree config carries the dedicated factory identity** (`FACTORY_GIT_IDENTITY`,
  code not configuration), and `core.bare` moves into the bare repo's `config.worktree`. —
  `git/attempt.mjs`
- **Every identity-derived path is contained by charset plus canonicalize-and-assert-prefix**,
  which is also what lets the git probes recompute a worktree path from an effect key alone. —
  `git/attempt.mjs`, `git/probes.mjs` · §2.1
- **§7.4's harvest predicates are typed verdicts** — a dirty worktree names its leftovers and is
  never auto-committed. — `git/harvest.mjs` · §7.4
- **`git-isolation` fails closed on `.gitmodules` or LFS attributes read from the fetched base
  tree**, never from the checkout. — `git/isolation.mjs` · §7.8
- **Nothing force-updates anything, and nothing resolves a conflict.** — `git/integrate.mjs`
- **The integration worktree is detached** and the branch is moved onto the rebased result by
  `update-ref` naming the value it replaces — a compare-and-swap. — `git/integrate.mjs` · §4.6
- **A conflicting rebase is aborted**, reported with the paths read off the index because git's
  prose is localized, and left to §8.5's fresh-retry. — `git/integrate.mjs` · §8.5
- **§7.4's integration-side predicates are commits-ahead, `git diff --check`, and §7.3's
  correlation trailer on every commit**, matched on run and ticket rather than on the attempt.
  They need no worktree. — `git/integrate.mjs` · §7.3, §7.4

## Tracker

- **The tracker is read through `tea` and holds no credential of its own**: `tracker.login` names
  a `tea` login, and `tea` resolves the instance and the secret. — `tracker/gitea.mjs` · §6.8,
  §11.2
- **Two modules shell out to `tea` and no others**; the reader hardcodes `--method GET` and takes
  no method argument. — `tracker/gitea.mjs`, `tracker/writer.mjs`
- **Status comes from `--include`, never from the exit code** — `tea api` exits `0` on a 404 and
  prints the error body. — `tracker/gitea.mjs`
- **Labels go through Gitea's appending `POST`, never the replacing `PUT`, and there is no
  removal at all**, which is how §14.20's "a label is cleared by a human or not at all" becomes
  unexpressible. — `tracker/writer.mjs` · §14.20
- **The writer performs and records nothing**; `mutations.mjs` owns "record the intent, perform,
  record the outcome" for both callers. — `tracker/mutations.mjs` · §4.5
- **A comment effect digests the intent, never the prose rendered from it.** —
  `tracker/mutations.mjs` · §3.3, §8.9
- **A claim is an assignee plus a structured comment plus a re-read**, and the slots are already
  held when it runs. — `tracker/claims.mjs` · §3.3, §14.21
- **Whose claim an existing assignee is, is answered from durable state and never from a
  comment**: a foreign assignee is an absolute human claim with no clock consulted, a live
  same-factory claim is never contested, a proven-dead one is taken over with the takeover comment
  posted first and no waiting period, and only a claim this store cannot account for waits §3.3's
  24h. — `tracker/claims.mjs` · §3.3
- **A claim this factory made and released is not proof of a claim standing now.** —
  `tracker/claims.mjs` · §3.3
- **Comment ids arbitrate simultaneous claims, never comment text**, and only between factories;
  every comment this store's effect rows account for is excluded. — `tracker/claims.mjs` · §5.2
- **The contest window opens at the pre-claim read**, or a concluded claim's lower id would make
  its ticket permanently unclaimable. — `tracker/claims.mjs` · §3.3
- **Every timestamp in a claim is the tracker's**, and a tracker that will not state its clock
  refuses the claim rather than substituting ours. — `tracker/claims.mjs` · §3.3
- **The loser of a contest writes nothing** — §3.3's *a live claim is never contested* outranks
  its *the loser un-assigns itself* where the two collide. — `tracker/claims.mjs` · §3.3
- **The claim's effects carry no attempt**: the claim belongs to the ticket execution. —
  `tracker/claims.mjs` · §9.4
- **A disposition is §8.9's table applied to the tracker, and the table is data**: three rows add
  one label and retain the assignee, `released` drops the claim and adds none. No row removes a
  label and no row re-adds `ready-for-agent`. — `tracker/disposition.mjs` · §8.9
- **The eligibility change goes first and the announcement second.** — `tracker/disposition.mjs` ·
  §14.20
- **All four rows post one machine-parseable JSON block** — identity tuple, the outcome chain read
  back from the journal, evidence by digest — **carrying no clock reading of ours**. —
  `tracker/disposition.mjs` · §8.9
- **Evidence comes from the ticket execution's own artifact-write effect rows**, not §12.1's
  ledger, whose producer columns name the most recent production. — `tracker/disposition.mjs` ·
  §12.1
- **A pause with no question, a publication with no PR link, and a reason class whose §14.18
  disposition is a different one are refused before any mutation.** — `tracker/disposition.mjs` ·
  §14.18
- **§9.6's abandon boundary settles through the same module**: `settleAtBoundary` records
  `released` for every in-flight execution and then applies the row. — `tracker/disposition.mjs` ·
  §9.6
- **§3.3's contest loser settles its own row when it loses**, journal-only. —
  `tracker/disposition.mjs` · §3.3
- **Disposition refusals are carried into the §3.5 report (`released_unsettled`)** — an
  unreachable tracker costs that ticket §3.3's staleness and an alarm, never the run's own
  `run.ended`, lease release, and exit 4. — `controller/drain.mjs` · §3.5
- **§7.5's pull request is check-then-create inside §4.5's pair.** — `tracker/pulls.mjs` · §4.5,
  §7.5
- **The PR body is a fenced JSON block followed by `Closes #N`**, so the manual merge discharges
  the ticket. — `tracker/pulls.mjs` · §7.5
- **§8.7's summary and advisory findings ride the PR and the §8.9 comment alike; blocking
  findings ride the attestation artifact and nothing else.** — `tracker/pulls.mjs` · §8.7
- **The stale-PR sweep closes each superseded factory PR of the same ticket and leaves alone any
  PR whose body is not ours.** — `tracker/pulls.mjs` · §7.6
- **§5.2's authority table is code**, and every observation passes `requireAuthority` before it is
  written. — `tracker/authority.mjs` · §5.2
- **Comment text is authoritative for nothing** and cannot be asserted at all, so a missing
  comment reads as `possibly-deleted` and never as `never-posted`. — `tracker/authority.mjs` ·
  §5.2
- **`worker.alive` is Herdr's one fact; the outbox is `evidence` and the journal is `intent`,
  never `proof`.** — `tracker/authority.mjs` · §5.2
- **§5.1's observation cursor is canonical, not a projection** — a watermark, and rebuilding it
  from a journal whose run streams expire would silently re-poll a repository's whole history. —
  `tracker/observation.mjs` · §5.1
- **The watermark is a record's `updated_at` and never our clock**; a cursor with no record to
  anchor to takes the tracker's own `Date` response header. — `tracker/observation.mjs` · §5.1
- **The foreign id names the fact, not the object** (`gitea:<kind>:<id>@<revision>`), and the
  graph fact is keyed by the timeline entry that caused its read. — `tracker/observation.mjs` ·
  §5.1
- **Dedup is enforced by a partial unique index**, not by the poll behaving itself. —
  `tracker/observation.mjs` · §5.1
- **A run's scope is a live selector, so `frontier.mjs` caches nothing** — every `readScope` is a
  fresh set of reads. — `tracker/frontier.mjs` · §3.1
- **Parent membership is the anchored `Part of #N` first body line and nothing looser**, and
  candidates come from the `workflow:implement` label server-side. — `tracker/membership.mjs` ·
  §3.1
- **A parent no candidate declares is refused `scope-empty` before a run exists**; `readScope`
  reports `candidates` beside `members`, and `doctor` raises the same alarm. A parent whose
  members are all closed is not empty. — `tracker/frontier.mjs` · `controller/start.mjs` · #181
- **A bare number carrying `wayfinder:map` is rewritten at start to the parent-scoped selector
  over it** — one read per typed ticket, above the process-shape branch, only for a start that
  would read a live frontier; a map beside other tickets is `scope-invalid`. —
  `controller/map-scope.mjs` · #182
- **A parent scope with no `ready-for-human` member warns `no-human-sink`, never refuses**; the
  drain report carries `sink`, and a delivered scope's headline leads with it. —
  `tracker/frontier.mjs` · `controller/drain.mjs` · #183
- **The edge set is a parameter**: a caller maintaining the graph from the poll passes it, and
  `doctor` omits it. — `tracker/frontier.mjs` · §5.1
- **`awaits_external` is a field rather than a seventh member class.** — `tracker/frontier.mjs` ·
  §3.5
- **`readScope` reads edges only for members an edge could reclassify** — `decide` consults
  blockers exactly once, after every state and label check has passed. — `tracker/frontier.mjs`

## The pipeline

- **§8.6's budgets are counted, never incremented**: a spend is a count of the `stage.resolved`
  records that charged that budget, read back from the journal. — `pipeline/budgets.mjs` · §8.6
- **`BUDGET_KEY_FOR_ACTION` is the whole relationship between §8.10's Action column and §11.6's
  three numbers**; the suite asserts the spending rows and the budget-column rows are the same
  set, both directions, and greps the shipped tree for the legacy counter names. —
  `pipeline/budgets.mjs` · §8.10, §11.6
- **The budget is asked in `walkStages` before the seam and never inside it.** —
  `pipeline/stages.mjs` · §8.6
- **Budget exhaustion is a disposition rather than a crash** — a throw only because §8.4's
  fan-out spends inside a phase executor. — `pipeline/budgets.mjs` · §8.4
- **An automation retry mints an attempt only where there is a worker to run again.** —
  `pipeline/retry.mjs` · §8.5, §8.8
- **A `retry` of an agent-borne phase relaunches from the prior tip under the profile already
  dispatched** — nothing was judged, so nothing is discarded and nothing is re-routed. —
  `planAutomationRetry` in `pipeline/retry.mjs` · §8.10
- **A `retry` of a controller phase mints nothing**: `verify` and `integrate` have no worker, and
  the walk re-enters them under the attempt it is already on, at the next **try** — the fifth slot
  of `(run, ticket, phase, attempt, try)`. — `pipeline/stages.mjs` · §8.10
- **The walking attempt is always a builder attempt.** — `pipeline/stages.mjs` · §8.5
- **`retried()`'s loop guard refuses a seam that answers with the attempt it was handed.** —
  `pipeline/stages.mjs`
- **The review phase fans out from the controller**: two read-only attempts, each with its own
  entry skill, outbox, attempt identity, and **its own worktree at the reviewed commit**. —
  `pipeline/review.mjs` · §7.3, §8.4
- **The axes run in sequence and both to completion** — neither is cancelled on the other's
  rejection. — `pipeline/review.mjs` · §8.4, §15
- **Each axis resolves its own `stage.resolved` under its own attempt**, and the phase's own
  result is resolved by the walk under the *builder* attempt. — `pipeline/review.mjs` · §8.10
- **`STAGE_ACTIONS.verdict` is never the walk's to take** — reaching it there means an executor
  answered a phase with an attempt outcome. — `pipeline/stages.mjs` · §8.10
- **Blocking sets are unioned by concatenation in axis order**, each finding tagged with the axis
  that wrote it — nothing merged, deduplicated, or reranked. — `pipeline/review.mjs` · §8.4
- **§11.5's `review` pair maps onto the axes positionally.** — `pipeline/review.mjs` · §11.5
- **Both ends of the diff are read off the passing verify record**, never taken from the caller.
  — `verifiedBoundary` in `pipeline/review.mjs` · §14.13
- **The fixed point reaches the worker through `renderAttemptPrompt`'s `review` block**, required
  for a role whose expectations name verdicts and refused for one that does not. —
  `worker/prompt.mjs` · §8.4
- **The authoritative read-only guard is the attestation, not the permissions**: clean worktree
  *and* HEAD captured before the review and verified unchanged after — both halves. —
  `git/attestation.mjs` · §6.8
- **An opening capture that is already dirty is a mutation too**, not an automation problem. —
  `git/attestation.mjs` · §6.8
- **`mutation-detected` is §8.10's only outcome with no retry at all.** — `pipeline/review.mjs` ·
  §8.10, §14.19
- **The attestation answers a typed verdict and never an outcome**, exactly as §7.4's harvest
  predicates do. — `git/attestation.mjs` · §7.4
- **`worker/outbox.mjs` judges the shape a written verdict must have** — the closed pair, a
  findings list, a mandatory citation per finding, and the word agreeing with its own blocking set
  — **while whether a verdict is owed stays in `pipeline/review.mjs`.** — §8.4
- **`worker/outbox.mjs` judges the shape of a written requirement trace** — non-empty rows, both
  fields text — and never its truth; **whether one is owed is `missingResult` in
  `worker/roles.mjs`**, read off the role's own `writesTrace` expectation by the builder executor.
  — `builderResult` in `pipeline/production.mjs` · §6.6
- **An invalid result's stage detail is the controller's own problems and never the refused
  record**; §8.10's `implement × invalid-result` row marks it fact so the fresh attempt is told
  which block it omitted, and the outcome chain — hence §8.9's disposition comment — carries it.
  — `pipeline/table.mjs`, `outcomeChain` in `pipeline/stages.mjs` · §8.5, §8.9, §8.10
- **A §6.6 problem sentence never embeds a worker-written value** — it names the field and the
  closed set — because those sentences reach the fresh attempt as fact. — `worker/outbox.mjs` ·
  §8.5
- **The trace is read off the reviewed attempt's own implement record**, never taken from the
  caller, and a review reached without one refuses rather than briefing the axis blind. —
  `builderTrace` in `pipeline/review.mjs` · §8.4
- **Every axis is handed the trace and the template renders it for the role whose expectations
  say `checksTrace`**, inside the computed untrusted boundary; a checking role rendered without one
  is refused. — `worker/prompt.mjs`, `worker/roles.mjs` · §8.4
- **The controller never classifies a citation**: recognising a baseline smell by name would put a
  second copy of the skill's list in the factory, and downgrading a finding would be the reranking
  §8.4 forbids. — `pipeline/review.mjs` · §8.4
- **The integration lease is acquired twice, and the gap is the point**: `[lease] fetch → evidence
  ref → rebase → the required set [release]`, then the two review axes with no lease held, then
  `[lease] base unchanged? → predicates → push → PR [release]`. — `pipeline/integration.mjs` ·
  §9.5
- **The rebase is in `verify`, not in `integrate`**, which is what makes §8.2's invariant
  literally true — the checks always run at the post-rebase commit that will be pushed. —
  `pipeline/integration.mjs` · §8.2, §14.13
- **`integrate` re-acquires under a base-commit identity precondition and loops back to re-rebase
  and re-verify, consuming no budget**, because nothing failed. — `pipeline/integration.mjs` ·
  §9.5
- **The integration lease is a row *and* an in-process turn**: the row is what reconcile finds
  after a crash, the chain is what makes a second lane wait. — `pipeline/integration.mjs` · §9.5
- **A red re-verify inside §9.5's loop is `integration-red`**, carrying no automation fault. —
  `pipeline/integration.mjs` · §8.6

## Checks

- **The checks are declared, never discovered**: the validated `checks` block and nothing else —
  no manifest, no Makefile, and `AGENTS.md` prose is never parsed at runtime. — `checks/run.mjs` ·
  §8.2, §14.34
- **The selector is the closed pair `required | all`**, so per-surface targeting is not a question
  the API can be asked. — `checks/run.mjs` · §8.2
- **`feeds` is advisory-only and names agent-borne phases**, unique, defaulting to empty; unknown
  phases and `review` refuse the config rather than becoming inert policy. — `config/checks.mjs` ·
  §8.2, §11.6
- **Fed evidence is selected from policy plus the verify record** and resolved through the
  artifact ledger — never from a caller-supplied string; a reference the ledger cannot answer is
  a sentence naming the digest, never a throw. — `pipeline/feeds.mjs` · §8.2, §8.7, §12.5
- **One check-evidence record, one trust boundary**: the record is built in `checks/evidence.mjs`
  and rendered by field selection, digest-labelled beneath a controller-owned heading that marks
  output as data, not instructions; the generic verify fact of a repair prompt carries the
  required set alone. — `worker/prompt.mjs`, `factDetail` in `pipeline/repair.mjs` · §8.2, §8.5
- **Fault attribution lives in one function**: a required check exiting inside its declared
  expected-failure codes is the worker's failure; a timeout, a signal, a missing exec, or any
  other code is `unrunnable` — an automation failure. — `checks/run.mjs` · §8.2
- **A timed-out check is killed as a process group.** — `checks/run.mjs`
- **§14.23's "two lanes never run mechanical checks concurrently" is one in-process chain, not a
  lease**; `checks[].parallelSafe` is the recorded v2 upgrade. — `checks/run.mjs` · §11.6, §14.23
- **Running a check is not an effect, but recording its output is** — keyed by the *execution*,
  not by the check alone; stdout/stderr is content-addressed and later reachable only through its
  ledger row. — `checks/artifacts.mjs` · §4.5, §8.7
- **§8.3's baseline gate is a detached throwaway worktree** under `baselines/`, deleted eagerly
  when green and retained when red, writing nothing durable. — `checks/baseline.mjs` · §8.3, §12.7
- **`doctor --baseline` shares the isolation path, not preflight's selection**: doctor explicitly
  runs `all` and reports advisory severity, while preflight keeps the `required` gate. —
  `checks/baseline.mjs`, `doctor/report.mjs` · §10.5, §14.24
- **Differential no-new-failures verification is deliberately absent**, and the comment saying so
  is load-bearing. — `checks/baseline.mjs` · §8.3

## The controller and the run

- **`factory start` is one invocation, one run**: acquire, reconcile, end any run `--new-run`
  abandons, expire, open the run, preflight, drain, atomically end and release. —
  `controller/start.mjs` · §10.1
- **The end reason is decided before the run executes** — a red preflight and a lost lease both
  already settled it. — `controller/start.mjs` · §10.3
- **§10.4's re-entry is not a mode**: there is no `resume`, a scope-less `start` adopts the
  orphaned run keeping its `run_id`, and a scope that would widen an adopted run's membership
  refuses. — `controller/start.mjs` · §3.1, §10.4
- **Against a live holder it resolves rather than queueing**, and refuses whatever it cannot
  decide from durable state. — `controller/start.mjs` · §19
- **A run ends at most once, and every ended run has a reason**: `run.ended` and the controller
  lease release commit in one token-checked transaction. — `controller/start.mjs`
- **Preflight is observable, not a gate**: every check writes a `preflight.checked` stage on the
  run's stream carrying no ticket, in §9.7's order — artifacts and config, then probes, then the
  expensive baseline. — `controller/preflight.mjs` · §9.7
- **A check whose subsystem has not landed answers `unbuilt`**, which is neither `passed` nor
  `failed`. — `controller/preflight.mjs` · §9.7
- **The drain report names the subsystems that would have found work**, so a green-looking run
  that did nothing cannot hide. — `controller/drain.mjs` · §9.7
- **The run manifest and the package handshake are effects keyed by the run**, so a re-entry whose
  declared inputs changed is a typed conflict. — `controller/manifest.mjs` · §3.1, §11.7
- **The scheduler is §9.6's loop and nothing more: no queue object, no ready-queue, no aging, no
  priority.** It re-reads the frontier at every scheduling decision and takes the lowest-numbered
  claimable ticket. — `controller/scheduler.mjs` · §9.6
- **Backpressure is not claiming** — nothing is buffered and no intent is queued. —
  `controller/scheduler.mjs` · §9.6
- **The frontier reader and the execution of one ticket are injected**, so the loop stays testable
  at any capacity with no override seam. — `controller/scheduler.mjs`
- **§5.5's `resumed` lanes are not a third kind**: they were running before the first frontier
  read, and a ticket already running is not a candidate again. — `controller/scheduler.mjs` ·
  §2.1, §5.5
- **The circuit breaker reads terminal-commit order, and its verdict is monotone**: the journal's
  own sequence over `ticket.disposition-changed`, never a clock. — `controller/breaker.mjs` · §3.5
- **It asks *has this run ever reached N in a row*, not *are the last N*.** —
  `controller/breaker.mjs` · §3.5
- **The scheduler's `claiming` predicate and `endReasonOf` call the one function**, and the
  verdict is on every run's report. — `controller/breaker.mjs`
- **Automation-versus-product is the disposition's own `fault`**, carried on
  `ticket.disposition-changed` payload v2, never a list of reason classes matched a second time. —
  `controller/breaker.mjs` · §8.6
- **An operator's explicit stop outranks the breaker in `endReasonOf`.** —
  `controller/breaker.mjs`
- **N is `budgets.circuitBreaker`, taken with no default.** — `controller/breaker.mjs` · §11.6
- **§3.5's drain owns both clauses** — nothing claimable now, and nothing that can become
  claimable without external change, the second read off `awaits_external`. —
  `controller/drain.mjs` · §3.5
- **The report's classes are §3.5's six exactly**; a member blocked by an in-scope blocker takes
  its blocker's class and carries `blocked_by`. — `controller/drain.mjs` · §3.5
- **Cycles are reported, not walked.** — `controller/drain.mjs`
- **A scope nobody read is `drained: null`, never `true`.** — `controller/drain.mjs` · §3.5
- **A lane that ran is not a ticket claimed**: the loop counts `lanes_run` and the report derives
  `claimed` from what the lanes answered. — `controller/drain.mjs` · §3.3
- **The frontier and the claim are wired together or not at all**, and the report names that half
  rather than reporting a scope that drained. — `controller/drain.mjs`

## Reconciliation

- **An unresolved effect is settled only by re-probing the external system**, and `doctor` is the
  identical computation behind a read-only flag. — `reconcile/` · §5.4
- **A conclusion outside the closed four, an empty basis, or `journal-intent` offered as a source
  cannot be constructed.** — `reconcile/conclusions.mjs` · §14.1, §14.2
- **The engine ships once; each effect kind's probe ships with the subsystem that introduces that
  kind**, registered by its §4.5 read. — `effects/registry.mjs` · §4.5, §5.3
- **An effect nothing could probe is left exactly as it was and reported** — no probe means no
  evidence, therefore no `reconcile.concluded` record at all. — `reconcile/` · §12.4
- **Scope follows the effect rather than the run**: a ticket-less effect of an ended run and a
  repo-scoped one are entities too. — `reconcile/` · §12.4
- **§5.4's "before the lease is used for any effect" is a latch only a settling pass opens** —
  `fence()` refuses until then. — `controller/lease-guard.mjs` · §5.4

## Retention and cleanup

- **Retention is the horizon, the pins, and one subtractive pass.** — `retention/` · §12
- **The tier-1 horizon is a union** — a run inside the last `fullDetailRuns` *or* inside
  `fullDetailDays` — ranked over the permanent digest rather than the surviving set. —
  `retention/horizon.mjs` · §12
- **§12.4's three pins are read from durable state alone**, and where durable state cannot answer
  the pin holds. — `retention/pins.mjs` · §12.4
- **No clock reaches `pinsForRun`**: the pins hold a run past the horizon rather than carrying one
  of their own. — `retention/pins.mjs` · §12.4
- **The label pin releases only on a later repository-wide poll's `observation.recorded` that
  states `ticket.labels`**, with the run's own §8.9 disposition as the fallback — most observations
  of a ticket establish nothing about its labels. — `retention/pins.mjs` · §5.1, §14.20
- **The open-PR pin releases on the *ticket's* observed state, not the PR's**, because §5.1 polls
  issues and never pull requests. — `retention/pins.mjs` · §5.1
- **Only an `ended` run is a candidate**; an unended one is held as `live`, which is not a fourth
  pin and which `doctor` alarms on. — `retention/expiry.mjs` · §12.6
- **`retentionAccounting` and `planExpiry` write nothing and are the one derivation `status`,
  `doctor`, and the deleting pass all answer from — and no size is an input.** —
  `retention/expiry.mjs` · §12.10, §14.30
- **Each run expires in one token-checked transaction**: tombstones, effect rows, derived
  projections, `deleteStreamWhole`, and `run.expired` on the `controller` stream. —
  `retention/expiry.mjs` · §12.6
- **The blob unlink is not an effect** — an amendment §4.5 now carries in its own text — and the
  tombstone commits before the unlink so a crash resolves to `retention-expired` rather than
  `blob-missing`. — `retention/expiry.mjs` · §4.5
- **Heartbeats truncate to the first sequence of the oldest surviving run stream** — one knob, and
  a sequence rather than a clock. — `retention/expiry.mjs` · §12
- **Cleanup is plan-then-execute, and there is no `--force` anywhere in it.** — `cleanup/plan.mjs`,
  `cleanup/execute.mjs` · §12.8
- **§12.8's whitelist is exactly six kinds**, with the factory-private clone outside them and
  reachable only by naming it in `--kind`. — `cleanup/targets.mjs` · §12.8
- **The plan is enumerated from the world and judged by durable state** — worktrees registered in
  the private clone, refs under `factory/`, panes carrying a factory token, blobs on disk. —
  `cleanup/plan.mjs` · §12.8
- **`cleanup-execute` runs cleanup before the expiry pass §12.6 folds into it.** —
  `cleanup/verb.mjs` · §12.6
- **Eligibility is the attempt being terminal and §12.4's pins being clear** — the same
  `pinsForRun` expiry uses — **and never pane liveness**. — `cleanup/plan.mjs` · §12.4
- **Panes are enumerated by token, never by a recorded pane id**, since Herdr reuses ids. —
  `cleanup/panes.mjs` · §14.27
- **The controller's own pane wears `FACTORY_RUN`, stamped only where `launch.mjs` declared
  `FACTORY_CONTROLLER_PANE`** — an operator's `--foreground` terminal is never marked and never a
  target. — `controller/launch.mjs` · §14.27
- **Cleanup's effect records are repo-scoped**, so they land on the `controller` stream. —
  `cleanup/execute.mjs` · §4.3
- **`worktree remove` carries no `--force`**, so git re-applies the untracked-work guard at the
  moment of deletion. — `cleanup/execute.mjs` · §12.8
- **`cleanup/panes.mjs` is the only module allowed to build a `pane close`.** — guard:
  `tests/node/factory_controller_launch.test.mjs`

## Diagnostics

- **`doctor` is handed the store from `openRepoStoreReadOnly`**, which carries no `transaction`
  and never creates a store. — `doctor/report.mjs` · §14.24
- **Every section is computed independently, and one that cannot answer says which ticket owes
  it** — a plausible zero answers the operator's question wrongly. — `doctor/report.mjs` · §10.5
- **Monitor health is advisory-only and never an alarm; legacy artifacts are reported and never
  deleted.** — `doctor/report.mjs` · §10.5
- **A named scope resolves its member list live and claims nothing** — it reads the observation
  cursor and never opens one. — `doctor/verb.mjs` · §10.5
- **A tracker `doctor` cannot read *is* an alarm**: no run over that scope can claim anything. —
  `doctor/verb.mjs` · §10.5
