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
  every historical failure as a product verdict. **`stage.resolved` is on payload v2** because
  §8.10's semantic key grew its fifth slot: a v1 record predates any way of re-entering a
  controller phase, so it reads as the first pass rather than as a gap. **`attempt.ended` is on
  payload v2** because `agent_stopped` changed meaning: a v1 record carries the pane read taken
  immediately after the quit sequence — a race the teardown normally won — while from v2 the
  value is what a bounded re-probe observed, `null` where Herdr would not answer, and a stop
  that could not be confirmed names the surviving pane in `stop_anomaly` instead.
- **Visibility is a three-value class**, not a boolean: `operator` (default feed) · `detail`
  (shown when a node is expanded) · `diagnostic` (filtered by default). Two values cannot
  express "real, but only when you are looking at this node", and the requirement is that
  internals stay *filterable* rather than *unemitted*.
- **Kinds are dotted `<entity>.<verb>`** from one closed, additive-only enumeration:
  `run.started` · `run.lifecycle-changed` · `run.ended` · `run.stop-requested` ·
  `run.abandon-requested` · `preflight.checked` · `attempt.launched` ·
  `attempt.rechecked` · `attempt.correlated` · `attempt.ended` · `stage.resolved` ·
  `ticket.disposition-changed` · `effect.requested` · `effect.resolved` ·
  `observation.recorded` · `observation.degraded` · `observation.unrecognised` ·
  `reconcile.concluded` ·
  `controller.heartbeat` · `controller.lease-lost` · `projection.rebuilt` ·
  `journal.integrity-failed` · `stream.truncated` · `run.expired` · `capacity.granted` ·
  `capacity.released` · `capacity.waiting` · `capacity.exhausted` · `capacity.admitted`.

  The last two are #154's exhaustion memo (§9.8): a class a provider refused for quota or rate
  reasons is unavailable until the recorded expiry, and only a probe's admission re-opens it.
  Both ride the `controller` stream with no run in the envelope — the memo outlives the run that
  paid for it — and carry the observation they came from in the payload.
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
writes (branch create, push, evidence ref, worktree create/delete), Herdr writes (workspace open,
agent start, agent stop), artifact and attestation writes, and cleanup deletions. **Reads are not
effects** — they get durable observation cursors.

**One exception, and it is the only one: expiry's reclamation of an artifact blob** (§12.5). The
pair exists so a mutation whose outcome the database cannot know is settled by re-probing rather
than by reasoning (§14.1). An expiring blob is the one mutation for which the database already
*is* the record: §12.5 keeps the ledger row permanently as a dated tombstone, expiry commits that
row before unlinking, and a crash in between leaves a digest resolving to the correct
`unavailable(retention-expired)` while the next pass re-attempts the unlink. Keying such a pair by
the expiring run would put the record of a deletion inside the thing being deleted; keying it
repo-scoped would add two permanent records per artifact to the `controller` stream §12.2 keeps
low-volume by design. `artifact-delete` therefore belongs to §12.8's cleanup, whose orphaned blobs
have no ledger row to be the record.

**Key grammar:**

```
<run>/<ticket>/<phase>/<attempt>/<operation>[/<operand>]
```

- `phase` is §2.2's closed enum.
- **`run`, `ticket`, and `attempt` are individually nullable, written as the reserved literal
  `-`.** A repo-scoped effect — an orphaned artifact blob, the controller's own pane, a
  `doctor --baseline` worktree — still produces a well-formed, `UNIQUE`-constrainable key.
- **When the attempt slot is filled, and when it is `-`.** An effect is keyed by the **attempt**
  when its subject is that attempt's own work — its branch, its worktree, its evidence ref, its
  pane. It is keyed by the **ticket execution**, attempt `-`, when its subject is something one
  ticket execution has exactly one of: the published branch (`push`, `pr-create`, §7.5) and the
  ticket itself (`assign`, `label-add`, `comment-post`, §3.3 and §8.9). The rule exists because
  *the database itself enforces uniqueness* below is a whole-system claim: a subject that outlives
  the attempt that made it, keyed by an attempt, gets one row per attempt that touches it, and
  the uniqueness quietly becomes a per-attempt property with nothing failing.
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
| workspace open | `workspace list` matching the run's label (§6.4) |
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
including the pane-lifecycle three, filterable per pane (verified live at 86 frames in 8
seconds). It is not exposed in the CLI, so this costs a small NDJSON socket client.
**Agent-status transitions must be recorded as events, not sampled** — a poll structurally
cannot see `working → blocked → working` between two samples. If the socket is unavailable,
degrade to polling **and emit a typed `observation.degraded` event**; silent degradation would
be indistinguishable from a well-behaved worker. Resubscribe by pane id after a Herdr server
restart — pane ids survive it.

**Wire names are inconsistent, and matching must not guess one spelling** (measured against
protocol 19): `pane.agent_status_changed` arrives **dotted**, while `pane_agent_detected` and
`pane_exited` arrive underscored. Each of the three subscribed events is therefore accepted in
**both** forms, so a server that changes one spelling is not a silent outage. A frame for this
pane that matches no known event is a recorded `observation.unrecognised` diagnostic, never the
same silent null that means "another pane's frame". A quiet socket at subscribe time is a calm
worker, not degradation — degradation means the socket failed.

An event is emitted per observed transition; a confirmation of no change emits nothing, with
the controller heartbeat carrying "watching N panes" so *quiet* stays distinguishable from
*stopped watching*.

**Progress is observed, never inferred from the controller's clock (§6.6).** A status
transition and a changed pane-output snapshot are each recorded as `observation.recorded` facts
— `worker.alive` (source `herdr`) for the first, `worker.output` (source `herdr`) for the
second. Pane output is **sampled** through `pane read` on its own cadence rather than
subscribed to, because Herdr exposes no output stream — the point is only whether the recent
output *changed* since the last sample. For pi the transcript pointer is a path whose growth is
the same output observed at its source; the pane is the uniform channel across both runtimes, so
it is the one sampled. The no-progress clock reads the latest of these recorded facts, and the
controller's own elapsed time is the *measure* of silence, never the evidence of activity.

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
| **Herdr** | three facts: whether a worker process is alive right now, the pane output it produced, and a provider refusal observed in that output (#154) |
| **The attempt outbox** | what the worker *claimed* — evidence, never proof, of a phase outcome |
| **The journal** | **intent only**; it never establishes an external fact |

Comment text is excluded deliberately: bodies are silently editable, and a deleted comment
vanishes from `/comments` **and** `/timeline` without trace. So a missing claim comment means
*possibly deleted*, never *no claim was made* — our own effect record plus the durable assignee
corroborate.

Herdr **exposes no exit code anywhere** (`exit_code` occurs exactly once in its entire API
schema, on plugin command logs), so it can never say *how* something ended. The outbox remains
the sole structured completion signal.

**"A worker process is alive right now" is `pane.agent`, and that field follows the pane's
foreground process rather than its screen** (#158, `tests/live/herdr-agent-presence-source.mjs`).
Herdr's screen rules decide agent **state** — `agent explain` names the rule that matched and
the region it matched in — but a pane whose foreground process merely *names* itself `claude`
is reported as hosting an agent with a blank screen and no rule matched, and neither
`pane release-agent` nor a foreign `pane report-agent` removes the field from a live one. This
is what makes §6.6's stop confirmation safe **in the direction it is used**: a mid-turn screen
that stops matching cannot manufacture an absence, so `stopped: true` is never written about a
worker that is still working. The error the signal *can* make is the opposite one — a process
wearing the name is reported present — and that lands as §13.B's `wedged-pane`, which is the
conservative failure. Agent **status** carries no such guarantee: a foreign `report-agent` moves
it, and pi's `idle` is already the engine's default when nothing matches (#150).

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
     cost. Verified live. The probe must use the production flag set. A **fourth step proves
     §6.8's discovery fence from both sides** (#163): a canary project skill planted in the
     probe's own working directory must be absent from that session's `commands`, *and* one
     deliberately unfenced control session — the worker binding minus the fence flags, nothing
     else — must register it. Claude's command records carry names, not source paths, so pi's
     converse check has no direct analogue; the canary is what makes the fenced session's
     silence evidence rather than an untested assumption.
3. **A cheap static recheck per attempt** — no fresh probe.

**The probe must execute the production path, not merely inspect registration.** The audited
Babysitter Pi bridge mixed CommonJS with an ESM package, referenced absent shell targets, and
then swallowed bridge exceptions as `{}` — passing installation and discovery while
behaviorally dead.

**The binding is one composed object, never two argument sets kept equal by care** (#160). Each
runtime's probe builder passed the skill-delivery flags — `--plugin-dir` for Claude,
`--no-skills --skill <root>` for pi — and its session builder did not, so every worker launched
without its closure while the probe stayed green: a divergence structurally undetectable from
the probe's own result. The **worker session's** argument set is therefore the primary object;
the probe's is that set plus its probe-only IO flags and nothing else, composed from it, and a
test holds the identity at the launch seam — the argv a worker pane receives is the probed argv
minus the probe-only flags plus the profile's. A launch whose closure cannot reach the session
(no proven plugin directory, no pinned skills root, a plugin cache wiped since preflight) is a
typed automation failure before the attempt spends, never a worker that quietly reads skill
files instead of invoking them.

**The profile's own flags sit outside that composed binding, and are proven by a check of their
own** (#164). §11.4's `model` and the optional `effort` / `thinking` are appended to the worker
binding at launch, and this probe cannot absorb them: it is role- **and profile-independent**,
memoized once per pinned revision, while profiles vary per role *and* per routing rule — so
exercising each one inside it would change the probe's **cardinality** rather than its argv, which
is a different design and must be chosen rather than drifted into. Instead:

- **`profile-flags` is a separate preflight check, one live session per *distinct* profile the
  active routing can dispatch.** A routing table naming one profile in every role and in a rule
  costs one session, because flag spelling is a property of the profile and not of the role that
  reached it. **§6.2's runtime probe keeps its own cardinality — one per pinned revision.**
- **Each session runs that profile's own launch argv plus the probe-only IO flags and nothing
  else**, and it is judged on the answer the probe already reads: pi's RPC response, Claude's
  `initialize` control-response. **No model call is made** — spelling is a parse-level fact, and
  proving it must not spend tokens.
- **The verdict is that answer, never an exit status.** Measured on the development machine, `pi
  list` exits 1 over a stale OAuth token while pi's RPC session answers perfectly, so a side
  subcommand's exit code is not a spelling verdict. **`--version` is measured useless**: against
  Claude 2.1.233 it short-circuits *before* argument parsing and accepts `--nonsense-flag` with
  exit 0. What both binaries do offer is that a session which starts has parsed its argv, and a
  misspelling is refused by name before one does — `error: unknown option '--efffort'`, with
  `(Did you mean --effort?)` on the line after it, and `Error: Unknown option: --thinnking` from
  pi. **The quoted line is the one naming a flag the profile passed, matched whole-word**, not
  the last line: the hint trails the diagnosis, and `--model` occurs inside pi's unrelated
  `--models`.
- **The check runs behind the runtime probe and only on a green one.** The probe starts the same
  kind of session *without* the profile's flags, so a green probe and a refused spelling session
  differ by exactly those flags — that ordering is what makes the verdict a statement about the
  spelling rather than a guess about a broken harness. With no green probe there is nothing to
  attribute against, so the check fails citing `runtime-probe` rather than answering.
- **A binary that could not be spawned at all is §11.7's unreachable runtime, not a rejected
  flag.** It was never asked about a spelling, and blaming the profile would point the operator at
  their config over a missing executable (§11.2).
- **The cost is stated rather than capped by a new knob**: the sessions are serial at the
  runtime's own probe timeout, so preflight's worst case grows by the number of distinct profiles
  times that timeout before the first claim. Measured, an accepted spelling answers in ~1.8 s
  (Claude) and ~0.7 s (pi), and §9.7's ordering still puts the expensive baseline last.
- **A refusal names the profile, its flags, the binary and the binary's own diagnostic**, as a
  §11.2 preflight failure before a branch, a worktree, a pane or a tracker claim exists. Without
  it a renamed flag surfaces as `worker-launch-failed` *after* all four — the one binding that
  escaped §6.2's purpose of refusing before an attempt spends.

The reviewer binding is not spelled out a second time for this check, for the reason the probe
already gives: it differs only by flags the same binary has accepted, and a profile's own flags
are identical under both postures.

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

**One workspace per run, and a tab in it per attempt.** A workspace rather than a split of
whatever pane the controller happens to be in: `factory start --foreground` may run in a terminal
that is not a Herdr pane at all, and a topology that only works when the controller was launched
detached fails on the operator's second invocation. That argument rules out the controller's own
pane; it never argued for a workspace *per attempt*. The workspace list is the operator's
top-level navigation, and one run on one ticket filed four workspaces into it, interleaved with
the operator's real projects. Watching a worker is a tab switch.

The workspace is **run-scoped, not persistent**. It is a `workspace-open` effect keyed by the
run, so it is opened exactly once, adopted by every later attempt and by every controller that
re-enters the run (§10.4), and settled after a crash by probing Herdr's workspace list for the
run's own deterministic label — Herdr carries no metadata token on a workspace the way
`pane report-metadata` does on a pane, so the label is the only handle a probe has. A workspace
that outlived its run would accumulate tabs across runs and would need its own reconciliation
question — *is this workspace mine, or a dead run's?* — and the effect row gives §12.8's cleanup
one durable anchor per run to plan from instead of one per attempt. **Reclaiming a workspace is
not in v1**: there is no workspace deletion in the effect catalogue, because nothing deletes one. It is opened by the first attempt that needs one: a run that
launches no worker leaves nothing behind, and Herdr refusing the command is that attempt's
`worker-launch-failed` automation failure (§8.10), which is where a launch failure already has a
home and a budget.

**The cost is accepted explicitly:** an operator who closed the factory workspace used to lose
one attempt and now loses every live lane of that run at once. Each pane's loss is still §6.6's
`dead-worker`, so it is a real robustness cost traded for the navigation. The controller does not
repair it: a `tab create` against a workspace that is gone is reported, never answered by opening
a replacement behind the operator's back. A re-entered run therefore adopts the workspace it
recorded and, if that workspace was closed, launches nothing further — every attempt fails as
`worker-launch-failed` until §8.6's breaker ends the run, and **a new run is what opens a new
workspace**. The launch failure says so rather than leaving the operator to derive it from
`workspace_not_found`.

The controller composes the first prompt from a **deterministic per-role template**: the native
invocation (`/skill:<name>` for pi, `/oh-my-slop:<name>` for Claude) plus a typed context block
carrying the ticket snapshot, attempt identity, worktree path, outbox path, and prohibitions
(no push, merge, close, or relabel).

**The first prompt is delivered, not merely submitted.** A harness still initializing can
acknowledge the submission and swallow it whole (observed live), leaving an idle pane nobody is
watching. The launch therefore confirms the prompt was *taken up* — the worker left its resting
state, or the outbox already exists — and re-sends the same deterministic prompt a bounded
number of times before correlation; resubmissions are recorded on `attempt.correlated` as
evidence, and a prompt never taken up is a typed `worker-launch-failed` automation failure.

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

**The environment channel is declared to the multiplexer, never typed at the pane.** Identity and
§6.8's session binding are one `--env KEY=VALUE` set on the attempt's `tab create`, so the closed
pane set reaches the worker without passing through terminal output anyone can read back. Of the
three commands a launch issues, `workspace create` and `tab create` take an environment and
**`agent start` takes none** — so the tab is the last point before the agent at which anything
can be put in front of it, and that is where the binding is assembled. That the variables reach
the *agent process* and not merely the shell Herdr launches for the tab was established live
before the typed path was removed — **§5.2 enumerates what Herdr is authoritative for, and this
is not among the two facts**, so its help text ("an environment variable for the launched
process", where the launched process is the shell) is a claim to observe rather than to rely on;
`tests/live/herdr-tab-env-reaches-agent.mjs` is that observation. Each
value crosses as one argv element, so the factory quotes nothing. **Identity is applied last and
no declared value may shadow it** — a binding naming `FACTORY_ATTEMPT` would correlate a worker
to somebody else's attempt — and it is one variable per name, never a repeated option whose
winner is an argument parser's to decide.

**The outbox result must echo the full tuple; a mismatch is an automation failure.**

The adapter persists per attempt: harness session identifiers (pi session, Claude session,
Herdr agent and pane ids), runtime, exact model, skill source, and package revision.

**The transcript pointer is captured from Herdr, not computed.** Herdr persists
`AgentSessionInfo {kind: "id"|"path", value}` per pane, pushed by the agent's own `SessionStart`
hook — Claude reports a session id, pi reports a literal `.jsonl` path. That hook is herdr's
**agent-state integration**, installed in the operator's config root and reaching the worker
through §6.8's capability promotion: config isolation removes the operator's copy, so the
integration crosses in as a fixed, digested, **version-observed** artifact, and a per-runtime
preflight check gates its presence before the first claim — a run that could not carry the
pointer is a named red, not a pointer that will not arrive. Record
`{worker_kind, transcript_kind, transcript_value, captured_at}` on the attempt, polling with
backoff for a few seconds after launch. One seam covers both runtimes, and because worker and
reviewer are *different panes* it disambiguates them **as a fact**; computing the path cannot,
since pi keys sessions on cwd and both roles share a worktree. If the pointer never arrives,
record `no-transcript-pointer` — with the gate above, that record is an anomaly an operator
investigates, not the expected residue of isolation. **No later heuristic can recover this** —
Herdr drops the reference at pane close and integration deletes the worktree the pi path is
keyed on.

### 6.6 Typed completion — hybrid authority

**The attempt outbox file** — schema-versioned JSON at a controller-designated path *outside*
the worktree — is the authoritative **domain** result. **Harness and Herdr lifecycle events**
are the authoritative **termination** signal.

The wait is **first-signal-wins**: either signal wakes the controller, which evaluates
(outbox validity × worker liveness) against a state table — making silent-completion,
wrote-but-hung, and invalid-result **distinct typed outcomes**.

**Worker-writable statuses are a closed set:**

- `completed` — commit SHAs, summary, a **requirement trace** on a builder's record (#189, below),
  worker-reported test evidence **as context only**;
- `needs-human` — reason class plus the exact question;
- `worker-failed` — classification plus explanation.

**Controller-derived outcomes are never worker-writable:** `automation-failure` · `timeout` ·
`invalid-result` · `no-result` · `dead-worker` · `wrote-but-hung` · `cancelled` ·
`provider-refused` · `worker-never-started`.

**A worker never observed working never had a turn (#178).** `no-result` and `timeout` both say
the worker *ended a turn* badly — the first without writing, the second without finishing — and
§8.10 charges the worker's own budget for each. Neither is true of an attempt whose pane the
controller never once saw in a working status, so the two silence rows become
**`worker-never-started`**, which §8.10 charges to the automation budget. It is a **state
predicate, not a launch window**: no grace, no "within N of launch", because "this pane was never
seen working" is already the whole fact. The working set is `working` **alone** — `blocked` is what
a pane on a folder-trust dialog reports and admitting it would let an interstitial launder a hang
into a turn, and `unknown` means an agent is present but unclassified, which proves nothing. The
fact is read from the attempt's own **durable observation records**, never from an in-memory flag:
a controller that crashed after a genuine worker turn must re-read that attempt as one that
worked, or it files a real `no-result` as an automation fault and retries it on the wrong budget
until that one is gone too. A valid outbox still wins, an observed provider refusal still outranks
it, and a pane that died is `dead-worker` still.

**A provider refusal is its own typed outcome (#154).** A refusal for quota or rate reasons is
observed in the pane output — a signature vocabulary read off the harnesses' own non-retryable
limit classification, matched in the output's tail — and it overrides the three silence-based
verdicts: `no-result`, the no-progress clock, and the hard ceiling all become `provider-refused`
when the last visible output is a refusal. The outbox still wins, and a pane that died is
`dead-worker` still. The refusal is recorded as its own `observation.recorded` fact
(`provider.refusal`, source `herdr`), never inferred from elapsed time, and it becomes §9.8's
time-boxed class memo rather than a charge against the worker's budget.

**Every attempt has two finite clocks, and both have code-owned defaults.** The **hard
ceiling** (`attemptTimeoutMs`) bounds the lane whatever the worker is doing; the **no-progress
timeout** (`noProgressTimeoutMs`) ends an attempt that has stopped producing anything
observable — a status transition, changed pane output, or a growing transcript. A profile may
declare either; absent one, its code-owned default applies, because an unset clock would make
its `timeout` row unreachable and a worker hung mid-turn would hold its lane forever (observed
live as an unbounded wait). The two verdicts are different: the hard ceiling says *the lane is
surrendered*, while the no-progress timeout says *this worker stopped* — and when the
controller's own observation channel degraded, a no-progress verdict is the **automation's**
failure, never the worker tier's (§8.10). `attempt.ended` records **which clock fired**
(`clock`) and **the last observed progress** (`last_progress`), so the operator is not left to
read elapsed time as a diagnosis.

**Every outbox status carries the full `{run, ticket, phase, attempt}` tuple and the schema
version.** Correlation and idempotency identity are mandatory, never optional.

**Outbox mechanics.** Exactly one file per attempt, written atomically (temp + rename). First
schema-valid content wins; post-harvest writes are evidence, never state. A present-but-invalid
file is `invalid-result`, distinct from no-file-at-turn-end.

**A completed builder record carries a requirement trace (#189).** `trace` is a non-empty list of
`{requirement, evidence}` rows: `requirement` quotes a line of the ticket snapshot the attempt was
briefed with, `evidence` names a path and, where one exists, a test; an advisory `note` per row is
allowed. It is a **prompt obligation** stated in the builder template, like §7.3's trailer — the
`implement` skill names the trace as a deliverable, and the template names the block it is written
in. Two levels, two owners, as for §8.4's verdict: the outbox reader judges a written trace's
**shape** — non-empty, both fields non-empty text — and never whether a row is true; whether a
trace is **owed** is role knowledge, and a `completed` builder record without one produced no
result for its role and is `invalid-result` (§8.10's fresh-retry row, unchanged), with the missing
block named on the stage detail §8.5's brief presents to the fresh attempt as fact. A reviewer's
record carries none. The controller reads the rows and never their truth: the spec reviewer is the
judge of that (§8.4).

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

**The matrix is a receipt against a fresh nonce, not a transcript** (#115). The package ships one
skill — `skills/meta/skill-loading-proof` — whose body declares a **marker, a token, and a
transform** in a machine-readable block and asks its reader for a single line applying that
transform to a nonce the prompt supplies. **No prompt carries the token, the transform, or the
answer**, so a receipt line is a body that reached the model and a correct one is a body it
followed; the judge reads the contract out of the *same shipped bytes the model was given*, so
there is no second copy of the token for the package to drift from.

**The proof skill ships in the pinned revision rather than being planted for the run**, and that
is the trade deliberately taken: a body planted outside the revision would be delivered through a
plugin the generator did not build from the pin, and would prove a package no worker runs. The
cost is one skill in a catalogue of sixty-six, whose description narrows it to this matrix and
which nothing else invokes; it is discovered by the closure walk, flattened by §6.3's generator,
and counted in §6.2's expected component inventory exactly like every other — which is the point.

Three cells per model, because the survey's two claims are separate — "success in one does not
prove the other" — and because a proof that could not have observed the failure it rules out is
not a proof:

- **direct invocation** — the `<plugin>:<skill>` command §6.4 puts at the head of every worker
  prompt;
- **model invocation** — natural language naming no skill, so the `description` is what has to
  work;
- **trace control** — a cell deliberately told to read the body off disk. Its `read-not-loaded`
  outcome is what makes the other two cells' *empty tool trace* evidence of native loading rather
  than an untested assumption, exactly as #163's unfenced control session does for the discovery
  fence. A control that shows no read leaves the trace question open, however green the rest is.

**Every cell runs the worker binding** — the argv a worker pane receives, plus the probe-only IO
flags and nothing else (#160's composed-binding rule). A cell proven under any other flag set
proves a session no worker runs in.

**That "plus" is also the matrix's own limit, recorded rather than glossed.** The probe-only IO
flags make a cell a `--print` session, and §6.4 runs every real worker attempt in an interactive
pane. The matrix therefore covers the **headless** end of that axis and cannot reach the other,
which is why the survey claim naming "interactive versus headless" stays unverified here however
green the cells are — the untested half is the one every attempt actually runs in.

**A claim is evidence about every axis its own sentence names, or about nothing.** The recorded
status of each survey claim is derived from the cells that ran, never narrated: a claim naming Opus
and Fable stays unverified on a matrix that ran neither, one naming an interactive worker stays
unverified on a headless run, and one naming consistency *across harness versions* is unreachable
from a single document by construction — it is discharged, if ever, by comparing two of them. A
caveat attached to a green claim is narration, and the silent-wrong-answer class §15 calls
load-bearing. What a matrix *did* establish toward such a claim is stated beneath it, so honesty
costs the reader no evidence.

The result is a durable artifact under `docs/proofs/`, one document per (version × revision),
citing the exact harness version, the **observed resolved model id** (§11.7), the package tree
digest — the working tree as it stood when the cells ran, which is before the document existed —
and §11.7's checkout metadata beside it, without which a digest of a tree that no longer exists
is unreconstructable. The runner is `tests/live/prove-skill-loading.mjs`, which lives there for
the reason every script in that directory does: it spends real turns and must never become a
suite. The judgement, the claim assessment and the document are `factory/lib/proof/`, held by
`tests/node/factory_proof_*.test.mjs`; what the runner itself owns is the wiring and the spending.

### 6.8 Trust, permissions, and isolation

**Trust.** The controller pre-trusts its own worktrees mechanically, per attempt — a factory
worktree contains only the operator's repo at a pinned commit, so auto-trust weakens nothing.
Claude: trust state written into the controller-owned config state file. pi: `trust.json` /
`defaultProjectTrust` in controller-owned scope. Each store is keyed the way its **own runtime**
keys it, canonical spellings included: pi resolves symlinks before keying the map and before
walking to the nearest ancestor entry, and a writer that did not put the two on different keys —
the pre-trust silently not applying, and the dialog firing (#178).

**Preflight proves that every key the pre-trust writer writes reads back through each runtime's own
resolution rule, so none of the dialogs those keys answer can reach a worker pane; such a hang is
an automation failure.** Read the scope literally, because it was once read wider than it is: the
check is a predicate over **controller-owned state**, and what it proves is exactly the set that
state settles. It does not, and cannot, cover an interstitial gated on anything else. The pi
sessions carry the trust-approval flag beside the store for the same belt-and-suspenders reason the
permission mode rides both the settings file and the flag.

**Interstitials exist that no controller-owned state can prevent, and they are caught by
attribution rather than by prevention (#178).** Some are gated on caches the harness warms itself
during an ordinary session; some on the contents of the **target repository**, which the operator
owns and may change between preflight and launch. Every one of them reaches an interactive worker
pane, and Herdr reports such a pane as settled or blocked rather than stuck — so a worker that
never got to start would otherwise be recorded as one that failed at its own job. The instances a
flag on the session binding can close are closed there, on the **worker binding**, and proven the
way §6.2's fences are proven: against the session a worker actually runs, with both sides run,
since an absence observed by a probe that could not have seen the write is not evidence. The class
as a whole is closed by §6.6's `worker-never-started` and §8.10's automation budget. **The list of
known instances is deliberately not written here**: keeping one current is the maintenance burden
this design exists to end, and a stale list yields a green check that proves nothing.

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

**Reviewer — belt and suspenders, attestation authoritative.** Claude reviewer: `dontAsk` mode +
`--disallowedTools Edit,Write,NotebookEdit` + deny floor, **and the same broad allows for the
tools it keeps**. `dontAsk` removes the approval workflow; it does not restore a tool named by
`--disallowedTools`. Plan mode is unusable in an unattended pane: Claude writes its plan through
`Write` and then enters `ExitPlanMode` approval, so combining plan mode with the required tool
withholding makes completion structurally impossible. A reviewer with no allow rules has a
second prompt path back, which is the failure this whole section closes. pi reviewer:
`--exclude-tools edit,write`, bash retained (needed for `git diff` / `log` and for the one
controller-owned outbox write). **The authoritative guard is the controller's attestation:**
capture clean-worktree + HEAD before review, verify unchanged after; a mismatch is a typed
`mutation-detected` failure. **An opening capture that is already
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
hooks.** The config directory alone does not close pi's skills channel — measured live (#160),
pi's default discovery reaches roots `PI_CODING_AGENT_DIR` does not fence: a worker session
with discovery on loaded four of the operator's personal skills from `~/.agents/skills` while
loading none of the pinned 65. Every pi worker session therefore passes `--no-skills` plus the
pinned `--skill` roots explicitly; the flags are load-bearing isolation, not probe hygiene.

**The same is true of Claude, from the other end — the session's own working directory.**
Measured live on Claude Code 2.1.233 (#163), at zero model cost, in a scratch project shipping
`.claude/skills/leaktest/SKILL.md`: an `initialize` control-request under an **empty** isolated
`CLAUDE_CONFIG_DIR` answered 44 commands including a bare `leaktest`, and a project
`.claude/commands/` file registered the same way. A worker's cwd is the attempt worktree — the
operator's repository at the pinned commit — so on any target repository shipping project
skills, every Claude worker would load skills from outside the pinned package root.
`--setting-sources user` closes it: the same request answered 43 commands with no `leaktest`,
and neither the project skill nor the project command registered in the run that shipped both,
while the §6.3 plugin's `<plugin>:<skill>` records, the injected `--settings` file, and
`--permission-mode dontAsk` were all untouched — the flag drops the `project` and `local`
*sources*, which is also what stops a target repository's own settings file from reaching a
worker, and never the settings the controller passes explicitly. Every Claude worker session
therefore carries those two arguments; like pi's, they are load-bearing isolation and belong to
the **worker** binding, never to the probe alone (§6.2's composed binding). What a run proved is
recorded on the `runtime-probe` check beside the version, since a green check saying nothing
about the fence cannot be told from one that never proved it.

**One consequence of that fence is stated rather than discovered later: the target repository's
own `CLAUDE.md` stops being auto-loaded too** — measured in the same pass (a one-turn session in
a project whose `CLAUDE.md` carried a marker word answered it unfenced and did not answer it
fenced). This is the channel list applied, not an accident: rules reach a worker through package
skills and the declared worker-context file, and a repository's own memory file was never one of
the two. The declared file is unaffected — it is installed in the **user** scope the fence
keeps — and the repository's conventions remain readable in the worktree as ordinary files. An
operator who wants a target repo's standing rules in every worker declares them through
`worker.contextFile`.

Procedurally valuable personal rules migrate through exactly two channels:

1. **Package skills** — the preferred home for engineering discipline. *Migration note:* the
   `tee`-over-`head`/`tail` output-capture rule belongs in this package's discipline skills.
2. **A factory worker-context file** declared in factory config, copied into the config
   environment at run start and hash-recorded in the run manifest.

**Live inheritance of `~/.claude` / `~/.pi` personal config is never a channel.**

**Capability promotion is a third channel, and it carries no rules.** The two channels above
govern *rules*; an empty config environment also removes things that are not rules and that the
factory's own model depends on — measured, not assumed: pi's `local` models are supplied by an
operator **extension**, so an isolated agent directory deletes a §9.1 resource class outright,
and §6.5's transcript pointer goes with the hook that pushes it. Two closed lists therefore
cross in:

- **Fixed capability artifacts**, named in code per runtime — credentials, the model
  catalogue, and §6.5's **agent-state integration**: the herdr-managed hook (Claude) and
  extension (pi) that push the transcript pointer. Nothing here carries behaviour, and this
  section already records that credentials are ambient on this host. The integration is
  recorded in the run manifest by declared path and content digest **and by the version
  observed out of the file's own header** — observed, not assumed — and its absence, missing
  version, or staleness is a **named preflight red per runtime in play**: the pointer has no
  other channel, so a run that could not carry it ends red before the first claim rather than
  null on every attempt.
- **Declared runtime extensions** (`worker.piExtensions`), defaulting to **none**, recorded in
  the run manifest by declared path **and content digest**, so what a run loaded is evidence
  rather than a claim about intent.

**The limit is enforced, not promised.** Skills reach a worker only from the pinned package
root: the live probe requires every `skill:<name>` command record in the session — not merely
the closure's — to resolve inside that root, so a promoted extension that registers a skill is
the same typed failure as a shadowed one. A promoted extension may add tools and providers; it
may not add skills, and it is never a route for personal rules. **Each runtime is held to that
limit by what its records can carry**: pi's command records name a source path, so its probe
judges the converse directly; Claude's name only the command, so its probe judges the same limit
by planting a canary project skill in the directory it probes in and requiring the fenced
session not to register it while an unfenced control session does. A canary that survives the
fence is `skill-shadowed`, naming the offending source; a control session that cannot see it is
`discovery-fence-unproven`, because a probe that could not have observed the leak is not
evidence of its absence.

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
  means mechanically. The attempt's own base answers exactly one question — *what did this
  attempt branch from* — and it is never the boundary of what §7.5 replays, nor what §8.4's
  review measures against: the values coincide only for a single-attempt execution, §7.5
  derives its replay set from the graph without consulting this one (#161), and §8.4 reads both
  ends of its diff off the passing verify record (#165).
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

> **Steps 1–4 execute at §8.1's `verify` phase, and steps 5–6 at its `integrate` phase.**
> §9.5 splits this sequence across the review and takes the integration lease twice, which is
> what puts the rebase *before* the checks — so §8.2's "at the exact post-rebase commit that will
> be pushed" needs no conditional re-check path. The steps are numbered together because they are
> one job; a rebase conflict at step 3 is therefore a `verify` result, and the same conflict met
> again by §9.5's compare-and-publish loop is an `integrate` one (§8.10 carries both rows).

1. **Fetch.** If the base moved — the branch no longer sits on the fresh tip, a fact read off
   the graph and never off an attempt's recorded base — **rebase** the attempt branch onto it:
   safe, because the branch is unpublished. **The upstream of the rebase is the fresh tip
   itself**, so the replay set is every commit the ticket execution produced that is not
   already on the base branch, however many attempts contributed to it (§8.5). An attempt's
   **own** base (§7.3) is the prior attempt's tip for a repair, and bounding the replay with it
   excludes the implement commit the repair builds on (#161). A rebase whose result carries
   fewer non-base commits than its input is **refused as a typed failure and never adopted**
   (§11.2), whatever the drop's mechanism: a branch that quietly lost a commit satisfies every
   downstream measure — §14.13 measures the commit being published, attestation compares heads
   — while publishing half the work.
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
  are **the only copy of that work**, so they are retained and pinned (§12.4) — and **§8.9's
  disposition comment names the branch and its head**, because a copy nobody can find without
  reading the private clone by hand is retained in name only.
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
- An advisory check may declare a unique **`feeds`** list naming agent-borne phases that receive
  its captured output on their next prompt. Absence means `[]`. A feed on a required check, an
  unknown phase, or `review` is invalid configuration: review consumes only the sealed
  attestation and diff snapshot (§8.7). `harden` becomes valid when that agent phase exists;
  until then it is unknown and refused.

After each check execution the controller stores stdout and stderr as a content-addressed blob
and appends an execution-scoped ledger reference. Prompt construction resolves only advisory
checks explicitly feeding the current phase and places their digest-labelled output in a
controller-owned trusted-evidence section that says the content is **data, not instructions**.
Raw output is never interpolated into the ticket/specification body, and unfed advisory output
is absent from prompts. Repair attempts are `implement` attempts, so only an `implement` feed
applies to them.

The repository's own declaration demonstrates three advisory recipes: Python mutation via
Mutmut, Node mutation via Stryker's command runner, and method-level Python CRAP via coverage.py
JSON joined to Radon complexity by `scripts/crap.py`. Mutmut reports survivors while exiting
`0`; the recipe therefore declares no expected-failure exit. Stryker and the CRAP joiner use
`1` for a score below threshold; other exits are automation failures where the tool can make
that distinction. A JavaScript repository's CRAP-equivalent recipe is Istanbul/nyc routine
coverage joined to ESLint cyclomatic complexity with the same
`complexity² × (1 − coverage)³ + complexity` rule. These are explicit recipes, never inferred
commands.

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

**The spec axis is briefed with the builder's requirement trace (#189)** — §6.6's `trace`, read off
the reviewed attempt's own implement record, never a parameter, for the reason the boundary below
is not — rendered inside the prompt's delimited untrusted block, the same computed boundary §8.5
quotes reviewer findings in. Its prompt asks it to check the trace against the ticket: a ticket line
no row addresses is a `blocking` finding citing the ticket line, and a row whose evidence the diff
does not bear out is a `blocking` finding citing the row. **The reviewer, not the controller, is the
judge of truth**: the controller has held the trace to its shape and to nothing else, and a
controller that checked a row against the snapshot would be a third reviewer with no verdict slot.
The standards axis is not briefed with it — coverage of the ticket is not its axis, and a second
reader of the trace would be the cross-axis ranking above. Which axis renders the trace is the
role's own expectations, read by the template; the fan-out hands every axis the same context. A
review reached with no trace on the implement record refuses rather than briefing the axis blind.

**The two axes are routed independently, and a fan-out that could only fill one says so** (#155).
Each axis dispatches through §11.5's order for **that axis**, so §9.9's reroute walks each down its
own escape rather than letting one axis's choices constrain the other's, and an axis with no routable
profile releases the ticket execution rather than minting an attempt nothing could launch. Where the
reroute does leave one profile between them, **that is a stated condition of the verdict**: two axes
on one profile is a legal outcome, and a run arriving there on its own — as opposed to an operator
writing the same name twice, which §11.5 makes them do visibly — must be recorded, or the verdict
presents two independent reviews where two runs of one model happened. The condition rides each
axis's own result and therefore §8.7's attestation; it is deliberately kept **off** the rejection's
detail, which §8.5 quotes whole as the reviewers' words.

**The diff both axes read is the publishable diff, and both of its ends are the passing verify
record's.** That record's base is the fresh base-branch tip the branch sits on after §7.5's
step-1 rebase — the boundary of what will be published — and its head is the exact commit
§8.2's checks passed at, so the review and the checks measure one value (§14.13). When §9.5's
compare-and-publish loop later re-rebases onto a base that moved during review, the verdicts
keep naming the boundary they were rendered against (§8.7) rather than implying they covered
the moved one. A walking attempt's **own** base (§7.3) is the prior attempt's tip for a repair
(§8.5), and a review diffed from it would brief both axes on the repair's delta alone while
their verdicts gate the publication of the whole chain — §8.7 would then record approvals whose
scope is a subset of the published change (#165). A repair's re-review therefore covers the
whole chain by construction, and neither end of the diff is a value a caller can supply.

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

**"Every resume is a fresh attempt" is a statement about worker attempts.** §8.10's automation
`retry` is not one of the two tiers above — the automation failed rather than the work, so it
rebuilds nothing and re-enters the phase it left — and what it mints depends on whether that
phase has a worker:

- **An agent-borne phase** (`implement`, `review`) mints a fresh attempt, because a worker runs
  again. `implement × dead-worker` relaunches the builder from the prior attempt's tip under the
  profile already dispatched: nothing was judged, so nothing is discarded and nothing is
  re-routed. §8.4's fan-out mints one axis attempt per reviewer try, which is the same rule one
  level down.
- **A controller phase** (`harvest`, `verify`, `integrate`) mints **nothing**. §8.8 says these
  phases have no worker, so an attempt id here would be a row in the `attempt` projection with
  no pane, no worktree, and no manifest behind it — an object the whole of §6 says does not
  exist. The phase is re-entered under the attempt already being walked, at the next **try**
  (§8.10's fifth key slot), and no retry seam is asked.

The consequence worth stating rather than deriving: **a walking attempt is always a builder
attempt.** Every retry that mints re-enters `implement`, and every retry that does not mint
leaves the attempt where it was, so the attempt a phase is walked under and the attempt whose
branch it publishes are the same one.

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

**N is `budgets.circuitBreaker`**, declared beside the three retry allowances and defaulting to
2. It is **bounded below and not above**, and that asymmetry is the point: the other three are
allowances *one ticket* may spend, and the 2 + 2 ceiling keeps a repair chain finite, while N
counts *ticket executions* that failed consecutively before the run stops claiming. Borrowing
the retry ceiling would cap a run's tolerance at 2 for a reason that does not apply to it. The
floor is what matters — at 0 the breaker would trip on a run that has failed nothing.

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
duration, and required flag; **both** review verdicts with blocking **and** advisory findings,
each naming the base and head it was rendered against (§8.4, #165); and the before/after HEAD
guard result.

A summary lands in §7.5's machine-parseable PR-body block and in the ticket comment — advisory
findings surfaced there, blocking findings never. This is what makes "the controller verified
this" a **checkable claim** rather than a policy statement.

Mechanical check stdout/stderr is also immutable artifact evidence: each execution gets its own
effect identity, the bytes are stored by SHA-256 digest, and the artifact ledger is the only way
a later fed phase resolves them. Fed advisory output is therefore controller-captured evidence
selected by policy, not worker-authored review prose (§8.2).

### 8.8 Taxonomy — three levels

**Attempt outcome** (one worker run).
Worker-writable: `completed` · `needs-human` · `worker-failed`.
Controller-derived: `invalid-result` · `no-result` · `dead-worker` · `timeout` ·
`wrote-but-hung` · `cancelled` · `automation-failure` · `provider-refused` (#154 — the
provider's fault, so §8.10 charges no budget for it) · `worker-never-started` (#178 — the pane was
never observed working, so the attempt had no turn to end; the automation's fault, and §6.6's
predicate over durable observation records is what answers it).

#155's **`routes-exhausted` is deliberately not in this enum**: no attempt has it, because it is
what the walk answers *instead of* minting one. It is one of §8.10's phase-less rows, beside the two
budget exhaustions it is shaped like — *the run ran out of something this ticket needed* — which is
also what makes it reachable from `verify` and `integrate`, whose fresh-retry is routed while they
have no attempt for an outcome to belong to.

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
machine-parseable comment block: identity tuple, outcome chain, evidence references by digest,
**what actually did the work**, and **the ticket execution's attempt branches, read from the
private clone at settlement**.

**The fourth element is #155's dispatch read**: every attempt with its role, the profile it ran on,
what §11.5 declared for it, and why they differ. §9.9's reroute runs a profile other than the
declared one, and a disposition naming neither would leave a green ticket unable to answer *what
wrote this?* — which is the whole reason §6.5 re-asserts a declared model against the observed one.
It is `null` for the two pinned rows rather than a copy of the profile: §8.5's repair and §8.10's
automation retry made no dispatch decision, and saying they declared what they ran would read as a
routing that happened to land where the pin already was. Unlike the branch read below it, it is a
pure function of durable state and therefore rides the **digested intent**: a re-entered settlement
recomputes it exactly.

**The branches are on the block because §8.10 harvests what an outbox claims, and an
attempt that never wrote one has still created a branch** — routinely carrying real commits, and
under §7.7 the only copy of them. So every attempt of the execution is named with its branch, the
head git answers *now* (§5.2, never the outbox's claim or the mint's record), and its commit
count against **its own** base (§7.4). It is read for every disposition and every attempt
outcome rather than for the endings that harvest nothing: a list of which outcomes those are is a
list somebody extends without extending, and the failure it permits is silent — "nothing was
built" reported over work sitting on a branch. Every answer the read can get is distinguishable
from every other, and none of them is spelled as the absence of another (§11.2): commits, no
commits, no branch, no answer from git, and no base recorded to count against — with **the
attempts not listable** and **no read at all** distinct from all five.

**The read rides the comment and not the digested intent.** §4.5 compares an effect's payload
digest, and every other field of the block is a function of durable state — so a re-entered
settlement recomputes it exactly, while a branch head is a fact about the world at the moment of
reading. Digesting it would make an ordinary §10.4 re-entry that read a moved head a payload
conflict instead of returning the comment already posted. **§9.6's abandon boundary settles like
every other ending** (#159): the in-flight executions it marks `released` in the journal drop their
claim, state the release, and add no label — the row above, applied by the one module that applies
it. An abandon is also where the read matters most, since it catches builders mid-work whose
commits §7.7 leaves on a branch and nowhere else.

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
| implement | `invalid-result` | fresh-retry, the controller's schema and role problems presented as fact | repair |
| implement | `no-result` | fresh-retry | repair |
| implement | `timeout` | fresh-retry | repair |
| implement | `wrote-but-hung` | harvest the valid outbox, stop the agent, record the anomaly | — |
| implement | `dead-worker` | retry | automation |
| implement | `automation-failure` | retry | automation |
| implement | `worker-never-started` | retry (§6.6 — outranks the `no-result` and `timeout` rows above) | automation |
| implement | `provider-refused` | §9.9 reroute to the next routable profile, §9.8 memo recorded | — |
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
| review | reviewer attempt `provider-refused` | §9.9 reroute down **that axis's** order, §9.8 memo recorded | — |
| review | `routes-exhausted` | `released` (§9.9 — the axis has no routable profile; no attempt is minted) | — |
| review | reviewer attempt `cancelled` | `released` | — |
| review | reviewer attempt `worker-failed` · `invalid-result` · `no-result` · `dead-worker` · `timeout` · `automation-failure` · `worker-never-started` | retry | automation |
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
- **`reroute` is the one action that spends nothing and is still not free of a bound** (§9.9). It is
  not one of §8.5's tiers and not the automation retry: nothing was judged and nothing broke, so it
  asks neither question. What bounds it is that each profile §11.5's order names is dispatched at
  most once per ticket execution, which makes the chain at most as long as the declared order with
  no counter to keep. Giving it a budget key that charged nothing would put a hole in exactly the
  property that makes an unbounded retry unconstructible.
- **`integration-red` disposes where `verify × failed` repairs**, though both are the same rerun
  reporting the same fact about the same kind of commit. What differs is what has been spent and
  what the red result is *about*: a red verify is the worker's own work failing at its own base,
  which is exactly what §8.5's repair is scoped to, while this work passed its verify **and both
  review axes** at that base and what changed is the world it lands in. A repair would restart
  the whole pipeline, two model calls included, to answer a question nobody asked the worker.
  It is §8.3's `baseline-red` one phase later — the required set red at a commit no worker chose
  — and it **consumes no budget**, which is what keeps §15's case 10 intact: the loop spends
  nothing and this is the exit from it rather than another lap. It carries a **reason class and
  no automation fault**, so §8.6's "product-level outcomes never trip the breaker" holds by
  construction: two changes that each pass alone and do not compose is not a broken host, and
  stopping the run over it would point an operator at infrastructure that is working.
- **The compare-and-publish loop is bounded, and hitting the bound is `push-failed`.** A base
  that moves on every pass is a repository under continuous merge, and an unbounded loop there
  holds the integration lease indefinitely while reporting nothing — which is the throughput
  failure §9.5 exists to prevent, arriving from the other direction. The bound is a small
  constant rather than configuration: it is not a policy anyone tunes, it is the point at which
  "the base keeps moving" stops being a race and starts being a fact about the repository.
  `push-failed` is the honest row for it because no push was attempted and nothing about the
  work is implicated, and §8.10 retries it on the automation budget — a later pass may well
  find a quiet moment.
- **A `rebase-conflict` consumes a fresh-retry, not a repair**, because the prior tip is
  precisely what conflicts. A second conflict is `failed` / `rebase-conflict`, and **the
  controller never attempts automatic resolution**, which would put a model inside a controller
  phase. It appears under **two phases** because §9.5 puts a rebase in each: `verify` opens with
  one, and `integrate`'s compare-and-publish loop redoes it when the base moved again. The row is
  the same in both.
- **`wrote-but-hung` is not a failure.** The outbox is valid, so harvest it, stop the agent as
  routine shutdown, and record the anomaly.
- **A `timeout` carries which clock fired (§6.6).** The two clocks share the one outcome word;
  `attempt.ended`'s `clock` field names `no-progress` or `deadline`, and its `last_progress`
  names the last observed fact. A no-progress timeout reached while the controller's observation
  channel was degraded is recorded as `automation-failure` instead, so the worker tier's budget
  is never spent on a controller that stopped observing.
- **The whole table is re-enterable.** Reconcile replays it from durable state after a crash
  between an external effect and its recorded resolution, which §7.7's end-to-end idempotent
  integration makes safe.
- **A stage result's semantic key is `(run, ticket, phase, attempt, try)`** — §2.1's stage
  identity, the attempt it was resolved under, and which pass through the phase it was. The last
  two slots cover the two ways a phase is legitimately entered twice, and they are two slots
  because the two ways are different things. **Attempt**: §8.5's repair re-enters a phase under a
  new attempt, so a key without that slot would read every repair as the conflicting duplicate two
  rows above, and a working pipeline would fail itself. **Try**: an automation retry of a
  *controller* phase mints no attempt (§8.5, §8.8), so the attempt slot cannot vary — and without
  a slot that can, the re-entry reads its own recorded result straight back and routes to the same
  row forever. `try` is `1` for every stage but a controller phase's re-entry.
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

**Abandon** — a second `stop` or `SIGTERM` — stops issuing new effects **about the work**, marks
in-flight ticket executions **`released`**, releases their slots, and **leaves worker panes alive
for the next reconcile**. Nothing is relaunched and nothing new is claimed; §8.9's `released` row
is still applied to each of those tickets, because giving a claim back is the settlement of work
already given up on rather than new work, and a claim left standing under an unanswered claim
comment reads to a human as a run still working (#159). Every in-flight execution at that boundary
is a claim the run holds, and **§3.3's contest loser is what makes that true rather than assumed**:
it assigned before its re-read told it the claim is somebody else's, so it settles its own row
`released` — journal only, since §3.3's loser leaves the tracker exactly as it is, and
un-assigning there would clear **the winner's** claim, which is one field with the loser's.

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

### 9.8 Provider exhaustion — a time-boxed capacity state (#154)

A provider that refuses for quota or rate reasons is a typed fault of its own, and the refusal is
remembered with an expiry. Before this, the worker started, was refused, wrote no outbox, and §6.6
recorded `timeout` or `no-result` — charging the **worker's** repair budget for the **provider's**
refusal and ending with a `factory:failed` label a human had to clear; the next ticket routed to the
same class rediscovered the same refusal, spending a launch and an attempt window each time.

**Detection (§6.6).** The refusal is an observed fact, never an inference from elapsed time: the
pane output is matched against a signature vocabulary read off the harnesses' own non-retryable
limit classification (quota, rate-limit, usage-limit, available-balance wording — transient faults
deliberately absent), matched in the output's tail. It is recorded as its own `observation.recorded`
fact (`provider.refusal`, source `herdr`, §5.2) and becomes the attempt outcome `provider-refused`,
which overrides the three silence-based verdicts — `no-result`, the no-progress clock, and the hard
ceiling — when the last visible output is a refusal. A valid outbox still wins, and a pane that died
is `dead-worker` still.

**The memo belongs to capacity, not to routing.** It is recorded as an unavailability of the
**resource class**, not a routing preference: an observed fact belongs in the journal, never in the
config file. Two events, both on the `controller` stream with no run in the envelope, because the cap
belongs to the provider and outlives any one run: `capacity.exhausted` (the class is unavailable
until `until`, with the observation in the payload) and `capacity.admitted` (a probe re-admitted it).
The latest record per class decides, and §9.7's saturation surface carries the memo per class.

**Dispatch consults the memo.** A lane is not launched into an exhausted class before its expiry —
the scheduler gates each candidate on it before the §9.4 acquisition, and an in-pipeline attempt
waits on it rather than rediscovering the refusal. **An expiry that has passed re-admits the class
by probe, never by assumption** (§5.2): one cheap completion on the class under the worker binding
(#160's rule) answers `admitted`, `refused`, or `inconclusive`. Only an admission clears the memo; a
refusal renews it for the full window, and an inconclusive read holds the class on a short window
rather than opening it on nothing observed.

**§8.10 charges no budget for it.** `provider-refused` routes to a budgetless `released` for a
builder and for a reviewer alike: the ticket goes back to the frontier untouched — no label — and the
memo is what keeps the next claim out of the exhausted class. A run left holding claimable work
whose every route is memo-locked at its final scheduling decision ends `capacity-exhausted` (exit
9) — even when other classes finished their tickets — saying so plainly in a classified per-member
report rather than draining as though the work were done (§9.7's green-looking run that did nothing). The
memo is the input §9.9's rerouting consumes; nothing here chooses a different profile.

### 9.9 Dispatch reroutes around an exhausted class (#155)

§9.8 remembers that a class is unavailable and holds dispatch off it. Holding is the right answer when
the class is all a role has; it is the wrong one when the operator wrote down somewhere else to go, and
a run that waits an hour for a daily cap to roll has turned one quota blip into an idle afternoon. **A
role whose profile belongs to an exhausted class dispatches to the next routable profile instead**, and
this section is that step.

**The order is declared, never inferred.** §11.5's routing gains an optional `fallbacks` block: a
per-role order of profiles dispatch may take next, with **review's declared as two orders, one per
§8.4 axis**. Every order an inference could produce — the profiles block's key order, the class sizes,
"any profile the routing reaches" — is defensible, none of them is the operator's, and the first quota
blip is a poor moment to discover which one the code picked. **An unknown profile name is a load error**
(§11.3), never a silent fall back to the default; a repeat within one order is one too. An absent block
is the empty addition, in the shape §6.8's `worker` block already has, and a routing that declares none
dispatches exactly as it did before this existed.

**A route is one decision, made once and recorded once.** §11.5's dispatch and §9.8's memo are one
question — *which profile may this run spend, and from which pool* — because the class names the slot
pool §9.4 takes from and the profile names what §6.5 mints. Deriving them separately is how a lane comes
to hold a slot in a pool its worker never touches. The scheduler makes the decision **before the claim**
and it travels with the lane; nothing downstream resolves the routing again, because the memo moves.

**A launch reads the mint, never the decision it just made.** The mint leaves an existing record exactly
as it is, so a controller that died between minting an attempt and running it re-enters, re-resolves
§11.5 against a memo that has since moved, and would otherwise launch under a profile the record does
not name — leaving §8.9's block naming a profile that did not do the work, which is the hole this
recording exists to close. The record is the answer to *what is this attempt* (§14.1), on every path.

**The substitution is never silent.** §6.5 and §11.5 re-assert a *declared* model against the observed
one precisely so a run cannot behave differently from what was declared, and a reroute is such a
difference. So the decision is a first-class record on the attempt's mint — what was declared, what ran,
why they differ, and every candidate passed over with the state that passed it over — and §8.9's block
names what actually did the work. A green ticket that cannot answer *what wrote this?* is the auditing
hole this exists on the right side of.

**The worker is not charged for the provider.** §8.10's `provider-refused` rows route to a **`reroute`**
action: the same work, on the next profile, on **no budget at all**. It is an action of its own rather
than a retry with a null budget, because the action→budget map is what makes an unbounded retry
unconstructible and a fourth key in it that charged nothing would put a hole in exactly that property.
**What bounds it is that each routable profile is *refused* at most once per ticket execution**, derived
from the journal — the attempts whose stage §8.10 routed to a reroute — so the bound and the spend are
one expression, as §8.6's budgets already are, and there is no counter to declare, forget, or lose to a
crash. **Refused, not merely dispatched**: an automation retry relaunches the same work on the same
pinned profile, so a profile a retry ran is not spent, and excluding it would turn every infra flake
into a silent model change — on a routing with no fallback, into a released ticket.

**Running out is its own typed outcome.** `routes-exhausted` (§8.8) is what the walk answers when every
profile a role can reach is memo-locked, and §8.10 settles it as a budgetless `released` — §9.8's answer
unchanged: no label, the ticket back on the frontier untouched, and the memo keeping the next claim out.
It is a word of its own rather than a second meaning for `provider-refused` because the two ask for
different things: *this provider is out* is answered by rerouting and *the run is out of providers* is
answered by waiting, and `released` writes no comment, so the outcome on the terminal record is the only
thing telling them apart. It is likewise not a `failed`: filing a provider's daily cap as an
investigation would end that investigation at "wait".

**The memo is class-scoped, and that is load-bearing here.** Two profiles naming different presets on
one endpoint share a slot pool because they share one GPU (§9.1), so they also share one refusal:
rerouting between them buys nothing, and the record says so by naming each candidate's class rather than
pretending the second is a different resource.

**§8.4's two axes reroute independently.** The fan-out dispatches per axis through the axis's own
declared order, so an exhausted class walks each down its own escape rather than one axis's choices
constraining the other's, and an axis with none releases **without minting an attempt** nothing could
launch. Where the reroute does leave one profile between them, the verdict says so (§8.4).

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

**Run outcomes: seven run end reasons plus one controller exit outcome.** Every ended run
carries a mandatory `end_reason` drawn from the seven; `lease-lost` is the eighth row of the
published table because it is a real exit code a caller can receive, but it is the controller
*process's* own exit outcome and never a run's recorded `end_reason` — the run it leaves
behind is open. One table publishes all eight rows so a script reading it finds every code:

| Outcome | Exit code | Meaning |
|---|---|---|
| `drained` | **0** | the scope drained; nothing left claimable |
| `baseline-red` | **2** | the required preflight set was not green; names the red check, including a required baseline check when that is the one that failed |
| `stopped-by-operator` | **3** | a `stop` request was honoured at a ticket boundary; in-flight lanes finished |
| `abandoned` | **4** | a second `stop` or `SIGTERM`; in-flight lanes `released`, panes left alive |
| `circuit-breaker` | **5** | N consecutive automation failures in terminal-commit order |
| `capacity-exhausted` | **9** | claimable work remained whose every route is §9.8's memo-locked at the final scheduling decision — work the run cannot spend, not a drained scope, whatever other classes finished |
| `lease-lost` | **6** | **controller exit outcome, not a run end reason**: the controller process lost its lease and exited without reacquiring; the stale process leaves the run open rather than self-authoring an unfenced `run.ended`, so this row is **only** an exit code and never a run's recorded `end_reason` |
| `controller-lost` | **— (none)** | **asserted only by a different controller or the monitor**, never self-asserted, so it can have no exit code |

Exit code **1 is reserved for usage and config-load failure** — those happen *before* a run
exists and therefore have no end reason. Codes **7** and **8** are verb-level markers for a
command that never reached a run (`not-implemented`, `refused`), deliberately outside the
end-reason range so no caller reads one as a run outcome — which is why `capacity-exhausted`
sits at **9** (#154).

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
- **`--baseline` executes all declared checks**, including advisory mutation and complexity
  recipes, inside §7.1's factory-private clone in a **throwaway worktree** — never the
  operator's checkout. Only required failures make the baseline gate red; advisory results are
  reported with their severity.
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

- **`routing` gains one optional key, `fallbacks`** (§9.9, §11.5): the declared order dispatch
  reroutes down when a role's profile belongs to a class §9.8's memo has locked. It is a block of
  *additions*, so its absent form is the empty addition — the same shape `worker` has — and an
  unknown profile name inside it is a load error rather than a silent fall back to the default.
- **The label vocabulary is code constants, not config** (§3.2).
- **`completion` is deleted entirely.** All four knobs (`closeAfterIntegration`, `finalMerge`,
  `createPullRequest`, `deploy`) now have exactly one legal value, three of them protected by
  §6.8's un-crossable hard floor. **A setting that cannot take its other value is a lie about
  what the system will do.**
- **`herdr.maxWorkers` is deleted** (superseded by §9). **`retry` → `budgets`.**

### 11.4 Profiles and permissions

Profiles carry `kind`, `model`, and optionally `effort` / `thinking` / `startupTimeoutMs` /
`attemptTimeoutMs` / `noProgressTimeoutMs`, where omission means "don't pass the flag" — safe
because non-passing is a **recordable observation** in the handshake, not an inference. The
last two are §6.6's two clocks, each with a code-owned default when the profile does not
declare it.

**`permissionMode` is removed from author control.** Permissions derive from the **role** a
profile is bound to at dispatch. Both Claude postures use the non-interactive `dontAsk` mode,
but the reviewer posture additionally withholds `Edit`, `Write`, and `NotebookEdit`; a profile
cannot remove that withholding or the §6.8 before/after mutation attestation. Altering
permissions requires a declared, manifest-recorded per-run override that can never cross the
hard floor.

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
- **An optional `fallbacks` block declares §9.9's reroute order** — per role, the profiles dispatch
  may take next when the one the role resolves to belongs to a class §9.8's memo has recorded
  unavailable. `implement` and `freshRetry` declare one order each; **`review` declares two, one per
  §8.4 axis**, so an exhausted class cannot quietly walk both axes onto the same profile with nothing
  in the config saying it could. An **unknown profile name is a load error** and a repeat within one
  order is one too. **Absent means no alternate route** — the empty addition in §6.8's `worker`
  block's shape, not a default anyone chose, because there is exactly one thing an undeclared reroute
  order can mean. A fallback profile **counts as reached by the routing** for §11.6's sizing and
  reachability rules and for §6.2's per-profile proof: a reroute dispatches into its class and takes a
  slot from that class's pool, so discovering it unsized at the moment a quota blip makes it the only
  way forward is the one moment the load-time refusal exists to be earlier than.
- **Repair and §8.10's automation retry stay unrouted under a reroute too.** Both are pinned to the
  originating attempt (above), and a reroute changes the profile without asking either tier's
  question — nothing was judged, a provider declined to serve the attempt, and the work has to happen
  somewhere else.

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
about.** An optional `feeds` field defaults to `[]`; it is a unique list of agent-borne phases,
valid only on advisory checks, and refuses unknown phases and `review` (§8.2).

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
  error, never an assumed 1. **Reachable includes §11.5's `fallbacks`**: §9.9 dispatches into a
  fallback's class and takes a slot from that class's pool, so an unsized one would surface at the
  moment a quota blip made it the only way forward.
- A class reachable from any **declared named set** **may** have one, so sizing `local` today
  does not break the loader when the set is switched tomorrow.
- A class reachable from **no** set at all is a load error: dead config that lies about what
  will run.

**Defaults exist only where an upstream decision already fixed the value:** `budgets.repair`=1,
`budgets.freshRetry`=1, `budgets.automation`=1 (ceiling 2+2), `budgets.circuitBreaker`=2 (§8.6's
N — floor 1, and **no ceiling**, because it counts ticket executions rather than one ticket's
retries), `retention.fullDetailRuns`=20,
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
  own files, excluding `node_modules`, `.venv`, `__pycache__`, and VCS dirs (derived trees that
  belong to the installer, the interpreter, and the VCS, not to the package) — **authoritative
  uniformly for every install shape**, with git commit and a dirty-worktree flag recorded as
  **metadata only**.
  `.venv` is `node_modules` under uv's name, and is listed for one measured reason (#115):
  `uv run pytest` — a mandatory command in this repository's own `AGENTS.md` — took the digested
  file count from 862 to 6525, so an agent who had run the suite pinned a different revision than
  one who had not, for byte-identical package files.
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
as "work in progress". At execute time each pane is **re-probed for its factory token**
and refused if that token now belongs to a non-terminal attempt. **A pane carrying no factory
token is never a target under any circumstance** — the factory does not own panes it did not
create.

The token is `FACTORY_ATTEMPT` on a worker pane and `FACTORY_RUN` on the controller's own, which
no attempt can name (#118). The controller stamps its own pane only where the **launcher made
it** — declared as `FACTORY_CONTROLLER_PANE` in the workspace's environment — because
`HERDR_PANE_ID` is set in the operator's terminal too, and a `--foreground` start must never
leave their shell reclaimable.

**Cleanup's own effect records are repo-scoped**, every identity slot `-`, with the target's
identity in the operand. That is what puts them on the `controller` stream: §4.3 refuses a
run-slotted record anywhere but that run's own stream, and a cleanup record living inside a run
stream would be deleted by the expiry of the run whose reclamation it documents.

**Orphaned blobs need no TTL.** `cleanup-execute` holds the controller lease, so no controller is
writing; under that lease a blob with no committed ledger row is unambiguously a crash leftover.
A grace period here would be the rejected stale-plan clock all over again.

**Scope.** The whole eligible set by default, narrowable with `--run=<id>` and
`--kind=<target-kind>`. The digest re-derivation covers whatever the plan actually contains, so a
narrowed plan is a first-class plan rather than a subset of a bigger one. **The default being
*everything* matters:** an operator reclaiming space should see the full picture including the
skips.

Both values ride the flag rather than the following token (#118): the verb is not known while
the line is being read — flags may precede it — so a flag that swallowed the next word could not
tell a run id from `cleanup-execute`'s plan digest.

**Crash mid-execute needs no resume logic.** Deleting a worktree is a mutation outside the
database and therefore an effect (§4.5), keyed `-/-/cleanup/-/<operation>/<operand>` with a
trivial probe. A crash leaves requested-but-unresolved effects; the next reconcile settles
them by re-probing. Cleanup's own actions land on the `controller` stream, auditable after the
fact.

**The plan is enumerated from the world and judged by durable state**, never derived from records
alone: expiry deletes a run's tier-1 detail, so a planner reading only records would never look at
that run's worktree again. `cleanup-execute` therefore runs cleanup **before** §12.6's folded-in
expiry pass, for the same reason.

**The deletion carries no force either.** `git worktree remove` is issued without `--force`, so
git applies the untracked-work guard a second time at the moment it acts — covering the window
between the plan's re-derivation and the deletion, which no digest comparison can. The guard
covers **every** whitelisted worktree, a `doctor --baseline` throwaway included.

That is not §12.7's retention restated, and the difference is worth being exact about. §12.7
retains a red baseline against **eager** deletion, which is automatic and unreviewed; a red
baseline whose checks left nothing on disk is still clean, and cleanup will therefore offer it.
What protects it there is the pair itself — it appears in a plan the operator reads, and
`--kind` narrows any plan that should not contain it. A guard that read the check outcome
instead is not available: `doctor` appends nothing to the journal in either mode (§14.24), so
there is no durable record of which baseline went red.

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

**Refined by #97's corrections:** the published table keeps its eight rows (seven run end
reasons — #154 added `capacity-exhausted` — plus the controller exit outcome), but the union is no
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

**The stop is the harness's own quit sequence, and its shape is two `send-keys` calls** — `esc`,
a short settle, then `ctrl+c ctrl+c` together — because Herdr exposes no `agent stop` (#107) and
because the grouping is what decides whether a worker quits at all (#158, measured in
`tests/live/herdr-agent-quit-sequence.mjs`). Sent as one call, the sequence quits an *idle*
harness but is absorbed by a *working* one as a bare turn interrupt: the turn stops, the
interrupted prompt returns to the input box, and the agent stays resident — the state three
attempts of run `01M0859CJAA1Z8XK41756H5Y30` were left in. The two `ctrl+c` must nevertheless
stay in one call: the exit affordance is a double press with a window under a second, and spaced
beyond it nothing quits at all. **A timeout arrives by definition at a working worker**, so the
mid-turn case is the normal one and the idle case is the exception.

**The cost is accepted explicitly:** an agent that ignores `agent stop` leaves a wedged pane that
survives the run. That pane is recorded as an anomaly and reclaimed later through
`cleanup-plan`'s live-pane guard (§12.8) — never killed as a side effect. #86's reasoning for the
controller's own pane (closing it destroys the classified drain report an operator looks at
first) applies identically to workers: **a wedged pane is evidence.**

The same holds one level up. §6.4's run-scoped workspace and the attempt tabs inside it are
**left exactly as found**: the controller closes no pane, no tab, and no workspace, and the run's
workspace survives its run for the operator to read and for `cleanup-plan` to reclaim.

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
27. **A pane carrying no factory-stamped token is never a cleanup target**, and **the
    controller never closes a pane.** The token is `FACTORY_ATTEMPT` on a worker pane and
    `FACTORY_RUN` on the controller's own, which §12.8 whitelists and no attempt owns (#118).
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
15. Second stop ⇒ in-flight lanes `released`, slots freed, panes left alive for reconcile, and
    each of those tickets' claims dropped and stated on the tracker per §8.9's `released` row.
    A lane that lost §3.3's claim contest is not one of them: it settled itself when it lost, and
    un-assigning there would clear the winner's claim.
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
overlapping `labelsAny` rules · a ticket matching two rules for one role · Opus/Fable on pi · **a
profile flag the installed binary no longer accepts under that spelling** (#164).

**Skill loading.** A **one-time acceptance matrix** per (harness version × model × package
revision) proving that Opus and Fable actually load and follow skill bodies — discharging the
survey's explicitly unverified claims. Discharged by §6.7's mechanism (#115): a receipt against a
per-cell nonce whose token and transform live only in the shipped body, three cells per model
(direct invocation · model invocation · trace control), every cell under the **worker** binding,
and one recorded document per (version × revision) under `docs/proofs/` naming which survey claims
it discharges and which remain unverified. **The claims it does not discharge are named there too**
— a matrix that only listed its wins would be the survey's own omission repeated.

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
| 2026-08-16 | #111 implementation corrections, all six found while counting §8.6's budgets. **The product budget is two declared numbers, not one pool of 2**: §11.6 declares `repair` and `freshRetry` separately because §8.6 grants them separately, and one pool would let a ticket take two repairs and never the fresh-retry that discarding the work was for. **Nothing increments** — a spend is a count of the stage resolutions that charged that budget, so the bound and the count are one expression, and a controller that died between resolving a failing stage and minting its retry reads the same count back. **An automation retry re-enters the phase it left**, while the two tiers re-enter `implement`: §8.5 governs the tiers, and rebuilding good work because a pane died is exactly the infra flake §8.6 refuses to charge the builder. **§8.6's N is `budgets.circuitBreaker`**, a fourth declared number in the block §11.3 already lists, defaulting to 2 — bounded below and **not above**, because the 2 + 2 ceiling bounds the retries *one ticket* may spend while N counts *ticket executions*, and borrowing it would cap a run's tolerance at 2 for a reason that does not apply. §11.8's migration leaves no hole for it: a v1 file had no breaker concept, so there is nothing to carry and nothing an operator must decide before the factory will run. **The breaker's verdict is monotone** rather than trailing, because §3.5 lets in-flight lanes finish and one settling `published` must not erase the reason the run stopped claiming. **Automation-versus-product is the disposition's own `fault`**, recorded on the terminal-commit record — matching a list of reason classes instead would make every class added to §8.8 later a silent vote on whether runs stop, which is also why `ticket.disposition-changed` moves to payload v2 (§4.3) **and why the breaker branches on that version** rather than trusting the bump alone — a pre-v2 record cannot be classified, so it breaks the streak and is counted as unread rather than read as a product verdict. Two wordings were made unambiguous rather than changed: the **hard ceiling of 2 + 2 is 2 on each declared number**, since the other reading puts the shipped default at its own ceiling and leaves a knob that can only be redistributed, which is the refusal-to-have-a-knob this section rejects; and an **operator's stop outranks the breaker**, because both drain identically and the human who typed `stop` should be told their stop was honoured. | #111 |
| 2026-08-16 | #113 implementation corrections, all four found while publishing §7.5's first pull request. **§8.10 gains an `integrate × integration-red` row and §8.8 the controller-derived class of the same name**: §9.5's compare-and-publish loop re-rebases onto a base that moved, and nothing named the case where the required set then comes back red on the result. Forcing it into `predicate-failed` would file it as an automation fault, and §8.6 is explicit that **product-level outcomes never trip the circuit breaker** — two changes that each pass alone and do not compose is not a broken host, and stopping a run over it points the operator at infrastructure that is working. Named after §8.3's `baseline-red` because it is the same fact about a different commit; it disposes and consumes nothing, since the same base conflicts the same way and a retry buys a second identical answer. **§8.10 gains a `verify × rebase-conflict` row, and `verify`'s result domain grows with it**: §9.5 puts the rebase *inside* that phase — "acquire for `rebase + verify`, release across `review`" — which is exactly what makes §8.2's "the required checks always ran at the commit being published" hold with **no conditional re-check path**, so a rebase that cannot be replayed ends `verify`. The `integrate` row of the same name stays reachable through the loop's second rebase, and the routing is identical in both. **The integration worktree is detached, and the branch is moved by a compare-and-swap**: the attempt's own worktree holds that branch checked out and git refuses both a second worktree on it and a `branch -f` against it, so §7.5's rebase happens on a detached head and `update-ref <new> <old>` adopts the result — which is also the §4.6 discipline the rest of the system already uses, rather than a force wearing a local disguise. **The pushed-SHA identity check is a predicate, not a push failure**: §8.10 retries `push-failed` on the automation budget, and a branch that is not the commits verification attested would be pushed identically by that retry, so §7.4's identity refusal files as `predicate-failed`. §8.8, §8.10 and §8.10's stated properties are corrected in place. | #113 |
| 2026-08-16 | #146 answers what an automation retry of a controller phase is, and the two corrections that follow from the answer. **A controller-phase automation retry mints no attempt**: §8.5's *"every resume is a fresh attempt"* is a statement about **worker** attempts, and §8.8 says `verify` and `integrate` have none — so an attempt id there would be a row in the `attempt` projection with no pane, no worktree, and no manifest behind it. The phase re-enters under the attempt already being walked; a retry of an *agent-borne* phase still mints, because a worker runs again. **A stage result's semantic key gains a fifth slot, `try`**, since the attempt slot is exactly what a controller-phase re-entry cannot vary and without one that can, the re-entry reads its own recorded result back and routes to the same row forever. **§4.5 states when the attempt slot is `-`**: an effect is keyed by the attempt when its subject is that attempt's own work, and by the ticket execution when its subject is something one ticket execution has one of — the published branch or the ticket. §7.5's `push` moves to the second, joining `pr-create`, which is what makes *the database itself enforces uniqueness* a whole-system property rather than a per-attempt one. | #146 |
| 2026-08-17 | #150 replaces §6.6's single wall-clock deadline with **two clocks**. The **hard ceiling** (`attemptTimeoutMs`) still bounds the lane, and is now anchored to the launch completion so a controller that died and adopted a live worker does not reset it; the **no-progress timeout** (`noProgressTimeoutMs`) ends an attempt that has stopped producing anything observable. **Progress is an observed fact, never the controller's clock**: a status transition and a changed pane-output snapshot are recorded as `observation.recorded` facts — `worker.alive` and the new `worker.output`, both source `herdr` — and the no-progress clock reads the latest of them. Pane output is sampled through `pane read` because Herdr exposes no output stream; a degraded observation channel makes a no-progress verdict `automation-failure`, never a worker-tier timeout. `attempt.ended` gains `clock` and `last_progress` so the operator reads which clock fired and what the last progress was rather than reading elapsed time as a diagnosis. §5.2's Herdr row widens from one fact to two (`worker.alive` · `worker.output`); §11.4's profiles gain `noProgressTimeoutMs`; both clocks carry code-owned defaults, calibrated against #114's measured 17- and 86-minute completions. | #150 |
| 2026-08-17 | #152 makes §6.6's recorded stop outcome an observation rather than a race. `stopAgent` sent the quit sequence and read the pane on the very next line, so **`agent_stopped` recorded a teardown in flight as a refusal** — across #114's two runs every attempt recorded `false` while the workers had in fact gone, and nothing re-checked it. The outcome now comes from a **bounded re-probe** whose budget covers Herdr's *detection* lag rather than the process exit: the controller closes no pane (§13.B), so `pane_exited` never fires and the agent merely stops being detected, measured at 729 ms (claude) and 418 ms (pi) on an idle session. `agent_stopped` keeps three values — `true`/`false` are observations, `null` is Herdr declining to answer, which §14.1 forbids writing down as though it were evidence the agent stayed. A stop that could not be confirmed records a named **`stop_anomaly`** on `attempt.ended` carrying the surviving pane, the status it was last seen in, and how much of the bound was spent, in one of three classes: `wedged-pane` (§13.B's accepted wedge, `cleanup-plan`'s to reclaim), `stop-unconfirmed` (Herdr silent), and `quit-undelivered` (the keys never landed, which the pane read cannot distinguish from a wedge because both leave a live agent). §11.2's no-silent-guessing is what forbids collapsing the three into one `false`. `attempt.ended` moves to payload v2 accordingly (§4.3). Nothing on this path closes a pane. | #152 |
| 2026-08-17 | #151 makes an **unharvested attempt's branch evidence on its disposition**. §8.10 harvests what an outbox claims; an attempt that never wrote one has still created a branch, and §7.7 makes that branch the only copy of the work on it — so on #114 a complete implementation was recoverable only because an operator read the factory-private clone by hand. §8.9's block gains a fourth element: every attempt of the ticket execution, with its branch, the head **git answers now** (§5.2 — never the outbox's claim nor the mint's record), and its commit count against **its own** base (§7.4). It is read for every disposition and every attempt outcome rather than for the endings that harvest nothing, because a list of which outcomes those are is a list somebody extends without extending — and the failure that permits is the silent one, "nothing was built" reported over work sitting on a branch. Every answer the read can get stays distinguishable and none is spelled as the absence of another (§11.2): commits, no commits, no branch, no answer from git, and no base recorded to count against, with **the attempts not listable** and **no read at all** distinct from all five. The read rides the comment and **not the digested intent** — every other field of the block is a function of durable state, and digesting a branch head would make a §10.4 re-entry that read a moved head a §4.5 payload conflict instead of the comment already posted; the one ending that therefore carries nothing is §9.6's abandon boundary, which writes no comment at all (#159). The **remote is deliberately not consulted** — §7.7 makes an attempt branch absent from it by construction, so an `ls-remote` would answer "absent" for exactly the attempts the read exists for, and §5.4 already names `git-local` for this. The read never throws: a settlement lost to a failed evidence read leaves the ticket claimed with nothing on it, which is the one state §8.9 has no word for. §7.7 and §8.9 corrected in place. | #151 |
| 2026-08-17 | #156 replaces §6.4's workspace-per-attempt with **one workspace per run and a tab per attempt**. The original reasoning — a workspace rather than a split of the controller's own pane, because a `--foreground` start may not be in a Herdr pane at all — rules out the controller's pane and never argued for one workspace *per attempt*; the workspace list is the operator's top-level navigation, and run `01M06G9WM4J389YE9AQ317GK0B` on #114 filed four of them (w2C–w2F) for one ticket among the operator's real projects. The workspace is a **`workspace-open` effect keyed by the run** (§4.5), so it is opened exactly once and a re-entering controller adopts the committed one instead of opening a second; its probe reads Herdr's workspace list for the run's **deterministic label**, because Herdr carries no metadata token on a workspace the way `pane report-metadata` does on a pane, and that probe is what recovers an id a crash left only in Herdr. It is opened by the first attempt that needs one rather than during run startup: a refusal then is an attempt's `worker-launch-failed` (§8.10), which is budgeted and counted, while the same refusal during startup would have no §10.3 end reason to be reported as — and a run that launches no worker leaves no workspace behind. Correlation is untouched: a pane is still found by its `FACTORY_ATTEMPT` token and never by its workspace or tab (§5.5). §13.B extends by construction — the controller closes no tab and no workspace either — and the **accepted cost is recorded in §6.4**: closing the factory workspace now ends every live lane of that run at once, recoverable through §6.6's `dead-worker` and §5.5's adoption, and never repaired by opening a replacement. `tab create --workspace --cwd --label --no-focus` and its answer shape were read off the installed Herdr 0.8.0 rather than assumed. | #156 |
| 2026-08-17 | #160 restores §6.2's probe to proving the session workers actually run. Both runtime adapters passed the skill-delivery flags to the **probe** and not to the **worker session**: every Claude worker launched without the §6.3 plugin (`plugin list` under the live worker binding: "No plugins installed"), every pi worker without the pinned roots — and pi's default discovery, which the probe's `--no-skills` suppressed, loaded four of the operator's personal skills from `~/.agents/skills`, a root `PI_CODING_AGENT_DIR` does not fence, inverting both §6.8 guarantees at once. §6.2 gains the composed-binding rule: the worker session's argument set is the primary object, the probe's is that set plus its probe-only IO flags and nothing else, held by a test at the launch seam (worker argv = probed argv − probe-only flags + profile flags). §6.8 records the measured discovery leak and makes `--no-skills --skill <root>` load-bearing isolation on every pi worker session. A launch whose closure cannot reach the session — no proven plugin directory, no pinned skills roots, a plugin cache wiped since preflight — is a typed automation failure before the attempt spends. §6.7's acceptance matrix (#115) is untouched by construction but noted: anything it proves must run the worker binding. | #160 |
| 2026-08-17 | #161 corrects §7.5's replay boundary. The rebase used the attempt's **own** base (§7.3) as its upstream, and a repair's own base is the prior attempt's tip (§8.5) — so a repair's replay set excluded the implement commit it builds on. The lucky outcome was #114's rebase conflict over sound, already-verified work: the repair edited a file the implement commit created, which does not exist at the fresh tip. The dangerous one was a repair touching only files the implement did not create, which replays **cleanly** and yields a branch carrying the repair without the work it repairs — verified, attested and published, since §14.13 measures the commit being published and attestation compares heads, and both are satisfied by a branch that quietly lost a commit. §7.5's upstream is now **the fresh tip itself**, so the replay set is every commit the ticket execution produced that is not already on the base branch, whatever attempt chain produced it; whether the base moved is read off the graph — is the branch already sitting on the fresh tip — never off a recorded base, which a §9.5 re-rebase has already made stale once; and a rebase whose result carries fewer non-base commits than its input is refused as a typed `rebase-dropped-commits` failure and never adopted — the guard that makes the silent case impossible rather than unlikely (§11.2), whatever the drop's mechanism, including git dropping a commit whose patch a human already cherry-picked upstream. §7.3 separates the two meanings the one value conflated: what an attempt branched from and the boundary of what §7.5 replays coincide only for a single-attempt execution, and neither is inferred from the other. §7.3 and §7.5 corrected in place. | #161 |
| 2026-08-17 | #165 corrects §8.4's review boundary — #161's conflation one phase earlier. `reviewPhase`'s contract said the base a review measures against is never a repairing attempt's own tip, and the caller violated it: the axes were prompted with the **walking attempt's own §7.3 base**, which for a repair is the prior attempt's tip (§8.5) — so on a repair chain both reviewers read only the repair's delta while their two approved verdicts gated the publication of the whole chain, and §8.7 recorded approvals whose scope is a subset of the published change. The exegesis is settled for **the publishable diff**, on §8.4's own structure: a failed verify goes straight to repair, so a repair after one has *no* previously reviewed state — the "delta since last reviewed" reading leaves the implement commit reviewed by nobody. **Both ends of the diff are the passing verify record's** — its `base_commit` is the fresh base-branch tip the branch sits on after §7.5's step-1 rebase, its `head` the exact commit §8.2's checks passed at — which also retires the harvest-head read that went stale whenever verify rebased, and makes the review and the checks measure one value (§14.13) — after a §9.5 re-rebase the verdicts keep naming the boundary they were rendered against rather than implying they covered the moved one. Neither end is a parameter: the attempt's own base cannot reach the phase at all, the same separation-by-removal #161 applied to §7.5. Each axis's durable result and §8.7's attestation now name the base and head the verdict was rendered against, so an approval's scope is a checkable claim. §7.3, §8.4 and §8.7 corrected in place. | #165 |
| 2026-08-17 | #153: the worker's session identity never reached Herdr. §6.5's transcript pointer is pushed by herdr's **agent-state integration** — a Claude `SessionStart` hook and a pi extension — which lived only in the operator's config root, so §6.8's config isolation removed it from every worker session and 15/15 `attempt.correlated` records carried `transcript: null`. The integration crosses in as a **fixed capability artifact named in code per runtime** (first closed list, beside credentials and the model catalogue): copied from the operator's config root into the run's own root, digested, and **version-observed** out of the file's own `HERDR_INTEGRATION_*` header rather than assumed. A new static preflight check, `worker-agent-state`, gates its presence and currency **per runtime the active routing can dispatch to** — missing, unversioned, mis-identified, or outdated is a named red ending the run `baseline-red` before the first claim, so `no-transcript-pointer` is an anomaly rather than the expected residue. The run manifest records it by declared path, content digest, and observed version per runtime, and records a named absence when the environment did not build. | #153 |
| 2026-08-17 | #164 closes #160's defect one argument set down: **a profile's own flags reached a live worker having never been handed to the installed binary.** `--model`, and Claude's `--effort` / pi's `--thinking`, are appended at launch and were exercised by nothing, so a renamed or dropped flag surfaced as `worker-launch-failed` — a pane that will not come up — *after* a branch, a worktree, a pane and the tracker claim already existed, which is the one binding that escaped §6.2's purpose of refusing before an attempt spends. §6.2 gains a **`profile-flags` check whose cardinality is the profile's, not the revision's**: one live session per **distinct** profile the active routing can dispatch, so a routing table naming one profile five times costs one session, while the runtime probe keeps its own one-per-pinned-revision cardinality — folding profiles into a probe that is *role- and profile-independent by design* would have changed that number rather than its argv, and that is a different design. Each session runs the profile's launch argv plus the probe-only IO flags and nothing else, and is judged on the answer the probe already reads — pi's RPC response, Claude's `initialize` control-response — at **zero model cost**, since spelling is a parse-level fact. Three measurements decided the mechanism rather than taste: **`--version` short-circuits before argument parsing** (Claude 2.1.233 accepts `--nonsense-flag` with exit 0), so it proves nothing; **a side subcommand's exit status is not a spelling verdict** (`pi list` exits 1 over a stale OAuth token on the development machine while the RPC session answers perfectly); and **a misspelling is refused by name before a session starts** (`unknown option '--efffort' (Did you mean --effort?)`, `Error: Unknown option: --thinnking`), so *a session that answers* is the proof and *one that never does* is the refusal, with no text parsing and no exit code in the judgement. The check runs **behind** the runtime probe and only on a green one, which is what makes it a spelling verdict at all: the probe starts the same session without the profile's flags, so the two differ by exactly those flags. A refusal names the profile, its flags, the binary and the binary's own diagnostic; an unproven spelling composes no production context, exactly as an unproven runtime does not. A binary that could not be spawned at all stays §11.7's `runtime-unreachable` rather than a rejected flag — it was never asked about a spelling. The profile-argument builders are exported so the launch and the proof share one definition by construction (#160's rule, applied one argument set down). **§15's configuration obligations gain the case by name**, and the cost is recorded rather than capped: the sessions are serial at the runtime's own probe timeout, so the worst case grows by distinct profiles × that timeout ahead of §9.7's expensive baseline, against a measured ~1.8 s (Claude) / ~0.7 s (pi) for an accepted spelling. | #164 |
| 2026-08-17 | #163 closes #160's leak class in the other runtime. **Claude registers the project skills its own working directory ships**, and an isolated `CLAUDE_CONFIG_DIR` does not fence them — measured live on Claude Code 2.1.233 at zero model cost: an `initialize` control-request in a scratch project shipping `.claude/skills/leaktest/SKILL.md`, under an *empty* isolated config dir, answered 44 commands including a bare `leaktest`, and a project `.claude/commands/` file registered the same way. A worker's cwd is the attempt worktree, so on any target repository shipping `.claude/skills/` every Claude worker would load skills from outside the pinned package root, and §6.8's "skills reach a worker only from the pinned package root" would be false again. §6.8 records the fact and makes **`--setting-sources user`** load-bearing isolation on every Claude **worker** session — measured in the same pass to drop the project skill and the project command (it drops the `project` and `local` setting *sources*) while leaving the §6.3 plugin's records, the injected `--settings` file, and `--permission-mode dontAsk` untouched. §6.2's Claude probe gains a **fourth step**, because Claude's command records carry names and no source path, so pi's converse check has no analogue: the probe plants a canary project skill in the directory it probes in, requires the fenced session not to register it, and requires one deliberately unfenced control session — the worker binding minus the fence, nothing else — to register it. A canary that survives the fence is `skill-shadowed` naming its source; a control session blind to it is the new `discovery-fence-unproven`, since a probe that could not have observed the leak is not evidence of its absence. The canary is planted and removed by the probe, and what a run proved is recorded on the `runtime-probe` check. One consequence is recorded rather than left to be discovered: the fence also stops the **target repository's own `CLAUDE.md`** from being auto-loaded (measured — a marker word in a project `CLAUDE.md` was answered unfenced and not fenced), which is §6.8's two rule channels applied rather than an accident; the declared worker-context file is installed in the user scope the fence keeps, and `worker.contextFile` is where a target repo's standing rules are declared. | #163 |
| 2026-08-17 | #157 moves §6.5's environment channel from **typed at the pane** to **declared to the multiplexer**. `startedAgent` sent `export FACTORY_ATTEMPT='…' CLAUDE_CONFIG_DIR='…' …` through `pane run`, justified by "neither `workspace create` nor `agent start` takes an environment" — **half of which stopped being true at Herdr 0.8.0**, which offers `--env KEY=VALUE` on `workspace create` and `tab create` and only leaves `agent start` without one. The typed path put every worker's config-directory paths and attempt identity into pane scrollback — the one place §6.8's closed pane set was meant not to widen — made the factory carry POSIX single-quoting for values it derived itself, and made a failure to type the exports indistinguishable from a shell that was not ready. The binding is now one `--env` set per name on the attempt's `tab create` (#156's tab), assembled at the tab because that is the last command before the agent that accepts an environment; identity is applied last so no declared value can shadow it, and one variable per name so no argument parser decides a winner. This is not inheritance returning through another door: the pane's shell still belongs to the multiplexer server, and the same closed set crosses — declared rather than typed. **That the variables reach the agent *process* and not merely the shell was established live before the typed path was removed** (`tests/live/herdr-tab-env-reaches-agent.mjs`, reading `/proc/<pid>/environ` on both hops): Herdr's own help says `--env` sets a variable for "the launched process", and the launched process is the shell. The same probe showed a value carrying a space and an apostrophe crossing byte for byte as one argv element, so `shellQuote` went with the path it existed for. | #157 |
| 2026-08-17 | #154 makes **provider exhaustion a typed fault with a time-boxed memo**. §6.6 gains the `provider-refused` outcome: a refusal for quota or rate reasons is observed in the pane output — a signature vocabulary read off the harnesses' own non-retryable limit classification, matched in the output's tail — recorded as its own `observation.recorded` fact (`provider.refusal`, §5.2's herdr row widened to three facts), and overriding the three silence-based verdicts (`no-result`, the no-progress clock, the hard ceiling); a valid outbox still wins and a dead pane is `dead-worker` still. §9 gains **§9.8**: the refusal is remembered as a `capacity.exhausted` memo naming the resource class and an expiry, on the `controller` stream with no run in the envelope so it outlives its author; dispatch consults it before launch, and **an expiry re-admits by probe, never by the clock** — one cheap completion under the worker binding answers `admitted`/`refused`/`inconclusive`, and only an admission writes `capacity.admitted`. §8.10 gains two budgetless `released` rows (builder and reviewer) — before this, the same refusal arrived as a repair-charged `no-result` with a `factory:failed` label — and §10.3 gains the `capacity-exhausted` end reason (exit 9), so a run left holding claimable work whose every route is memo-locked says so plainly in the §3.5 report instead of draining as though the work were done. §4.3's kind enumeration gains the two memo kinds. Rerouting that consumes the memo is #155; nothing here chooses a different profile. | #154 |
| 2026-08-18 | #155 makes **dispatch reroute around an exhausted resource class**, which is the consumer #154's memo was recorded for. §11.5's routing gains an optional **`fallbacks`** block — a declared per-role order of profiles dispatch may take next, with **review's declared as two orders, one per §8.4 axis** — because every order an inference could produce is defensible and none of them is the operator's; an unknown profile name is a load error and a fallback profile counts as reached by the routing, so §11.6 sizes its class and §6.2 proves its flags. §9 gains **§9.9**: §11.5's dispatch and §9.8's memo become **one decision, made before the claim and recorded on the attempt's mint** — declared, ran, why, and every candidate passed over — because the class names the pool §9.4 takes from and the profile names what §6.5 mints, and deriving them separately is how a lane holds a slot in a pool its worker never touches. §8.10's two `provider-refused` rows become a new **`reroute`** action that spends **no budget at all** and is bounded by each routable profile being **refused** at most once per ticket execution, derived from the journal; §8.10 gains a **phase-less `routes-exhausted`** row for having run out of them — no attempt has that outcome, and a routed fresh-retry reaches it from `verify` and `integrate`, which have none — settled as §9.8's budgetless `released` and typed apart from `provider-refused` because *this provider is out* and *the run is out of providers* ask for different things. §8.4's two axes reroute down their own orders and a fan-out that could only fill one says so in its verdict; §8.9's block gains the dispatch read, so a green ticket can answer what wrote it. Found while wiring it: the review fan-out never consulted the memo at all, so a locked review class parked the lane on §9.8's wait for the memo's full hour while holding the ticket slot; §9.2's effective concurrency did not count the fallback pools a rerouted implement attempt starts from; and §8.6's breaker was read only at the head of a scheduling pass that may have started before a lane tripped it. | #155 |
| 2026-08-18 | #158 answers the question #152 left open — how long a **mid-turn** worker takes to stop being reported as an agent — and the answer changes §13.B's quit **sequence** rather than the bound. Measured on Claude with `tests/live/herdr-agent-quit-sequence.mjs` (Herdr 0.8.0 / protocol 19, one cheap turn held open by a committed script): sent as **one** `send-keys` call, `esc ctrl+c ctrl+c` quits an idle harness in 721 ms and is absorbed by a working one as a bare turn interrupt — the turn stops, the interrupted prompt returns to the input box, and the agent stays resident indefinitely, which is the wedge run `01M0859CJAA1Z8XK41756H5Y30` recorded on three attempts of #114. **The sequence is therefore two calls** — `esc`, a 250 ms settle, then `ctrl+c ctrl+c` together — and both halves of that shape are load-bearing: the two `ctrl+c` must ride one call because the exit affordance is a double press with a window under a second (spaced 1000 ms apart, nothing quits, not even an idle harness), while `esc` must ride its own because in company it is what swallows them. **The call boundary is the mechanism, not the delay**: two calls 8 ms apart quit a working worker as reliably as 1500 ms apart, and the settle is headroom for a loaded machine, bracketed by measurements at 0, 250 and 1500 ms. #152's `STOP_CONFIRM_BACKOFF_MS` is **confirmed unchanged**: with the corrected sequence a mid-turn stop is observed at 412–723 ms, the same order as the idle 729 ms, because the wait is Herdr's detection cycle and not the harness's teardown. **§5.2's presence fact is settled at the same time** (`tests/live/herdr-agent-presence-source.mjs`, no model cost): `pane.agent` follows the pane's **foreground process**, not the screen — a bare `sleep` whose argv names it `claude` is reported as an agent with a blank screen and no rule matched, an unregistered `claude` at a shell is reported without any `agent start`, and neither `pane release-agent` nor a foreign `pane report-agent` can take the field away from a live one (a foreign report does move `agent_status`, which is a separate signal). The detection rules decide **state**, never presence. That is what makes §6.6's confirmation safe in the direction it is used: a screen that matches nothing cannot manufacture an absence, and 487 reads across two working turns, tool running, recorded zero. The asymmetry is recorded rather than papered over — presence is name-shaped, so a false *presence* is constructible, and it lands as `wedged-pane`, which is the conservative error. pi quits under either shape (106 ms, 209 ms idle); its mid-turn case stays unmeasured, since Claude is the runtime whose interrupt affordance absorbed the sequence. Nothing on this path closes a pane. | #158 |
| 2026-08-18 | #117 builds §12's subtractive half and records three readings the section left to the implementer. **(a) Only an `ended` run is ever a candidate.** §12.6's "never mid-run" is read as a property of the *run*, not only of the invocation: a run whose lifecycle has not reached `ended` is this controller's own or an orphan a re-entry will adopt, so the plan holds it as `live` — which is not a fourth pin. **(b) Expiry's blob deletion is not an effect — and this is an amendment to §4.5, not a reading of §12.** §4.5's "every mutation outside the database is an effect" is categorical, so §4.5 now carries the single exception in its own text rather than being silently contradicted here. §12.5 makes the ledger row the record (`expired_at`, dated), and expiry commits the tombstone *then* unlinks: a crash in between resolves to the correct `unavailable(retention-expired)` and the next pass re-attempts every tombstone, so the crash window self-heals with no second table. An `artifact-delete` pair keyed by the expiring run would be a record of the deletion inside the thing being deleted — and, because §12.4's fourth pin skips a run holding an unresolved effect while reconcile can only settle `absent` once the blob is gone, it would deadlock expiry outright; keyed repo-scoped it would put two permanent records per artifact on the stream §12.2 keeps low-volume. `artifact-delete` stays cleanup's, for §12.8's orphaned blobs that have no row at all. **(c) §12.4's label pin reads the freshest surviving `observation.recorded` *that states `ticket.labels`*, falling back to the run's own §8.9 disposition when nothing has been observed.** §5.1's poll is repository-wide, so a *later* run's observation is what releases the pin after a human clears the label — the only durable channel there is, since §14.20 means the factory never removes it. The fact-class restriction is load-bearing: most observations of a ticket establish nothing about its labels, and reading one of those as "nothing is known" would re-engage a cleared pin permanently. **(d) The open-PR pin's release channel is the *ticket's* observed state, not the pull request's.** §5.1 polls issues and never pull requests, and §7.5's `Closes #N` makes the merge discharge the ticket; the visible cost is that a PR closed unmerged pins its run indefinitely, which is the direction chosen throughout: where durable state cannot answer, every pin holds, because an over-held run costs bytes an operator can see in `status` and a swept one costs the investigation. | #117 |
| 2026-08-18 | #115 discharges §6.7's acceptance matrix, and it is a **mechanism** rather than a transcript. The package now ships `skills/meta/skill-loading-proof`, whose body declares a marker, a token and a transform in one machine-readable block and asks for a single receipt line applying that transform to a **nonce the prompt supplies**; no prompt carries the token, the transform or the answer, so a receipt is a body that reached the model and a correct one is a body it followed — the gap between that and §6.2's registration-and-echo probe being exactly what §6.7 exists to close. The judge reads the contract out of the *same shipped bytes the model was given* (`factory/lib/proof/receipt.mjs`), so a package whose skill said something else could not go on passing; the skill ships in the pinned revision rather than being planted, because a planted body would be delivered through a plugin the generator did not build from the pin and would prove a package no worker runs. Three cells per model, because the survey names direct invocation and natural-language triggering as separate cases and asks separately whether a trace distinguishes native loading from a path read: **direct invocation**, **model invocation**, and a **trace control** deliberately told to read the body off disk — whose `read-not-loaded` outcome makes the other cells' empty tool trace evidence rather than an assumption (#163's control-session pattern, one layer up), and whose silence withdraws the trace claim however green the rest is. Every cell runs the **worker** binding by calling the argv builder §6.2's spelling proof already composes (#160's rule). **A claim is evidence about every axis its own sentence names, or about nothing** — the rule two review passes were needed to get right: a first cut counted verdicts and not whose, so a green haiku-only run reported "Opus and Fable actually load and follow" as discharged; a second still discharged "interactive versus headless" from headless-only cells and "across Claude Code versions" from one version, demoting the untested half to a caveat. A caveat on a green claim is narration, and all three are the silent-wrong-answer class §15 calls load-bearing; what a matrix *did* establish toward an unverified claim is now stated beneath it instead. §11.7's exclusion list gains **`.venv`** for a measured reason found here: `uv run pytest` — one of this repository's own mandatory commands — took the digested file count from 862 to 6525, so an agent who had run the suite pinned a different revision than one who had not, for byte-identical package files. Taken live against Claude Code **2.1.233**, revision `sha256:7505b5cae67e…` at commit `aef7a3c` (dirty): all four invoked cells `followed` under resolved ids `claude-opus-5` and `claude-fable-5`, both controls `read-not-loaded`. Three survey claims discharged; three recorded unverified — the interactive surface, cross-version consistency, and role closure. Also measured, zero cost: `claude --model nonsense-model` still answers the `initialize` control-request with exit 0, so #164's check proves flag *spelling* and never that a model **value** resolves; only a real turn does, which is what this matrix adds. The result lives at `docs/proofs/skill-loading-claude-2.1.233-7505b5cae67e.md`, and `tests/live/prove-skill-loading.mjs` re-takes it — by hand, one short turn per cell, beside the probe that spends a session for the same kind of reason. | #115 |
| 2026-08-18 | #159 closes §8.9's one unapplied row. §9.6's abandon boundary marked in-flight executions `released` in the journal and wrote **nothing** to the tracker — no unassign, no comment — so the two halves disagreed from that moment on, and the tracker is the half a human reads: a ticket still assigned, still carrying the factory's claim comment, with nothing after it, reads as a run still working. §3.3's 24h staleness settled it eventually, which is a timeout standing in for a fact the controller already knew and could have stated — on a path reached by ordinary operator action (a second `stop` or `SIGTERM`, exit 4), not only by a crash. The boundary now applies §8.9's `released` row through the one module that applies dispositions: claim dropped, release stated, no label added, both as §4.5 pairs a re-probe settles if the controller dies between the journal record and the write. It also gives #151's parked-branch read the comment it had nowhere to ride, on precisely the ending most likely to catch a builder mid-work. §9.6's "stops issuing new effects" is narrowed to new effects **about the work**; a tracker refusal is carried into the §3.5 report (`released_unsettled`) rather than costing the run its own ending, since the unresolved effect is already §12.4's alarm. One thing had to become true for the boundary to be able to settle everything it marks: **§3.3's contest loser now records its own `released`** when it loses, journal-only, because it assigned before its re-read and therefore leaves a ticket execution behind for a ticket it does not hold — and un-assigning there would clear the winner's claim, which is one field with the loser's since arbitration is only reachable between installs sharing one tracker identity. | #159 |
| 2026-08-18 | #118 builds §12.8's pair and records six readings, four of which are places the section as written could not be implemented literally. **(a) Cleanup's effect records are repo-scoped.** §12.8 puts cleanup's own actions on the `controller` stream, and §4.3 refuses a record carrying a run anywhere but that run's own stream — so §12.8's sketched key `<run>/<ticket>/cleanup/<target-kind>/<operand>` cannot be both. Repo-scoped wins, for a second reason beyond the refusal: a run-slotted cleanup record would be deleted by the expiry of the very run whose reclamation it documents. Every identity a probe needs therefore travels in the **operand**, whose grammar lives with the module that owns the subject (`worktreeTarget`, `paneTarget`, `addressFromOperand`), so a probe resolves a target through the code that created it. **(b) §14.27's `FACTORY_ATTEMPT` is read as *a factory-stamped pane token*, and the controller's own pane gets `FACTORY_RUN`.** §12.8 whitelists a pane no attempt owns, so under the literal spelling the fourth target kind is unreachable and the invariant it must obey has nothing to check. The stamp is applied only where the factory *made* the pane — `launch.mjs` declares `FACTORY_CONTROLLER_PANE` in the workspace's environment — because `HERDR_PANE_ID` is set in the operator's own terminal too, and stamping on that evidence would make their shell a cleanup target, which is precisely the sentence §14.27 exists to write. It carries the run rather than a flag, since Herdr reuses pane ids. A stamp that fails is reported on the run and leaves the pane unreclaimable, which is the fail-safe direction. **(c) The plan is enumerated from the world and judged by the journal**, never derived from records alone: expiry deletes a run's tier-1 detail, and a planner that could only see records would never look at that run's worktree again. For the same reason `cleanup-execute` runs cleanup **before** the expiry pass §12.6 folds into it. **(d) §14.26's guard applies to every whitelisted worktree, baseline ones included**, and the deletion is issued as `git worktree remove` **without `--force`** so git applies the same guard again at the moment it acts — covering the window between the digest re-derivation and the deletion, which no comparison can. It is **not** §12.7's red-baseline retention restated, and the review caught the first draft of this row claiming that it was: §12.7 protects a red baseline from *eager, unreviewed* deletion, while a red baseline whose checks left nothing on disk is clean and cleanup will offer it. What protects it there is the plan-then-execute pair — it appears in a plan the operator reads — and a guard that consulted the check outcome is not available at all, since §14.24 leaves `doctor` no durable record of which baseline went red. **(e) The private clone needed a mutation class of its own** — `clone-delete`, probed by a new `git.clone-status` read — because it is not a worktree and a path probe would answer about the wrong thing; it is reachable only by naming it in `--kind`, which is what makes the invocation separate. **(f) An orphaned blob's operand is `sha256/<digest>`.** §14.28 leaves a blob no handle but its address, so the key must carry one; §14.4 forbids a hash **of the effect's own payload**, whose absence is what keeps a conflicting duplicate a typed conflict rather than a different key, and `keys.mjs` still refuses a bare sha256. Also: `--run` and `--kind` take their values as `--flag=value`, because the verb is not known while the line is being read and a flag that swallowed the next token could not tell a run id from `cleanup-execute`'s digest. | #118 |
| 2026-08-30 | #188 adds validated advisory `feeds`, execution-scoped digest-ledgered check output, trusted repair evidence injection, concrete Mutmut/Stryker/CRAP recipes, and all-check `doctor --baseline` diagnostics. | #188 |
| 2026-08-30 | #178 answers the class of hazard §6.8's trust guarantee was being read as covering, and does it in both halves. **Prevention, where controller-owned state reaches.** Claude's browser prompt is not a first-run dialog but a **warm-cache** one, gated on a key the harness writes itself: measured on Claude Code 2.1.241 with credentials promoted the way §6.8 promotes them (`tests/live/claude-chrome-cache.mjs`, zero model cost), the first interactive startup in a controller-owned config root writes `cachedChromeExtensionInstalled: true` and a later one raises a prompt waiting on a keypress a worker has nobody to supply. It is permanent rather than per-run — the environment rebuild overwrites *named files* while the pre-trust writer merges unknown keys forward — so once any session warms it, every attempt of every later run meets the prompt until a human deletes the directory. `--no-chrome` joins the discovery fence on the **worker binding**, and therefore on the builder, the reviewer, the probe, and the probe's own deliberately-unfenced control, which is as capable of warming the cache as anything else; the proof runs both sides for §6.2's reason, and needs a **TTY**, because the detection does not run in a `--print` session at all and the same assertion taken headless is green over a live bug. pi gains `--approve` beside its store, and the store itself is keyed the way pi keys it: pi canonicalizes a directory before keying its trust map and before the ancestor walk, while the writer resolved without following symlinks — latent here, live on any symlinked store path. The `worker-trust` check now reads back **every key the pre-trust writer writes** rather than the trust-dialog key alone; three interstitials were written and never proven. **Attribution, as the floor under what prevention cannot reach.** §6.6 gains **`worker-never-started`**: an attempt that ends in silence having never been observed in a working status had no turn to end, so §8.10's two silence rows — the settle grace's `no-result` and the no-progress clock's `timeout`, both charged to the **repair** budget as "ended its turn without writing" — become one outcome on the **automation** budget. It is a state predicate and not a launch window; the working set is `working` alone, since `blocked` is what a folder-trust dialog reports and admitting it would let an interstitial launder a hang into a turn; and the fact is read from the attempt's **durable observation records** rather than an in-memory flag, so a controller that crashed after a real turn does not re-read it as never-started and retry a genuine `no-result` on the wrong budget forever — which meant the wait's own seed read had to become a recorded sighting, since a worker already working when the subscription opens produces no transition to record. §6.8's trust sentence is narrowed to what the check delivers and states the unpreventable class in general terms — some interstitials are gated on caches the harness warms, some on the target repository — **without enumerating the known instances**, since maintaining that list is the burden this design exists to end. Found on the way: `identity/paths.mjs`'s canonicalizer ate a path's first directory character whenever no ancestor above `/` existed, invisible while every caller's root did. | #178 |
| 2026-08-30 | #189 gives the builder outbox a **mandatory requirement trace** and makes review-spec its judge — the substance of SwarmForge's two-call audit (`docs/surveys/swarm-forge-adoption-survey-2026-08-30.md`, item 3) without its mechanism: no second model turn, and no self-attestation the same agent grades. §6.6's `completed` gains `trace`, a non-empty list of `{requirement, evidence}` rows quoting a ticket line and naming a path and test, stated as a **prompt obligation** in the builder template like §7.3's trailer, and named as a deliverable in the `implement` skill's closing checklist so a worker under pi or Claude produces it from the skill as well. **Two levels, two owners**, exactly §8.4's split for the verdict: `worker/outbox.mjs` judges a written trace's shape — non-empty, both fields text, malformed is `invalid-result` naming the row — and never its truth; whether one is owed is the role's own expectations (`writesTrace`), read back by the builder executor, so a `completed` builder record with none is `invalid-result` on §8.10's unchanged fresh-retry row. Two things had to change for the refusal to be readable: an invalid result's stage detail now carries the controller's problems rather than `null`, and §8.10's `implement × invalid-result` row marks its evidence **fact** — the detail is the controller's schema and role judgement and never the refused record — so §8.5's brief tells the fresh attempt which block it omitted instead of leaving it to repeat the omission. §8.4: the fan-out reads the trace off the reviewed attempt's own implement record — never a parameter, #165's reason — hands every axis the same context, and the template renders it for the role whose expectations say `checksTrace`, inside the same computed untrusted boundary §8.5 uses, with the two checks stated: an unaddressed ticket line is blocking citing the line, a row the diff does not bear out is blocking citing the row. The reviewer, not the controller, judges truth; a review reached with no trace on the record refuses rather than briefing the axis blind. Not done, by design: the controller never compares a row to the snapshot, because a controller that did would be a third reviewer with no verdict slot to write in. | #189 |
