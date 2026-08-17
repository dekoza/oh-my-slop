# Repository AGENTS.md

This file is the repo-specific guide for agents working in `oh-my-slop`.
It supplements the global `~/.pi/agent/AGENTS.md` rules.
If the two conflict, the global file wins.

## What this repository is

This repo packages:

- `skills/` — curated markdown skills for pi agents
- `prompts/` — slash-command entry points that hand off to those skills
- `extensions/` — TypeScript pi extensions
- `factory/` — the `factory` binary and its plain-ESM libraries, shipped from the root package's `bin`
- `scripts/` — repository maintenance scripts
- `tests/` — Python and Node regression tests for repo invariants
- `README.md`, `package.json`, `pyproject.toml`, `uv.lock` — package metadata and install surfaces

The repo is installed through `pi`, so broken paths, invalid references, or stale manifests are release-blocking defects, not minor cleanup items.

## Mandatory commands

Run these commands when you touch the related areas. Do not skip them.

- Full Python test suite: `uv run pytest`
- Markdown reference validator: `uv run python scripts/validate_refs.py`
- Node extension tests: `node --test tests/node/*.mjs`

`tests/live/` is deliberately outside that glob: those scripts probe a running Herdr server and
one of them starts a paid model session. Run them by hand, never from a suite — see
`tests/live/README.md`.

Targeted minimums:

- Any change under `skills/` or to markdown references: `uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py`
- Any change under `prompts/`: `uv run pytest tests/test_prompt_templates.py tests/test_readme.py`
- Any change under `extensions/` or to package entrypoints: `node --test tests/node/*.mjs`
- Any change under `factory/`: `node --test tests/node/factory_*.test.mjs`
- Any change to `package.json`, `pyproject.toml`, or installable entrypoints: `uv run pytest tests/test_pi_package_installability.py`
- Any change to `scripts/validate_refs.py`: `uv run pytest tests/test_validate_refs.py`

If a change affects more than one surface, run every relevant command. Do not rely on a single happy-path smoke test.

## Repo-specific rules

### `skills/`

This directory is the core product.

- Skills live in exactly one of four buckets — `skills/reference/`, `skills/practice/`, `skills/workflow/`, `skills/meta/` — and the directory is the authority on which. File by what the reader came looking for: an API surface (reference), a way of working (practice), a job to run (workflow), or the agent's own toolkit (meta). The buckets are a taxonomy, not a promotion tier: everything under `skills/` ships, because pi recurses until it finds a `SKILL.md`.
- Retiring a skill means **deleting** it, in a commit whose message names its replacement — or states plainly that it has none. There is no `deprecated/` bucket; an empty directory kept as a gesture is a lie about the tree.
- Reach for a skill by name, not by path: `find_skill_dir()` in `scripts/validate_refs.py` resolves a name to whichever bucket currently holds it, so re-filing stays a pure move.
- Keep markdown links and backtick references valid.
- Do not invent file paths, reference targets, or API details.
- If you add or rename a reference file, update the owning `SKILL.md` and any tests that assert its content.
- If a skill has `evals/`, keep the evals aligned with the docs. A skill doc change without matching eval updates is incomplete.
- Preserve the repo’s “one skill, one boundary” style. Do not blur unrelated frameworks or topics into the same skill.

### `prompts/`

These are slash-command entry points, not a lighter alternative product.

- A template names the skill it fronts and does nothing else: one handoff sentence of the shape *"Use the `<skill-name>` skill to …"*, plus the argument substitution its frontmatter advertises.
- The skill is the single source of truth. Templates carry **no process text** — no headings, no phases, no vocabulary lists, no output formats, no stopping criteria. Eight templates once sat unmaintained while the skills beneath them were rewritten; `prompts/arch.md` described a flow its skill had not had for three releases.
- Name the skill, never a path. Install roots vary, so an absolute path rots silently while a name can be checked.
- A template whose skill sets `disable-model-invocation: true` adds the fallback clause telling the agent to find that skill's `SKILL.md` in the installed package — the flag strips it from the model's `<available_skills>` listing.
- The reason this surface exists is argument passthrough (`${1:-.}`, `$@`, `$2`), which `/skill:<name>` cannot do. Keep it; it is the whole justification for the file.
- `tests/test_prompt_templates.py` enforces the above. `scripts/validate_refs.py` is deliberately not widened to `prompts/`; under the naming rule there are no paths there to resolve.

### `extensions/`

These are installable pi extensions, so entrypoints matter.

- Keep each extension’s `index.ts` reachable from the declared `pi.extensions` entry.
- Keep nested `package.json` files in sync with the actual entrypoints.
- Do not break relative imports or rename files casually; the extension tests assume resolvable local module graphs.
- If you change extension behavior, update the Node tests in `tests/node/`.
- Do not add placeholder providers, fake registration logic, or speculative configuration knobs.

### `factory/`

The Software Factory's operator binary. [`docs/specs/software-factory.md`](docs/specs/software-factory.md)
is the authority; cite the section a change answers to.

- Plain ESM under Node (`.mjs`), no build step. TypeScript is reserved for the pi
  extension entries under `extensions/`.
- The binary ships from the **root** `package.json`'s `bin` — one package, one version.
  It is never separately installable and never grows its own `package.json`.
- Config is fail-closed and repo-bound: one file at `<repo root>/.pi/factory.json`, no
  `--config`, no env overrides, no merge layering, and no warn-and-continue path.
  `extensions/config-loader.ts`'s fallback-on-parse-error is the failure mode this
  code exists to end — do not reach for it here.
- `factory migrate` is the **only** verb that writes the operator's config, which is why
  it is a sibling of `doctor` rather than a flag on it, and the only verb exempt from the
  load. §11.8's legacy key disposition table lives as **data** in
  `factory/lib/migrate/document.mjs`, so the printed report and the rewritten file come
  from the same rows — a row that maps a key without reporting it is not expressible. A
  legacy key no row names **refuses** the migration rather than being dropped by omission,
  and the five holes it leaves are `TODO` sentinels the loader hard-fails on. The file it
  replaces is preserved as `.pi/factory.v1.json` **before** anything is written: the legacy
  rules and the dormant post-subscription set are what a human re-authors those holes from.
- `AGENTS.md` is read by the factory in exactly one place, `factory/lib/migrate/matrix.mjs`,
  and only to draft the initial `checks` block **once, for human review** (§11.6). There is
  no runtime parse and no automated agreement check — that would need the parser §8.2 ruled
  out. Thereafter this document and `checks` are kept in step by hand.
- Exit code `1` means usage or config-load failure and nothing else; `0` and `2`–`6`
  and `9` belong to the run end-reason table (`9` is #154's `capacity-exhausted`;
  `7` and `8` are verb-level markers that exist before any run does).
- Defaults exist only in `factory/lib/config/defaults.mjs` (`budgets`, `retention`),
  where an upstream decision already fixed the value. Everywhere else absence refuses —
  a policy the loader fills in is a policy nobody can read on disk. The one thing that
  is not a default and reads like one: §6.8's `worker` block holds *additions* to floors
  that live in code, so its absent form is the empty addition — the channel's identity,
  not a value anyone chose — spelled once in `config/worker.mjs` so no consumer branches
  on `undefined`.
- Policy that is not configuration lives in code, and each piece is read from exactly
  one place: the label vocabulary in `factory/lib/tracker/labels.mjs`;
  `MAX_SUPPORTED_TICKET_CONCURRENCY` in `factory/lib/config/concurrency.mjs`;
  `MAX_PANES_PER_TICKET` in `factory/lib/capacity/plan.mjs`; the
  closed domain enums — phases, run lifecycles, end reasons, dispositions, attempt
  outcomes — in `factory/lib/domain/vocabulary.mjs`; and the event-kind enumeration in
  `factory/lib/state/events.mjs`. A vocabulary that grows a second home has already
  started to drift. The scheduler stays capacity-parametric and never reads the
  ceiling — that is what makes raising it a one-line change, and
  `tests/node/factory_config_semantics.test.mjs` guards it.
- **Capacity is arbitrated by named rows, never by a counter.** `capacity:ticket:<i>`
  and `capacity:model:<class>:<i>` are compare-and-swap holds on the lease primitive,
  so a slot names its holder and is probeable; a number is not. The resource class is
  what arbitrates — derived from the profile (`resourceClassOf`), never declared — and
  the pane bound is derived from the ceiling, so **no pane knob exists in config**.
  Slots carry **no TTL**: a row records the generation of the **controller lease** that
  took it — never one minted for the row, which a stale-but-live controller would stamp
  above its successor's — and a superseded row is settled by probing its holder
  (`reclaim`, called once per run, over §5.5's adoption probe — the probe ships with
  `worker/adoption.mjs`, which is the module that can ask a pane whether it is alive).
  An expiring slot would free itself while its pane still
  talks to the GPU. The ticket slot spans the whole ticket
  execution and the model slot spans one attempt, which is what makes hold-and-wait —
  and therefore deadlock — unconstructible. `factory/lib/capacity/report.mjs` is the one
  derivation of §9.7's numbers, so `status`, `doctor`, and a live run cannot disagree
  about saturation; `held` is the rows and `waiting` is a walk over the journal, never a
  second tally.
- **Provider exhaustion is a time-boxed capacity state, not a routing preference**
  (#154, §9.8). A provider refusal for quota or rate reasons is observed in the pane
  output (`matchRefusal` in `factory/lib/capacity/exhaustion.mjs` — the signature set is
  the harnesses' own non-retryable limit wording, matched in the tail, transient faults
  deliberately absent) and typed as `provider-refused`, overriding the three
  silence-based verdicts while a valid outbox still wins. The refusal becomes a
  `capacity.exhausted` memo naming the **resource class** and an expiry, on the
  `controller` stream with no run in the envelope so it outlives its author; dispatch
  gates on it before launch (scheduler and the in-pipeline model-slot wait alike), and
  **an expiry re-admits by probe, never by the clock** — `worker/readmit.mjs` spends one
  cheap completion under the worker binding and answers
  `admitted`/`refused`/`inconclusive`, and only an admission writes `capacity.admitted`.
  §8.10 charges no budget for it (budgetless `released`, builder and reviewer), and a run
  left holding claimable work whose every route is memo-locked at the final scheduling
  decision ends `capacity-exhausted` (exit 9) rather than draining — work other classes
  finished does not soften it. Rerouting that consumes the memo is #155.
- The scheduler (`factory/lib/controller/scheduler.mjs`) is §9.6's loop and nothing
  more: **no queue object, no ready-queue, no aging, no priority.** It re-reads the
  frontier at every scheduling decision, takes the lowest-numbered claimable ticket,
  and otherwise waits for a ticket execution to terminate. Backpressure is **not
  claiming** — nothing is buffered and no intent is queued — and the two things it is
  parametric in, the frontier reader and the execution of one ticket, are injected so
  the loop stays testable at any capacity with no override seam.
- Every command answers from one structured value, rendered human by default and
  `--json` on request. A verb that cannot do its job says what is missing; it never
  goes quiet and never half-runs.
- Durable state is one SQLite store per repository under the pi SDK's `getAgentDir()`.
  `node:sqlite` is imported by exactly one module — `factory/lib/state/sqlite.mjs` —
  and `PI_AGENT_DIR` is never read; it is not a pi variable, and the day someone sets
  `PI_CODING_AGENT_DIR` the old spelling splits pi and the factory into two brains.
  `tests/node/factory_state_*.test.mjs` guards both.
- An event and every projection it changes commit in **one** transaction, written from
  one place: `appendEvent` in `factory/lib/state/store.mjs`. That deletes the
  stale-projection failure class rather than detecting it, so no precedence rule
  between journal and projection exists to get wrong. `effect` and `lease` rows are
  canonical rather than projections — they ride the same transaction and are never
  rebuilt from the journal.
- The projection tables are the monitor's versioned read contract. A projector whose
  output changes bumps its `version` in `factory/lib/state/projections.mjs`; the head
  compare at open is fail-closed, and a missing head is a mismatch, never a skipped
  check. A mismatched **reader** refuses that projection alone — `projection-unreadable`
  — and still answers from the rest, because blanking a whole screen over one stale head
  sends the operator back to `sqlite3`.
- Every lock is one row and one compare-and-swap, from `factory/lib/state/leases.mjs`
  and nowhere else. **The holder token is the only ownership proof**: the identity blob
  is advisory, nothing tests a pid, and no path removes a row without comparing the
  token — those two are exactly how the legacy systems failed. Fencing generations come
  from the one DB-wide counter, so they order every lease against every other. **The
  `controller` lease is the only one a clock may free**, and the TTL belongs to the
  lease object rather than to its caller; every other row is settled by its superseded
  generation and a probe, never by elapsed time. A lost controller lease is terminal
  (`factory/lib/controller/lease-guard.mjs`): stop issuing effects, emit, exit 6, never
  reacquire, and never self-close the run a successor may already have adopted. Normal
  `run.ended` and controller-lease release commit in one token-checked transaction, and
  **every record moving a run's lifecycle goes through `hold.append`**, which compares the
  token inside the write's own transaction. A holder's in-memory latch is not proof: a
  successor adopts a lapsed row without asking, so `lost` stays false until this process's
  next compare-and-swap. Effects survive that window on §14.5's resolution-time check; a
  run's lifecycle is authoritative state with no such backstop. A loss conceded **before
  `run.started` commits** names no run — the minted id is advisory until its record exists,
  so the loss event carries `run: null` and the exit-6 report names no phantom run.
- **Integrity failure is never repaired.** A damaged database is renamed into
  `quarantine/<stamp>/` byte-for-byte and replaced by a minimal fresh store carrying a
  typed `journal.integrity-failed` fact, so `status` and `doctor` still have somewhere to
  answer from; a hash-chain break scopes to its own stream and costs that run's tier-1
  detail alone. Only projections are rebuildable, only under one of
  `REBUILD_REASONS`, and every rebuild emits its reason, projector versions, and
  resulting head. The store whose compare failed is reachable **only** through
  `openStoreForRebuild`, which carries no `append` and no `transaction` — an
  ordinary append moves every projection head to the event it wrote, so a write
  path there would repair a mismatch without recording anything.
- **`factory/lib/state/truncation.mjs` holds the only two ways a record leaves the
  journal** — whole-stream deletion for a run stream, front-truncation for
  `controller.heartbeat`, recording `stream.truncated {stream, up_to_seq, up_to_hash}` on
  the indefinite `controller` stream. A `DELETE FROM event` anywhere else, or any
  renumbering or rewriting, is §14.7 broken; `tests/node/factory_state_integrity.test.mjs`
  greps the tree for it. A global sequence hole is the expected residue and is never read
  as tampering — only per-stream contiguity is verified.
- Every mutation outside the database is an effect: a requested/resolved pair keyed by
  §4.5's grammar, built in one place (`factory/lib/effects/keys.mjs`) and written in
  one place (`records.mjs`). A new effect kind is a row in `effects/catalogue.mjs` and
  nothing else — **an effect kind with no probe cannot be registered**, refused at
  construction, which is what keeps §5.3's reconciliation invariant structural rather
  than a review convention. **Reads are not effects**: they appear in the catalogue
  only as a probe's `call`, and get durable observation cursors instead.
- The payload digest sits **beside** the effect key, never in it. Re-issuing a key with
  an identical payload returns the committed result; a different payload is a typed
  conflict. Keying by the digest would turn that conflict into a different key and two
  mutations nobody compared.
- **When an effect key names an attempt, and when the slot is `-`**, is one rule with one
  home (`effects/keys.mjs`): keyed by the **attempt** when the subject is that attempt's own
  work — its branch, worktree, evidence ref, pane — and by the **ticket execution** when the
  subject is something one ticket execution has exactly one of: the published branch
  (`push`, `pr-create`) and the ticket (`assign`, `label-add`, `comment-post`). §4.5's *the
  database itself enforces uniqueness* is a whole-system claim, and a subject that outlives
  the attempt that made it, keyed by an attempt, gets one row per attempt that touches it —
  the uniqueness demoted to a per-attempt property with nothing failing. `pushAttemptBranch`
  therefore takes **no attempt parameter at all**: the wrong key is not something a caller
  can ask for.
- **An artifact is never referenced by path** — only by digest, through §12.1's ledger.
  Everything in `factory/lib/artifacts/` takes content or an address (an algorithm from a
  closed set plus a fixed-shape digest) and never a location, so the audited `../` escape is
  not a thing the API can *express* rather than a thing it checks for. The ledger row is
  canonical like `effect` and `lease`, keyed by the content: two productions of identical
  bytes are one blob and one row, stamped with the later producer so expiry reclaims it
  exactly once and no reference counting exists. The retention class is **derived** from the
  producer rather than passed, and byte accounting per class is a `GROUP BY` over the ledger
  — never a second tally to keep in step. Large output goes in as bytes and comes back as
  §6.6's reference (digest, media type, byte count, producer, class); the bytes themselves
  never enter an outbox or an event payload.
- The package handshake (`factory/lib/package/`) resolves §11.7's four participating
  artifacts — the binary, the factory extension, the monitor extension when present, and
  the skills root — from the **one manifest that declares them**, and proves they are one
  package. The **running executable is the anchor**: a configured package root would be one
  more thing that can disagree with what is executing. The deterministic tree digest is
  authoritative uniformly for every install shape, with the git commit and a dirty flag
  recorded beside it as **metadata only** — checkouts are never special-cased, because that
  would make dev runs incomparable to installed runs. Findings are **data rather than
  exceptions**, since `doctor` runs the same handshake in report mode (§10.5);
  `assertPackageIntact` is the one place they become the automation failure before first
  claim, and §14.35's split across roots has no severity ladder and no compatibility pass.
  `package.expect` declares a name and a version — exact or a range from npm's common
  subset — and nothing else: a hand-declared digest is refused at load, because the digest
  is observed and would be unmaintainable in development.
- The worker adapter (`factory/lib/worker/`) is §6.1's seam: one runtime-neutral contract of
  exactly four operations — `preflight(role, package_rev)` · `launch` · `awaitCompletion` ·
  `cancel` — built by `createWorkerAdapter`, which refuses a missing or invented operation and
  validates every role as §6.1's five-slot tuple before an implementation sees it. **The
  adapter knows nothing about which roles exist**: the pipeline's role inventory is
  `roles.mjs`'s data, and a role's closure is computed from the pinned revision's `requires:`
  frontmatter (`closure.mjs`), never hardcoded. §6.2's layer 1 is static — readable SKILL.md
  for the whole closure, frontmatter and reference validation, symlink containment, and §6.8's
  one conflict predicate (shadowed, duplicated, disabled, missing are **one** typed failure,
  every finding naming the offending source). Layer 2 is one disposable live probe per runtime
  per revision on the production path — pi: an RPC session over `--no-skills --skill <root>`
  requiring `skill:<name>` command records; Claude: the §6.3 generator's plugin, **cached per
  tree digest beside `state.db` and immutable** (factory infrastructure like the bare clone,
  not an effect), then `plugin validate --strict`, the component diff, and the `initialize`
  control-request over stream-json — **with §9.7's capacity observation folded into the same
  probe**, so a declared size above an observed `max_instances` and an unreachable required
  class are red checks naming the class, the endpoint, and the fix, never a silent clamp or a
  quiet capacity 0. Beside that probe and behind it sits the **`profile-flags` check** (#164),
  whose cardinality is the profile's rather than the revision's: **one session per distinct
  profile the active routing can dispatch**, running that profile's own launch argv so the
  installed binary accepts or refuses `--model` / `--effort` / `--thinking` before a pane
  depends on the spelling. It is a separate check precisely *because* the probe is
  profile-independent — folding profiles in would change the probe's cardinality, not its argv.
  It costs no model call, and a green probe is what makes a refusal there a statement about the
  flags rather than about the harness. Layer 3 (`recheck.mjs`) re-records the run-keyed handshake per attempt, so
  package drift arrives as §4.5's typed payload conflict — **a failure, never a new pin** —
  and persists the observed resolved model id per attempt (`attempt.rechecked`), refusing a
  declared model that resolves to two ids within one run (§11.7). The probes' IO lives
  behind `transports.mjs` and is injected in tests exactly as the Herdr probe is.
- **The attempt path is one order, and every step of it is where a crash puts it**
  (`worker/lifecycle.mjs`, §6.4–§6.6). The manifest and the rendered prompt are written
  first, into the controller-owned `attempts/<attempt_id>/` beside `state.db` — factory
  infrastructure like the bare clone, never an effect, and **outside the worktree by
  topology** so §12.7's eager deletion cannot take a result with it. Then `attempt.launched`,
  the **mint**, because the projections refuse an attempt-scoped record for a tuple nothing
  minted; then one `agent-start` effect covering pane, stamp, identity variables, and agent,
  whose pane is a **tab in the run's own workspace** (`worker/workspace.mjs`) — one
  `workspace-open` effect keyed by the *run*, so it is opened once, adopted by every later
  attempt and by every controller that re-enters the run, probed by the run's deterministic
  label because Herdr stamps no token on a workspace, and opened by the first attempt that needs
  one so a refusal is a budgeted `worker-launch-failed` rather than a run with no end reason,
  with the `FACTORY_ATTEMPT` token stamped **before** the agent so a crash in between leaves a
  pane reconcile can still recognise — the probe asks for the token *and* a live agent, so an
  early stamp cannot fake a start. §6.5's identity travels on **two channels**: the prompt, and
  `FACTORY_*` variables **declared on the attempt's `tab create`** rather than typed at its shell
  (#157), so the tuple reaches everything the worker starts without entering the scrollback §6.8's
  closed pane set was meant not to widen. Of the three launch commands `workspace create` and
  `tab create` take `--env` and **`agent start` takes none**, which is what puts the binding at the
  tab; that the variables reach the agent *process* and not merely the shell Herdr launches for it
  was read out of `/proc/<pid>/environ` live (`tests/live/herdr-tab-env-reaches-agent.mjs`) before
  the typed path was deleted, and the same probe is why no quoting helper survives here — a value
  crosses as one argv element. Identity is applied last, so a declared binding cannot shadow it.
  Then the transcript pointer, polled out of Herdr with backoff and
  never computed; then §6.2's layer-3 recheck, which is why the pin is compared **before** the
  prompt — the prompt is the first thing that spends; then the prompt; then
  `attempt.correlated`, whose presence is what makes a launch *finished*, and which carries the
  agent **kind** on payload v2 so §5.5's third adoption test compares against an observation
  rather than a derivation. A re-entry finishes an uncorrelated attempt and refuses a correlated
  one, whose live worker `worker/adoption.mjs` adopts instead. Every
  runtime difference is two values: the Herdr agent kind, and the name `prompt.mjs` turns into
  `/skill:<name>` or `/<plugin>:<name>`.
- The first prompt is **one renderer parameterised by the role**, not four templates
  (`worker/prompt.mjs`), and it is **deterministic**: nothing in it reads a clock or a
  directory, which is what lets its digest ride `attempt.launched` as evidence of exactly what
  the worker saw. §6.4's completion-protocol obligation lives **only** there — a package skill
  stating it would be a factory dependency inside a product the factory does not own, and
  `factory_worker_prompt.test.mjs` walks the shipped tree to hold that. Workers get no tracker
  credential, so the ticket arrives as `tracker/snapshot.mjs`'s claim-time snapshot, dated by
  the tracker's own clock.
- §6.6's wait is **first-signal-wins over two sources answering different questions**, and the
  asymmetry in how they are read is §5.1's: Herdr is *subscribed* to, because a poll cannot see
  `working → blocked → working` between samples, while the outbox is a file that appears once
  and is re-read on an interval. **Liveness means "still working", not "the process exists"** —
  neither harness exits when a turn ends, so reading process-existence as liveness would make
  every normal completion `wrote-but-hung`. The state table is one function (`decideOutcome`),
  the two silences split by fault (`no-result` is the worker's, `dead-worker` is the
  automation's, §8.10), and a settled worker gets a grace before its silence is called
  silent-completion. **An attempt ends once**: the projector refuses a second `attempt.ended`,
  which is how "late outboxes are ignored for state" gets teeth instead of staying a rule the
  harvest path has to remember. A **subscription is re-established by pane id** after a Herdr
  server restart, because §5.1 makes pane ids persistent and never reused: polling covers the
  gap and stops when the socket takes the question back, so a restart is a gap in the channel
  rather than a permanent demotion — and the recovery clears the flag that would otherwise
  charge the automation for the worker's next silence.
- **Adoption asks §5.5's five tests together and answers three ways**
  (`worker/adoption.mjs`, #114). Token · pane alive · agent kind · recorded worktree · outbox
  path intact — each of them able to prevent adoption on its own. Provable and disproved are
  what the specification names; **the third is what makes them safe**: an unanswerable Herdr
  read and an unreadable path both taught the process nothing, and "unanswerable" is not
  "absent" (§5.2, §12.4). The module **mutates nothing and asks about nothing but the pane**:
  §5.5 settles two controllers with the controller lease and its fencing generation, *not* by
  killing the worker, so there is no quit sequence and no pid in it, and
  `factory_worker_adoption.test.mjs` greps for both. What a row may be adopted *for* is
  re-derived from the journal rather than read off the advisory identity blob: **unfinished and
  correlated**, because a launch that never finished is one a re-entry finishes (§6.4) and an
  attempt the projections already settled has ended whatever its pane looks like — a wedged pane
  passing all five would otherwise reach the projector's refusal of a second ending as an
  automation failure. Acting on the verdict belongs to the modules that own the writes:
  `capacity/slots.mjs` moves the row, `worker/lifecycle.mjs`'s `settleUnadoptable` ends the
  attempt through the same `settle()` every other ending uses — `dead-worker`, §8.10's
  automation fault — and it **stops no agent**, because identity is exactly what failed and quit
  keys would act on a pane this controller could not show was its own (§13.B).
- **A capacity row settles three ways, and a lane is adopted whole or not at all**
  (`capacity/slots.mjs`'s `reclaim`, §9.4, §15 cases 6–8). A provable holder of the run this
  controller drives is **transferred** onto its generation on the predecessor's own token —
  `leases.adoptAll`, one transaction per lane, capacity rows only — because a release-and-retake
  opens a window a third controller can take the index in while the pane is still using the
  resource. A disproved holder has **its attempt settled first and its row released second**: a
  crash between them leaves a row the next controller re-probes, while the other order leaves an
  unfinished attempt nothing names. An unanswerable read moves nothing at all. The **transfer is
  gated on `preflight.ok` and on there being an executor**, and whatever a run adopted and never
  ran is released before it ends — a row fenced to a generation that ends unused is precisely the
  row no successor may adopt, since adoption requires the row to name the run being driven. What
  is still held at the end is **named on the report** (`unsettled`), saying that only a later
  probe can settle it: a pool one index short and nobody told is §9.7's slow run that looks busy.
- **Herdr has no `agent stop`** — verified against protocol 19, where the whole agent surface is
  list/get/read/send-keys/prompt/rename/focus/wait/attach/start/explain and the socket API has
  no `agent.stop` either. §13.B's "the controller stops agents and never closes panes" — nor
  tabs, nor the run's workspace — is therefore `agent send-keys` with the harness's own quit
  sequence, and a harness that ignores it leaves a wedged pane **recorded as an anomaly and never
  escalated**. The availability probe
  (`controller/herdr.mjs`) and the commands (`controller/herdr-control.mjs`) are two modules
  because "the factory checks the multiplexer, it does not manage one" is checkable only as
  *the probe imports nothing that can start a process*.
- **Herdr dates nothing.** No answer or frame in its API carries a timestamp, so `EVENT_SOURCES`
  declares `statesTime: false` for it and §4.3's `occurred_at_raw` is **refused** on that source
  rather than filled with our clock under Herdr's name; `observed_at` dates the record. The
  foreign id is constructed instead, and it names the *fact* — a transition's ordinal within the
  attempt, a reading's own liveness — because keying on the pane would let §5.1's dedup index
  suppress every sighting after the first.
- **A worker's environment is built, never inherited** (§6.8). `worker/environment.mjs`
  materialises one controller-owned config root per runtime beside `state.db`
  (`CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR` — each runtime's own variable), and a session's
  whole binding — env, flags, settings file — comes from it, including the preflight probes':
  a probe run under the operator's config proves a world no worker will ever see. Three closed
  lists cross in and nothing else: **capability artifacts** (credentials, the model
  catalogue, and §6.5's **agent-state integration** — the herdr-managed hook (Claude) and
  extension (pi) that push the transcript pointer, copied into the run's roots, digested, and
  version-observed out of the file's own `HERDR_INTEGRATION_*` header rather than assumed),
  the **declared worker-context file** (§6.8's second migration channel, installed as each
  runtime's user-memory file and hash-recorded in the run manifest), and **declared pi
  extensions**. Isolation is what makes the capability lists necessary and is worth knowing
  before you delete them: the `local` resource class's models come from an operator
  extension, so an empty agent directory silently removes the class — and the pointer's
  integration with it. **`worker-agent-state` is the red that keeps that loss named**
  (`worker/preflight.mjs`): missing, unversioned, mis-identified, or outdated is a named red
  ending the run `baseline-red` before the first claim, per runtime the active routing can
  dispatch to — so `no-transcript-pointer` is an anomaly, never 15/15 nulls. Promotion is
  declared and recorded; live inheritance is never a channel.
- **Permissions derive from the role's posture, never from a profile** (§6.8, §11.4).
  `worker/permissions.mjs` is the one home for the deny floor (`git push`, `tea`, `gh`, in
  every spelling the matcher accepts), the builder binding (`dontAsk` + broad tool-family
  allows — never a per-command allowlist, never `acceptEdits`, which still prompts for Bash),
  and the reviewer binding (`dontAsk`, because plan mode requires an interactive approval;
  edit tools still withheld). **Overrides may only add denies**: the config surface has no
  allow channel and no remove channel, so subtraction is
  unexpressible rather than checked, and an inverted rule spelling fails to parse. The floor's
  non-permission half lives in `git/attempt.mjs` — a **disabled `pushurl` in every attempt
  worktree**, worktree-scoped so §7.5's integration push from the clone still works.
- **Pre-trust is per runtime's own resolution rule, not per path** (`worker/trust.mjs`). pi
  walks *up* to the nearest `trust.json` entry, so one entry on the worktrees root covers
  every attempt; Claude keys `.claude.json`'s `projects` map exactly, and for a linked
  worktree the key it writes is the **repository's git common directory** — verified live, and
  pre-trusting the worktree path alone would leave every pane facing the dialog. A `--print`
  probe never meets the dialog at all, so the guarantee is the state predicate that preflight
  asserts, not a green probe. `createAttemptWorktree` therefore **requires** the environment
  handle and applies both the pushurl and the pre-trust outside the effect, so a re-entered
  attempt converges rather than skipping them.
- Git isolation (`factory/lib/git/`) operates **exclusively on a factory-private bare
  clone** beside `state.db`; the operator's checkout is never read or written — the
  protection is topological, and `factory_controller_start.test.mjs` snapshots the
  checkout around a whole run to hold it. The clone is built by `init --bare` plus a
  **refspec-less** named remote rather than `git clone`, so every ref in it is one the
  factory wrote deliberately and §14.11 is observable with one `for-each-ref`; fetches
  pin the base under `refs/factory/base/*` with `--no-tags`, serialized per handle
  (§7.7). Structural damage means rebuild, never in-place repair; a drifted remote URL
  converges by `set-url`, because a rebuild would discard attempt branches that are
  the only copy of unpushed work. Branch (`factory/t<ticket>/a<attempt_id>`) and
  worktree are effects with the pinned base in both payloads, so §7.2's "never chased
  mid-attempt" arrives as a typed payload conflict; the per-worktree config carries
  the dedicated factory identity (`FACTORY_GIT_IDENTITY`, code not configuration), and
  `core.bare` moves into the bare repo's `config.worktree` or no linked worktree could
  commit. Every identity-derived path is contained by charset **plus**
  canonicalize-and-assert-prefix (§2.1), which is also what lets the git probes
  recompute a worktree path from an effect key alone. §7.4's harvest predicates are
  typed verdicts — a dirty worktree names its leftovers and is never auto-committed —
  and preflight's `git-isolation` check fails closed on `.gitmodules` or LFS
  attributes read from the **fetched base tree**, never from the checkout (§7.8).
- Reconciliation (`factory/lib/reconcile/`) settles an unresolved effect **only** by
  re-probing the external system, and `doctor` is the identical computation behind a
  read-only flag — one code path, so the two verbs cannot answer differently about what the
  world said. §5.4's conclusion and its evidence basis are built in `conclusions.mjs` and
  enforced there: a conclusion outside the closed four, an empty basis, or `journal-intent`
  offered as a source cannot be constructed, which is how §14.1 and §14.2 hold wherever a
  conclusion is made. The engine ships once; **each effect kind's probe ships with the
  subsystem that introduces that kind**, registered by its §4.5 *read* so one call serves
  every operation that performs it. An effect nothing could probe is left exactly as it was
  and reported — that is §12.4's alarm, and it is why no probe means no evidence, therefore
  no `reconcile.concluded` record at all. Scope follows the effect rather than the run: a
  ticket-less effect of an **ended** run and a repo-scoped one are entities too, or §12.4 would
  pin them forever with nothing able to probe them. And §5.4's "before the lease is used for any
  effect" is a latch on the controller's hold that only a settling pass opens — `fence()` refuses
  until then, so it is not an order of calls anyone can get wrong.
- **A run ends at most once, and every ended run has a reason.** Normal completion appends
  `run.ended` in the same token-checked transaction that releases the controller lease; a
  stale holder exits 6 without ending a run now owned by its successor. The vocabulary is
  **six run end reasons plus one controller exit outcome**: `RUN_TERMINAL_REASONS` and
  `CONTROLLER_EXIT_LEASE_LOST` in `factory/lib/domain/vocabulary.mjs` are two values, never a
  union collection — a list named "end reasons" containing a value no run may end for is how
  the forbidden ending gets reintroduced with every test still green. §10.3's seven-row table
  lives in `factory/lib/cli/exit-codes.mjs` beside them, and import-time checks refuse a
  member with no row, a row naming no member, and an outcome that leaked into the reasons —
  the co-location §10.3 asks for, made mechanical. `controller-lost` maps to `null` because
  it is never self-asserted, so `exitCodeForEndReason` refuses it rather than inventing a
  code; it refuses `lease-lost` too, whose code is `EXIT_LEASE_LOST` — a real exit, but the
  `run` projector refuses it on a `run.ended` because it names a process's exit and not a
  run's ending.
  Neither the table nor the `--json` `schema_version` is reachable from configuration.
  The envelope's `ok` tracks that exit code rather than "a report came back": §10.3's warning
  about `factory start && next-thing` reading a circuit-breaker exit as success is the same
  misreading a `--json` consumer branching on `ok` would make. A failed run still prints its
  report — `error` is for a refusal, and a run that ran and failed refused nothing.
- `factory start` (`factory/lib/controller/`) is **one invocation, one run**: acquire, reconcile,
  end any run `--new-run` abandons, expire, open the run, preflight, drain, atomically end and
  release. The order is
  §10.1's sentence and the two constraints on it — §12.6's expiry window and §10.3's "preflight
  runs after the run exists" — and **the end reason is decided before the run executes**, because
  a red preflight and a lost lease both already settled it. §10.4's re-entry is not a mode: there
  is no `resume`, a scope-less `start` adopts the orphaned run keeping its `run_id`, and a scope
  that would widen an adopted run's membership refuses (§3.1). Against a **live** holder it
  resolves rather than queueing — a private queue is §19's excluded work queue one indirection
  down — and refuses whatever it cannot decide from durable state, because an optimistic "already
  in scope" promises a frontier that never arrives.
- Preflight is **observable, not a gate**: every check writes a `preflight.checked` stage on the
  run's stream carrying **no ticket**, in §9.7's order — artifacts and config, then probes, then
  the expensive baseline. A check whose subsystem has not landed answers `unbuilt`, which is
  neither `passed` nor `failed`: reporting it green would be the plausible zero, and reporting it
  red would end every run in this package. What keeps that honest is the drain report naming the
  subsystems that would have found work, so §9.7's *green-looking run that did nothing* cannot
  hide. The run manifest and the package handshake are **effects keyed by the run**, so a
  re-entry whose declared inputs changed is a typed conflict — §3.1's immutable membership and
  §11.7's single pin arriving as a refusal rather than as a rule anyone follows.
- The **checks are declared, never discovered** (`factory/lib/checks/`). `run.mjs` executes
  the validated `checks` block and nothing else — no manifest, no Makefile, and `AGENTS.md`
  prose is never parsed at runtime (§14.34) — and its selector is the closed pair
  `required | all`, so **per-surface targeting is not a question the API can be asked**.
  Classification is §8.2's fault attribution and lives in one function: a required check
  exiting **inside its declared expected-failure codes** is the worker's failure, and a
  timeout, a signal, an exec that is not there, or any other code is `unrunnable` — an
  automation failure. A timed-out check is killed as a **process group**, because a suite
  that survives the check that gave up on it holds the port the next one needs. §14.23's
  "two lanes never run mechanical checks concurrently" is one in-process chain, not a lease:
  §11.6 declares no parallel-safety, and `checks[].parallelSafe` is the recorded v2 upgrade.
  **Running a check is not an effect** — there is nothing for a probe to ask the world — but
  recording its output is, so `artifacts.mjs` is what writes, keyed by the *execution* and
  not by the check alone: a re-entered run preflights again, and two executions' bytes under
  one key would make an ordinary re-entry a §4.5 conflict. `baseline.mjs` is §8.3's gate in a
  **detached throwaway worktree** under `baselines/` — deleted eagerly when green, retained
  when red (§12.7) — and it writes nothing durable, which is exactly what lets
  `doctor --baseline` share it verbatim under §14.24 — both verbs reach it through the one
  `baselineForRepo`, so they cannot answer differently about what the base is or what the
  checks said, and a caller that already pinned a base passes it rather than fetching a
  second one. Differential no-new-failures verification is **deliberately absent**; §8.3
  records it as the v2 answer, and the comment saying so is load-bearing.
- **§8.6's budgets are counted, never incremented** (`factory/lib/pipeline/budgets.mjs`). A
  spend is a *count* of the `stage.resolved` records that charged that budget, read back from
  the journal — so the bound and the count are one expression, and `job-pipeline`'s
  `replanCount`, incremented forever and compared to nothing, is not a shape this module can
  express. Deriving rather than carrying is also what settles re-entry: a controller that died
  between a failing stage and the attempt its tier called for reads the same count back, grants
  the same retry, and finds the attempt already minted. `BUDGET_KEY_FOR_ACTION` is the whole
  relationship between §8.10's Action column and §11.6's three numbers, so a retry action that
  named no budget would have nowhere to be declared; the test suite asserts the spending rows
  and the budget-column rows are the **same set, both directions**, and greps the shipped tree
  for the legacy counter names with comments stripped. The budget is asked in `walkStages`
  **before** the seam and never inside it: the seam plans a tier, which needs the clone, the
  routing and the pinned base, while affordability is one question with one answer for every
  caller. Exhaustion is a *disposition* rather than a crash, and it is the one member of the
  pipeline's closed reason set that is an answer — a throw only because §8.4's fan-out spends
  the automation budget inside a phase executor, whose only ways out are a phase result and a
  throw.
- **An automation retry mints an attempt only where there is a worker to run again**
  (§8.5, §8.8). §8.10's `retry` of an **agent-borne** phase relaunches: `pipeline/retry.mjs`
  composes the seam `walkStages` takes, and `planAutomationRetry` plans the relaunch from the
  prior tip under the profile already dispatched — nothing was judged, so nothing is
  discarded and nothing is re-routed. Its `retry` of a **controller** phase mints nothing:
  `verify` and `integrate` have no worker, so an attempt id there would be a projection row
  with no pane, no worktree and no manifest behind it. The walk re-enters those under the
  attempt it is already on, at the next **try** — the fifth slot of a stage result's semantic
  key `(run, ticket, phase, attempt, try)`, which exists because the attempt slot is exactly
  what such a re-entry cannot vary. The consequence is worth knowing before you reach for a
  branch: **the walking attempt is always a builder attempt**, since every retry that mints
  re-enters `implement` and every retry that does not leaves the attempt where it was.
  `retried()`'s loop guard still refuses a seam that answers with the attempt it was handed —
  a controller re-entry is a different mechanism and never reaches it.
- **The circuit breaker reads terminal-commit order, and its verdict is monotone**
  (`factory/lib/controller/breaker.mjs`). The order is the journal's own sequence over
  `ticket.disposition-changed` — never a clock, because two lanes finishing in one order and
  being recorded in another would give two answers to one question and only one of them
  reproduces. It asks *has this run ever reached N in a row*, not *are the last N*: §3.5 lets
  in-flight lanes finish, and a lane settling `published` must not erase the reason the run
  stopped claiming. The scheduler's `claiming` predicate and `endReasonOf` call the one
  function, so the loop and the report cannot disagree about why the run ended, and the verdict
  is on **every** run's report rather than only the ones it stopped. Automation-versus-product
  is the disposition's own `fault` and never a list of reason classes matched a second time —
  which is why `ticket.disposition-changed` carries the fault on payload v2, and why an
  operator's explicit stop outranks the breaker in `endReasonOf` while the breaker's number
  stays on the report either way. **N is `budgets.circuitBreaker`** and the module takes it with
  **no default** — the value has one home, §11.6's block, and a fallback here would answer
  precisely when a caller forgot to thread the config through. It is the one number in that
  block with a floor and no ceiling: §8.6's 2 + 2 bounds the retries one ticket may spend, and N
  counts ticket executions, so `config/defaults.mjs` carries **per-key** bounds rather than one
  block-wide `max` that would be silently wrong for it.
- **The tracker is read through `tea`, and holds no credential of its own.**
  `.pi/factory.json` carries `tracker.repo`, `tracker.remote`, and `tracker.login` — no
  base URL and no token, which is not an omission: §6.8 states that `tea` credentials are
  ambient on this host and §11.2 forbids env overrides, so `tracker.login` names a `tea`
  login and `tea` resolves the instance and the secret. It is also why §6.8's deny floor
  lists `Bash(tea *)` — the scheduler's credentials are exactly what a worker must not
  reach. `factory/lib/tracker/gitea.mjs` and `writer.mjs` are the only modules that shell
  out to it — the reader hardcodes `--method GET` and takes no method argument, so a write
  is not something it can be *told* to do — and **status comes from `--include` rather than
  the exit code**: `tea api` exits `0` on a 404 and prints the error body, so a client
  trusting the exit code would parse `{"message":"not found"}` as an answer. The writer's
  surface is the tracker mutations §3.3 and §8.9 need and no others, each keyed by the
  effect kind that names it — labels through Gitea's **appending** `POST` and never the
  replacing `PUT`, so a disposition cannot discard a label a human added, and **with no
  removal at all**, which is how §14.20's "a label is cleared by a human or not at all"
  becomes unexpressible rather than checked. It performs them and records nothing, because
  §4.5 has exactly one place effects are written; `mutations.mjs` owns that pair for both
  callers, so "record the intent, perform, record the outcome" has one home rather than one
  per subsystem that writes to a ticket. **A comment effect digests the intent, never the
  prose rendered from it**: §3.3's claim comment carries a timestamp and §8.9's block carries
  the chain, and digesting the rendering would make a re-entry a §4.5 payload conflict for no
  reason but the hour it happened at — leaving a ticket permanently unclaimable by the run
  that already holds it.
- **A claim is an assignee plus a structured comment plus a re-read** (`tracker/claims.mjs`,
  §3.3), and the slots are already held when it runs (§14.21) — claiming work that cannot
  start puts a falsehood on the tracker for humans and other tooling to read. Whose claim an
  existing assignee is, is answered from **durable state and never from a comment**: an
  assignee the factory did not set is an absolute human claim with no clock consulted at all;
  a live same-factory claim is never contested; a proven-dead one is taken over with the
  takeover comment posted first and **no waiting period**, because nothing a clock could add
  to a fact already proven; and only a claim this store cannot account for waits §3.3's 24h
  without ticket trace — and a claim this factory made **and released** is not proof of the
  claim standing now, so the last thing the store recorded about each run's hold is what
  decides. Comment **ids** arbitrate simultaneous claims, never comment text (§5.2) — and only
  between factories, since within one the durable state already decided, so every comment this
  store's effect rows account for is excluded or a taking-over run would lose to the run it
  just buried. The contest window opens at the pre-claim read, or a concluded claim's lower id
  would make its ticket permanently unclaimable; **every timestamp in it is the tracker's**,
  and a tracker that will not state its clock refuses the claim rather than substituting ours.
  The loser of a contest **writes nothing** — id arbitration is only reachable between installs
  sharing one tracker identity, so "un-assign myself" would clear the winner's assignee and
  §3.3's *a live claim is never contested* outranks its *the loser un-assigns itself* where the
  two collide. The claim's effects carry **no attempt**: §9.4 mints one before the claim but
  none has *launched*, and the claim belongs to the ticket execution.
- **A disposition is §8.9's table applied to the tracker** (`tracker/disposition.mjs`), and
  the table is data: three rows add one label and **retain the assignee** — retaining being
  the absence of a mutation, visible as one — and `released` drops the claim and adds none.
  The eligibility change goes first and the announcement second, because a comment with no
  label behind it leaves the ticket claimable for the next run to die on identically, which
  is exactly §14.20's failure. No row removes a label and no row re-adds `ready-for-agent`.
  All four post **one machine-parseable block** — identity tuple, the outcome chain read
  back from the journal, evidence by digest — and it is JSON rather than the claim comment's
  YAML because it carries a worker's exact question, which is where hand-rolled quoting
  breaks. **The block carries no clock reading of ours**: the tracker dates every comment,
  and a timestamp in the body would make a re-entered settlement a §4.5 payload conflict
  rather than the comment already posted — which is why the comment effect digests the block
  and not the prose rendered from it. Evidence comes from the ticket execution's own
  artifact-write effect rows rather than §12.1's ledger, whose producer columns name the
  *most recent* production and would move under a settlement already requested. A pause with
  no question, a publication with no PR link, and a reason class whose §14.18 disposition is
  a different one are all refused before any mutation.
- **The review phase fans out from the controller** (`pipeline/review.mjs`, §8.4): two
  read-only attempts, each with its own entry skill, outbox, attempt identity and **its own
  worktree at the reviewed commit**, so §7.3's one-worktree-per-attempt holds verbatim and a
  mutation is attributable to a specific attempt. The axes run **in sequence and both to
  completion** — neither is cancelled on the other's rejection, and taking turns is what makes
  §15's size-1 case structural rather than arithmetic. Each axis resolves its own
  `stage.resolved` under its own attempt, so §8.10's per-attempt rows are routed where the
  attempt is, and the phase's own result — `approved`, `rejected`, `mutation-detected` — is
  resolved by the walk under the **builder** attempt. `STAGE_ACTIONS.verdict` is therefore
  never the walk's to take: reaching it there means an executor answered a phase with an
  attempt outcome. The blocking sets are **unioned by concatenation** in axis order, each
  finding tagged with the axis that wrote it — nothing merged, deduplicated, or reranked — and
  one or more blocking findings on either axis is the rejection. §11.5's `review` pair maps
  onto the axes **positionally**, which is the whole of "model diversity is available as
  per-run configuration but is not mandated". **Both ends of the diff are read off the passing
  verify record** (`verifiedBoundary`), never taken from the caller: §14.13 measures the commit
  being published, a `reviewedCommit` parameter would be a second opinion about which one that
  is — as would the harvest's head, which a moved base makes the pre-rebase commit — and a
  `baseCommit` parameter briefed a repair chain's reviewers on the repair's delta while their
  verdicts gated the whole chain (#165). The fixed
  point then reaches the worker through `renderAttemptPrompt`'s `review` block, which is
  **required** for a role whose expectations name verdicts and refused for one that does not —
  a reviewer rendered without it gets a prompt naming no diff, which reads as a complete
  instruction to a pane nobody is watching.
- **The authoritative read-only guard is the attestation, not the permissions**
  (`git/attestation.mjs`, §6.8): clean worktree **and** HEAD captured before the review and
  verified unchanged after — both halves, because a reviewer that committed leaves a clean
  tree and one that edited leaves the same HEAD. A mismatch is `mutation-detected`, §8.10's
  **only** outcome with no retry at all (§14.19), and an opening capture that is already dirty
  is a mutation too rather than an automation problem: the controller made that worktree out of
  a commit and handed it to one role. The module answers a **typed verdict and never an
  outcome**, exactly as §7.4's harvest predicates do. §8.4's verdict obligation lives in
  `worker/prompt.mjs` and nowhere else (§8.4 says so explicitly); `worker/outbox.mjs` judges the
  *shape* a written verdict must have — the closed pair, a findings list, a **mandatory
  citation** per finding, and the word agreeing with its own blocking set — while whether a
  verdict is *owed* is role knowledge and stays in `pipeline/review.mjs`. The controller never
  classifies a citation: recognising a Fowler baseline smell by name would put a second copy of
  the skill's list in the factory, and downgrading a finding would be the reranking §8.4 forbids.
- **The integration lease is acquired twice, and the gap is the point**
  (`pipeline/integration.mjs`, §9.5): `[lease] fetch → evidence ref → rebase → the required
  set [release]`, then the two review axes with no lease held at all, then `[lease] base
  unchanged? → predicates → push → PR [release]`. **The rebase is in `verify`, not in
  `integrate`**, which is what makes §8.2's invariant literally true — the checks always run
  at the post-rebase commit that will be pushed, with no conditional re-check path bolted on
  for the case where the base moved, and §14.13 falls out of it. `integrate` re-acquires under
  a base-commit identity precondition and loops back to re-rebase and re-verify when a human
  merged during the review, **consuming no budget**, because nothing failed. The lease is a
  row *and* an in-process turn: the row is what reconcile finds after a crash, and the chain is
  what makes a second lane wait rather than meet a refusal.
- **Nothing in `git/integrate.mjs` force-updates anything, and nothing resolves a conflict.**
  The integration worktree is **detached** — the attempt's own worktree has that branch checked
  out and git refuses a second one on it — so the branch is moved onto the rebased result by
  `update-ref` naming the value it replaces; `branch -f` is refused on a checked-out branch
  anyway, and a compare-and-swap is what §4.6's discipline asks for. A conflicting rebase is
  aborted, reported with the paths read off the index (git's prose is localized), and left to
  §8.5's fresh-retry. §7.4's integration-side predicates are commits-ahead, `git diff --check`,
  and §7.3's correlation trailer on **every** commit, matched on run and ticket rather than on
  the attempt, since a repair legitimately carries the attempt before it. They need no worktree,
  which is what lets a re-entry after a reclaimed one re-derive the same verdict. A red
  re-verify inside §9.5's loop is **`integration-red`** — a reason class named after §8.3's
  `baseline-red`, carrying no automation fault, because §8.6 says product-level outcomes never
  trip the breaker and two changes that do not compose is not a broken host.
- **§7.5's pull request is check-then-create inside §4.5's pair** (`tracker/pulls.mjs`): the
  pair makes a *recorded* creation idempotent, and the check covers the window it cannot — a
  controller that opened the PR and died before the resolution committed adopts that PR rather
  than opening a second one a human must choose between. The body is a **fenced JSON block**,
  which is what "machine-parseable key-value" means when the values include reviewer prose and
  check commands, followed by `Closes #N` so the *manual* merge discharges the ticket. §8.7's
  summary and **advisory findings** ride it and the §8.9 comment alike; **blocking findings ride
  the attestation artifact and nothing else**, because a blocking finding is one a repair
  already answered. The stale-PR sweep closes each superseded factory PR of the same ticket
  with a comment linking the live one and **leaves alone any PR whose body is not ours** — a
  human fixing a factory branch up by hand is §7.6's redo path.
- **§2.1's attempt ordinal is allocated against the record** (`allocateAttempt` in
  `worker/attempt.mjs`), never derived from the attempt being answered. More than one thing
  mints into one ticket execution's ordinal space — §8.5's two tiers and §8.4's two axes — so
  "one past the prior attempt" lands a repair on a reviewer's id, finds its branch and worktree
  effects already resolved, and re-enters a phase whose result is recorded under that id, which
  §8.10 then reads as its own conflicting duplicate. **Idempotency is the minter's purpose,
  not the counter's**: a caller says what it is minting *for* — the tier and the attempt it
  answers, or the axis, the work, and the try — and a record already naming that purpose hands
  back the same id, so `planRetry` stays pure by no longer naming an attempt at all. The purpose
  is one object, written by `mintAttempt` and matched by `allocateAttempt`, so the key that is
  matched and the key that was written cannot come to be spelled differently — and `mintAttempt`
  is the one home for a mint whose minter is not its launcher, which both §8.5's tiers and
  §8.4's axes are.
- §3.5's drain is `factory/lib/controller/drain.mjs`, and it owns **both** clauses: nothing
  claimable now, and nothing that can become claimable without external change — the second
  read off `awaits_external`, which `frontier.mjs` computes per member. The report's classes
  are §3.5's six exactly. Mapping the frontier's nine onto them is not a rename:
  `awaiting-merge-dependency` and `blocked-external` name a *dependency* rather than a ticket
  state, which is why a member blocked by an in-scope blocker takes its blocker's class and
  carries `blocked_by` — at drain every open in-scope blocker is itself settled, so the
  inherited class is the reason a human has to act. Cycles are reported, not walked.
  §7.6's unmergeable flag is a field nothing reads back, which is the whole of "no automation
  acts on it in v1". **A scope nobody read is `drained: null`, never `true`** — the plausible
  zero a red preflight or an abandon already pending would otherwise produce. **A lane that ran
  is not a ticket claimed**, so the loop counts `lanes_run` and the report derives `claimed`
  from what the lanes answered; §3.3 has four ways to decline, each writing nothing.
  **The frontier and the claim are wired together or not at all**: a run with no pipeline above
  the claim reads no frontier, and the report names that half rather than reporting a scope
  that drained. `readScope` with no supplied graph reads edges only for members an edge could
  reclassify — `decide` consults blockers exactly once, after every state and label check has
  passed, so a settled member's edges buy an answer nothing reads.
- §5.2's authority table is **code** (`factory/lib/tracker/authority.mjs`), and every
  observation passes `requireAuthority` before it is written — a global source ranking
  always ends up asserting something the winning source does not know. **Comment text is
  authoritative for nothing** and cannot be asserted at all, so a missing comment reads as
  `possibly-deleted` and never as `never-posted`; our own effect record and the durable
  assignee are what corroborate. `worker.alive` is Herdr's one fact, and the outbox is
  `evidence` while the journal is `intent`, never `proof`.
- **A run's scope is a live selector, so `frontier.mjs` caches nothing.** Every
  `readScope` is a fresh set of reads, which makes §3.1's "membership is recomputed at
  every scheduling decision" a property of the code rather than a discipline the scheduler
  keeps. Parent membership is the anchored `Part of #N` **first body line** and nothing
  looser; candidates come from the `workflow:implement` label **server-side**. The **edge
  set is a parameter**, because §5.1 reads `dependencies`/`blocks` only on an
  `add_dependency` and a resolve that fetched them per member per decision would be exactly
  the cost that clause prevents — a caller maintaining the graph from the poll passes it,
  `doctor` omits it. §3.5's six member classes all exist in `MEMBER_CLASSES`, plus the
  three a mid-run scope can be in that a drained one cannot; `awaits_external` is a field
  rather than a seventh class, because a closed six-member vocabulary does not grow a
  seventh to say "blocked by something that will never move".
- §5.1's observation cursor is **canonical, not a projection** (`observation.mjs`,
  `observation_cursor` + `observed_issue`): it is a watermark, and rebuilding it from a
  journal whose run streams expire would silently re-poll a repository's whole history.
  **The watermark is a record's `updated_at` and never our clock** — `?since=` is compared
  by the *tracker's* clock, so a watermark taken from ours puts two clocks in one
  comparison, and a Gitea lagging by more than the overlap would drop every record written
  just before a poll. That is the gap §5.1 promises the overlap cannot produce, reintroduced
  by the watermark itself. The one moment our clock could appear is a cursor with no record
  to anchor to, and the tracker's own `Date` response header settles it instead.
  **The foreign id names the fact, not the object** (`gitea:<kind>:<id>@<revision>`): keyed
  on the id alone, the first sighting of an issue would suppress every later one, and the
  ticket would be labelled, closed, and reassigned without a fact being recorded. The graph
  fact is keyed by the timeline entry that caused its read for the same reason — dating it
  `now` would make it the one fact class a re-run poll records twice. Dedup is enforced by a
  **partial unique index**, not by the poll behaving itself, exactly as `effect`'s primary
  key enforces §4.5's. Reads are not effects, so nothing here has a requested/resolved pair;
  the cheap endpoints are repository-wide on purpose, because an out-of-scope blocker's
  state is what §3.1 decides `blocked-external` from.
- `doctor` (`factory/lib/doctor/`) is handed the store from `openRepoStoreReadOnly`, which
  carries no `transaction` and never creates a store, so §14.24 is a property of the handle
  rather than a rule the diagnosis follows. Every section is computed independently and one
  that cannot answer says which ticket owes it — a plausible zero for a counter nothing
  increments answers the operator's question wrongly, and an unreadable package must not
  take the journal, the pins, and the reconciliation down with it. Monitor health is
  advisory-only and never an alarm; legacy artifacts are reported and never deleted.
  A named scope adds the classified member list, resolved live and **claiming nothing** —
  it reads the observation cursor and never opens one, because a `doctor` that created
  durable state would do it precisely when the operator is trying to find out what state
  already exists. A tracker it cannot read *is* an alarm: no run over that scope can claim
  anything.

### `scripts/`

These scripts enforce repository invariants.

- Treat `scripts/validate_refs.py` as an authority for markdown reference integrity.
- If you change how references are parsed or resolved, add tests for the new behavior.
- `scripts/link-skills.sh` exists because skill discovery is not portable. pi recurses until it finds a `SKILL.md`, so the buckets cost it nothing; Claude Code scans exactly one level of `~/.claude/skills`, so a bucket symlinked in whole resolves fine and silently hides every skill inside it. Do not assume a change to the `skills/` layout is invisible to consumers — it is invisible to pi, and load-bearing for anything that scans one level.
- Keep script output explicit and machine-readable where possible; the tests depend on predictable failures.

### `tests/`

Tests are part of the contract, not decoration.

- Prefer real filesystem fixtures and subprocess-backed checks over heavy mocking.
- Add regression tests when you fix a bug. If the bug was caused by a bad assumption, encode that assumption in a test.
- Keep Python tests runnable with `uv run pytest`.
- Keep Node extension tests runnable with plain `node --test`.
- Do not write tests that only restate implementation details; test the repository behavior that users rely on.

### Package metadata

These files are install surfaces, not arbitrary config.

- `package.json` must keep the `pi.extensions` list accurate.
- `pyproject.toml` and `uv.lock` must stay consistent.
- Avoid editing manifests without checking the tests that validate installability and entrypoint exposure.

## File hygiene

- Do not edit generated caches such as `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, or other build artifacts.
- Do not delete or overwrite untracked files unless the user explicitly asks.
- Before removing anything, inspect `git status` and confirm the path is safe.
- Do not use blanket cleanup commands that can destroy user work.

## Change discipline

- Keep changes small and coherent.
- Do not mix unrelated fixes into one edit.
- If you notice a real problem outside the requested scope, report it instead of bundling it silently.
- Commit in logical units. This repo is actively used; half-finished work should not linger uncommitted.

## Protected surfaces

These are contracts with the outside — consumer repos, muscle memory, installed
packages. Changing one requires a stated migration path (a commit message naming the
replacement, a survey note, or a README callout) — never a silent rename:

- **Skill names** — consumer repos reference them from `CLAUDE.md`/`AGENTS.md` after
  `/setup-project-skills`, and everything here resolves skills by name
  (`find_skill_dir()`). Bucket moves are free; renames are breaking.
- **Prompt-template names** — the `/command` surface: muscle memory plus README rows.
- **The `docs/agents/` contract** — the file names, the `## Agent skills` pointer
  block, and the tracker templates' load-bearing headings (`## Conventions` ·
  `## Robot comments` · the two "when a skill says…" headings · `## Wayfinding
  operations`) that consumer skills dereference in installed repos.
- **Install surfaces** — `package.json`'s `pi` block and each extension's declared
  entrypoint.

## Practical review checklist

Before finishing a task, verify:

- markdown references still resolve
- package manifests still match real entrypoints
- affected tests were run
- new files are intentional and documented
- no cache or generated files were touched by accident

## Agent skills

### Issue tracker

Agent work lives on Gitea (`minder/oh-my-slop`, via `tea`); GitHub (`dekoza/oh-my-slop`)
is intake-only for human-filed issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical default vocabulary — each label string equals its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. `CONTEXT.md` holds the
workflow vocabulary; the skill-authoring vocabulary lives in
`skills/meta/writing-great-skills/GLOSSARY.md`. See `docs/agents/domain.md`.
