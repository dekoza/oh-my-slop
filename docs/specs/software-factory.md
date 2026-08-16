# Software Factory — build-ready specification

> **Status:** locked. This is a **living contract**, not a dated snapshot. It is amended in
> place as decisions land (see *Amendment log*), and it is the single citable source for
> factory implementation tickets.
>
> Locked by [Lock the build-ready Software Factory specification](http://192.168.129.37:30008/minder/oh-my-slop/issues/87),
> the final decision ticket of the map
> [Specify a reliable Software Factory](http://192.168.129.37:30008/minder/oh-my-slop/issues/75).
>
> Companion: [`software-factory-monitor.md`](software-factory-monitor.md), locked first on
> purpose, so this document is obliged to make the observable contract true rather than the
> monitor discovering what the factory happens to emit.

---

## 1. Scope and destination

A Herdr + pi Software Factory that consumes **build-ready Gitea implementation tickets** and
produces **independently verified integration pull requests** by invoking skills from this
package.

- The first delivery is **serial**. The architecture admits **bounded parallel** frontier
  execution immediately afterward without replacement — serial is `capacity = 1`, not a
  different design (§9).
- **Gitea's implementation-ticket dependency graph is the sole durable delivery graph.** The
  factory owns no discovery, no Wayfinding, and no private generated task graph.
- **Gitea-only, manual final merge, no deployment.** The factory pushes branches and opens
  PRs; a human merges.

**Ownership boundaries**, fixed while charting and never relitigated below:

| Component | Owns |
|---|---|
| **Gitea** | durable work items, dependency edges, claims, human boundaries |
| **Herdr** | terminal and agent lifecycle; *one* fact about a worker: is it alive |
| **pi / Claude Code** | model execution |
| **The factory** | scheduling, policy, recovery, evidence, integration |
| **Named package skills** | agent process |

**The failed `extensions/.legacy/software-factory` and `extensions/.legacy/job-pipeline`
implementations are evidence only.** Independently justified contracts are reused; modules
are not.

---

## 2. Domain model

### 2.1 Entities and identities

| Entity | Identity | Notes |
|---|---|---|
| **Run** | `run_id` — **ULID** | stable across controller restarts, orderable by start time |
| **Ticket execution** | `(run_id, ticket_number)` | the natural composite, never a new opaque id, so it cannot drift from its parts |
| **Stage** | `(run_id, ticket, phase)` | one per pipeline phase |
| **Attempt** | `attempt_id` = `<run_ulid>-t<ticket>-a<n>` | `n` a per-ticket-execution ordinal allocated transactionally **against the record** — one past the highest that execution ever minted, never one past the attempt being answered. §8.5's two tiers and §8.4's two axes both mint into the one space, so a neighbour-derived ordinal collides |
| **Tracker ticket** | Gitea issue number | the tracker's own object |

ULID over the legacy `factory-YYYYMMDD-<6hex>`, which was date-only and unorderable within a
day. `attempt_id` is globally unique rather than a bare per-ticket ordinal, which matters:
run 2's `factory/t42/a1` would otherwise collide with run 1's published branch, and §7 says
published branches are never touched again. The full `{run, ticket, attempt}` tuple is
readable straight off a branch name or a path during an incident.

**Charset is `[0-9A-Za-z-]` by construction.** Containment of every identity-derived path is
proven by charset validation **plus** canonicalize-and-assert-prefix — both, not either.

### 2.2 The phase enum

Closed, never free text:

`preflight` · `implement` · `harvest` · `verify` · `review` · `integrate` · `cleanup` ·
`expiry`

The last three are not pipeline phases. They exist in the enum because effect keys and event
envelopes carry a phase slot and every mutation outside the database is an effect (§4.4) —
including a cleanup deletion and an expiry stream drop. See §13.C for why this is a widening
rather than a contradiction.

### 2.3 Cross-run history is a list, never a merge

One tracker ticket may hold several ticket executions — failed in run A, published in run B.
Merging them would imply budgets and outcome chains carry across runs. They do not: budgets
are per ticket and never reset *within* a run, so they do reset *between* runs, while
`factory:failed` persists on the tracker ticket indefinitely.

---

## 3. Tracker scheduling, claims, and run scope

### 3.1 Scope and membership

**Exactly two scope forms:** direct-ticket (an explicit set, possibly of size 1) and
parent-scoped.

**Scope never auto-expands.** An open blocker outside scope marks its dependent
`blocked-external`; only an operator widens scope.

**Parent-scoped membership is a strict contract, not a heuristic:** the literal first body
line `Part of #N`, matched by one anchored pattern, on candidates found server-side via the
`workflow:implement` label.

**A run is a live selector over the tracker graph, never a pinned copy.** Membership is
recomputed at every scheduling decision. Direct-ticket sets are pinned by definition; their
states are still read live.

**Run membership is immutable for a run's life.** `factory start` against a live run resolves
against the live selector rather than widening it (§10.3) — the monitor derives structure
from membership, and a widening selector reads as structure changing underneath.

### 3.2 Eligibility, blocking, ordering

- **Eligible** = open ∧ `workflow:implement` ∧ `ready-for-agent` ∧ in scope.
- `ready-for-human` members are **visible but unclaimable**: reported as human-owned,
  blocking their dependents, never touched.
- **A blocking edge is satisfied only by blocker state = closed.** No stacked-branch
  softening. A serial run may stall on manual merges, and the drain report says so.
- **Ordering** among currently claimable tickets is **ascending issue number**. Dependency
  order is already enforced by claimability. No priority labels in v1.

**The label vocabulary is fixed constants in code, not configuration.** Per-install label
names turn an eligibility predicate into a naming preference and make the tracker graph
un-auditable across repos. Making them configurable later is purely additive.

### 3.3 Claiming

A claim is **assignee plus a structured claim comment** (run id, ticket, attempt id,
timestamp), then a re-read.

- Collisions are arbitrated by **lowest claim-comment id** — Gitea-assigned and monotonic.
  The loser un-assigns itself and moves on.
- **Any assignee the factory did not set is an absolute human claim.** Never contested, ticket
  unclaimable.
- Capacity is acquired **before** the claim (§9.3). Claiming work that cannot start puts an
  assignee and a claim comment on the tracker for work that is not moving — visible to humans
  and other tooling as a falsehood.

**Staleness, two tiers.** *Same-factory*: `reconcile` proves the claiming run dead from
durable state and adopts or releases with a takeover comment — no waiting period. *Foreign or
unprovable*: stale after 24h without ticket trace, takeover comment posted first. **A live
claim is never contested.**

### 3.4 Human pause and resume

Label `factory:needs-human` plus a structured pause comment carrying the reason class and the
**exact question**; the assignee is retained so nothing else claims it.

**Resume is mechanical: the human answers in a comment *and removes the label*.** The factory
never guesses whether a comment is an answer. The frontier query simply excludes the label.

A cleared `factory:needs-human` makes the ticket eligible at the next frontier evaluation and
it is claimed as a **fresh ticket execution** with a new attempt chain — not a requeue, since
the human's action is the trigger. **The run never waits for it:** if the frontier drains
first, the run ends `drained` and the ticket waits for the next run.

### 3.5 Drain

Scope is drained when nothing is claimable now **and** nothing can become claimable without
external change (a human answer, a manual merge, an out-of-scope closure).

The run then exits with a **classified per-member report** and never lingers polling. Member
classes: `closed` · `needs-human` · `awaiting-merge-dependency` · `blocked-external` ·
`human-owned` · `failed`.

`factory:failed` is the eligibility-excluding tracker marker; the failure policy itself is §8.

---

## 4. Durable state

**One SQLite database per repository**, holding a per-stream hash-chained event journal,
same-transaction projections, canonical effect and lease rows, and durable observation
cursors. The journal records **intent** and never establishes an external fact.

### 4.1 Substrate and location

- Path: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/software-factory/repos/<slug>/state.db`, WAL,
  `synchronous=FULL`. The root is resolved by the pi SDK's **`getAgentDir()`**.
  **`PI_AGENT_DIR` is not a pi variable** — it was read only by the retired factory
  extension's own code. Both spell the same path today; the day someone sets
  `PI_CODING_AGENT_DIR`, the old spelling splits pi and the factory into two brains and the
  monitor reads an empty database.
- `<slug>` is Claude's notation (`-home-minder-projekty-oh-my-slop`). On collision with a
  differing canonical path, append `-<sha256(realpath)[0:8]>`. **The canonical path is
  recorded inside the directory and compared at open**, so reconcile proves it opened the
  right store. This replaces the legacy's flat, non-repo-scoped `runs/`, which currently mixes
  `oh-my-slop` and `nukem2_again` documents in one directory.
- Driver is **`node:sqlite` behind one thin adapter module**, accepting its
  `ExperimentalWarning`. The file format is stable SQLite whatever the JS API does, and
  `better-sqlite3` would put a native module inside a pi extension for a cosmetic gain.
- **An event append and its projection update commit in one transaction.** This *deletes* the
  stale-projection failure class rather than detecting it, and means no precedence rule
  between journal and projection can exist to get wrong. The legacy `job-pipeline` had a
  checksummed journal *and* a `shouldPreferReplayedSnapshot()` step-rank heuristic that let
  the stored snapshot beat the replay.
- WAL is load-bearing and was verified on this host (Node 22.23.2, SQLite 3.51.3): a separate
  read-only connection sees 0 rows mid-transaction and 1 immediately after commit. A reader
  takes no write lock, never blocks the scheduler, and cannot observe a partial record.
- **Journal instance identity** is a UUID row written at creation. The monitor's SSE cursor is
  the pair `(instance_uuid, seq)`, so a cursor presented against a different journal is
  detectable and forces a full resync.

### 4.2 Streams and chaining

Streams: **`controller`** · **`controller.heartbeat`** · **`run:<run_id>`**.

- A global `seq` gives total order and the replay cursor; **`prev_hash` links within a
  stream**.
- Global `seq` is monotonic but **not gapless**, permanently — expiry is what creates the
  gaps. Nothing may read a gap as evidence of tampering. Only **per-stream contiguity** is
  verified.
- **Expiry is only ever whole-stream deletion or front-truncation, never mid-stream
  deletion.** A single global chain would break verification permanently at the first tier-1
  expiry, and the controller would fail closed on its own housekeeping. Run streams die whole;
  heartbeats truncate from the front, recording `stream_truncated {stream, up_to_seq,
  up_to_hash}` at the boundary. Prefix truncation keeps tamper-evidence intact across
  everything retained. A re-anchoring `journal.compacted` record was rejected: that record is
  itself deletable, which is the property being designed out.

### 4.3 Event envelope

Fields: `seq` · `event_id` (ULID) · `envelope_version` · `kind` + `payload_version` ·
`visibility` · `{run, ticket, phase, attempt}` · `causal_command_id` · `source` ·
`occurred_at` · `observed_at` · foreign source id · `payload` · `payload_digest` ·
`prev_hash` · `hash`.

- **Schema versioning is per kind**, not per journal — a global bump forces every unchanged
  kind to lie about having changed. The version is how replay tells history from a current
  writer's mistake: `run.ended` and `run.lifecycle-changed` are on **payload v2**, whose
  contract refuses `lease-lost` as an ending, a second ending, and movement after the end;
  v1 records were valid under the contract their version names and replay with v1's
  tolerance, rendered as written. **`ticket.disposition-changed` is on payload v2** for the
  same kind of reason: it now carries the reason class and the **fault** the execution settled
  under, without which §8.6's terminal-commit order is an order of dispositions nobody can
  classify — and reading a v1 record's missing fault as "not the automation's" would count
  every historical failure as a product verdict.
- **Visibility is a three-value class**, not a boolean: `operator` (default feed) · `detail`
  (shown when a node is expanded) · `diagnostic` (filtered by default). Two values cannot
  express "real, but only when you are looking at this node", and the requirement is that
  internals stay *filterable* rather than *unemitted*.
- **Kinds are dotted `<entity>.<verb>`** from one closed, additive-only enumeration:
  `run.started` · `run.lifecycle-changed` · `run.ended` · `run.stop-requested` ·
  `run.abandon-requested` · `preflight.checked` · `attempt.launched` ·
  `attempt.rechecked` · `attempt.correlated` · `attempt.ended` · `stage.resolved` ·
  `ticket.disposition-changed` · `effect.requested` · `effect.resolved` ·
  `observation.recorded` · `observation.degraded` · `reconcile.concluded` ·
  `controller.heartbeat` · `controller.lease-lost` · `projection.rebuilt` ·
  `journal.integrity-failed` · `stream.truncated` · `run.expired` · `capacity.granted` ·
  `capacity.released` · `capacity.waiting`.
- **The hash covers the whole envelope**: `hash = sha256(prev_hash ‖
  canonical_json(envelope_minus_hash))`, binding seq, event id, identity tuple, causal command
  id, payload digest, and both timestamps. Babysitter's checksum covered only
  `{type, recordedAt, data}`, which is precisely why deletion, reordering, and renaming were
  not tamper-evident there.
- **Timestamps are UTC epoch milliseconds, both of them.** Gitea returns RFC3339 with the
  server's local offset; integers also make duration arithmetic rather than parsing. **The
  foreign system's raw timestamp string is retained verbatim in the payload** — it is
  evidence, and normalizing in place destroys the original. For a foreign fact `occurred_at`
  is the foreign time and `observed_at` is when we polled; the gap between them is often the
  interesting number.
- **Ordering is by sequence, never by clock.** Tracker and git facts are discovered long after
  they occur, so a wall-clock sort silently places a polled label change ahead of the attempt
  that explains it.

### 4.4 Projections

Projections: `run` · `ticket_execution` · `attempt` · `ticket_index` (the cross-run ticket →
executions reverse index) · `run_digest` (tier 2, permanent).

- **Effect and lease rows are canonical, not projections.** The effect table needs a real
  `UNIQUE` constraint on the semantic key for the database itself to enforce idempotency, and
  a lease needs CAS against a real row. Both still emit events in the same transaction, so
  there is no drift.
- Each projection carries `projection_head {name, last_seq, projector_version, chain_hash}`,
  compared against the journal head at startup, **fail-closed with no "compare only when both
  present" downgrade** — that downgrade is the hole the Babysitter audit found.
- **Rebuild reasons:** `schema-upgrade` · `projector-version-change` · `head-mismatch` ·
  `operator-requested` · `post-quarantine`. A rebuild emits an event recording its reason,
  projector version, and resulting head.
- **The projection tables are a versioned read contract (monitor O14).** The monitor reads
  them and never re-derives state from events; a monitor that computes its own answer can
  contradict the controller, and then the operator cannot tell which one is lying. **A
  projection schema change bumps the version rather than migrating silently**, and a
  mismatched reader refuses to render the affected values rather than guessing.

### 4.5 Effects and idempotency

**Every mutation outside the database is an effect** with a `requested` / `resolved` pair:
Gitea writes (assign, claim comment, label add/remove, close, PR create, PR body update), Git
writes (branch create, push, evidence ref, worktree create/delete), Herdr writes (agent start,
agent stop), artifact and attestation writes, and cleanup deletions. **Reads are not
effects** — they get durable observation cursors.

**Key grammar:**

```
<run>/<ticket>/<phase>/<attempt>/<operation>[/<operand>]
```

- `phase` is §2.2's closed enum.
- **`run`, `ticket`, and `attempt` are individually nullable, written as the reserved literal
  `-`.** A repo-scoped effect — an orphaned artifact blob, the controller's own pane, a
  `doctor --baseline` worktree — still produces a well-formed, `UNIQUE`-constrainable key.
- `operand` is a short **natural** discriminator (label name, branch name) and **never a hash
  of the payload**. Hashing the payload into the key would make a conflicting duplicate
  silently become a *different* key, destroying the "same key, different result ⇒ typed
  conflict" rule below.
- The **payload digest is stored beside the key** and compared at resolution: identical ⇒
  return the committed result; different ⇒ **typed conflict**.

**Every effect record carries an `actor` identity slot** (monitor O6) naming who requested it
— the controller, or an operator verb. The read-only first release enumerates no operator
commands, but naming the actor on the pair being built anyway makes a future write path
additive instead of a redesign.

**Every effect record stores the fencing generation that requested it, and an effect resolving
under a generation older than the current holder's is rejected.** That is what makes the
fencing real rather than decorative.

**Every effect kind declares its probe as data, and an effect kind with no probe cannot be
registered** — enforced at construction, so a fire-and-forget effect cannot be added by
accident. This constructor check is the structural guarantee behind §5's reconciliation
invariant; without it the invariant is a code-review convention.

**Probe catalogue:**

| Effect | Probe |
|---|---|
| label add/remove | `GET` issue labels |
| assign | `GET` assignees |
| close | `GET` issue state |
| PR create | `GET` PRs by head branch |
| **comment post** | `GET` comments matching an **effect key embedded in the body as an HTML comment** |
| push | `git ls-remote`, compare SHA |
| branch create | `git rev-parse` |
| worktree create | `git worktree list` plus path exists |
| agent start | `pane list` matching the `FACTORY_ATTEMPT` token |
| artifact write | file exists and re-hashes to its digest |
| cleanup delete | does the path / ref / pane still exist |

Comment matching is **exact on an embedded key**, not marker-prefix: comments are silently
editable and deletable, so prefix matching would be the weakest link in the scheme, and an
embedded key survives edits to the visible text.

### 4.6 Leases and locks

**One primitive, several objects, all rows in the database with compare-and-swap.**

Each row carries: lease name · random **128-bit holder token** · **fencing generation from a
single DB-wide monotonic counter** (so generations are totally ordered across *all* leases) ·
expiry · renewal timestamp · an **advisory** identity blob (host, boot id, pid, process start
time) that is for the operator's eyes only and **never constitutes ownership proof**. Release
is compare-and-delete on the token.

**Objects:**

- **`controller`** — repo-scoped, exclusive.
- **`integration`** — durable rather than an in-process mutex, so a crash mid-integration is
  visible as "held by a dead generation" and reconcile probes git to decide.
- **`capacity:*`** — §9 owns the policy; this section owns only the primitive.

There is **no worktree lease** — attempt identity already makes worktrees single-writer.

**Losing the controller lease mid-run: stop issuing effects immediately, emit
`controller.lease-lost`, exit 6, and never attempt reacquisition.** The losing process does
**not** append `run.ended`: another controller may already have adopted that same `run_id`, and
an unfenced terminal event from the stale process would close work it no longer owns. Normal
run completion therefore compare-and-deletes the controller lease and appends `run.ended` in
one transaction; failure of that compare leaves the run open for re-entry and exits 6.
In-flight work is abandoned without touching Gitea or git. The fencing check at resolution is
the backstop, so the exit does not have to win a race to be safe.

A loss conceded **before `run.started` commits** names no run: a minted run id is advisory
until its record exists, so the `controller.lease-lost` event carries `run: null` on the
`controller` stream and the exit-6 report names no run — a loss event naming a run that was
never started would itself be refused by the projector, taking the concession down with it.

**Every record that moves a run's lifecycle is written under the token, in the same transaction
as the compare.** A successor adopts a *lapsed* row without asking anyone, so the previous
holder learns it is stale at its next compare-and-swap and not one moment sooner — a window in
which "do I still hold the lease?" answered from memory is answered wrong. Effects survive that
window because §14.5 declines a superseded one at resolution; a run's lifecycle has no such
backstop, since it is authoritative state read by the monitor and by the next controller's
re-entry. A stale writer would park a successor's run at `draining` while the successor is
preflighting it.

Both legacy systems failed here identically: `software-factory`'s `open(…,"wx")` lock recorded
a PID it never tested — the live store still holds a lock naming dead pid 3852874, hand-renamed
to `.lock.stale` to escape it — and `job-pipeline`'s `releaseJobLock` was an unconditional
`rmSync`, so any process could drop any owner's lock.

### 4.7 Integrity failure

**Fail closed, two scopes, never repair.**

- **SQLite-level corruption ⇒ global stop.** The controller refuses to start, the database is
  renamed to a quarantine path, and a minimal fresh store records a typed
  `journal.integrity-failed` fact so `status` and `doctor` can still answer.
- **A hash-chain break inside one stream ⇒ that run alone is unrecoverable**, rebuilt only
  from external evidence. Other streams are unaffected.

Never truncate mid-stream, never renumber, never rewrite. Babysitter's repair mode — which
drops corrupt events and reassigns IDs — is rejected.

### 4.8 Liveness

The **lease row is renewed every 10s** — that is the liveness fact, and it costs no journal
growth. A **heartbeat event is emitted every 60s** carrying lease token, fencing generation,
and a one-line activity summary, classed `diagnostic`.

The monitor derives `controller-lost` after **3 missed heartbeats (~3 min)** or an expired
lease row, whichever it sees first. **The controller never self-asserts it.**

Heartbeats are the one event class safe to compact, and they have their own front-truncatable
stream to make that possible without breaking any chain.

---

## 5. Observation and reconciliation

### 5.1 Observation ingestion

**Herdr: subscribe, don't poll.** `events.subscribe` on the Unix socket carries 26 event kinds
including `pane_agent_status_changed`, `pane_exited`, and `pane_agent_detected`, filterable per
pane (verified live at 86 frames in 8 seconds). It is not exposed in the CLI, so this costs a
small NDJSON socket client. **Agent-status transitions must be recorded as events, not sampled**
— a poll structurally cannot see `working → blocked → working` between two samples. If the
socket is unavailable, degrade to polling **and emit a typed `observation.degraded` event**;
silent degradation would be indistinguishable from a well-behaved worker. Resubscribe by pane id
after a Herdr server restart — pane ids survive it.

An event is emitted per observed transition; a confirmation of no change emits nothing, with
the controller heartbeat carrying "watching N panes" so *quiet* stays distinguishable from
*stopped watching*.

**Gitea: a durable cursor `(scope, last_updated_at, last_foreign_id)`.** Poll the two cheap
`since` endpoints at **15s** during a run with a **60s overlap**, deduping on foreign event id
— safe because timeline and comment ids share one monotonic sequence, and because `?since=` is
`updated_at`-based, so overlap costs duplicates and never gaps. Not 5s: the factory's tempo is
minutes and the frontier only moves on our own writes or a human's. Per-issue `timeline?since=`
only for issues the cheap pass flagged; `dependencies`/`blocks` only on an `add_dependency`.
Store `content_version` per issue as the cheap body-edit detector. Every foreign fact enters as
`observation.recorded` with `source=gitea` and the foreign id, making re-polling idempotent by
construction.

**Webhooks are rejected for v1** — the repo has none configured and the controller has no
inbound HTTP surface.

### 5.2 Authority is per fact class

A global ranking always ends up asserting something the winning source does not know.

| Source | Authoritative for |
|---|---|
| **Gitea** | ticket state, labels, assignee, PR existence — **not comment text** |
| **Git remote, freshly fetched** | what was actually published: branch SHAs, whether a push landed |
| **Herdr** | exactly one fact: whether a worker process is alive right now |
| **The attempt outbox** | what the worker *claimed* — evidence, never proof, of a phase outcome |
| **The journal** | **intent only**; it never establishes an external fact |

Comment text is excluded deliberately: bodies are silently editable, and a deleted comment
vanishes from `/comments` **and** `/timeline` without trace. So a missing claim comment means
*possibly deleted*, never *no claim was made* — our own effect record plus the durable assignee
corroborate.

Herdr **exposes no exit code anywhere** (`exit_code` occurs exactly once in its entire API
schema, on plugin command logs), so it can never say *how* something ended. The outbox remains
the sole structured completion signal.

### 5.3 The reconciliation invariant

> **A `requested` record with no `resolved` record is never settled by reasoning, only by
> re-probing the external system — and that probe is itself written as an observation event
> carrying its source.**

This is what discharges "without inferring success from a stale snapshot".

### 5.4 When reconcile runs, and what it emits

**Reconcile runs always at controller startup, before the lease is used for any effect.**
There is no separate resume mode — resume *is* startup, and a special mode is a mode someone
forgets to enter. It also runs on the operator's explicit `reconcile`.

**`doctor` runs the identical code with a read-only flag**: it computes the same conclusions
and **prints them, appending nothing**.

**Scope:** every run whose lifecycle is not `ended`, plus **any entity holding an unresolved
effect** — a ticket execution, a run that has already ended, or the repository itself for a
repo-scoped one.

The second clause is not a list of places effects happen to live; it is there because **an
unresolved effect outlives its run's ending**, which is exactly why §12.4 makes it a pin rather
than a table-level exception. Scoped to ticket executions alone, a ticket-less effect of an
ended run and a repo-scoped effect would be pinned by §12.4 and reached by nothing — a
permanent pin, with `doctor` shouting about an obligation the operator has no verb to discharge.

**Output:** one `reconcile.concluded` event per affected entity, carrying a conclusion ∈
`adopted` · `released` · `declared-dead` · `unchanged` and an **ordered, non-empty evidence
basis, deciding source first**, from the closed set `tracker` · `git-remote` · `git-local` ·
`harness` · `outbox` · `artifact`. Ordered, because the operator's question is *which source
decided*. Non-empty is enforced at construction. **`journal-intent` is deliberately not a
member** — that is how "the journal never establishes an external fact" gets teeth instead of
staying a comment.

### 5.5 Adopting a live worker

Herdr runs in its own server process, so a resumed controller routinely finds a live worker
session well into an implement phase. **Adopt when identity is provable; declare dead
otherwise.** Discarding it would throw away real model work because the *controller* died.

Provability is cheap. Herdr's `pane report-metadata` accepts up to 32 `NAME=VALUE` tokens per
pane — a purpose-built correlation side-channel that nothing else uses. **Stamp
`FACTORY_ATTEMPT=<attempt_id>` on the pane at launch.** Pane ids are persisted in
`session.json` v3, stable across a Herdr server restart, and never reused.

**Adoption test — all five:** token matches **and** pane alive **and** agent kind matches
**and** recorded worktree exists **and** outbox path intact.

Two controllers both adopting is prevented by the controller lease and its fencing generation,
**not** by killing the worker.

This reads "every resume is a fresh attempt" as **a failed or abandoned attempt is never
continued**, not *a still-running one is discarded*.

---

## 6. Workers

### 6.1 The adapter seam

One runtime-neutral **worker harness adapter** is the contract's spine, with operations
roughly `preflight(role, package_rev)` · `launch(attempt)` · `await_completion(attempt)` ·
`cancel(attempt)`, each emitting typed events.

Every pi/Claude difference — flags, plugin dirs, invocation syntax — lives behind it; adding a
runtime means implementing the adapter and nothing else. The adapter is **role-parametric**,
where a role is `(name, entry skill, closure, prompt template, result expectations)`, and it
knows nothing about which roles exist.

### 6.2 Skill closure and the three-layer preflight

**Transitive skill requirements are a machine-readable `requires:` frontmatter declaration in
the package's skills** — a package change this specification mandates. The factory computes
the closure mechanically from the pinned revision; no hardcoded role knowledge lives in the
factory.

**Preflight runs before the first claim. Any miss is an automation failure.**

1. **Static artifact checks, per run** — resolved and canonicalized package root, pinned
   revision, readable `SKILL.md` for the whole closure, frontmatter and reference validation,
   no escaping symlinks.
2. **A live per-runtime probe, per run.**
   - **pi** — a disposable RPC session with the exact production flags
     (`--no-skills --skill "$PACKAGE_ROOT/skills"`), requiring `skill:<name>` command records
     for the entire closure.
   - **Claude** — `claude plugin validate --strict`, then
     `claude --plugin-dir <path> plugin details` expected-vs-actual component diff, then the
     authoritative **`initialize` control-request probe** over stream-json, which returns the
     session's structured `commands` array (including `<plugin>:<skill>` records) at zero model
     cost. Verified live. The probe must use the production flag set.
3. **A cheap static recheck per attempt** — no fresh probe.

**The probe must execute the production path, not merely inspect registration.** The audited
Babysitter Pi bridge mixed CommonJS with an ESM package, referenced absent shell targets, and
then swallowed bridge exceptions as `{}` — passing installation and discovery while
behaviorally dead.

**The capacity probe folds into this same per-runtime probe** (§9.7): one request yielding both
model inventory and `max_instances`, so no second place can disagree about whether the runtime
is up.

**No degraded prose-loading mode exists in v1.** Unprovable native invocation fails the attempt
as an automation failure. Prose hints, global symlinks, terminal sentinels, and model-driven
package discovery are not authoritative protocols.

### 6.3 The Claude plugin artifact

The package ships a **tested generator script** — `scripts/build_claude_plugin.py` — that
flattens `skills/<bucket>/<name>` into a valid plugin (manifest name `oh-my-slop`, with
`references/` / `scripts/` / `assets/` kept beside their skill). The factory invokes it against
the pinned revision into an immutable run-scoped directory, validates strictly, and caches per
revision.

**Two loader facts, verified live against Claude Code 2.1.229**, both of which fail *silently*
and so must be held by tests rather than by care:

- **The plugin loader registers `skills/<name>/SKILL.md` at depth 1 only.** A skill left at
  `skills/<bucket>/<name>/SKILL.md` is absent from the component inventory with no warning and
  no error — just a smaller `Skills (N)` count. Flattening is therefore load-bearing, not
  cosmetic, and the generator's acceptance asserts the registered count against the shipped
  count rather than asserting the tree shape.
- **`author` must be an object**; npm's string form fails `--strict` with
  `author: Invalid input: expected object, received string`. The generator normalizes it, so
  `package.json` stays idiomatic npm.

### 6.4 Sessions and prompts

**All worker attempts run as interactive Herdr panes**; headless is reserved for disposable
probes.

The controller composes the first prompt from a **deterministic per-role template**: the native
invocation (`/skill:<name>` for pi, `/oh-my-slop:<name>` for Claude) plus a typed context block
carrying the ticket snapshot, attempt identity, worktree path, outbox path, and prohibitions
(no push, merge, close, or relabel).

**Workers get no tracker credentials.** The Gitea instance rejects all unauthenticated API
calls, so the controller **snapshots ticket body plus relevant comments into the attempt
context at claim time** — deterministic evidence of exactly what the worker saw, zero
credentials. A dedicated read-only factory token is the v2 upgrade path.

**Workflow skills stay factory-agnostic.** The completion-protocol obligation lives only in the
template (with a schema pointer), never inside package skills.

### 6.5 Correlation

The controller mints `{run_id, ticket, phase, attempt_id}` **before launch**, writes an attempt
manifest in a controller-owned location, passes identity via environment variables and the
prompt, and derives Herdr agent and pane names deterministically from it.

**The outbox result must echo the full tuple; a mismatch is an automation failure.**

The adapter persists per attempt: harness session identifiers (pi session, Claude session,
Herdr agent and pane ids), runtime, exact model, skill source, and package revision.

**The transcript pointer is captured from Herdr, not computed.** Herdr persists
`AgentSessionInfo {kind: "id"|"path", value}` per pane, pushed by the agent's own `SessionStart`
hook — Claude reports a session id, pi reports a literal `.jsonl` path. Record
`{worker_kind, transcript_kind, transcript_value, captured_at}` on the attempt, polling with
backoff for a few seconds after launch. One seam covers both runtimes, and because worker and
reviewer are *different panes* it disambiguates them **as a fact**; computing the path cannot,
since pi keys sessions on cwd and both roles share a worktree. If the pointer never arrives,
record `no-transcript-pointer`. **No later heuristic can recover this** — Herdr drops the
reference at pane close and integration deletes the worktree the pi path is keyed on.

### 6.6 Typed completion — hybrid authority

**The attempt outbox file** — schema-versioned JSON at a controller-designated path *outside*
the worktree — is the authoritative **domain** result. **Harness and Herdr lifecycle events**
are the authoritative **termination** signal.

The wait is **first-signal-wins**: either signal wakes the controller, which evaluates
(outbox validity × worker liveness) against a state table — making silent-completion,
wrote-but-hung, and invalid-result **distinct typed outcomes**.

**Worker-writable statuses are a closed set:**

- `completed` — commit SHAs, summary, worker-reported test evidence **as context only**;
- `needs-human` — reason class plus the exact question;
- `worker-failed` — classification plus explanation.

**Controller-derived outcomes are never worker-writable:** `automation-failure` · `timeout` ·
`invalid-result` · `no-result` · `dead-worker` · `wrote-but-hung` · `cancelled`.

**Every outbox status carries the full `{run, ticket, phase, attempt}` tuple and the schema
version.** Correlation and idempotency identity are mandatory, never optional.

**Outbox mechanics.** Exactly one file per attempt, written atomically (temp + rename). First
schema-valid content wins; post-harvest writes are evidence, never state. A present-but-invalid
file is `invalid-result`, distinct from no-file-at-turn-end.

**Large output belongs in artifacts.** Stdout, stderr, and evidence go into immutable artifact
objects referenced by digest, media type, byte count, producer, and retention class (§12.1) —
never embedded.

**Lifecycle after result.** After writing any status the worker ends its turn and the
controller **stops the agent** — not the pane (§13.B). `cancel(attempt)` is a Herdr **agent
stop** plus a typed cancellation event carrying who and why; late outboxes are ignored for
state. A worker still running after harvest is stopped as **routine shutdown, not an error**.

### 6.7 Proof depth

Runtime verification proves **registration and invocation echo only**. Deep proof that
Opus/Fable actually load and follow skill bodies is a **one-time acceptance matrix** per
(harness version × model × package revision) during implementation, with §8's independent
review gate judging worker output at every integration.

### 6.8 Trust, permissions, and isolation

**Trust.** The controller pre-trusts its own worktrees mechanically, per attempt — a factory
worktree contains only the operator's repo at a pinned commit, so auto-trust weakens nothing.
Claude: trust state written into the controller-owned config state file. pi: `trust.json` /
`defaultProjectTrust` in controller-owned scope. **Preflight proves no trust dialog can reach a
worker pane; a trust hang is an automation failure.**

**Builder posture — allow-by-default with explicit denies.** Full bypass is rejected; a strict
allowlist is a reliability trap.

- **Claude binding:** `dontAsk` mode + broad allow rules + the deny floor, injected per session
  via `--settings`. No prompt path exists, so an interactive pane can never hang on approval.
  `acceptEdits` is unusable — it still prompts for Bash, the proven #64 failure.
- **pi binding:** tool lists only. **pi has no command-level permission system.**

**Deny floor (mechanical, override-proof):** `Bash(git push*)` · `Bash(tea *)` · `Bash(gh *)`
plus a **disabled `pushurl`** in every attempt worktree. Per-run overrides may *add* denies,
never subtract. Deliberately small: the floor guards scheduler-only verbs; the integration gate
guards the outcome. No broad network denies in v1.

**pi's weaker gating is accepted for v1, loudly.** A pi builder relies on prompt + capability
withholding + the integration gate. A pi bash-guard extension is a v2 hardening candidate.

**Stated honestly:** on this host, push authority is ambient SSH and `tea`/pi credentials are
readable by any same-user process. Credential sandboxing is out of scope, so **worker
permissions constrain behavior, not capability**. The guarantee is §7's controller-only
integration gate — nothing becomes real except commits the controller itself verifies and
pushes.

**Reviewer — belt and suspenders, attestation authoritative.** Claude reviewer: plan mode +
`--disallowedTools Edit,Write,NotebookEdit` + deny floor, **and the same broad allows for the
tools it keeps** — a reviewer with no allow rules has a prompt path back, which is the failure
this whole section closes, on the one posture that was not given them. pi reviewer:
`--exclude-tools edit,write`, bash retained (needed for `git diff` / `log`). **The authoritative guard is the
controller's attestation:** capture clean-worktree + HEAD before review, verify unchanged
after; a mismatch is a typed `mutation-detected` failure. **An opening capture that is already
dirty is a mismatch too**, not a third answer: the controller made that worktree out of a commit
and handed it to one read-only role, so anything in it beforehand was written under that
attempt's identity — and reading a leftover as an automation problem would hand back the second
go §14.19 refuses, to the attempt that earned the refusal.

**Approval states — no mid-attempt approvals in v1.** A denial is information: the worker
adapts within its permissions or ends the attempt with a `needs-human` outbox carrying reason
class `risky-action-required`. Pane-level live approval is interactive takeover, and out of
scope. The prompt template states this contract to the worker.

**Config isolation — promotion, not inheritance.** Workers run in a controller-owned config
environment (Claude: `CLAUDE_CONFIG_DIR`, which still accepts `--plugin-dir`; pi:
controller-scoped settings), **never inheriting the operator's personal config, skills, or
hooks.** Procedurally valuable personal rules migrate through exactly two channels:

1. **Package skills** — the preferred home for engineering discipline. *Migration note:* the
   `tee`-over-`head`/`tail` output-capture rule belongs in this package's discipline skills.
2. **A factory worker-context file** declared in factory config, copied into the config
   environment at run start and hash-recorded in the run manifest.

**Live inheritance of `~/.claude` / `~/.pi` personal config is never a channel.**

**Capability promotion is a third channel, and it carries no rules.** The two channels above
govern *rules*; an empty config environment also removes things that are not rules and that the
factory's own model depends on — measured, not assumed: pi's `local` models are supplied by an
operator **extension**, so an isolated agent directory deletes a §9.1 resource class outright,
and §6.5's transcript pointer arrives through another. Two closed lists therefore cross in:

- **Fixed capability artifacts**, named in code per runtime — credentials and the model
  catalogue. Nothing here carries behaviour, and this section already records that credentials
  are ambient on this host.
- **Declared runtime extensions** (`worker.piExtensions`), defaulting to **none**, recorded in
  the run manifest by declared path **and content digest**, so what a run loaded is evidence
  rather than a claim about intent.

**The limit is enforced, not promised.** Skills reach a worker only from the pinned package
root: the live probe requires every `skill:<name>` command record in the session — not merely
the closure's — to resolve inside that root, so a promoted extension that registers a skill is
the same typed failure as a shadowed one. A promoted extension may add tools and providers; it
may not add skills, and it is never a route for personal rules.

**Skill conflicts — one predicate, fail closed.** Every required skill must resolve uniquely
and verifiably to the pinned package revision. Shadowed, duplicated, disabled, or missing are
**one typed automation failure**, and the diagnostic names the offending source.

**Human overrides — per-run, declared, recorded.** Overrides (extra denies, budgets, model
choices, worker-context file) are declared at run start in config and recorded in the run
manifest as evidence. **The hard floor no override may cross:** no force-push, no
default-branch writes, no auto-merge, no skipping the independent review verdict, no
subtracting from the deny floor. No mid-run loosening in v1.

---

## 7. Git isolation and integration

### 7.1 Topology

The factory operates **exclusively on a factory-private bare clone** of the target repo, one
per repo, in the controller-owned state area. Every working tree is an attempt or integration
worktree hanging off that clone. **The operator's checkout is never read or written** —
protection of operator and untracked work is *topological*, not behavioral.

The clone is **derived, disposable state**: missing or corrupt means re-clone, never in-place
repair.

### 7.2 Base and freshness

Base = the target repo's default branch as known to the Gitea remote. The controller fetches
immediately before creating each attempt branch and **pins the fetched tip as the attempt's
base commit**, recorded in the attempt manifest. **The base is never chased mid-attempt**; a
moved base is reconciled at integration time only (§9.5). Neither legacy implementation
handled base freshness at all.

### 7.3 Branches, worktrees, commits

- **One branch per attempt:** `factory/t<ticket>/a<attempt_id>`, derived deterministically from
  the minted identity tuple. Globally unique, so collisions are impossible and **force-push is
  never needed**. The `factory/` branch namespace and `refs/factory/*` belong to the factory
  alone; it never writes any ref outside them and never pushes the default branch.
- **One worktree per attempt**, created fresh at claim time, exactly one worker, never reused.
  It is created at **the attempt's own base commit** — §7.2's pinned base for a first attempt
  and for a fresh-retry, and **the prior attempt's tip for a repair** (§8.5). A repair's base is
  therefore an attempt branch rather than the default branch, which is what "work preserved"
  means mechanically.
- **Commits** are made under the package's `git-discipline` skill (conventional commits, a
  commit per wave), using a **dedicated factory git identity** set via per-worktree git config,
  plus a mandatory correlation trailer `Factory-Attempt: <run>/<ticket>/<attempt>` — a prompt
  obligation, verified at integration. **Factory commits are never authored as the operator.**

### 7.4 Mechanical acceptance predicates

Controller-enforced, and deliberately split by fault attribution:

- **Harvest-side (builder faults):** an attempt is harvestable as `completed` only if its
  worktree is **clean** — no uncommitted or untracked leftovers, and a dirty worktree is a
  typed failure, never auto-committed — **and** its branch has **≥1 commit** ahead of **its own
  base** (§7.3). Read against the run's base instead, a repair that committed nothing would
  still be "ahead" by the commits the attempt before it made, and a worker that did nothing
  would harvest as `completed`.
- **Integration-side (controller faults):** the branch passes `git diff --check`, and the
  pushed SHAs are exactly the verified branch's commits (ancestry and identity check).

### 7.5 Integration

Only the controller integrates, in a controller-owned integration worktree.

1. **Fetch.** If the base moved, **rebase** the attempt branch onto the fresh tip — safe,
   because the branch is unpublished.
2. Before a destructive rebase, **the pre-rebase head is preserved under a local evidence ref**
   `refs/factory/evidence/<attempt_id>`. Evidence survives by contract, not by reflog.
3. **A rebase conflict is a typed outcome** ending the integration step.
4. The required mechanical checks run on the rebased result, **at the exact commit that will be
   pushed** (§8.2). Verification attests the commits actually being published.
5. **Plain push, never force**, of the final attempt branch only.
6. **One PR per ticket** against the default branch.

**PR shape.** Title: the ticket title (with a conventional prefix when the ticket provides one)
plus `(#N)`. Body: a machine-parseable fenced key-value block — attempt identity tuple, base
commit, package revision, evidence links, attestation digest — followed by **`Closes #N`**, so
the *manual* merge is what closes the ticket via Gitea's native automation. This satisfies both
"manual final merge" and "only the controller closes".

A stale open PR from a dead earlier attempt is closed with a comment linking the new PR — **one
live PR per ticket, always matching one attempt branch**. This replaces the legacy per-run
integration-branch/single-PR shape, which §3.2's closure-only dependency rule forecloses.

### 7.6 Awaiting-merge, drift, and the redo path

At publication the controller sets **`factory:awaiting-merge`** on the ticket (assignee
retained). Frontier eligibility excludes the label; the drain report classes such members
`awaiting-merge-dependency`; reconcile double-checks by discovering the open factory PR from
its parseable body.

**The factory never touches a published branch:** no refresh rebases, no force pushes, no
auto-closing drifted PRs. A PR that turns conflicted before manual merge is the human's call.
The drain report may note Gitea's unmergeable flag; **no automation acts on it in v1**.

**Human redo path** for a PR closed unmerged: remove the label and the assignee, and a fresh
attempt with a new branch and worktree runs. **The factory never resurrects a closed PR.**

### 7.7 Failed attempts, idempotency, and the lock

- **Nothing non-integrated is ever pushed.** A failed attempt's worktree and unpushed branch
  are **the only copy of that work**, so they are retained and pinned (§12.4).
- **Integration is re-runnable end to end**: rebase on a scratch ref, push of a unique branch
  retries cleanly, PR creation is check-then-create. A crash mid-integration is repaired by
  reconcile re-running integration from durable state.
- **No force-push ever**, and the factory writes nothing to the default branch, so **there is
  no main-branch rollback surface**.
- **A single controller-wide `integration` lease** — at most one attempt in rebase → push → PR
  at a time, permanently. Fetches into the private clone are serialized by the controller.
  Worker parallelism needs nothing more from Git: disjoint branches, disjoint worktrees,
  per-attempt pinned bases.

### 7.8 Refusals

**v1 supports plain repos only.** Preflight detects `.gitmodules` or LFS attributes and **fails
closed** with a clear diagnostic. No silent degradation.

---

## 8. Verification, review, repair, and outcomes

### 8.1 The pipeline

```
implement → harvest → verify → review → integrate
```

**Exactly two phases are agent-borne — `implement` and `review`.** `harvest`, `verify`, and
`integrate` are controller phases with no model in them: putting a model between `pytest` and
an exit code adds a failure mode and buys nothing.

`harvest` exists as a named step so that §7.4's builder-fault predicates route to repair,
attributed apart from the integration-side controller-fault predicates.

**`implement` has no phase result of its own** — its result is its attempt's outcome.

### 8.2 Mechanical checks are declared, never discovered

Factory config carries, per target repo, an **ordered list of named checks**, each with a
command, a **mandatory timeout**, a `required | advisory` flag, and an **expected-failure
exit-code contract** (§11.6).

- **No inference** from `pyproject.toml`, `package.json`, or a Makefile, and **no parsing of
  `AGENTS.md` prose** — prose is not a contract.
- **The full required set runs every time.** Per-surface targeting ("which area did this
  touch") is exactly the inference that goes wrong silently.
- **The controller reruns the full required set itself**, in a controller-owned verification
  worktree, **at the exact post-rebase commit that will be pushed**. One rule, no conditional
  re-check paths. Worker-reported test evidence remains **context only**.
- **`verify` runs the advisory checks alongside the required ones**, and judges on the required
  set alone. That is the one place "advisory checks record evidence and never block" can happen:
  §8.3's baseline runs the required set by itself, and §8.7's attestation carries *every* check
  with its required flag.
- **A required set in which one check was `unrunnable` is `unrunnable`, even beside a genuine
  failure.** §14.16 makes the controller's rerun the only attestation boundary, so an incomplete
  rerun attests nothing; calling the phase `failed` would charge the worker's repair budget for a
  broken host, and a real failure that survives the retry reports itself one phase later.

Neither legacy implementation ever executed the project's own checks; both trusted
agent-reported evidence, and `software-factory` merely demanded a `"tests":["command: result"]`
array it never re-ran.

**Fault attribution.** A required check exiting non-zero **within its declared expected-failure
exit codes** is a genuine failure → repair. **Anything else — timeout, signal, exec-not-found —
is `unrunnable`, an automation failure, never a worker failure.** Advisory checks record
evidence and never block; expensive or environment-fragile classes (E2E, browser, network)
default to advisory with an explicit opt-in to required.

### 8.3 Baseline: green at base, or the run does not start

The controller runs the required set at the pinned base commit **before the first claim**;
failure aborts the run with the run-scoped reason **`baseline-red`**, naming the specific red
check. Without this, every attempt is blamed for breakage the worker did not cause — the exact
conflation this section exists to prevent.

Differential "no new failures relative to baseline" verification is recorded as the **v2
upgrade** and is the right answer for repos the operator does not control. It is rejected for
v1 because it requires parsing per-test identity out of three unrelated runners, and a wrong
diff silently passes a real regression.

> **Recorded consequence, and a hard precondition on delivery (§18):** `oh-my-slop`'s own suite
> is red since `fe80c5d` — `tests/test_pi_package_installability.py:125` asserts a retired
> extension, seven files under `tests/node/` import the moved `extensions/software-factory/lib/*`,
> and `tests/test_readme.py:11` points at a dead path. CI stays green only because it runs
> `validate_refs.py` alone. **The factory cannot run against this repo until that is fixed.**

### 8.4 Review — the controller fans out, not the worker

The review phase launches **two independent read-only worker attempts**, `review-standards` and
`review-spec`, each with its own entry skill, outbox, attempt identity, and **its own worktree
at the same commit** — preserving §7.3's one-worktree-per-attempt invariant verbatim, and
making a mutation attributable to a specific attempt.

The fan-out sits with the controller because the alternatives leak: `two-axis-review` spawns
its own sub-agents and pi's model-facing subagent tool is a separate opt-in extension, while
Herdr fan-out would hand a read-only role the ability to spawn write-capable panes outside the
controller's minted identity — producing orphans invisible to reconcile and unreachable by
`cancel`.

**Both are launched independently and both always run to completion.** Under a resource class
of size 1 they take turns; simultaneity was never the requirement. Cancelling the survivor on
first rejection would manufacture a late-result-after-cancellation case on a path that is not
even an error, and the second axis's findings improve the repair prompt.

**The controller unions the blocking sets.** It never merges or reranks, which honours the
skill's own refusal to rank across axes for free.

**Package change this mandates.** The two axis briefs — already self-contained sub-agent
prompts carrying the smell baseline and the trust boundary — become **independently invocable
entry skills** the factory names as roles. `two-axis-review` remains the human-facing skill and
should stop assuming a spawn tool exists.

**Verdict shape.** The reviewer role writes a typed outbox verdict — `approve` | `reject` with
a findings list — where every finding carries severity `blocking | advisory` and a **mandatory
citation**: a spec line or a documented standard. **One or more `blocking` findings on either
axis ⇒ reject**, and the rule is read over the union rather than over the two verdict words, so
a record whose word and findings disagree — `reject` with nothing blocking, `approve` over a
blocking finding — is an `invalid-result` rather than a contest the controller settles. Fowler
baseline smells are judgement calls by the skill's own text and can therefore **never** be
`blocking`; the controller does not classify a citation, because recognising a smell by name
would put a second copy of the skill's baseline in the factory and downgrading a finding would
be the reranking above. This obligation lives in the **prompt template**, not inside the package
skill.

**Two levels, two owners.** The *shape* of a written verdict is §6.6's schema judgement and
belongs with the outbox reader, which has never known which roles exist. Whether a verdict is
**owed** — a `completed` reviewer attempt that wrote none produced no result for its role — is
role knowledge and belongs with the fan-out. Each axis resolves its own `stage.resolved` under
**its own attempt**, so §8.10's per-attempt rows are routed where the attempt is; the phase's
own result is resolved under the **builder** attempt, which is what makes §8.10's `verdict`
action the fan-out's and never the stage walk's.

**Independence is *role* independence:** fresh session, read-only permissions, no builder
transcript, ticket snapshot and diff as the only inputs. **Model diversity is available as
per-run configuration but is not mandated** — it would constrain model routing for a benefit
nobody can measure.

**Ordering short-circuit.** A failed `verify` goes **straight to repair** with the check output
as evidence; **the reviewer only ever sees mechanically-passing code.** This sharpens the
reviewer's brief to "is this right and clean" rather than "is this broken".

### 8.5 Repair — two tiers

Every resume is a fresh attempt with a fresh worktree, so "repair" never means a continued
session.

- **Repair** branches from the **prior attempt's tip** — work preserved — with the failure
  evidence in its prompt.
- **Fresh-retry** branches from the **pinned base** — work discarded — optionally re-routed to
  a different model.

The two tiers answer different failures: a failing test is usually a small fix on top of good
work, while a worker that flailed should not have its flailing inherited.

**The repair chain reaches the PR unsquashed.** It is honest about what happened, and the
alternative is the controller rewriting worker commits — a new class of thing for it to get
wrong. Stated explicitly so nobody reads it as an oversight.

**Repair prompt trust framing.** Controller-produced evidence — check exit codes,
digest-referenced output, git predicates — is presented **as fact**. Worker-authored text — the
prior worker's summary, the reviewer's findings — goes in a clearly delimited **untrusted
block** using the same trust-boundary language `two-axis-review` already carries. A reviewer
whose findings contain an injected directive must not have it promoted into an instruction to a
write-capable builder.

### 8.6 Budgets and the circuit breaker

**Counted per ticket, never reset within a run:** **1 repair + 1 fresh-retry** (the product
budget), plus an **independent automation budget** (default 1) that automation failures alone
consume. Declared configuration with a **hard ceiling of 2 + 2**.

**Three declared numbers, not two counters.** §8.10's fourth column is coarse on purpose — it
says *product* or *automation*, which is what "automation failures never consume the product
budget" is about — but the product budget is granted as *1 repair **+** 1 fresh-retry*, and
§11.6 declares the two separately. Each tier therefore spends its own number, and exhausting
either files `repair-budget-exhausted`. One pool of 2 would let a ticket take two repairs and
never the fresh-retry that discarding the work was for.

**The ceiling is 2 on each declared number**, which is what "2 + 2" scales the defaults' "1
repair + 1 fresh-retry" to, and the automation budget is capped at 2 by the same rule. The
other reading — at most two *product* retries in total — would put the shipped default at its
own ceiling, leaving a knob that can only be redistributed and never raised; that is the
refusal-to-have-a-knob this section already rejects, wearing a ceiling's clothes.

**Nothing increments.** A spend is a *count* of the stage resolutions that charged that budget,
read back from the journal, so the bound and the count are one expression and there is no
counter to keep in step. That is also what makes the walk re-enterable: a controller that died
between resolving a failing stage and minting the attempt its tier called for reads the same
count back and grants the same retry.

- **Automation failures never consume the product budget** — the worker did not cause them.
- **Reviewer-attempt failures consume the automation budget**, because a reviewer that crashed
  says nothing about the work; charging the builder would eventually discard good work on an
  infra flake.
- **An automation retry re-enters the phase it left**, while both tiers re-enter `implement`.
  §8.5's "every resume is a fresh attempt" governs the tiers; a `retry` is a third action, and
  rebuilding good work because a pane died is the flake charged to the builder this section
  forbids.

Legacy pinned `repairAttempts` / `freshAgentRetries` at exactly 1 by *throwing in config
validation* — the right instinct expressed as a refusal to have a knob. A declared ceiling gets
the same guarantee and stays honest about being a policy choice. The failure mode being
foreclosed is `job-pipeline`'s `replanCount`, incremented forever and compared to nothing.

**Run-level circuit breaker.** N **consecutive automation failures** (default 2) stops new
claims and exits through §3.5's drain report. **"Consecutive" means consecutive in
terminal-commit order** — the total, durable order in which ticket executions commit their
disposition, reconstructible from the journal. Wall-clock interleaving would otherwise make it
depend on scheduling accidents; at capacity 1 this degrades to exactly the serial semantics.

**N is a code constant, not a knob.** §11.3's block inventory and §11.6's list of defaults are
both closed and neither names a breaker key, while §14.33 makes an undeclared key a load
failure — so the value lives in code, read from one place, beside the ticket-concurrency
ceiling it most resembles. This is also the reversible direction: promoting it to a declared
number later breaks no file on disk, while retiring a knob breaks every file that set it.

**An operator's stop outranks the breaker.** Both drain identically, so when a human asked for
the stop the run says so and the exit code answers what they typed; the breaker's verdict is on
the report either way, so the ordering hides nothing about the machine's state.

**The verdict is monotone**: *has this run ever reached N in a row*, not *are the last N*. The
two agree at the instant a breaker trips, because the predicate is read at every scheduling
decision — and they must disagree afterwards, because §3.5 lets the lanes that were already
running finish, and one of them settling `published` cannot be allowed to erase the reason the
run stopped claiming. The `claiming` predicate and the recorded `end_reason` read the one
verdict, so they cannot conclude differently about why the run ended.

**Product-level outcomes never trip it.** Five tickets each needing a human is a productive
run; five tickets each dying in preflight is a broken host burning tokens on a verdict it has
already reached. **Which is which is the disposition's own `fault`** — the budget kind that ran
out, recorded on the terminal-commit record beside the disposition — and never a list of reason
classes matched here. A class added to §8.8 later would otherwise be a silent vote on whether
runs should stop, cast by whoever happened to add it.

### 8.7 Attestation

The controller writes a **per-attempt immutable attestation artifact**, referenced by digest
(never embedded): the exact published commit; every check with its command, exit code,
duration, and required flag; **both** review verdicts with blocking **and** advisory findings;
and the before/after HEAD guard result.

A summary lands in §7.5's machine-parseable PR-body block and in the ticket comment — advisory
findings surfaced there, blocking findings never. This is what makes "the controller verified
this" a **checkable claim** rather than a policy statement.

### 8.8 Taxonomy — three levels

**Attempt outcome** (one worker run).
Worker-writable: `completed` · `needs-human` · `worker-failed`.
Controller-derived: `invalid-result` · `no-result` · `dead-worker` · `timeout` ·
`wrote-but-hung` · `cancelled` · `automation-failure`.

**Phase results.**
`harvest` → `passed` | `predicate-failed` ·
`verify` → `passed` | `failed` | `unrunnable` | `rebase-conflict` ·
`review` → `approved` | `rejected` | `mutation-detected` ·
`integrate` → `integrated` | `rebase-conflict` | `predicate-failed` | `push-failed` | `integration-red`.

`verify` and `integrate` have no worker, so forcing their results into the attempt enum would
conflate them.

**Ticket disposition.** `published` · `paused` · `failed` · `released`.

**Reason classes.**
Worker-writable: `product-ambiguity` · `spec-contradiction` · `missing-access` ·
`risky-action-required` · `out-of-scope-discovered` · `dependency-unmet`.
Controller-derived, never worker-writable: `repair-budget-exhausted` ·
`automation-budget-exhausted` · `rebase-conflict` · `review-mutation` · `check-unrunnable` ·
`integration-red`.
Run-scoped, not a ticket disposition: `baseline-red`.

> **The invariant:** *every worker-writable reason class ⇒ `paused`; every controller-derived
> reason class ⇒ `failed`.* §8.10's two "`failed` / automation" rows name no class at all, and the
> same rule answers them: an automation fault is controller-derived by definition, so it fails.

A worker asking a question needs an answer; the controller giving up needs an investigation.
Stated as a rule rather than as a table property, so a class added later cannot be filed to the
wrong disposition by accident. Letting a worker write `repair-budget-exhausted` would let it lie
about a counter it cannot see.

### 8.9 Dispositions and tracker actions

| Disposition | Tracker action |
|---|---|
| **`published`** | `factory:awaiting-merge`, assignee retained, PR link. Closes on manual merge via `Closes #N` |
| **`paused`** | `factory:needs-human`, assignee retained, structured pause comment with reason class and the exact question |
| **`failed`** | `factory:failed`, assignee retained, structured failure comment carrying the outcome chain |
| **`released`** | claim dropped, no label, ticket returns to the frontier untouched |

`paused` and `failed` both need a human and both resume by label removal, but **the label tells
the human at a glance whether they owe an *answer* or an *investigation*** — the difference
between a two-minute reply and opening a terminal. Every disposition gets the same
machine-parseable comment block: identity tuple, outcome chain, evidence references by digest.

`released` is for operator stop and controller shutdown mid-attempt: an honest state, not a lock
nobody holds.

**No automatic requeue.** Legacy's `failAutomation` removed `ready-for-human` and *added back*
`ready-for-agent`, re-arming a ticket for the next run to die on identically — the loop still
existed, spanning runs instead of iterations, which is worse because nobody is watching. **A
human removing the label is what makes the label mean "someone has acknowledged this".**

### 8.10 The mapping table

| Phase | Outcome | Action | Budget consumed |
|---|---|---|---|
| implement | `completed` | → harvest | — |
| implement | `needs-human` | `paused` (worker reason class) | — |
| implement | `worker-failed` | repair | repair |
| implement | `invalid-result` | fresh-retry | repair |
| implement | `no-result` | fresh-retry | repair |
| implement | `timeout` | fresh-retry | repair |
| implement | `wrote-but-hung` | harvest the valid outbox, stop the agent, record the anomaly | — |
| implement | `dead-worker` | retry | automation |
| implement | `automation-failure` | retry | automation |
| implement | `cancelled` | `released` | — |
| harvest | `passed` | → verify | — |
| harvest | `predicate-failed` (dirty tree / 0 commits) | repair | repair |
| verify | `passed` | → review | — |
| verify | `failed` | repair, check output presented as fact | repair |
| verify | `unrunnable` | retry; exhausted ⇒ `failed` / `check-unrunnable` | automation |
| verify | `rebase-conflict` | fresh-retry from the new base tip | repair |
| review | reviewer attempt `completed` | take its verdict | — |
| review | both axes `approved` | → integrate | — |
| review | either axis `rejected` | repair, findings in the untrusted block | repair |
| review | `mutation-detected` | `failed` / `review-mutation`, **no retry** | — |
| review | reviewer attempt `needs-human` | `paused` (worker reason class) | — |
| review | reviewer attempt `wrote-but-hung` | take its verdict, record the anomaly | — |
| review | reviewer attempt `cancelled` | `released` | — |
| review | reviewer attempt `worker-failed` · `invalid-result` · `no-result` · `dead-worker` · `timeout` · `automation-failure` | retry | automation |
| integrate | `integrated` | `published` | — |
| integrate | `rebase-conflict` | fresh-retry from the new base tip | repair |
| integrate | `predicate-failed` | `failed` / automation | — |
| integrate | `push-failed` | retry | automation |
| integrate | `integration-red` | `failed` / `integration-red` | — |
| — | repair budget exhausted | `failed` / `repair-budget-exhausted` | — |
| — | automation budget exhausted | `failed` / `automation-budget-exhausted` | — |
| — | duplicate result, identical | return the existing result, idempotent | — |
| — | duplicate result, conflicting under the same semantic key | `failed` / automation, typed conflict | — |

**Properties worth stating rather than burying:**

- **`mutation-detected` is the only outcome with no retry at all.** A read-only role that wrote
  has broken its own contract, and retrying it buys a second violation.
- **`integration-red` disposes and consumes nothing**, because the same base conflicts the same
  way and a retry buys a second identical answer. It is §8.3's `baseline-red` one phase later —
  the required set red at a commit no worker chose — and it carries a **reason class and no
  automation fault**, so §8.6's "product-level outcomes never trip the breaker" holds by
  construction: two changes that each pass alone and do not compose is not a broken host, and
  stopping the run over it would point an operator at infrastructure that is working.
- **A `rebase-conflict` consumes a fresh-retry, not a repair**, because the prior tip is
  precisely what conflicts. A second conflict is `failed` / `rebase-conflict`, and **the
  controller never attempts automatic resolution**, which would put a model inside a controller
  phase. It appears under **two phases** because §9.5 puts a rebase in each: `verify` opens with
  one, and `integrate`'s compare-and-publish loop redoes it when the base moved again. The row is
  the same in both.
- **`wrote-but-hung` is not a failure.** The outbox is valid, so harvest it, stop the agent as
  routine shutdown, and record the anomaly.
- **The whole table is re-enterable.** Reconcile replays it from durable state after a crash
  between an external effect and its recorded resolution, which §7.7's end-to-end idempotent
  integration makes safe.
- **A stage result's semantic key is `(run, ticket, phase, attempt)`** — §2.1's stage identity
  plus the attempt it was resolved under. §8.5's repair re-enters a phase, so a key without the
  attempt slot would read every repair as the conflicting duplicate two rows above, and a working
  pipeline would fail itself.
- **The last two rows are dispositions, not crashes.** A conflicting duplicate is a *typed*
  conflict precisely so the ticket execution still reaches `failed`; letting it escape the walk
  would leave it at no disposition, which is the one state §8.9 has no word for.

---

## 9. Concurrency and resource arbitration

### 9.1 The capacity model — three dimensions, two declared

| Dimension | Bound |
|---|---|
| **Ticket execution** | the scheduler's unit, bounded by declared `maxTicketExecutions` |
| **Resource class** | the model endpoint behind the pane, bounded by a declared per-class slot pool — **this is what actually arbitrates** |
| **Worker pane** | **derived, never configured**: `maxTicketExecutions × MAX_PANES_PER_TICKET` |

**`MAX_PANES_PER_TICKET = 2` is a named code constant**, owned by §8's pipeline shape — it comes
from the review fan-out.

**The pane is deliberately not the unit of scarcity.** Panes are nearly free on this host, and
Herdr v0.8.0 imposes no pane, agent, or resource cap of any kind, so all limiting is the
factory's job. Counting panes would let N lanes launch and then queue invisibly behind one GPU
slot, having already claimed N tickets on the tracker for work that is not moving. A declared
pane knob is rejected for a second reason: `maxTicketExecutions: 2, maxWorkerPanes: 2`
deadlocks the review phase, and catching that statically would mean encoding the pipeline's
pane arithmetic into the config loader anyway.

**Resource classes are derived, not declared per profile.** For `kind: pi`, the class is the
**provider segment of the model id** (`local/thinkingcap-qwen3.6-27b` → `local`); for
`kind: claude`, the constant `claude-code`. Two profiles naming different presets on the same
endpoint then correctly share one slot pool, **because they share one GPU**.

### 9.2 The operator constraint is arithmetic, not a rule

> Local work runs on a single GPU on `rico`, one model at a time; bounded parallelism requires
> at least one active non-local provider; with none configured the run stays sequential.

**This is not a branch in the scheduler.** `local` is a resource class of size 1, so routing
that resolves entirely to it yields effective concurrency 1. Nothing to forget.

The environment confirms the size: pi's `local` provider points at
`http://192.168.129.7:11545/v1`, a llama.cpp **router** reporting `"role":"router",
"max_instances":1, "models_autoload":true`, with every preset launched `--parallel 1` — one
model held, one request slot, swap on request.

### 9.3 The ceiling is the proof gate

`concurrency.maxTicketExecutions` is **required with no default** and validated against a code
constant **`MAX_SUPPORTED_TICKET_CONCURRENCY`, which is 1 in v1**. A value of 2 is a hard load
failure naming the constant and the acceptance suite that raises it.

Shipping the knob with any value accepted would be a setting whose other value has never
executed. Omitting the field entirely would fail the destination's "without replacement" clause
in the only way that matters — its absence permits a single-threaded scheduler.

> **The ceiling is enforced in the config loader only. The scheduler is capacity-parametric and
> never learns the constant exists.**

That placement is load-bearing three ways: it is what makes the acceptance suite possible
**without an override seam** (tests instantiate the scheduler at capacity 2 because there is
nothing to override); it makes "raising the ceiling is a one-line change" **literally
checkable**, since nothing else ever read the constant; and it keeps the scheduler honest about
being parametric rather than special-cased at 1.

### 9.4 Acquisition, spans, and fencing

**Acquire before claiming.** A ticket execution acquires its **ticket slot and its implement
attempt's model-resource slot together, before the Gitea claim** (§3.3). This is also what
makes local-only-is-sequential *structurally* true rather than merely arithmetically true: a
second ticket can never be claimed while rico's one slot is held.

**Representation: discrete named rows, not a counter** — `capacity:ticket:0…N-1` and
`capacity:model:<class>:0…M-1`, each CAS-held on §4.6's lease primitive. **A slot row names its
holder, so it is probeable**; a counter has no identity to probe and cannot satisfy §5.3's rule
that an unresolved fact is settled only by re-probing.

**Spans.**

- The **ticket slot spans the whole ticket execution**, repair and fresh-retry included,
  releasing exactly once at terminal disposition. A ticket that lost its slot between attempts
  could be starved out by a newly eligible ticket while still holding its Gitea claim.
- The **model slot is per attempt**: an exited attempt holds nothing, and a lane between phases
  must not squat on the GPU.

> **Property, stated so it is never re-derived:** a lane holds at most one model slot and zero
> between phases, so **no hold-and-wait is constructible and therefore no deadlock cycle is.**

**No TTL.** Capacity slots do not auto-release on expiry — an expiring slot would free itself
while its pane is still alive and still talking to rico, double-booking a GPU that physically
has one slot. Instead they are **fenced to the controller's lease generation**: a slot stamped
with a superseded generation is not honored, and **reconcile settles it by probing the pane,
never by waiting for a clock.**

### 9.5 Serialization — the integration lease is acquired twice

Holding one lease across the agent-borne review phase would serialize every lane on a model
call — the standard way a lock destroys the throughput it was added to protect.

So: **acquire for `rebase + verify`, release across `review`, re-acquire for
`integrate + publish` under a base-commit identity precondition.** If the base moved, loop back
to re-rebase and re-verify. This is compare-and-publish, and it **consumes no budget** because
nothing failed — the base only ever moves by a human merge, since the factory pushes branches
and never the default ref.

The payoff is that §8.2's invariant stays **literally** true: the required checks always ran at
the exact commit being published, with no conditional re-check path.

> **Concurrent verification is refused for v1, and this is a real throughput bottleneck stated
> out loud rather than left to be discovered.** §11.6's check schema declares **no
> parallel-safety**, so two suites at once can collide on ports, databases, or fixtures and
> produce a failure the ticket did not cause — the exact conflation §8 exists to prevent.
> **`checks[].parallelSafe` is the recorded v2 upgrade that lifts it.** A later reader must not
> read this as an oversight and "fix" it into cross-ticket check collisions.

### 9.6 Fairness, backpressure, drain, abandon

**There is no queue object.** Fairness is §3.2's ascending issue number and nothing else. The
map rules out a private generated task graph and §10 rules out the resident work queue; an
in-memory ready-queue is that same object with a shorter lifetime.

The loop is: *while a slot is free and the live frontier is non-empty, take the lowest-numbered
claimable ticket; otherwise wait for a ticket execution to terminate.*

> **Starvation is structurally impossible rather than defended against.** The frontier is
> finite, every ticket execution reaches a terminal disposition, and §8.9's dispositions remove
> tickets from eligibility. This is why **no aging or priority mechanism exists.**

**Backpressure is simply not claiming.** The tracker holds the backlog; an unclaimed ticket is
the honest representation of unstarted work. Nothing is buffered and no intent is queued.

**Draining** = stop claiming new tickets; let every in-flight ticket execution run to its
terminal disposition, integration included. Slots are released and never refilled; the run exits
when the last lane terminates.

**Abandon** — a second `stop` or `SIGTERM` — stops issuing new effects, marks in-flight ticket
executions **`released`**, releases their slots, and **leaves worker panes alive for the next
reconcile**.

**One report, one end reason.** The end reason is a property of the controller loop and is
**never derived from the lanes**, so it stays unambiguous however differently they ended.

### 9.7 Preflight ordering and saturation observability

**Order inside preflight:** artifacts and config (cheap, local) → runtime probes including
capacity observation → baseline checks (expensive). A wrong number fails before a full test
suite is spent discovering it.

- **A declared size exceeding an observed `max_instances` is a preflight failure naming both
  values**, never a silent clamp. Cloud classes have nothing to observe and stay declared-only.
- **An unreachable required class is a preflight failure** naming the class, the endpoint, and
  the fix. Treating it as capacity 0 and continuing would produce a run that starts, claims
  nothing, and drains as though the work were done — **a green-looking run that did nothing**,
  the worst outcome available here.

**Saturation is observable**, because "the run is slow" looks identical whether lanes are
working or all of them are queued behind rico's single slot:

- Three **additive** event types on the `run:<ULID>` stream: `capacity.granted`,
  `capacity.released`, and **`capacity.waiting`, emitted once when a lane first blocks on a
  class, never per poll** — retry-storm spam is how this diagnostic normally destroys its own
  usefulness. These are ordinary journal events, **not effects** (nothing external mutates), so
  no probe is owed.
- `status` and `doctor` print the **declared ceiling, the effective concurrency, and per class:
  size, held, waiting.** A config saying 4 while routing resolves entirely to `local` is a
  comfortable lie, and effective concurrency is what makes it visible.
- **No monitor amendment is needed** — the monitor is parallel-ready by construction and the
  `(run, ticket)` node already carries multiple live ticket executions.

---

## 10. Controller lifecycle and the operator surface

### 10.1 Process shape

> **The controller is a run-scoped child process; the operator surface is a deterministic
> binary; the pi session is a launcher and a monitor host, never the executor.**

- **One invocation, one run.** `factory start <ticket-or-parent>` acquires the controller
  lease, reconciles, applies expiry (§12.6), preflights, executes to drain, atomically emits
  `ended` with its reason while releasing the lease, prints the classified per-member report,
  and exits. Lease loss is the exception: stale authority emits `controller.lease-lost` and
  exits 6 without closing the run another controller may already be adopting. **No idle polling,
  no residency.** The lease exists to exclude a *second* controller, not to mark a service up.
- **A separate OS process, not an in-session async task.** pi has no host task scheduler, and
  `/new`, `/resume`, `/fork`, and quit all fire `session_shutdown` — the legacy
  `Map<cwd, Promise>` pattern loses a multi-hour run to a routine session switch, and nobody
  connects the two.
- **Default launch is detached into a Herdr pane**; `--foreground` runs it in the invoking
  terminal. The dominant case is SSH in, start, walk away for hours; foreground-by-default dies
  with the connection.
- **The controller's pane survives the run**, leaving the classified drain report on screen.
  Stale controller panes are a **cleanup target**, never a shutdown side effect.
- `session_shutdown` in the launching tab therefore tears down **only the monitor**. The run is
  untouched.

### 10.2 Entry point and verb set

**`factory start` in the shell is the primary entry point.** `/factory start` survives as a
thin wrapper over identical code that additionally fires the monitor trigger, so using it costs
nothing and gains a monitor. A shell-launched run hosts no monitor; the operator opens one from
any tab.

**Every operator verb lives in one deterministic binary:**

```
factory start | status | doctor | reconcile | stop | cleanup-plan | cleanup-execute | migrate
```

Nothing is reachable *only* from a pi session, because the moment `doctor` matters most is when
the controller is dead and possibly pi with it — a diagnostic that requires booting the thing it
diagnoses is the Babysitter failure again. pi cannot register CLI subcommands, so this is a
`bin` entry, not a pi surface.

**`migrate` is a sibling of `doctor`, not a flag on it.** §10.5's invariant is that doctor
appends nothing to the journal in either mode, while still executing a baseline in a throwaway
worktree. Migration writes the operator's own `.pi/factory.json` — a durable mutation of a
different category. Keeping it a separate verb means doctor's read-only reputation never needs
an asterisk.

**Human output by default, `--json` for machines** — both rendered from one structured value so
they cannot drift. JSON-by-default would tax every real use to serve the rarer one.

Moving `start` to the shell drops pi's `isProjectTrusted()` gate. **Running the binary inside a
repo is itself the trust act**; no replacement gate is introduced.

### 10.3 Run lifecycle, end reasons, and exit codes

**Lifecycle:** `preflight` · `running` · `draining` · `ended`.

**Run outcomes: six run end reasons plus one controller exit outcome.** Every ended run
carries a mandatory `end_reason` drawn from the six; `lease-lost` is the seventh row of the
published table because it is a real exit code a caller can receive, but it is the controller
*process's* own exit outcome and never a run's recorded `end_reason` — the run it leaves
behind is open. One table publishes all seven rows so a script reading it finds every code:

| Outcome | Exit code | Meaning |
|---|---|---|
| `drained` | **0** | the scope drained; nothing left claimable |
| `baseline-red` | **2** | the required preflight set was not green; names the red check, including a required baseline check when that is the one that failed |
| `stopped-by-operator` | **3** | a `stop` request was honoured at a ticket boundary; in-flight lanes finished |
| `abandoned` | **4** | a second `stop` or `SIGTERM`; in-flight lanes `released`, panes left alive |
| `circuit-breaker` | **5** | N consecutive automation failures in terminal-commit order |
| `lease-lost` | **6** | **controller exit outcome, not a run end reason**: the controller process lost its lease and exited without reacquiring; the stale process leaves the run open rather than self-authoring an unfenced `run.ended`, so this row is **only** an exit code and never a run's recorded `end_reason` |
| `controller-lost` | **— (none)** | **asserted only by a different controller or the monitor**, never self-asserted, so it can have no exit code |

Exit code **1 is reserved for usage and config-load failure** — those happen *before* a run
exists and therefore have no end reason.

> **This table and the `--json` `schema_version` are published contract, not configuration.**
> Callers' error handling depends on them, so a config knob would let a config file silently
> break every downstream script. **They are documented here, beside the vocabulary they map, so
> the two cannot diverge** — that co-location is the whole point.
>
> `factory start && next-thing` must never read a circuit-breaker exit as success.

`draining` covers operator stop-after-current-ticket and the circuit breaker **identically** —
the behaviour is the same and the reason carries the difference.

**Preflight is an observable phase with per-check and per-probe results**, not a pass/fail
gate. It runs **after the run exists**, so `baseline-red` can be a run end reason naming a
specific red check. Despite the historical name, `baseline-red` covers any **required
preflight** check that is red — package integrity, required runtime availability, or the
required baseline — because the closed end-reason vocabulary has one pre-execution failure
outcome. These are **run-scoped stages that hang off no tracker ticket**.

**Herdr availability is a named preflight check** that probes and **fails closed with the exact
command to start it** — the factory checks the operator's multiplexer, it does not manage it.

### 10.4 Recovery and re-entry

- **A restart re-enters an orphaned run, keeping its `run_id`.** Startup reconcile finds a run
  not `ended` whose lease is free or expired and adopts it. §5.5's pane-token worker adoption is
  pointless if start always opens a new run, and one logical delivery fragmented across run ids
  breaks the monitor's overlay.
- **`--new-run` forces a fresh one** and ends the abandoned run with `controller-lost` — an
  observation by a *different* controller, so the never-self-asserted rule holds.
- **`factory start` against a live lease-holder resolves against the live selector; it does not
  queue.** In scope → print "already in scope of run *R*, it will be claimed when the frontier
  reaches it" and exit `0`. Out of scope → refuse, naming the live run. If membership requires
  a tracker read the installed slice cannot yet perform — a direct ticket against a
  parent-scoped selector — refuse as `scope-unresolvable`, naming the run and the missing
  tracker reader; never guess either branch.

### 10.5 Stopping, doctor, reconcile, cleanup

**`stop` writes a durable stop-request record** carrying §4.5's actor slot, polled by the
controller at ticket boundaries. It works from any terminal without finding a pid, survives
arrival mid-phase, needs no signal-handler reentrancy inside an async scheduler, and **makes
`draining` visible to the monitor the moment it is *requested*** rather than when the phase
ends.

**A second `stop`, `SIGTERM`, or a second `Ctrl-C` escalates to abandon.** The first `stop`
states in its output that a second one escalates. **Worker panes are left running** — killing
panes destroys the evidence a confused operator needs, and tearing down worktrees belongs to
cleanup's reviewed plan.

**`doctor`:**

- **By default reports the last baseline result**, with its `as-of` and the base commit it ran
  at, stating plainly that it was **not** re-run.
- **`--baseline` executes** the checks, inside §7.1's factory-private clone in a **throwaway
  worktree** — never the operator's checkout.
- Reports per-ticket repair / fresh-retry / automation counters, since "why did this stop" is
  usually a budget question.
- Runs §11.7's package handshake in **report mode** (probing is a read), and reports
  `.pi/factory-monitor.json` health **advisory-only** — a missing or broken monitor never fails
  a factory run.
- Reports legacy run artifacts (`.worktrees/factory-*`, the legacy state dir) without deleting
  anything.

> **Under both modes, doctor appends nothing to the journal and writes no projection.** That is
> the precise, checkable meaning of "doctor does not mutate what it inspects" — running a
> declared check in a disposable worktree is not that mutation, but a journal append would be.

**`reconcile` against a live lease-holder refuses**, exits non-zero, and names the holding run
and pane: it cannot take the lease, and reconciling from outside one would race the thing it is
describing. It points at `status` and `doctor`, which are lock-free reads and work fine against
a live run.

**`cleanup-plan` is read-only and always permitted; `cleanup-execute` requires the controller
lease**, so it can never race a live controller. **Staleness is decided by digest equality, not
a clock**: execute re-derives the plan from current state and refuses unless the digest matches
the one it was handed. A TTL either expires a still-correct plan or blesses a stale one.

### 10.6 Monitor coupling

`factory start` publishes a **typed `pi.events` request** that `factory-monitor` subscribes to
— **never an import, never a spawn, never fatal**. Absent the extension nothing listens and the
run proceeds unaffected. Start output prints the monitor URL when a listener answers, and says
nothing when none does.

`status` and `doctor` authenticate over **loopback with the ephemeral token** from a `0600`
discovery file, never the password path.

---

## 11. Configuration and the package handshake

**Configuration is two independent, fail-closed files plus one published binary contract, and
nothing about runtime policy is ever inferred.**

### 11.1 Files and discovery

- **`.pi/factory.json`** (`schemaVersion: 2`) — the factory's single authoritative source. **No
  user-level defaults file, no env overrides for policy, no merge layering**; the effective
  policy always exists on disk exactly once. The only other input is §6.8's declared per-run
  overrides, recorded in the run manifest.
- **`.pi/factory-monitor.json`** — owned by `extensions/factory-monitor/`, **standalone**, so
  the monitor is installable and startable without the factory extension present. **The
  dependency is one-directional**: a missing or broken monitor never fails a factory run.
- **Discovery** walks up from the invocation directory **to the git repo root** and reads
  exactly `<root>/.pi/factory.json`, refusing to start if there is no repo root or no file.
  **There is no `--config` override**: config is repo-bound (`tracker.repo`, `git.baseBranch`),
  so an override's only distinctive power is pointing repo A's factory at repo B's policy.
  Exact-cwd was rejected because it would make the binary behave differently from a
  subdirectory for no gain.
- **Fail-closed cross-check: the resolved repo's remote URL must match `tracker.repo` or the run
  refuses to start.**

Starting the new schema at **2** (legacy used `version: 1`) means no `1` ever denotes two
different schemas, even if the key is renamed or read loosely.

### 11.2 Strictness — the "no silent guessing" core

**Unrecognised `schemaVersion`, unknown key, missing required key, parse error, and any residual
`TODO` sentinel are all hard load failures that refuse to start the run.** No warn-and-continue.

`extensions/config-loader.ts`'s fallback-on-parse-error semantics are explicitly **not** used
for factory config — that function's silent defaulting is the failure mode this section exists
to end.

### 11.3 Block inventory

Surviving blocks: `tracker` (minus `labels`), `git`, `profiles`, `routing`, `checks`,
`budgets`, `concurrency`, `retention`, and an optional `package.expect`.

**One block is added rather than surviving: an optional `worker`**, holding §6.8's declared
per-run overrides — `denies`, `contextFile`, `piExtensions`. §6.8 requires overrides to be
"declared at run start in config" and recorded in the run manifest, and there was nowhere on
disk to declare them; the manifest's evidence would otherwise record a decision no operator
could make. It is named in the singular deliberately: legacy `version: 1` files used `workers`
for profiles and routing, and §11.8's migration must not confuse the two.

- **The label vocabulary is code constants, not config** (§3.2).
- **`completion` is deleted entirely.** All four knobs (`closeAfterIntegration`, `finalMerge`,
  `createPullRequest`, `deploy`) now have exactly one legal value, three of them protected by
  §6.8's un-crossable hard floor. **A setting that cannot take its other value is a lie about
  what the system will do.**
- **`herdr.maxWorkers` is deleted** (superseded by §9). **`retry` → `budgets`.**

### 11.4 Profiles and permissions

Profiles carry `kind`, `model`, and optionally `effort` / `thinking` / `startupTimeoutMs`, where
omission means "don't pass the flag" — safe because non-passing is a **recordable observation**
in the handshake, not an inference.

**`permissionMode` is removed from author control.** Permissions derive from the **role** a
profile is bound to at dispatch. A profile setting `dontAsk` and later being used as a reviewer
would silently defeat the read-only guarantee that §6.8's before/after mutation attestation
rests on. Altering permissions requires a declared, manifest-recorded per-run override that can
never cross the hard floor.

### 11.5 Routing

Roles are **`implement`, `freshRetry`, `review[2]`** — all three required, **no implicit
fallback**.

- **Repair is not routable.** It is pinned to the originating attempt's profile: repair
  continues the same working line from the prior tip, and re-routing it would discard the
  context that makes repair cheaper than fresh-retry while blurring the distinction the budget
  split depends on.
- **Fresh-retry is the one tier-dependent routing point**, and declaring it is mandatory — an
  implicit `freshRetry = implement` is precisely the silent runtime-policy guess this section
  names.
- **`review` is a two-element list.** The two attempts may name the same profile, but **it must
  be written twice** — no shorthand expands one entry into two, so duplication is always a
  visible choice. Independence comes from the attempts being separate and read-only, not from
  distinct weights. `finalReview` is gone; §8.1's pipeline has no such phase.
- Rules stay `labelsAny × role → profile`, with **conflicts failing closed at both levels**:
  rules whose `labelsAny` sets intersect for the same role are a **config load error**
  (statically checkable without any ticket), and a ticket matching more than one rule for a role
  is a **ticket-scoped automation failure surfaced at claim time before any work**. Never
  legacy's positional first-match.
- **`_postSubscription` becomes a first-class named routing set** (`routing.sets.*`), selectable
  per run. Dormant config the loader ignores is exactly the drift this section ends.

**Opus/Fable on pi is a load-time validation error naming the offending profile, never
coercion** — then re-asserted at launch against the *observed* runtime. A config that validates
still proves nothing about what executes.

### 11.6 Checks, budgets, concurrency, retention

All live **inline** in `.pi/factory.json` — one file, one atomic fail-closed load.

**Every check requires all five fields:** `name`, `command`, `timeout`, `required|advisory`, and
**`expectedFailureExitCodes` with no default**. That last field is the sole mechanism separating
"the worker's code failed this check" from "this check is broken", and the correct set genuinely
varies — pytest's 1/2/5, ruff, tsc, and a shell script do not agree. **A default would silently
misclassify infrastructure breakage as worker blame on exactly the checks nobody thought
about.**

**`AGENTS.md` is never parsed at runtime and there is no automated agreement check** — that
would require the parser §8.2 ruled out. Migration generates the initial `checks` block from the
"Mandatory commands" matrix **once, for human review**; thereafter the two are kept in agreement
by hand.

```json
"concurrency": {
  "maxTicketExecutions": 1,
  "resources": { "local": 1, "claude-code": 2 }
}
```

**Both concurrency keys are required with no default.** Loader validation:

- `1 ≤ maxTicketExecutions ≤ MAX_SUPPORTED_TICKET_CONCURRENCY`; every size `≥ 1`.
- A class reachable from the **active** routing **must** have an entry — missing is a load
  error, never an assumed 1.
- A class reachable from any **declared named set** **may** have one, so sizing `local` today
  does not break the loader when the set is switched tomorrow.
- A class reachable from **no** set at all is a load error: dead config that lies about what
  will run.

**Defaults exist only where an upstream decision already fixed the value:** `budgets.repair`=1,
`budgets.freshRetry`=1, `budgets.automation`=1 (ceiling 2+2), `retention.fullDetailRuns`=20,
`retention.fullDetailDays`=30 (floor of 1 each), monitor `bind`=`127.0.0.1`, monitor `tls`
absent = off.

**Required with no default:** everything in `tracker` and `git`; every profile's `kind` and
`model`; all three routing roles; every check's five fields; both `concurrency` keys; monitor
`username`; monitor `port` whenever the bind is non-loopback.

**Monitor config shape:**

```
{ schemaVersion, bind, port, credential: { username, scrypt: { salt, hash, N, r, p } }, tls: { cert, key } }
```

Whole file **`0600`**; **the monitor refuses to start if the mode is group- or world-readable.**
Inline credential material rather than a pointer-to-secret-file: a pointer doubles the number of
paths whose mode can be wrong, and the mode check is the thing actually protecting you. **scrypt
cost parameters are stored beside the hash** but chosen only by the generator — verifying a hash
requires the exact params that produced it, so hardcoding them makes any future cost bump a
silent verification break. **A non-loopback bind with no configured credential refuses to
start.** The hash is never logged.

### 11.7 Package pinning and the production executable handshake

Per run, for **each of the four participating artifacts** — the `factory` **binary**, the
factory extension, the monitor extension (when present), and the skills root — record and
validate:

- canonical executable path (for the binary: the resolved `PATH` entry **and** its realpath),
  resolved package root, package name plus declared version;
- a **deterministic tree digest** — sorted relative paths plus content hashes over the package's
  own files, excluding `node_modules` and VCS dirs — **authoritative uniformly for every install
  shape**, with git commit and a dirty-worktree flag recorded as **metadata only**.
  Special-casing checkouts would make dev runs incomparable to installed runs, and dirty
  checkouts are the common case;
- **live-probed** runtime/harness version, effective production flags, adapter/bridge identity,
  resolved model id, and skill-source root — **derived from the pinned package, never
  configured**.

**Mismatch, an unprobeable runtime, or an executable resolving outside its declared package root
is an automation failure before first claim** — never an inferred compatibility pass.

> **The anti-shadowing guard is a mandatory self-consistency check:** the binary, the factory
> extension, the monitor extension (when present), and the skills root must **all resolve to the
> same package root**, and a split across roots is a hard automation failure before first claim.

This catches the audited split-brain — package 6.0.3 declaring SDK 6.0.3 while the executable on
`PATH` resolved SDK 0.0.187 through a separate global install — **without anyone maintaining a
hash by hand**. Supporting it: **the binary ships from the root package's `bin` field — one
package, one version; `bin` and both extensions are never separately installable.**

Config may carry an optional `package.expect` (`name`, `version` exact or range) as the declared
expectation, while **the tree digest stays purely observational** — recorded, compared across
attempts within a run, never hand-declared, because a digest in config would be unmaintainable
in development.

**Model identity is pinned twice:** the declared config string and the observed resolved id.
They are *expected* to differ (`opus` → `claude-opus-5`); **the observed id is what is persisted
per attempt and cited in evidence.** The observed id **changing between attempts within one run
is an automation failure** — the same split-brain in slow motion.

**Persistence.** Preflight writes **one immutable handshake artifact per run**, its digest
recorded in a journal event and in the run manifest; each attempt references the digest rather
than re-embedding the payload. §6.2's per-attempt recheck appends a short event citing the same
digest — **a recheck producing a different digest is a failure, not a new pin.**

### 11.8 Command name and migration

- **`/factory` keeps its name** — that is the entire legacy compatibility promise. The verb set
  is §10.2's; legacy `start` / `status` semantics are not preserved.
- **v1 configs are hard-rejected by `schemaVersion`**, with the error pointing at
  `factory migrate`. No in-place silent upgrade.
- **Migration is never silent.** Every legacy key is mapped, reported-and-dropped, or left as a
  `TODO` hole, and the full disposition list is printed:

| Disposition | Keys |
|---|---|
| **Mapped** | `tracker.*` minus labels · `git.*` · profiles minus `permissionMode` · `retry.repairAttempts`→`budgets.repair` · `retry.freshAgentRetries`→`budgets.freshRetry` |
| **Reported and dropped** | `tracker.labels` · `herdr.maxWorkers` · `permissionMode` · `routing.defaults.finalReview` · `completion` |
| **`TODO` holes** (the loader hard-fails until a human resolves them) | `budgets.automation` · `checks` · `routing.rules` · `routing.sets.post-subscription` · `concurrency` |

The legacy rules must be re-authored to satisfy the overlap-free requirement, and **a machine
cannot pick which ticket labels were meant to survive, nor pick concurrency sizes.**

- **Legacy run artifacts are neither imported nor auto-deleted.** Doctor reports them; removal
  goes through §10.5's `cleanup-plan` / `cleanup-execute` as an explicit opt-in; **the new
  factory refuses to reuse any of them.** `removedExtensions` is dropped from the root
  `package.json` as dead metadata.

---

## 12. Artifacts, retention, and cleanup

> **Two mechanisms, one ledger, one set of pins.** Expiry is horizon-driven, fully derivable
> from durable state, and safe unattended — the controller applies it. Cleanup touches things a
> human may be standing in (a worktree they `cd`'d into, a pane they are reading) and is
> therefore always plan-then-execute and operator-invoked. **`cleanup-execute` never expires a
> journal stream; expiry never removes a worktree.** What binds them is the artifact ledger they
> share and — the load-bearing half — **the same pins**.

### 12.1 The artifact store

A content-addressed store plus an `artifact` ledger table, both under §4.1's per-repo state
root: blobs at `<state_root>/artifacts/<algo>/<aa>/<digest>`, ledger row carrying digest, media
type, byte count, producing run/ticket/attempt, created-at, and retention class.

> **Nothing references an artifact by path — only by digest, resolved through the ledger.**

That makes path containment a **non-issue by construction**: the Babysitter audit's `../` escape
is not a thing that can be *expressed*, rather than a thing that is checked for. It also makes
byte accounting per retention class free.

**Contents:** §8.7's per-attempt attestation, §11.7's per-run handshake artifact, the run
manifest, harvested check output, and review verdicts. That is the complete set — §9 introduced
none, and capacity state lives in lease rows, which are canonical current-state and outside
retention entirely.

### 12.2 Retention classes

| Stream / object | Class |
|---|---|
| `controller` stream | **indefinite** — the factory's own audit trail, low-volume precisely because heartbeats are split out of it |
| `controller.heartbeat` stream | front-truncated to **the tier-1 boundary**, recording `stream.truncated {stream, up_to_seq, up_to_hash}` |
| `run:<ULID>` stream | tier 1; **deleted whole** at the horizon |
| artifacts | inherit their run's tier; blob deleted, **ledger row kept as a dated tombstone** |
| run digest, transcript pointers, ticket → executions index | **permanent** |
| effect rows | expire with their run — but an **unresolved effect pins the run** |
| lease rows | outside retention (current state, not history) |

Heartbeats truncate to wherever tier 1 currently starts rather than to a horizon of their own:
**one knob instead of two**, and "was the controller alive at time T" stays answerable for
exactly the runs whose detail still exists — never longer, never shorter.

**`capacity.*` gets no class of its own.** They are ordinary run-stream events that expire with
the run, and their aggregate does **not** enter the tier-2 digest — that digest's field list is
locked by the monitor spec, and adding to it would be a monitor-spec amendment, not a retention
decision.

**Expiry records land on the `controller` stream** — deleting a run's stream cannot be recorded
inside it. `run.expired {run_id, bytes_reclaimed, artifact_count, at}`.

### 12.3 Two tiers

- **Tier 1 — full detail:** every journal event, per-attempt stage detail, attestations,
  transcript pointers. Horizon = the more generous of **last 20 runs** or **30 days**.
- **Tier 2 — run digest, retained indefinitely:** run identity, start/end, lifecycle plus end
  reason, per-ticket final disposition, outcome-chain *shape*, PR and commit links,
  attention-at-end, **transcript pointers**, and the **ticket → executions reverse index**.

**The digest is maintained continuously as a §4.4 projection, committed in the same transaction
as every event that changes it — never built at expiry time.** Building it at expiry would make
a bug in the expiry path irrecoverably lose history, and it would mean the one operation that
deletes things is also the one that first writes the thing being kept. Under continuous
maintenance, **expiry is purely subtractive**: a run that *crashes* rather than ends already has
a complete digest up to the crash.

### 12.4 Pins — four, and they govern cleanup too

A run never leaves tier 1 while it has:

1. **an open PR**, or
2. **a member ticket carrying `factory:failed` or `factory:needs-human`**, or
3. *(same class)* — see 2, and
4. **an unresolved effect.**

The fourth is a **pin rather than a table-level exception**, deliberately. An unresolved effect
is by definition what reconcile re-probes, so expiring its run's stream destroys the context
needed to interpret the probe while leaving the obligation intact. A pin also gives it an
**alarm**: reconcile settles effects by probing at every startup, so **a run pinned this way for
weeks means an effect nothing can settle — which `doctor` should be shouting about.** A silent
table-level exception hides exactly that.

> **The unification: cleanup obeys the same pins.** A failed attempt's worktree and unpushed
> branch are the only copy of that work, so they must survive exactly as long as the evidence
> explaining them does. "The run is still in full detail" and "its forensic artifacts still
> exist" can never disagree, and an operator investigating a failure never finds half the
> evidence swept.

### 12.5 The dangling digest, answered as a tombstone

Digests are written into places that outlive the factory's own state: §7.5's PR body block,
tracker comments, the tier-2 digest.

**Expiry deletes the blob and sets `expired_at` on the ledger row, keeping digest, byte count,
class, and producer** — a few dozen bytes, permanently. A digest from a two-year-old PR body
resolves to `unavailable(retention-expired)` **with a date and a byte count**, never to "unknown
digest". **Expired and never-existed must never look alike**, or a stale deep link is
indistinguishable from a mis-click.

### 12.6 When expiry runs

**Once per controller invocation, after reconcile and before preflight, under the controller
lease** — the established "state is authoritative and nothing is in flight" window. Plus an
explicit path folded into `cleanup-execute`, which already holds the lease, so an operator with
no run to start can still reclaim.

**Never on a timer, never mid-run:** expiry mid-run could delete a stream the current run's
reconcile just read.

### 12.7 Resource lifetimes

**Outcome-dependent, and the controller never closes a pane.**

- **Integrated success** — worktree deleted **eagerly** (the branch is pushed; the worktree holds
  nothing unique); local branch immediately cleanup-eligible. Reclaiming a *local* ref inside a
  disposable private clone is not "touching a published branch".
- **Failed / paused / needs-human** — worktree and unpushed branch **retained and pinned**. They
  are the forensic artifact and the only copy.
- **Panes** — **never closed by the controller, worker or its own** (§13.B). Pane reclamation is
  exclusively a cleanup-plan entry.
- **`doctor --baseline`'s throwaway worktree** — deleted eagerly on success, **retained on
  failure**. A failing baseline is precisely when an operator wants to `cd` in.

### 12.8 Cleanup

**Whitelist — six target kinds:** attempt worktrees under the factory-private clone; local
`factory/t*/a*` branches; worker Herdr panes; the controller's own pane from a finished run;
`doctor --baseline` throwaway worktrees; and orphaned artifact blobs.

**The factory-private bare clone itself is not a default target** — a separate explicit
invocation, because re-cloning is expensive and its deletion is never routine.

**Never touched under any circumstance:** live attempts, published branches of open PRs,
anything outside `factory/` and `refs/factory/*`, or the operator's own repos.

**The untracked-work guard.** A whitelisted worktree containing uncommitted or untracked files
**never enters the plan**; it renders as a skip with its reason — `retained: <path> — N
untracked, M modified files` — so the operator sees it rather than wondering why bytes did not
drop. **There is no `--force`:** a force flag on a guard whose entire purpose is "a human may
have work here" is a guard with an off switch, and this is the class of mistake that is
unrecoverable.

**The live-pane guard.** Plan entries derive from the attempt being **terminal**, never from pane
liveness — the hard-stop path deliberately orphans worker panes, so "pane exists" must not read
as "work in progress". At execute time each pane is **re-probed for its `FACTORY_ATTEMPT` token**
and refused if that token now belongs to a non-terminal attempt. **A pane carrying no factory
token is never a target under any circumstance** — the factory does not own panes it did not
create.

**Orphaned blobs need no TTL.** `cleanup-execute` holds the controller lease, so no controller is
writing; under that lease a blob with no committed ledger row is unambiguously a crash leftover.
A grace period here would be the rejected stale-plan clock all over again.

**Scope.** The whole eligible set by default, narrowable with `--run <id>` and
`--kind <target-kind>`. The digest re-derivation covers whatever the plan actually contains, so a
narrowed plan is a first-class plan rather than a subset of a bigger one. **The default being
*everything* matters:** an operator reclaiming space should see the full picture including the
skips.

**Crash mid-execute needs no resume logic.** Deleting a worktree is a mutation outside the
database and therefore an effect (§4.5), keyed `<run>/<ticket>/cleanup/<target-kind>/<operand>`
with a trivial probe. A crash leaves requested-but-unresolved effects; the next reconcile settles
them by re-probing. Cleanup's own actions land on the `controller` stream, auditable after the
fact.

### 12.9 Transcripts — the factory never deletes one

**The call is never.** The factory has no transcript retention policy at all: it persists a
*pointer* (path or session id, plus worker kind and format, captured at attempt start) and
nothing else. `~/.pi/agent/sessions/…` and `~/.claude/projects/…` belong to the harnesses;
deleting from them is reaching into another component's storage, and the pointer costs a few
dozen bytes in the permanently-retained digest.

So **`transcript-missing` always means someone else removed it** — the harness's own housekeeping
or the operator. That makes "the monitor is never the reason a transcript becomes unreachable"
true of the whole system rather than of one component.

### 12.10 Byte accounting: account, report, never trigger

`status` and `doctor` report bytes per retention class and per run; `cleanup-plan` reports
reclaimable bytes. **But there is no size-triggered expiry.** A byte ceiling fires
non-deterministically, at a moment nobody chose, and its first victims are the largest runs —
**disproportionately the *failed* ones an operator is still reading.** The horizon and the pins
are the only expiry triggers.

**Configuration is exactly two numbers.** `retention.fullDetailRuns` (20) and
`retention.fullDetailDays` (30), floor of 1 each at load. **Constants, deliberately unreachable
from config:** the four pins (*a pin you can switch off is not a pin*), the permanence of the
tier-2 digest, the heartbeat horizon, and the artifact store root.

### 12.11 What remains, by outcome

| | integrated success | failed / needs-human | after the tier-1 horizon |
|---|---|---|---|
| worktree | deleted eagerly | retained, pinned | cleanup-eligible; untracked-work guard applies |
| local branch | cleanup-eligible immediately | retained, pinned | cleanup-eligible |
| remote branch + PR | permanent, never touched again | never pushed | untouched — the pin holds the run while the PR is open |
| Herdr pane | retained (never closed) | retained | cleanup-eligible |
| run stream + attempt detail | tier 1 | tier 1, pinned | deleted whole |
| artifacts | tier 1 | tier 1, pinned | blob deleted, **dated tombstone row kept** |
| run digest + transcript pointers + ticket → executions index | permanent | permanent | permanent |
| transcript file itself | never touched by the factory, ever | never touched | never touched |

---

## 13. Reconciled contradictions

Three places where two closed decision tickets disagreed. Each is resolved here **once**, so no
implementer re-derives it and no reader finds the losing side and follows it.

### 13.A The end-reason enum — union of #82 and #85

#82 and the locked monitor §3.2 carried five members; #85 independently enumerated six with two
different spellings and two members the other lacked. **The union is adopted** (§10.3, seven
members), on these grounds:

- **`stopped` and `stopped-by-operator` are the same thing.** `stopped-by-operator` wins: it
  names the actor, which is the operator's actual question.
- **`abandoned` is genuinely distinct from `stopped-by-operator`.** #82 folded the second stop
  into the first, but the two leave the world in different states — one lets lanes reach terminal
  dispositions, the other marks them `released` and orphans panes. Reconcile's next run needs to
  know which happened.
- **`lease-lost` and `controller-lost` are both required and are not synonyms.** `lease-lost` is
  a controller process's own exit; `controller-lost` is an observation made *about* a
  controller by a different one or by the monitor. The losing process emits
  `controller.lease-lost` but cannot safely append `run.ended`: after expiry, a successor may
  already own and be adopting the same run. Normal completion couples lease release and the
  terminal event atomically, so stale authority can never close an adopted run. #82's own
  exit-code table already listed `lease-lost`, because "never self-asserted" means
  `controller-lost` can never be an exit code — that tension is what produced the divergence.

**This is additive to the monitor's locked enum**, so the monitor specification is amended in
place under its §12 protocol rather than reopened.

**Refined by #97's corrections:** the published table keeps its seven rows, but the union is no
longer called an end-reason enum — that name made "mandatory, drawn from the enum" and "never a
recorded `end_reason`" true of the same collection. §10.3 now distinguishes the **six run end
reasons** from the **one controller exit outcome**, `lease-lost`, and the vocabulary carries
them as two values (`RUN_TERMINAL_REASONS` and `CONTROLLER_EXIT_LEASE_LOST`) whose disjointness
is checked at import beside the table.

### 13.B Pane closure — #86 wins outright

#78 specified `cancel(attempt)` as a Herdr **agent stop escalating to pane kill**, and described
panes as disposable. #86 later specified that **the controller never closes a pane, worker or its
own.**

**Resolution: the controller stops *agents*; it never closes *panes*.** #78's escalation to pane
kill is **superseded**. Herdr's `agent stop` and pane closure are distinct operations, and only
the first is the controller's.

**The cost is accepted explicitly:** an agent that ignores `agent stop` leaves a wedged pane that
survives the run. That pane is recorded as an anomaly and reclaimed later through
`cleanup-plan`'s live-pane guard (§12.8) — never killed as a side effect. #86's reasoning for the
controller's own pane (closing it destroys the classified drain report an operator looks at
first) applies identically to workers: **a wedged pane is evidence.**

### 13.C The effect-key grammar — widened, not contradicted

#79 fixed the key as `<run>/<ticket>/<phase>/<attempt>/<operation>[/<operand>]` with `phase` a
closed enum; #86 then keyed cleanup effects with `cleanup` in the phase position, which is not
one of the five pipeline phases — and several cleanup and expiry targets have no ticket and
sometimes no run.

**Resolution (§2.2, §4.5):** the closed enum is widened to
`preflight · implement · harvest · verify · review · integrate · cleanup · expiry`, and the
`run`, `ticket`, and `attempt` segments are individually nullable, written as the reserved
literal `-`. The key stays well-formed and `UNIQUE`-constrainable for a repo-scoped effect.
**No decision is reversed** — the enum stays closed and the grammar stays fixed-arity.

### 13.D O6 — carried, though #79's resolution never restated it

The monitor's **O6** (an actor identity slot on effect records) was handed to #79 and accepted,
but #79's resolution text never restates it; only #82's stop-request record refers to "your actor
slot". The obligation was **accepted, not contradicted**, so §4.5 states it as a required effect
field and it needs no reopen.

---

## 14. Invariants

Numbered, testable, and adversarially exercised by §15's cases. Each is a **never**.

1. **The journal never establishes an external fact.** A `requested` record with no `resolved`
   record is settled only by re-probing, never by reasoning.
2. **`journal-intent` is never a member of a reconcile evidence basis.**
3. **No effect kind is registrable without a probe** — enforced at construction.
4. **An effect key never contains a hash of its payload.** The digest sits beside the key.
5. **An effect resolving under a superseded fencing generation is never honored.**
6. **A lost controller lease is never reacquired and never self-closes the run.** Stop issuing
   effects, emit, exit 6; normal `run.ended` and lease release are one token-checked transaction,
   and every record moving a run's lifecycle is written under the same compare. No `run.ended`
   is ever **written** carrying `lease-lost` — that reason names a process's exit, not a run's
   ending. Payload-v1 records that carried it are history, replayed and rendered as written
   (§4.3); the loss a stale controller concedes before `run.started` commits names no run.
7. **No mid-stream journal deletion, ever** — whole-stream deletion or front-truncation only.
8. **A projection is never committed in a different transaction from its event.**
9. **A projection schema change never migrates silently** — it bumps the version, and a
   mismatched reader refuses to render.
10. **Journal integrity failure is never repaired** — no truncate, no renumber, no rewrite.
11. **The factory never pushes non-integrated work**, never force-pushes, and never writes the
    default branch or any ref outside `factory/` and `refs/factory/*`.
12. **A published branch is never touched again.**
13. **Verification never attests a commit other than the one being published.**
14. **A run never starts with a red required baseline.**
15. **The reviewer never sees mechanically-failing code.**
16. **Worker-reported evidence is never proof** — the controller's rerun and attestation are the
    only attestation boundary.
17. **A worker is never handed a tracker credential**, and the deny floor is never subtractable
    by an override.
18. **Every worker-writable reason class ⇒ `paused`; every controller-derived one ⇒ `failed`.**
19. **`mutation-detected` is never retried.**
20. **No automatic requeue** — a label is cleared by a human or not at all.
21. **A ticket is never claimed before its ticket slot and implement model slot are held.**
22. **A capacity slot never auto-releases on a timer** — it is fenced and settled by probe.
23. **Two attempts never share a worktree**, and two lanes never run mechanical checks
    concurrently.
24. **`doctor` never appends to the journal and never writes a projection**, in either mode.
25. **`cleanup-execute` never runs without the controller lease**, and never on a plan whose
    re-derived digest differs.
26. **A worktree with uncommitted or untracked files never enters a cleanup plan**, and there is
    no `--force`.
27. **A pane carrying no `FACTORY_ATTEMPT` token is never a cleanup target**, and **the
    controller never closes a pane.**
28. **An artifact is never referenced by path** — only by digest through the ledger.
29. **The factory never deletes a transcript.**
30. **Expiry is never size-triggered**, and never runs mid-run or on a timer.
31. **An expired artifact never resolves to "unknown digest"** — it resolves to a dated
    tombstone.
32. **A pin is never reachable from configuration.**
33. **Config never warns and continues** — unknown key, missing required key, bad version, parse
    error, and residual `TODO` are load failures.
34. **A runtime policy is never inferred** — not from `pyproject.toml`, not from `AGENTS.md`
    prose, not from an implicit routing fallback.
35. **The binary, both extensions, and the skills root never resolve to different package
    roots.**
36. **`controller-lost` is never self-asserted**, and therefore never has an exit code.
37. **Ordering is by sequence, never by clock.**

---

## 15. Acceptance obligations

The specification carries the obligation; **the tests are implementation work for `to-tickets`**,
not part of this map.

**Completion and worker protocol.** wrote-but-hung · exited-without-result · invalid result ·
late result after cancellation · mismatched identity tuple · duplicate-identical result ·
duplicate-conflicting result · a dead production bridge that passes discovery.

**Verification and review.** required check `unrunnable` · `baseline-red` run refusal · review
mutation · both axes rejecting · blocking-set union.

**Durable state and recovery.** concurrent controllers · duplicate sequence · checksum and
predecessor tamper · PID reuse and replacement · controller crash between an external effect and
its durable resolution · stale projection head · artifact path escape · projection schema
mismatch.

**Concurrency** (the gate that raises `MAX_SUPPORTED_TICKET_CONCURRENCY` — **a hermetic suite
plus one documented two-lane run against a non-local resource class**, because a suite of fakes
proves the knob and not the scheduler):

1. Ceiling 2, three eligible tickets ⇒ exactly two claimed; the third carries **no assignee and
   no claim comment** until a slot frees.
2. Routing resolving entirely to a size-1 class ⇒ effective concurrency 1 **regardless of the
   declared ceiling**; the second ticket is never claimed.
3. A lane holds at most one model slot, and zero between phases.
4. The ticket slot **survives repair and fresh-retry**; a newly eligible ticket cannot take it
   mid-execution.
5. Every terminal disposition frees the ticket slot, and after a full run **no capacity row is
   left held**.
6. Controller killed mid-lane; restart re-enters the same run, adopts the live pane, and
   **re-acquires the slot that pane holds**.
7. A slot whose holder cannot be adopted is released **by probe**, never by elapsed time.
8. A slot stamped with a superseded lease generation is not honored.
9. Two lanes never run mechanical checks concurrently.
10. Two lanes reach integrate; the base moves between verify and integrate ⇒ the
    compare-and-publish loop re-rebases and re-verifies, **consuming no budget**.
11. No two attempts ever share a worktree.
12. Under a size-1 class, both review attempts still run to completion sequentially, neither is
    cancelled, and both verdicts are unioned.
13. N consecutive automation failures **in terminal-commit order** trip the breaker; product-level
    failures interleaved among them do not.
14. Drain with in-flight lanes: no new claims, all reach terminal dispositions, **one report, one
    end reason**.
15. Second stop ⇒ in-flight lanes `released`, slots freed, panes left alive for reconcile.
16. Declared size exceeding observed `max_instances` ⇒ preflight failure naming both values.
17. Required class unreachable ⇒ preflight failure naming class, endpoint, and fix — **never a
    silent drain-as-if-done**.
18. Loader rejects: a missing size for an active-routing class; a size for a class no declared set
    reaches; `maxTicketExecutions` above the ceiling.
19. `status` reports effective concurrency 1 when routing is local-only despite a higher declared
    ceiling.

> Cases **5, 7, 10, and 17** are the load-bearing ones: each is a **silent wrong answer** rather
> than a crash, and those are the failures that survive into production disguised as "it seems
> slow" or "it said it was done".

**Retention and cleanup.** malicious `../` artifact paths (unexpressible by construction) · binary
logs · digest mismatch · stale cleanup plans · live leases and sessions · failed and paused runs ·
orphan objects · worktrees with untracked files · partial deletion and retry after controller
crash.

**Configuration and migration.** multiple global/user installations · `PATH` shadowing · stale
generated adapter artifacts · package revision change · a bridge present-but-nonfunctional ·
overlapping `labelsAny` rules · a ticket matching two rules for one role · Opus/Fable on pi.

**Skill loading.** A **one-time acceptance matrix** per (harness version × model × package
revision) proving that Opus and Fable actually load and follow skill bodies — discharging the
survey's explicitly unverified claims.

---

## 16. Monitor contract obligations — checked off

The monitor's §11 numbers fourteen obligations on the factory. All fourteen are now carried by
this specification.

| | Obligation | Carried in |
|---|---|---|
| **O1** | every operator-observable transition is a journal event | §4.3 (`visibility` three-value class) |
| **O2** | agent-status transitions **recorded**, not merely read live | §5.1 |
| **O3** | periodic controller liveness event with lease and fencing identity | §4.8 |
| **O4** | reconcile emits a typed per-entity conclusion with its evidence basis | §5.4 |
| **O5** | the per-event field set and sequence-not-clock ordering | §4.3 |
| **O6** | an actor slot on effect records | §4.5 — **see §13.D**: accepted but never restated by #79's resolution |
| **O7** | run identity stable, durable across restarts, orderable by start time | §2.1 (ULID) |
| **O8** | lock-free torn-tail-tolerant reads; nothing observable only in memory; distinguishable journal identity | §4.1 (discharged by the WAL decision) |
| **O9** | resolved transcript pointer plus worker kind/format, captured at attempt start | §6.5 + §12.9 (permanent in the digest tier) |
| **O10** | run lifecycle and end reasons operator-visible; preflight observable per check and probe; `controller-lost` never self-asserted | §10.3 — **amended by §13.A**, then refined by #97: six run end reasons plus one controller exit outcome |
| **O11** | monitor service session-scoped, idempotently started, rehostable; reached by typed `pi.events` only; `status`/`doctor` on the loopback token | §10.6 |
| **O12** | monitor config surface: `bind`, explicit port for non-loopback, scrypt hash plus salt, optional TLS, fail-closed without a credential, `0600` | §11.6 — **independently verified against #84's resolution**, not merely against the monitor's own table row |
| **O13** | two-tier retention and its pins; transcript pointers and the ticket → executions index in the permanent digest; a chosen deletion surfaces as `transcript-missing` | §12.2–§12.4, §12.9 |
| **O14** | the projection tables are a **versioned read contract** | §4.4 |

---

## 17. Pinned decisions

| Ticket | State | Inherited |
|---|---|---|
| [#76](http://192.168.129.37:30008/minder/oh-my-slop/issues/76) Survey of the failed factories | closed | §1 inheritance rule; §6.2 harness-native loading |
| [#77](http://192.168.129.37:30008/minder/oh-my-slop/issues/77) Tracker scheduling and claims | closed | §3 |
| [#78](http://192.168.129.37:30008/minder/oh-my-slop/issues/78) Worker launch and typed completion | closed, **amended** | §6.1–§6.7 — ticket reads amended by #83; resume semantics narrowed by #79; **pane kill superseded by #86 (§13.B)** |
| [#79](http://192.168.129.37:30008/minder/oh-my-slop/issues/79) Durable state, events, reconciliation, locks | closed, **amended** | §4, §5 — state root corrected by #82; **effect-key grammar widened (§13.C)**; O6 restated (§13.D); O14 added |
| [#80](http://192.168.129.37:30008/minder/oh-my-slop/issues/80) Git isolation and integration | closed | §7 |
| [#81](http://192.168.129.37:30008/minder/oh-my-slop/issues/81) Verification, review, repair, outcomes | closed, **amended** | §8 — review fan-out wording and circuit-breaker definition amended by #85 |
| [#82](http://192.168.129.37:30008/minder/oh-my-slop/issues/82) Controller lifecycle and operator surface | closed, **amended** | §10 — `migrate` verb added by #84; **end-reason enum unioned with #85 (§13.A)** |
| [#83](http://192.168.129.37:30008/minder/oh-my-slop/issues/83) Worker trust and permissions | closed | §6.8 |
| [#84](http://192.168.129.37:30008/minder/oh-my-slop/issues/84) Configuration, routing, migration | closed, **amended** | §11 — `concurrency` block filled and migration disposition extended by #85 |
| [#85](http://192.168.129.37:30008/minder/oh-my-slop/issues/85) Serial-to-bounded-parallel scheduling | closed, **amended** | §9 — **end-reason enum unioned with #82 (§13.A)** |
| [#86](http://192.168.129.37:30008/minder/oh-my-slop/issues/86) Retention, cleanup, transcripts | closed | §12 |
| [`software-factory-monitor.md`](software-factory-monitor.md) | locked | §16 obligations; amended by §13.A |

**Amendment protocol.** This specification is amended in place as implementation discovers facts
that *refine* it. Anything that **contradicts** a locked decision here **reopens a ticket** rather
than being silently edited in — including anything that would reopen §13's three reconciliations.

---

## 18. Delivery

### 18.0 Preconditions — not factory code, but blocking

Both are **discharged**; recorded because the reasoning still governs.

1. ~~**Turn `oh-my-slop`'s own suite green** (§8.3).~~ **Done** (`4a037a3`). The retirement of
   `extensions/software-factory` in `fe80c5d` left its tests, its manifest assertion, and its
   README entry behind. CI stayed green only because it runs `validate_refs.py`, which walks
   `skills/` alone — so the gap that hid it is itself now covered by a guard.
2. ~~**Package changes this specification mandates.**~~ **Done.** `requires:` frontmatter with a
   mechanical closure gate (§6.2) · `scripts/build_claude_plugin.py` with live Claude
   verification (§6.3) · `review-standards` and `review-spec` as independently invocable entry
   skills, with `two-axis-review` no longer assuming a spawn tool (§8.4) · the whole-output
   capture rule as `construction-craft` Critical rule 8, inside `implement`'s declared closure
   (§6.8).

**The `requires:` gate is what keeps §6.2 true over time.** A skill that hands work to another —
by a markdown link to its `SKILL.md`, or the `use the \`x\` skill` imperative — must declare it,
enforced by `tests/test_skill_requires.py`. An undeclared dependency therefore fails in CI rather
than at a worker's preflight, which is the only place it would otherwise surface: mid-attempt,
after a ticket is already claimed.

### 18.1 Slices

**Slice 1 — Substrate.** §4 durable state (journal, projections, effects, leases, integrity),
§11 config loader and the §11.7 package handshake, and the §10.2 binary skeleton carrying
`status`, `doctor`, and `reconcile`. Nothing executes work yet; everything observable exists.

**Slice 2 — The monitor**, sequenced **immediately after slice 1** rather than last. Its whole
data dependency is §4.4's projection tables, which slice 1 delivers; and the window in which runs
execute with no monitor — SSH plus `sqlite3` against `state.db` — is the exact silence the
monitor exists to end. The monitor map's own `to-tickets` runs once the factory's implementation
tickets exist, so its tickets wire to **real slice-1 blockers** rather than to nothing.

**Slice 3 — Execution.** §3 tracker scheduling and claims, §6 the worker adapter and its
three-layer preflight, §7 Git isolation and integration, §8 the pipeline and outcome policy, at
`capacity = 1`. This is the first slice that produces a pull request.

**Slice 4 — Operations.** §12 retention, expiry, and the `cleanup-plan` / `cleanup-execute` pair;
§11.8 `migrate`.

### 18.2 Deferred but specified

Build-ready in this document and outside the first shippable slice:

- **Raising `MAX_SUPPORTED_TICKET_CONCURRENCY` above 1** — gated on §15's concurrency suite plus
  one documented two-lane run.
- **`checks[].parallelSafe`** and concurrent verification (§9.5).
- **Differential "no new failures relative to baseline" verification** (§8.3).
- **A read-only tracker token for workers**, and a **pi bash-guard extension** (§6.8).
- **Per-class fairness**, if one class is ever observed starving another.

**Not deferrable.** The **effect/probe discipline** (§4.5) and the **availability of every
identity at mint time** (§2.1) are woven through every subsystem; retrofitting either means
touching everything twice.

---

## 19. Out of scope

- Turning loose ideas into plans, specs, or implementation tickets inside the factory.
- A private factory-generated task graph, or workers sharing one mutable worktree.
- Non-Gitea tracker adapters in the first release.
- Automatic final pull-request merge, or deployment.
- Interactive takeover of a running worker, or arbitrary mid-turn command injection.
- Credential sandboxing beyond explicit permissions and existing host boundaries.
- The monitor UI itself — it belongs to
  [`software-factory-monitor.md`](software-factory-monitor.md).
- Deleting the legacy implementations during this planning effort.
- **A resident factory service with a work queue.** A private queue is the private task graph
  already excluded, and the run boundary is the spine of the locked monitor specification, so
  residency *invalidates* rather than adjusts it. **The tracker is already the queue** —
  labelling a ticket under the run's parent *is* the enqueue. Planned separately as a v2 effort
  with its own destination.

---

## 20. Amendment log

| Date | Change | By |
|---|---|---|
| 2026-08-15 | Initial lock. Reconciles three cross-ticket contradictions (§13): the end-reason enum is unioned to seven members; the controller stops agents and never closes panes; the effect-key grammar is widened with a `cleanup`/`expiry` phase and nullable identity segments. Restates monitor **O6**, which #79's resolution accepted but never carried. | #87 |
| 2026-08-15 | §5.4's scope clause generalised from "any ticket execution holding an unresolved effect" to **any entity** holding one — a ticket execution, an already-ended run, or the repository for a repo-scoped effect. Both omissions are reachable (`start --new-run` ends a run whose ticket-less effects were never settled; a repo-scoped artifact write is keyed with a null run), and under the old wording §12.4 pinned them forever with nothing able to probe them. Found while implementing the engine. | #96 |
| 2026-08-15 | §18.0 both preconditions discharged. §6.3 gains two **verified** Claude Code 2.1.229 loader facts that justify the generator: skills register at **depth 1 only** (a bucketed skill is dropped with no error), and `author` must be an **object**. Both were found by running the real binary, not by reading docs — the second one failed a test that would otherwise have passed. | #87 |
| 2026-08-15 | #97 hostile review corrections: normal `run.ended` and controller-lease release are one token-checked transaction; a stale controller emits and exits 6 but leaves the adopted run open. `baseline-red` is clarified as the closed pre-execution outcome for any required red preflight check. §10.4 explicitly permits a fail-closed `scope-unresolvable` result until the tracker membership reader lands. | #97 |
| 2026-08-15 | #97 reverse-verification corrections. §4.6 and §14.6 extended: **every** record moving a run's lifecycle is written under the token in the same transaction as the compare, not only `run.ended` — a holder whose row lapsed learns it is stale at its next compare-and-swap, and effects survive that window on §14.5's resolution-time check while a run's lifecycle has no such backstop. §10.3's table row records that `lease-lost` is the one member that is only an exit code and never a recorded `end_reason`; the projector enforces it. | #97 |
| 2026-08-16 | #106 implementation corrections, all three found by running the real harnesses. §11.3 gains an optional **`worker`** block — §6.8 requires per-run overrides to be *declared in config* and recorded in the manifest, and no block held them; singular, so §11.8's migration cannot confuse it with legacy v1's `workers`. §6.8 gains a **third channel, capability promotion**, with an enforced limit: config isolation silently deletes the `local` resource class (its models come from an operator *extension*, verified live — 5 models and the router's `max_instances` with it, zero without) and §6.5's transcript pointer, so declared extensions are promoted, digest-recorded, and held to "no skills" by the probe requiring **every** `skill:<name>` record — not only the closure's — to resolve inside the pinned root. §6.8's Claude reviewer gains broad allows for the tools it keeps: plan mode with an empty allow list leaves a prompt path in the one posture that was not given them. | #106 |
| 2026-08-15 | #97 second reverse-verification corrections. §4.6: a loss conceded before `run.started` commits names no run — the loss event carries `run: null` and the exit-6 report names no phantom id. §10.3 and §13.A: the published table is restated as **six run end reasons plus one controller exit outcome**, ending the contradiction of a mandatory "end-reason enum" containing a member never recorded as one. §4.3: `run.ended` and `run.lifecycle-changed` move to payload v2, whose contract refuses `lease-lost`, duplicate endings, and post-terminal movement, while v1 journals replay with the tolerance they were written under; the `run` and `run_digest` projectors bump to v3, so a store the previous contract wrote refuses at open and is repaired by a recorded rebuild rather than opened silently or classified as corruption. §4.3's kind enumeration gains the `run.lifecycle-changed` and `preflight.checked` records the implementation already emits. §14.6 invariant 6 qualified accordingly. | #97 |
| 2026-08-16 | #107 implementation corrections, both found by running the installed Herdr (protocol 19). **Herdr exposes no `agent stop`** — not in the CLI, whose whole agent surface is list/get/read/send-keys/prompt/rename/focus/wait/attach/start/explain, and not in the socket API, which has no `agent.stop` method. §6.6 and §13.B's "the controller stops the **agent**, never the pane" therefore lands as the harness's own quit sequence through `agent send-keys`, leaving the pane at its shell prompt; §13.B's accepted cost is unchanged, and a harness that ignores its quit keys is the wedged pane it already describes. **Herdr also dates nothing**: no answer or event frame in its API carries a timestamp, so §4.3's "a foreign fact retains that system's raw timestamp string verbatim" gains an explicit source-level exception — a source that states no time declares it (`statesTime: false`), the `occurred_at_raw` key is *refused* on it rather than filled with our clock under its name, and `observed_at` dates the record. Herdr's frames carry no id either, so §5.1's foreign id is constructed and — exactly as the tracker's is — **names the fact rather than the object**, or the partial unique index would let the first sighting of a pane suppress every later one. Two further clarifications of what was already implied: §6.6's worker liveness is *still working*, not *the process exists* (neither harness exits when a turn ends, so the latter reading makes every normal completion `wrote-but-hung`), and §6.5's mint is recorded before any attempt-scoped effect, with the harness session identifiers and the transcript pointer following in an `attempt.correlated` record once Herdr can state them. §4.3's kind enumeration is brought back into step with what the implementation emits: it had fallen behind #98's two operator requests, #98's `ticket.disposition-changed`, and #105's `attempt.rechecked`, and now also carries this slice's `attempt.correlated` and `attempt.ended`. | #107 |
| 2026-08-16 | #108 implementation corrections, all five found while making §8.10's table total. **A stage result's semantic key is `(run, ticket, phase, attempt)`**, not §2.1's bare stage identity: §8.5's repair re-enters a phase, so a key without the attempt slot would make every repair §8.10's *conflicting duplicate* and a working pipeline would fail itself. **§8.10's two "`failed` / automation" cells name no reason class**, and §8.8 has none that fits — so §14.18's rule is stated over the fault as well: a controller-derived reason class ⇒ `failed`, and an automation fault with no class ⇒ `failed` too, since an automation fault is controller-derived by definition. **`unrunnable` outranks `failed`** when a required set mixes them: §14.16 makes the controller's rerun the only attestation boundary, so a set one required check never ran attests nothing, and calling the phase `failed` would charge the worker's repair budget for a broken host. **Verify runs the advisory checks too** — §8.2's "the full required set runs every time" and its "advisory checks record evidence and never block" have only one place they both hold, since §8.3's baseline runs the required set alone and §8.7's attestation carries *every* check with its required flag. **§8.10's review rows are expanded per attempt outcome**: the published row lumps "reviewer attempt died / timed out / invalid", but a reviewer's `needs-human` is §14.18's pause, its `cancelled` is `released`, and its `wrote-but-hung` is a valid verdict — so the phase is routed over its attempt outcomes *and* its three verdict results, which is what makes it total. §4.3's kind enumeration gains this slice's `stage.resolved`. | #108 |
| 2026-08-16 | #109 implementation corrections, all three found while putting §8.9's four dispositions on a real Gitea. **A comment effect digests its intent, not the prose rendered from it**, and nothing a comment body carries may read a clock: §4.5 compares the payload digest, so a timestamp of ours inside a body makes an ordinary §10.4 re-entry a *payload conflict* instead of the comment already posted — and the tracker dates every comment anyway, which §3.3 already insists is the clock that counts. §8.9's block therefore carries the identity tuple, the chain, and the evidence, and no `at`; §3.3's claim and takeover comments keep the timestamp §3.3 asks for and digest the three identities instead, which is the same correction applied to the older path — a re-entered takeover was otherwise a permanent conflict on the one ticket the run already held. **§4.5's "label add/remove" is add only in v1**: §14.20 has a label cleared by a human or not at all, so the writer carries no removal and the *probe* for one exists without a caller — the catalogue declares what a mutation would be settled by, the writer declares what this factory can do. Labels are added with Gitea's **appending `POST`**, never the replacing `PUT`, or a disposition would silently drop a label a human put there. And §5.2's corroboration for a missing comment splits with §8.9's table rather than with claim-versus-not: three dispositions **retain** the assignee, so what agrees with a deleted pause or failure comment is the label it added, and reading "no assignee" as the corroborator for all four would leave every one of them uncorroborated and pinning its run's artifacts under §12.4. | #109 |
| 2026-08-16 | #110 implementation corrections, all three found while wiring §8.5's two tiers. **§7.3's worktree is created at the attempt's own base commit**, not at the pinned base unconditionally: §8.5 branches a repair from the prior attempt's tip, so the unqualified wording described a tier the section forbids. **§7.4's harvest predicate is read against that same base** — against the run's base a repair that committed nothing is still "ahead" by the previous attempt's commits, and a worker that did nothing would harvest as `completed`. **A retry mints its own attempt**, following #107's ordering correction: the mint precedes every attempt-scoped effect and both git mutations are effects, so it belongs to whoever creates the worktree. That splits §6.5's minter from its launcher, with a consequence worth recording rather than rediscovering: the `attempt` projector inserts one row per `attempt.launched`, so `launchWorker` **cannot** append a second one and skips its own — and the facts only a launch knows (the runtime, the declared model, the manifest and prompt digests) stay in the attempt manifest on disk and never reach the journal. The mint therefore carries everything knowable at mint time, including the three derived paths; closing the residue belongs to the claim → launch composition and is not a property of the tiers, since a first attempt's claim has the identical split. One property worth recording rather than rediscovering: **no fresh-retry row carries untrusted evidence** — §8.10 marks evidence `fact` or `untrusted` per row, and every row routing to fresh-retry has none at all, so §8.5's "a worker that flailed should not have its flailing inherited" holds for the prompt as well as for the branch, without a second rule saying so. | #110 |
| 2026-08-16 | #116 implementation corrections, all five found while migrating this repository's own v1 file. **§11.8's mapped column is not exhaustive**: the three surviving `routing.defaults` roles are mapped too — naming `routing.defaults.finalReview` as *reported and dropped* says nothing unless the block around it survives — and `version` → `schemaVersion` with them. **§11.5's review pair is written twice by the migration**, from the one legacy reviewer, and reported as a duplication to confirm: a sixth hole would contradict §11.8's closed hole list, and picking a different second reviewer is the guess §11.2 forbids. **§11.6's generated `checks` block and §11.8's `checks` hole are one artifact**: name and command come from the matrix, and the three fields no matrix can answer — `timeout`, severity, `expectedFailureExitCodes` — are left as sentinels, so "generated once, for human review" and "the loader hard-fails until a human resolves it" describe the same file. **Migration preserves the file it replaces** as `.pi/factory.v1.json`, written before the rewrite and never overwritten: two of the five holes are re-authored *from* the legacy rules, so consuming them would make those holes unresolvable, and §11.8 named no such copy. **A legacy key the table does not name refuses the migration** rather than being dropped by omission — §11.2's rule applied at the moment the legacy file stops being the one that runs. | #116 |
| 2026-08-16 | #112 implementation corrections, all four found while fanning §8.4's review out. **§2.1's ordinal is allocated against the record, not derived from the attempt being answered**: §8.5's tiers and §8.4's two axes mint into one ticket execution's ordinal space, so "one past the prior attempt" lands a repair on a reviewer's id, finds its branch and worktree effects already resolved, and re-enters a phase whose result is recorded under that id — which §8.10 reads as its own conflicting duplicate, failing a working pipeline. Idempotency moves to the minter's *purpose* (the tier and the attempt it answers, or the axis, the work, and the try), which is what lets `planRetry` stay pure by naming no attempt at all. **An axis resolves its own stage under its own attempt**, and the phase's result is resolved under the builder attempt — so §8.10's `verdict` action is taken inside the fan-out and is never the walk's; the walk reaching it means an executor answered a phase with an attempt outcome, which is §8.8's two levels crossed. **The verdict's shape and whether one is owed are two different judgements with two homes**: §6.6's schema judge holds a written verdict to the closed pair, a findings list, a mandatory citation per finding, and agreement between the word and its own blocking set — while "a `completed` reviewer owes a verdict" is role knowledge and lives in the fan-out, because §6.1's adapter has never known which roles exist. The controller never classifies a citation, so §8.4's "a baseline smell can never be blocking" is stated in the prompt template and enforced by the skill: recognising a smell by name would be a second copy of the skill's baseline living in the factory, and downgrading a finding would be the reranking §8.4 forbids. **An opening capture that is already dirty is a mutation, not a third answer** — the controller made that worktree out of a commit and handed it to one read-only role, so reading a leftover as an automation problem would hand back the second go §14.19 refuses, to the attempt that earned the refusal. **The commit under review is read off the recorded harvest rather than taken from the caller** — §14.13 measures the commit being published, and a supplied one is a second opinion about which that is — and the fixed point is *required* on a review role's prompt and refused on a builder's, because a reviewer rendered without one gets a prompt naming no diff, which reads as a complete instruction in a pane nobody is watching. §2.1, §6.8 and §8.4 are corrected in place. | #112 |
| 2026-08-16 | #111 implementation corrections, all six found while counting §8.6's budgets. **The product budget is two declared numbers, not one pool of 2**: §11.6 declares `repair` and `freshRetry` separately because §8.6 grants them separately, and one pool would let a ticket take two repairs and never the fresh-retry that discarding the work was for. **Nothing increments** — a spend is a count of the stage resolutions that charged that budget, so the bound and the count are one expression, and a controller that died between resolving a failing stage and minting its retry reads the same count back. **An automation retry re-enters the phase it left**, while the two tiers re-enter `implement`: §8.5 governs the tiers, and rebuilding good work because a pane died is exactly the infra flake §8.6 refuses to charge the builder. **§8.6's N is a code constant, not a knob** — §11.3's block inventory and §11.6's default list are both closed and neither names a breaker key, while §14.33 makes an undeclared key a load failure; promoting it later breaks no file on disk, retiring a knob breaks every file that set it. **The breaker's verdict is monotone** rather than trailing, because §3.5 lets in-flight lanes finish and one settling `published` must not erase the reason the run stopped claiming. **Automation-versus-product is the disposition's own `fault`**, recorded on the terminal-commit record — matching a list of reason classes instead would make every class added to §8.8 later a silent vote on whether runs stop, which is also why `ticket.disposition-changed` moves to payload v2 (§4.3) **and why the breaker branches on that version** rather than trusting the bump alone — a pre-v2 record cannot be classified, so it breaks the streak and is counted as unread rather than read as a product verdict. Two wordings were made unambiguous rather than changed: the **hard ceiling of 2 + 2 is 2 on each declared number**, since the other reading puts the shipped default at its own ceiling and leaves a knob that can only be redistributed, which is the refusal-to-have-a-knob this section rejects; and an **operator's stop outranks the breaker**, because both drain identically and the human who typed `stop` should be told their stop was honoured. | #111 |
