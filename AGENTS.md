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
- Exit code `1` means usage or config-load failure and nothing else; `0` and `2`–`6`
  belong to the run end-reason table.
- Defaults exist only in `factory/lib/config/defaults.mjs` (`budgets`, `retention`),
  where an upstream decision already fixed the value. Everywhere else absence refuses —
  a policy the loader fills in is a policy nobody can read on disk.
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
  (`reclaim`, called once per run; the probe itself ships with the slice that can ask a
  pane whether it is alive). An expiring slot would free itself while its pane still
  talks to the GPU. The ticket slot spans the whole ticket
  execution and the model slot spans one attempt, which is what makes hold-and-wait —
  and therefore deadlock — unconstructible. `factory/lib/capacity/report.mjs` is the one
  derivation of §9.7's numbers, so `status`, `doctor`, and a live run cannot disagree
  about saturation; `held` is the rows and `waiting` is a walk over the journal, never a
  second tally.
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
- **The tracker is read through `tea`, and holds no credential of its own.**
  `.pi/factory.json` carries `tracker.repo`, `tracker.remote`, and `tracker.login` — no
  base URL and no token, which is not an omission: §6.8 states that `tea` credentials are
  ambient on this host and §11.2 forbids env overrides, so `tracker.login` names a `tea`
  login and `tea` resolves the instance and the secret. It is also why §6.8's deny floor
  lists `Bash(tea *)` — the scheduler's credentials are exactly what a worker must not
  reach. `factory/lib/tracker/gitea.mjs` is the only module that shells out to it, every
  entry point is a `GET`, and **status comes from `--include` rather than the exit code**:
  `tea api` exits `0` on a 404 and prints the error body, so a client trusting the exit
  code would parse `{"message":"not found"}` as an answer.
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
