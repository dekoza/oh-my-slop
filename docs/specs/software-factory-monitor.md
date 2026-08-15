# Software Factory monitor — build-ready specification

> **Status:** locked. This is a **living contract**, not a dated snapshot. It is amended
> in place as the factory decisions it depends on land (see *Amendment log*), and it is
> the single citable source for monitor implementation tickets.
>
> Locked by [Lock the build-ready monitor specification](http://192.168.129.37:30008/minder/oh-my-slop/issues/74),
> the final decision ticket of the map
> [Specify a local Software Factory monitor](http://192.168.129.37:30008/minder/oh-my-slop/issues/67).

---

## 1. Scope and destination

A read-only, repository-scoped monitor for the Software Factory: a browser UI hosted by
a controller tab, showing the tracker graph with active execution unfolded on it, durable
run history that survives with nothing running, structured events, and on-demand
transcript excerpts.

**Delivery order: the factory ships first, the monitor second.** The specification order is
the reverse — this document is locked *before*
[Lock the build-ready Software Factory specification](http://192.168.129.37:30008/minder/oh-my-slop/issues/87)
precisely so the factory is obliged to make the observable contract below durably true
rather than the monitor discovering what the factory happens to emit.

During the window between the two, observation is SSH + Herdr plus `sqlite3` run directly
against `state.db`. That is a stopgap this specification does not design for, and a small
argument for #87 sequencing the monitor early in its own ticket order rather than last.

**The first release is read-only.** A command seam is preserved but never opened (§7.7).

---

## 2. Domain model

### 2.1 Entities

| Entity | Identity | Owns |
|---|---|---|
| **Run** | run id (stable, durable across restarts, orderable by start time) | lifecycle, end reason, run-scoped stages |
| **Ticket execution** | `(run, tracker ticket)` | disposition, budget counters, outcome chain, stages |
| **Stage** | `(run, ticket, phase)` | phase result, attempts |
| **Attempt** | `(run, ticket, phase, attempt)` | outcome, events, transcript pointer |
| **Tracker ticket** | Gitea issue number | the tracker's own object; the graph spine |

**Ticket execution** is the monitor's own name for the execution of one tracker ticket
*within one run*. It is the node that unfolds under a tracker node, and it is what makes
"pick a run" precise: selecting a run selects which ticket execution unfolds.

**Cross-run history is a list, never a merge.** One tracker ticket may hold several ticket
executions (failed in run A, published in run B). Merging them would imply budgets and
outcome chains carry across runs, which they do not — budgets are per ticket and never
reset within a run, so they do reset between runs, while `factory:failed` persists on the
tracker ticket indefinitely.

**No synthetic nodes exist anywhere in this design.** A direct-ticket run synthesizes no
root: the ticket *is* the root, and its declared `Part of` parent renders as a linked
ancestry breadcrumb above the graph, not as a node.

### 2.2 The three orthogonal axes

The load-bearing shape of the model. Collapsing any pair produces exactly the confusions
the monitor exists to prevent.

1. **Execution state** — what the factory decided (§3.1's inherited enums).
2. **Worker activity** — what the harness observes of the live agent: Herdr's
   `idle` · `working` · `blocked` · `done` · `unknown`, verbatim.
3. **Freshness and availability** — how current the observation is, and whether it is
   known at all.

A worker in Herdr `blocked` during `implement` is an **anomaly**, not a normal wait —
[#83](http://192.168.129.37:30008/minder/oh-my-slop/issues/83) removes mid-attempt
approvals, so folding it into the disposition `paused` would hide the one state meaning
"this will never finish on its own".

### 2.3 Availability — "we don't know" is a value

Every observable value carries an `as-of` and an availability of
`known` · `unknown` · `unavailable(reason)`, carried **separately from the value**. No
`unknown` member is ever added to an inherited factory enum — that would fork the
vocabulary this specification inherits.

**Freshness** is per-entity — `live` · `stale` · `ended` · `unknown` — and **never
overwrites the last known execution state**. It is asserted and inferred, with the
assertion authoritative: the controller emits a periodic liveness event carrying its lease
and fencing identity, and the monitor compares it against event age only as a fallback.
This is what makes "the controller died" distinguishable from "the worker has been
thinking for 40 minutes".

### 2.4 Vocabulary — three things that were one word

"Projection" was overloaded across three tickets. In this specification:

- **Projection** — [#79](http://192.168.129.37:30008/minder/oh-my-slop/issues/79)'s
  durable projection tables in `state.db`, committed in the same transaction as the event
  that updates them. The factory's word, and the factory owns it.
- **Entity frame** — the typed wire object the service streams to the browser carrying the
  authoritative full value of a changed run / ticket execution / stage / attempt.
- **Derived emphasis** — attention rendering, computed at render time and never stored.

---

## 3. Observable contract

### 3.1 Inherited enums — verbatim, never translated

Adopted from
[Define verification, review, repair, and outcome policy](http://192.168.129.37:30008/minder/oh-my-slop/issues/81)
with spellings unchanged. An operator cross-references the UI against a tracker comment, a
PR-body block, and a drain report inside one investigation; a translation layer gives one
event three names and makes every future enum addition a mapping edit nobody remembers.

**Attempt outcome.** Worker-writable: `completed` · `needs-human` · `worker-failed`.
Controller-derived: `invalid-result` · `no-result` · `dead-worker` · `timeout` ·
`wrote-but-hung` · `cancelled` · `automation-failure`.

**Phase results.** `harvest` → `passed` | `predicate-failed`; `verify` → `passed` |
`failed` | `unrunnable`; `review` → `approved` | `rejected` | `mutation-detected`;
`integrate` → `integrated` | `rebase-conflict` | `predicate-failed` | `push-failed`.
**`implement` has no phase result of its own** — its result is its attempt's outcome.

**Ticket disposition.** `published` · `paused` · `failed` · `released`.

**Reason classes.** Worker-writable: `product-ambiguity` · `spec-contradiction` ·
`missing-access` · `risky-action-required` · `out-of-scope-discovered` ·
`dependency-unmet`. Controller-derived: `repair-budget-exhausted` ·
`automation-budget-exhausted` · `rebase-conflict` · `review-mutation` ·
`check-unrunnable`. Run-scoped, not a ticket disposition: `baseline-red`.

The monitor renders, and never re-derives, #81's invariant: every worker-writable reason
class ⇒ `paused`; every controller-derived reason class ⇒ `failed`.

### 3.2 Run lifecycle

Lifecycle: `preflight` · `running` · `draining` · `ended`. Mandatory **end reason**, seven
members: `drained` · `baseline-red` · `stopped-by-operator` · `abandoned` ·
`circuit-breaker` · `lease-lost` · `controller-lost`.

`draining` covers operator stop-after-current-ticket and the circuit breaker identically —
the behaviour is the same and the reason carries the difference. **`controller-lost` is
never self-asserted**; it is derived solely from the freshness axis.

**`abandoned` and `lease-lost` were added by
[#87](http://192.168.129.37:30008/minder/oh-my-slop/issues/87)**, reconciling #82's
five-member list with the six #85 independently enumerated. Both distinctions are load-bearing
for the operator: `abandoned` (a second stop or `SIGTERM`) leaves in-flight ticket executions
`released` and worker panes orphaned, where `stopped-by-operator` lets lanes reach terminal
dispositions — different worlds for the next reconcile. And `lease-lost` is a controller's own
exit, where `controller-lost` is an observation made *about* a controller by a different one or
by this monitor; collapsing them would make `controller-lost` self-assertable, which §3.2
forbids. Additive to this enum, so it is an amendment rather than a reopen.

**Preflight is observable per check and per probe.** This creates **run-scoped stages that
hang off no tracker ticket**, and `baseline-red` names a *specific* red check — "which
one" is the operator's immediate next question (§5.3).

### 3.3 Stages and attempts

All five pipeline phases are stages — `implement → harvest → verify → review → integrate`
— including the three with no worker in them. A controller phase is not a lesser stage:
`verify` is where most failures land, and its check output is the evidence the operator
needs.

**`review` is one stage with two child attempts.** The controller unions the blocking
sets, so the stage result is `approved | rejected | mutation-detected` while
`review-standards` and `review-spec` sit beneath it as attempts. Two sub-rows is `review`'s
normal shape, not a sign of trouble.

**Every attempt is individually observable**, superseded ones included — each with its own
event stream, outcome, and transcript pointer, and each carrying a typed relation to its
predecessor: `repair-of`, `fresh-retry-of`, or its review axis. The operator's next action
depends on the *shape* of the outcome chain, not its last element, so the chain is never
summarised away.

### 3.4 Events

**One event stream.** Every operator-observable transition **is** a journal event. There is
no second, curated operator feed — dual-write creates two truths that drift, and they
drift exactly when something has gone wrong. Each event carries a stable typed kind and an
operator-visibility class, so internals stay *filterable* rather than *unemitted*.

Every event carries: the full `{run, ticket, phase, attempt}` identity tuple · a monotonic
per-stream sequence · **both** `occurred_at` and `observed_at` · a mandatory **source** tag
· typed kind plus schema version · artifact references by digest · and, for foreign-sourced
events, that source's own stable id.

**Sources are interleaved and tagged.** A ticket timeline mixes factory-journal events with
tracker events (a human removing `factory:needs-human`, answering a pause, a manual merge,
a hand-closed ticket) and git facts. Foreign sources are marked observed-not-authored.
"Why is this stuck" is usually answered by a human action or an unmerged PR, not by a
factory action.

**Ordering rule: journal events order by sequence, never by clock.** Gitea's timestamps are
local-offset RFC3339 and tracker and git facts are *discovered* long after they occur, so a
wall-clock sort silently interleaves a polled label change ahead of the attempt that
explains it. Foreign events order by `occurred_at` and carry their source's stable id, so
re-polling is idempotent and cannot duplicate a timeline row.

### 3.5 Interruption

Controller restart and reconcile are observable events, not a gap the UI smooths over.

- Reconcile emits a typed event **per affected entity** with its conclusion — adopted,
  released, or declared dead — and with the **evidence basis** it rested on.
- The blind interval renders `unknown` on every axis, **never interpolated** from the
  states on either side. Drawing a smooth line across a crash is the worst failure this
  monitor can have, because a crash is exactly when the operator is reconstructing what
  happened.

### 3.6 Attention

Attention is **derived emphasis over state**, never a per-event severity field. The
projection is: every ticket execution in `paused` or `failed`, plus a **closed, named
anomaly set** — worker `blocked` during an attempt · `controller-lost` ·
`mutation-detected` · circuit breaker tripped · `baseline-red`. Closed, because an
open-ended list degenerates into a severity field by another route. Read-only release, so
this is a rendering, never a notification.

### 3.7 Concurrency readiness

[#85](http://192.168.129.37:30008/minder/oh-my-slop/issues/85) admits bounded parallel
frontier execution immediately after the serial first delivery. **The monitor is
parallel-ready by construction**: unfolding, the run band, and derived emphasis must never
assume a single active ticket execution. The `(run, ticket)` node already carries this for
free; retrofitting it later means redoing unfolding and attention.

**One live run at a time stays.** The subscription-scope reasoning in §7.4 is unaffected.

---

## 4. Graph derivation

**The graph is a derivation, never a record.** Everything here follows from that
commitment plus two hard facts about Gitea: body edits leave no diff (only a
`content_version` counter), and the tracker is strictly pull.

- **Structure is the monitor's own live read of Gitea. A run may annotate nodes; it may
  never create or remove one.** The monitor therefore renders a root with zero runs, and
  the factory owes it no graph structure — only runtime facts.
- **Nodes** are members (first-line `Part of #N`) plus **one hop** of external blockers as
  a reduced class that can never carry a runtime stack. Transitive closure is rejected — it
  lets an unrelated corner of the tracker pull itself into view.
- **Non-eligible members render *with the reason*, never filtered.** Filtering makes "why
  was this never picked up?" unanswerable, which is the most common operator question
  about a stalled graph.
- **Layout** is dependency depth, ascending issue number within a layer — matching
  [#77](http://192.168.129.37:30008/minder/oh-my-slop/issues/77)'s scheduler tie-break, so
  "what gets picked next" reads straight off the screen. **Deterministic by requirement:**
  identical tracker state yields identical layout, and a poll that changes nothing must
  never reshuffle the graph under the operator's cursor.
- **Entry** is discovery-first — roots from run history unioned with issues that have
  members — plus a direct "open #N" for a root that has never been run.

### 4.1 Time basis and divergence

**Always live. As-of reconstruction is rejected as impossible, not undesirable.** The Gitea
timeline is append-only for labels, assignees, dependencies and closure, but body edits
leave no diff — and membership *is* body text. A replayed graph would have authentic edges
and fabricated nodes, which is worse than an honest live view that names its own gaps.

**Divergence covers membership, edges, and deletion — not identity.** Edge divergence is
stated as fact (`add_dependency` / `remove_dependency` are real timeline events); membership
divergence is only ever detectable as a present-tense mismatch; a deleted issue becomes a
tombstone. A title change is not divergence — the graph is unchanged, and the
`change_title` before/after belongs in the inspector.

> **Governing rule:** divergence means the graph no longer matches what ran.

Divergence renders as a **band below** the derived graph, present only when the selected run
has any. Not inline — a tombstone has no honest dependency depth. Not in a side panel —
these nodes are the *sole* carrier of historical truth.

### 4.2 Freshness of the tracker read

- The operator switches between automatic polling and refresh-on-demand. Either mode
  renders its own as-of; neither ever renders silence as "nothing changed".
- **The switch throttles the tracker only.** Herdr's push liveness keeps flowing in both
  modes, which keeps "frozen" meaning exactly one thing — the run is not responding — and
  never "you turned polling off".
- Incomplete knowledge renders partially, with cause distinguished: not-yet-fetched is
  `unknown`, a failed read is `unavailable(reason)`.

---

## 5. Runtime unfolding

### 5.1 Disjoint by construction

**Runtime never impersonates the tracker structurally, not merely visually.** A runtime
identity contains no issue number, carries no issue-number affordance, and never links to
Gitea; a tracker identity never carries an attempt. A UI regression cannot quietly merge
them.

### 5.2 The stage stack

- **One row per phase, expanding into sub-rows only when a phase holds more than one
  attempt.** Five rows for a clean ticket; attempt multiplicity — which *is* the failure
  story — surfaces as visible expansion rather than something you must open an inspector to
  discover. `review` always renders its two sub-rows.
- Each stage row is clickable, opening the **stage inspector**: stage-scoped events plus
  the on-demand transcript excerpt. The full ticket timeline is demoted to a disclosure
  behind it.
- Every stage row is **deep-linkable** (§6.3).
- **Cross-run history is an accordion of prior ticket executions**, reverse-chronological
  beneath the selected one. Each row is *both* expandable in place — for the real operator
  question "this ticket keeps failing across runs" — *and* a link that switches the run
  overlay. A node showing an expanded non-selected execution is marked as such, so one
  glance says which nodes are not on the selected run.

### 5.3 The three bands

The view reads top to bottom as *before any ticket* → *the graph* → *no longer in the
graph*:

1. **Run band (above)** — run lifecycle and end reason, preflight probes, and the baseline
   check run. These belong to no tracker node, so they use the same clickable stage rows
   and the same inspector, and are never laid out as a DAG node. This gives `baseline-red`
   the obvious home for "**which** check was red", and it is where `controller-lost` and
   `baseline-red` surface as derived emphasis, having no node to sit on.
2. **The derived graph** (§4).
3. **Divergence band (below)** (§4.1).

### 5.4 Node annotation — exactly three channels

**Participation · disposition** (#81 verbatim) **· worker activity** (Herdr verbatim).
Freshness and availability decorate every value in every channel *independently* and are
never a channel of their own. Anything outside these three channels is not a node
annotation and belongs in the stack or the inspector.

Derived emphasis renders on the graph — computed, never stored. It must be on the graph,
because the tracker-graph spine is the first thing an operator looks at and an attention
set behind a separate list would go unread.

---

## 6. Page structure and interaction

Hierarchy is prototype variant **B, "Tracker wall"**, with vertical stage stacks — the
verdict of
[Prototype the graph, timeline, and transcript drill-down](http://192.168.129.37:30008/minder/oh-my-slop/issues/71).
The tracker graph is the spine; a run strip is a secondary selector; timelines are scoped
per ticket and stage; transcripts are on-demand with source provenance.

Branch `prototype/monitor-ui-71` (`extensions/software-factory/prototype/monitor-ui-prototype.html`
plus `NOTES.md`) is retained as **design reference only**. The implementation does not fork
from it: its data is synthetic and two of its three variants are dead code.

### 6.1 Client stack

- **Zero-build vanilla ES modules and plain DOM**, served as static files from
  `extensions/factory-monitor/public/`. The browser is a renderer of typed frames, not a
  state machine, and this package has no toolchain beyond a `postinstall`.
- Page sources are plain `.js` with **JSDoc type annotations and `checkJs`** — type-checked
  without being compiled. Type-checking is not a build step.
- The server half is `.ts`, like every other extension here.
- **No external request from the page, ever** — no CDN, no font host, no analytics. The
  page may be reached over a VPN with no internet route.

### 6.2 Graph rendering

Hand-rolled SVG implementing §4's layered layout directly. A general DAG layout library is
both over-powered for a fully specified rule and works against the determinism requirement,
since its defaults optimise for aesthetics over stability. It would also put a vendored
dependency inside a zero-build page.

### 6.3 Addressability

Path-based and **server-resolved** — not hash-based. A fragment never reaches the server,
and the server is the only thing that can turn an expired anchor into a named tombstone at
`200` rather than a `404` or a silent redirect.

| URL | Addresses |
|---|---|
| `/` | run index; filters as query params |
| `/runs/<runId>` | a run, its graph and bands |
| `/runs/<runId>/t/<issue>` | a ticket execution |
| `/runs/<runId>/t/<issue>/<phase>` | a stage, inspector open |
| `/runs/<runId>/t/<issue>/<phase>/<attempt>` | an attempt |
| `…?event=<sequence>` | an event anchor inside the attempt |

### 6.4 Time display

- **Relative is primary** ("4m ago"); absolute local time on hover/title.
- `occurred_at` is the displayed time. `observed_at` surfaces only when it differs
  materially — foreign-sourced and polled facts — as an explicit "observed 40s later".
- **No list is ever sorted by a displayed time**, so the display can never contradict the
  sequence ordering.

---

## 7. Service, API, transport, auth

### 7.1 What the service is

**A read-only reader over the factory's durable state, hosted in a controller tab but never
fused to a run.** An in-process view of scheduler memory shares the fate of the thing it
observes, so the one moment the operator needs it most — the controller died — is the one
moment it could not render. As a reader it runs in a tab with no active run, which makes
post-run history and post-crash forensics the *same* code path as live viewing, and makes
`controller-lost` derivable rather than degenerating into a refused connection.

When co-located with a live scheduler it may subscribe to `pi.events` as a **zero-latency
wakeup, never as a source of a fact absent from the durable store.**

**Package:** its own pi extension, `extensions/factory-monitor/`. Separate rather than
bundled, so the independence above is structural rather than disciplinary, and the durable
store is the only coupling.

### 7.2 Reading the durable store

The store is one SQLite database per repository at
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/software-factory/repos/<slug>/state.db` (WAL,
`synchronous=FULL`), opened **read-only**, taking no write lock. The root is resolved by the
SDK's `getAgentDir()`; `PI_AGENT_DIR` — the spelling this specification originally carried —
**is not a pi variable** and was read only by the retired factory's own code (amended by
[#82](http://192.168.129.37:30008/minder/oh-my-slop/issues/82)).

- **The monitor reads #79's projection tables; it does not re-derive state from events.** A
  monitor that computes its own answer can contradict the controller, and a monitor that
  contradicts the controller is worse than no monitor — the operator cannot tell which one
  is lying. #79 deliberately deleted the stale-projection failure class by committing
  projections in the same transaction as the event; re-deriving would reintroduce it from
  outside.
- **The coupling is explicit, not incidental.** The projection tables the monitor reads are
  a **versioned read contract**. A schema-version mismatch renders a typed
  `unavailable(reason)` and refuses to render the affected values — never a guess, never a
  best-effort parse.
- Events are read **as well**, for timelines — but never to recompute a state a projection
  already holds.
- WAL discharges the torn-tail requirement by construction: a read-only connection never
  observes a partial record and never blocks the scheduler.

### 7.3 Lifetime

Session-scoped, and deliberately **not a daemon**. Never start background resources from
the extension factory.

- Starts through **one idempotent path** from either trigger: an explicit monitor command,
  or a run started **from a tab**. Since
  [#82](http://192.168.129.37:30008/minder/oh-my-slop/issues/82) made the shell binary the
  primary entry point, not every run has a hosting tab — a shell-launched run hosts no
  monitor, and the operator opens one from any tab.
- Tears down on `session_shutdown` after flushing a typed `service-stopping` event, so the
  page renders "monitor host gone, the run may still be running" rather than guessing from
  a dropped socket.
- Recovery is "open the monitor again, in any tab" — any tab can rehost a reader.
- Outliving the controller session is **rejected**: it reopens the separately-managed
  daemon this specification rules out, and a live run keeps a tab alive by definition.

### 7.4 Streaming

**SSE**, with `id:` set to the journal sequence and `Last-Event-ID` honoured as a replay
cursor. Traffic is server→client only; SSE needs nothing beyond `node:http`, and its
reconnect primitive maps 1:1 onto the sequence that is already the ordering authority.
WebSocket buys bidirectionality that is not used and hands back reconnect and resume to
reimplement; polling forfeits the mid-phase latency that motivated the monitor at all.

**The server owns the entity frames; the browser derives nothing that has a name in §2.**
The stream is typed and mixed: `entity` frames carrying the authoritative full value of a
changed run / ticket execution / stage / attempt (each with its own availability and
`as-of`), and `event` frames carrying journal records for timelines.

**The subscription declares its scope**: the selected run plus the graph, with a small
always-on global set (run-list changes, controller liveness, service lifecycle). Switching
runs is a fresh snapshot at a new sequence with a re-scoped stream, not client-side
filtering.

### 7.5 API surface

Coarse, not a resource tree — the page's data shape is already fixed by §2 and §6, and a
REST resource hierarchy would be an invented second model.

- **`snapshot`** — state as of a named sequence: the derived graph, a bounded run list
  sufficient to draw the run strip, the selected run's full overlay (ticket executions →
  stages → attempts with state, availability, `as-of`), and controller liveness. Default
  selection is the live run, else the most recent, overridable per request. **The snapshot
  holds what the first paint needs and nothing that grows with history.**
- **`stream`** — SSE from snapshot sequence + 1. Race-free because the snapshot names the
  sequence the stream resumes from.
- **On-demand GETs** — timelines, transcript excerpts, other runs' overlays. Timelines page
  descending under a **sequence cursor** with a server-fixed page size, so a page boundary
  cannot interleave wrongly against a live append.

**Everything the browser sees passes through this server.** The browser makes no external
request and holds no credential. The server holds the Gitea token, owns the poll budget and
cache (one poller, N viewers), and reads transcript files server-side — the only place §8's
bounds and redaction can be *enforced* rather than requested.

> **Status-code rule: "unavailable" is a value, not an HTTP error.** A missing session file,
> an attempt that has not started, an expired run — all return `200` with a typed
> `unavailable(reason)`. Non-2xx is reserved for transport, auth, and genuine service
> faults. A `404` *is* absence, and a browser is one `catch` block away from rendering it
> as emptiness.

### 7.6 Reachability and authentication

Loopback-only was **withdrawn deliberately** for a concrete workflow: the factory runs on
the home machine, progress is watched from a laptop over WireGuard, steering happens by SSH
+ Herdr. What replaces it is not "open port" but a fail-closed listener.

- **`bind` is configuration, defaulting to `127.0.0.1`.** The recommended non-local value is
  the VPN interface address rather than `0.0.0.0`, so the home LAN is not in the blast
  radius. `0.0.0.0` remains available.
- **A non-loopback bind refuses to start without a configured credential.** The failure
  mode being designed out is a copied config file quietly exposing an unauthenticated
  transcript server.
- **Port** is ephemeral on loopback, and a **required explicit setting** otherwise — no
  default, so nothing is guessable by convention. The `0600` discovery file stays for the
  local launch and `status` path.
- **Credential**: one account; password stored only as a **scrypt** hash with a per-install
  random salt (`node:crypto`, zero dependency, no hand-rolled primitive); config file
  `0600`; hash never logged; constant-time comparison.
- **Login** is a form POST setting an `HttpOnly; SameSite=Lax` session cookie. The cookie,
  not the password, rides every request **including the SSE stream — decisive, because
  `EventSource` cannot set an `Authorization` header.**
- **Failed logins get per-IP backoff** (5 attempts, then exponential) — the only thing
  between a network-reachable form and an unattended dictionary run.
- **The loopback ephemeral token survives as a second credential**, valid only on loopback,
  so `status` and `doctor` authenticate without a password round-trip.
- **TLS is optional config** (`tls.cert` / `tls.key`), off by default. Over WireGuard it is
  redundant. A self-signed cert is rejected: it buys encryption at the price of training the
  operator to click through the exact warning that would matter.
- **`Host` allowlist and strict `Origin` replace loopback-ness** as DNS-rebinding and CSRF
  defence. Wildcard CORS never — the page is same-origin and there is no legitimate
  cross-origin caller.
- **No unauthenticated routes except the login form**, static assets included.

Residual risk, stated rather than hidden: excerpted transcripts now cross a network to a
second device, so §8.4's redaction is not hygiene — it is the barrier between a leaked
credential and a laptop.

### 7.7 Command seam — reserved, not opened

**No HTTP write route exists in v1**, not even one returning `501`. The seam is an internal
interface inside the service — a single `submitEffect` port with **zero callers** — so
"read-only" is true of the *socket*, not merely of the intent. The observable shape is
named (`requested` → `resolved`, with an **actor identity** slot) and no commands are
enumerated. Steering stays SSH + Herdr.

### 7.8 Polling, viewers, versions

**Polling cadence tiers** (server-side poller, tracker reads only):

| Condition | Cadence |
|---|---|
| Run active (`preflight` · `running` · `draining`) | cheap `since` ladder every **5 s** |
| No active run, page open | **30 s** |
| Refresh-on-demand | no automatic tracker reads; explicit control |
| **No viewers connected** | **no polling at all** |
| On error | exponential backoff 5 s → 60 s, surfaced as `unavailable(reason)`, never silence |

No-viewers-no-polling is lossless *because* the ladder is `since`-cursored and Gitea's
timeline is append-only with stable ids: catch-up on the next connect costs latency, never
events. Overnight, an unwatched factory makes zero tracker requests.

**Progressive-edge threshold: 25 members, concurrency cap 4.** At or below 25 members every
member's edges resolve eagerly on load. Above it, edges resolve progressively — selected-run
participants first, then visible nodes, then a background fill of the remainder — so a
100-member root never fires 100 calls at once. **The background fill always runs to
completion**, which makes `unknown` transient and self-healing rather than a state the
operator must act on.

**Viewers and versions.** Concurrent viewers cap at **8**, each with a bounded per-client
buffer; on overflow the client is **disconnected with a typed reason and resyncs via
`Last-Event-ID`**, never having events silently dropped — a gap a client cannot detect is
the one failure this model cannot render. The snapshot carries a server build id and the
page hard-reloads on mismatch; a `Last-Event-ID` from a different journal identity forces a
full resync rather than a silently wrong resume.

### 7.9 Failure isolation

The service opens the store read-only, takes no write lock, shares no mutable state with the
scheduler, catches at the request boundary, and **cannot take a run down**.

---

## 8. Retention and transcripts

**History is browsable from durable artifacts with nothing running.** No operator-observable
fact may exist only in controller memory.

### 8.1 Two tiers, with pins

- **Tier 1 — full detail.** Every journal event, per-attempt stage detail, attestations,
  transcript pointers. Horizon = the more generous of **last 20 runs** or **30 days**.
- **Tier 2 — run digest, retained indefinitely.** Run identity, start/end, lifecycle plus
  end reason, per-ticket final disposition, outcome-chain *shape*, PR and commit links,
  attention-at-end, transcript pointers, and the **ticket → executions reverse index**.
- **Pins — four.** A run never leaves tier 1 while it has an open PR, a member ticket still
  carrying `factory:failed` or `factory:needs-human`, or **an unresolved effect**. Those are
  precisely the runs an operator is still investigating; a horizon that expires them fires
  while the evidence is still in use. The fourth pin is #86's: an unresolved effect is what
  reconcile re-probes, so expiring its run's stream would destroy the context needed to
  interpret the probe while leaving the obligation intact.

**The horizon values are configurable defaults; the pins are code constants.**
`retention.fullDetailRuns` (20) and `retention.fullDetailDays` (30) live in
`.pi/factory.json` with a load-time floor of 1 each. The pins, the permanence of tier 2, the
heartbeat horizon (derived from the tier-1 boundary), and the artifact store root are not
reachable from config — a pin that can be switched off is not a pin.

**Cleanup obeys the same pins.** A failed attempt's worktree and unpushed branch are the only
copy of that work, so "the run is still in full detail" and "its forensic artifacts still
exist" can never disagree.

**Consequence accepted deliberately:** ticket → executions must be answerable in the digest
tier, so the reverse index survives tier-1 expiry. Otherwise "was this ticket ever
attempted?" begins silently lying at the horizon — the one question cross-run history
exists to answer.

### 8.2 Run index

Ordered newest-first by run identity's own time order, never wall clock. Row: run id ·
start/end · lifecycle + end reason · ticket counts by final disposition · attention count ·
retention tier. Filters: **by tracker ticket**, by end reason, by date range, by
has-attention.

### 8.3 Transcript excerpts

- **Source: the worker's own on-disk transcript, exclusively** — pi at
  `~/.pi/agent/sessions/…`, Claude at `~/.claude/projects/…`. **Herdr's pane buffer is not a
  fallback; it is a non-source**, and its `agent_session` pointer dies at pane close.
- Fetchability must survive pane close, worktree deletion, and controller restart. It may
  legitimately end when the transcript file itself is gone — a fact the monitor renders,
  never hides.
- **Anchor and window.** An excerpt is anchored to an **attempt**, optionally to an event
  inside it. Default window is the attempt's **tail** — failures explain themselves at the
  end — and a deep link from the stage inspector yields a window centred on that event's
  `occurred_at`. **Not an arbitrary-depth scrollable reader**: that is a transcript viewer,
  and it reopens "persisting complete transcripts" from the other side. Every excerpt
  renders its anchor and its bounds.
- **Normalization** to one neutral record shape — role, timestamp, typed kind (`message` ·
  `tool-call` · `tool-result` · `thinking` · `meta`), text — so one operator habit reads
  both worker kinds and the inspector has one renderer instead of two. **A record whose type
  does not map renders as a typed placeholder carrying its raw kind — never dropped, never
  silently merged.**
- **Bounds — three caps, the smaller always winning, applied after normalization and
  enforced server-side**: **40 records**, **64 KB**, and a **4 KB per-record cap** that
  truncates in place leaving a typed `truncated, N bytes elided` marker rather than dropping
  the record. The operator may **narrow** freely and **widen** only up to a **configured**
  ceiling (200 records / 256 KB) — a request-settable ceiling is not a ceiling. `thinking`
  is in-window by default: it is frequently the only thing explaining a wrong action, and
  the per-record cap already contains its volume.

### 8.4 Redaction — hard gate, fail-closed

Applied at **read time, on every read**, never assumed to have happened at write time — the
transcript files belong to the agents and are unredacted by definition. Redaction runs
server-side over normalized records **before anything leaves the process**. A redactor error
on a record replaces that record with a typed `redaction-failed` placeholder and **never**
passes it through raw.

Classes: the factory's own secrets by value (Gitea token, the monitor's password hash and
salt, TLS key material) plus high-confidence patterns (private-key blocks, `Authorization:`
headers, common token shapes, `KEY=value` where the key name matches a secret-ish set).

**The limit is stated, not implied:** pattern redaction cannot catch an arbitrary secret an
agent chose to print. The primary control remains #83's refusal of tracker credentials to
workers; redaction is defence in depth in front of the network boundary §7.6 opened.

### 8.5 Unavailability — a closed vocabulary

`not-started` · `no-transcript-pointer` · `transcript-missing` · `transcript-unreadable` ·
`format-unsupported` · `retention-expired` · `redaction-failed`

Served at `200` as typed values. **This set is closed.** An earlier "alt-screen Claude pane"
reason is **void and must not appear in the API**: that ceiling belonged to Herdr's pane
buffer, which §8.3 removes as a source entirely. Claude's own JSONL is unaffected by the
alternate screen — if the pointer was recorded and the file exists, an alt-screen pane
serves a perfectly good excerpt.

### 8.6 Expiry, as rendered

An expired run is a **tombstone: always listed, never absent.** Every axis the run no longer
has renders `unavailable(retention-expired)`, dated.

A deep link into expired detail resolves to the tombstone **with the anchor named**
("attempt 2 of #64's `verify` stage — detail expired 2026-09-13"), at `200`. Never a `404`,
and never a silent redirect to the run's top, which leaves the operator unable to tell a
mis-click from a record that never existed.

**Excerpts follow the transcript file, not the tier** — so the transcript pointer lives in
the **digest** tier.

**The factory never deletes a transcript** (#86's call). It persists a pointer and nothing
else; the files belong to the harnesses. `transcript-missing` therefore always means
*someone else* removed it — harness housekeeping or the operator — so "the monitor is never
the reason a transcript becomes unreachable" is true of the whole system, not just of this
component.

**Digest-referenced artifacts expire to a dated tombstone, not to absence.** #86's ledger
deletes the blob and keeps the row with `expired_at`, digest, byte count, class, and
producer. A digest cited from a long-lived PR body or tracker comment resolves to
`unavailable(retention-expired)` **with a date**, never to "unknown digest" — the same
refusal to let *expired* and *never existed* look alike that governs run tombstones above.
No new vocabulary member: `retention-expired` already covers it.

---

## 9. Invariants

Numbered, testable, and adversarially exercised by §10's fixtures. Each is a **never**, and
each has a fixture that would trip it.

1. **Unavailable renders as itself** — never as absence, emptiness, or zero, at any level
   from a single field to a whole run.
2. **A node with unresolved edges never renders as a node with no blockers.** Absence of a
   known blocker and known absence of blockers are different facts; collapsing them paints a
   stalled ticket as ready to run.
3. **No interpolation across a blind interval.** A controller restart renders `unknown` on
   every axis, never a smooth line between the states on either side.
4. **A runtime identity never contains an issue number**, carries no issue-number
   affordance, and never links to Gitea. A tracker identity never carries an attempt.
5. **Freshness never overwrites the last known execution state.**
6. **Ordering is by sequence, never by clock** — including the run index, and including
   every list the UI displays with a time on it.
7. **`unavailable` is `200`.** Non-2xx is transport, auth, and service faults only.
8. **Redaction is fail-closed** — a redactor error yields a typed placeholder, never raw
   passthrough.
9. **Bounds are enforced server-side**, after normalization, smaller cap wins; widening
   stops at the configured ceiling.
10. **An unmappable transcript record is never dropped** — it renders as a typed placeholder
    carrying its raw kind.
11. **Layout is deterministic** — identical tracker state yields identical layout; a poll
    that changes nothing never reshuffles the graph.
12. **Non-eligible members render with their reason**, never filtered out.
13. **Cross-run executions are listed, never merged.**
14. **No synthetic node is ever created** — not for a direct-ticket run, not for a run band
    entry, not anywhere.
15. **The monitor never re-derives a state a projection holds**; a projection schema
    mismatch refuses to render rather than guessing.
16. **Attention is computed at render time, never stored.**
17. **No HTTP write route exists**; `submitEffect` has zero callers.
18. **The browser makes no external request** and holds no credential.
19. **A non-loopback bind without a configured credential refuses to start.**
20. **An expired deep link resolves to a named tombstone at `200`** — never a `404`, never a
    silent redirect.
21. **A client that overflows its buffer is disconnected with a typed reason**, never
    silently dropped events.
22. **The monitor never blocks the scheduler and cannot take a run down.**
23. **Rendering never assumes a single active ticket execution** (§3.7).

---

## 10. Fixture harness

A first-class deliverable, not a test convenience. It is what turns §9's invariants from
prose into assertions.

**A fixture is** a `state.db` plus a Gitea snapshot plus the referenced transcript files,
replayed deterministically — deterministic because the sequence, not the clock, is the
ordering authority.

**Two kinds, both required:**

- **Recorded** — captured from a real factory run. The default, and the answer to #71's
  stated confidence weakness ("synthetic data, one judge"). Recorded fixtures give the
  renderer real shapes.
- **Synthetic** — hand-authored, reserved for states a real run will not reliably produce on
  demand: `controller-lost`, `baseline-red`, retention-expired tombstones,
  `redaction-failed`, a deleted issue tombstone, a divergence band, a projection schema
  mismatch, a client buffer overflow. Synthetic fixtures give the invariants their
  adversarial cases.

---

## 11. Contract obligations on the factory

Numbered so #87 can check them off item by item rather than re-reading six resolutions.
All were posted as handoff comments to their owning tickets.

**O1.** Every operator-observable transition is a journal event; no operator-observable
transition exists only as a projection side effect. *(→ #79)*

**O2.** Agent-status transitions are **recorded as events**, not merely read live — a poll
structurally cannot see `working → blocked → working` between two samples. *(→ #79)*

**O3.** A periodic controller liveness event carrying lease and fencing identity. *(→ #79)*

**O4.** Reconcile emits a typed per-entity conclusion with its evidence basis. *(→ #79)*

**O5.** The per-event field set of §3.4, and the sequence-not-clock ordering rule. *(→ #79)*

**O6.** An actor slot on effect records. *(→ #79)*

**O7.** Run identity is stable, durable across controller restarts, and orderable by start
time. *(→ #79)*

**O8.** Store reads are lock-free for readers and torn-tail tolerant; nothing
operator-observable lives only in scheduler memory; journal identity is distinguishable so a
stale `Last-Event-ID` forces resync rather than a wrong resume. *(→ #79 — discharged by the
WAL SQLite decision)*

**O9.** The attempt record durably carries a **resolved transcript pointer plus worker
kind/format, captured at attempt start**. No later heuristic can recover it: Herdr drops the
reference at pane close, pi session paths are keyed on a worktree path that integration
deletes, and worker and reviewer share one cwd. *(→ #79, #86 — **discharged**: the pointer
is retained permanently in the digest tier, and the factory never deletes a transcript)*

**O10.** Run lifecycle and end-reason enums are operator-visible; preflight and baseline are
an observable phase with per-check and per-probe results; `controller-lost` is derived from
liveness and never self-asserted. *(→ #82 — **discharged**; the end-reason enum was widened to
seven members by #87, see §3.2)*

**O11.** The monitor service is session-scoped, idempotently started from a command or a run
started **from a tab**, torn down on `session_shutdown`, and rehostable from any tab; `status`
and `doctor` authenticate over loopback with the ephemeral token and must not require the
password path. The factory reaches it by a **typed `pi.events` request only** — never an
import, a spawn, or a fatal dependency. *(→ #82 — **discharged**)*

**O12.** The config surface carries `bind` (default `127.0.0.1`), an explicit port required
for non-loopback binds, the scrypt password hash plus salt, optional `tls.cert`/`tls.key`,
and the fail-closed rule that a non-loopback bind without a credential refuses to start. The
config file holding the hash is `0600`. **This surface now spans two extensions** — the
factory and `factory-monitor` — since the monitor ships as its own package. *(→ #84)*

**O13.** The two-tier retention shape and its pins; **expiring a run's detail must not orphan
its transcript pointers** — the pointer and the ticket → executions reverse index belong to
the permanently retained digest; the monitor never deletes a transcript, and a deletion the
factory chooses surfaces as `transcript-missing` rather than as silence. *(→ #86 —
**discharged**: pins are now four and are code constants, the horizon values are the only
configurable numbers, the factory's deletion call is **never**, and expired artifacts leave a
dated tombstone row)*

**O14.** The projection tables the monitor reads are a **versioned read contract**; a schema
change bumps the version rather than migrating silently. *(→ #79, new with §7.2)*

---

## 12. Pinned decisions

What this specification inherits, and from where.

| Ticket | State | Inherited |
|---|---|---|
| [#68](http://192.168.129.37:30008/minder/oh-my-slop/issues/68) Observation surfaces | closed, **partially superseded** | §3–§7 of the survey only: Gitea, Herdr, git, pi host, on-disk transcripts. §1, §2, §8.3, §9, §10 are **void** — never cite a seam number |
| [#69](http://192.168.129.37:30008/minder/oh-my-slop/issues/69) Run and event model | closed | §2, §3 |
| [#70](http://192.168.129.37:30008/minder/oh-my-slop/issues/70) Graph and unfolding | closed | §4, §5 |
| [#71](http://192.168.129.37:30008/minder/oh-my-slop/issues/71) UI prototype | closed | §6 hierarchy (variant B) |
| [#72](http://192.168.129.37:30008/minder/oh-my-slop/issues/72) Service and streaming | closed | §7 |
| [#73](http://192.168.129.37:30008/minder/oh-my-slop/issues/73) Retention and transcripts | closed | §8 |
| [#77](http://192.168.129.37:30008/minder/oh-my-slop/issues/77) Scheduling and claims | closed | §4 layout tie-break |
| [#79](http://192.168.129.37:30008/minder/oh-my-slop/issues/79) Durable state and events | closed | §7.2 store shape; O1–O9, O14 |
| [#81](http://192.168.129.37:30008/minder/oh-my-slop/issues/81) Verification and outcomes | closed | §3.1 enums, verbatim |
| [#83](http://192.168.129.37:30008/minder/oh-my-slop/issues/83) Worker trust | closed | §2.2 anomaly rationale; §8.4 primary control |
| [#82](http://192.168.129.37:30008/minder/oh-my-slop/issues/82) Controller lifecycle | closed | O10, O11 discharged; §7.2 store root and §7.3 start trigger corrected |
| [#84](http://192.168.129.37:30008/minder/oh-my-slop/issues/84) Configuration | closed | O12 discharged by `.pi/factory-monitor.json`, standalone and `0600` |
| [#85](http://192.168.129.37:30008/minder/oh-my-slop/issues/85) Bounded parallelism | closed | §3.7 readiness requirement; needed no amendment — saturation surfaces as journal events and in `status`/`doctor` |
| [#86](http://192.168.129.37:30008/minder/oh-my-slop/issues/86) Retention and ownership | closed | O9 (transcript half) and O13 discharged; §8.1 pins and configurability, §8.6 tombstones |
| [#87](http://192.168.129.37:30008/minder/oh-my-slop/issues/87) Factory specification lock | closed | §3.2 end-reason enum widened to seven members; all fourteen obligations checked off in [`software-factory.md`](software-factory.md) §16 |

**Amendment protocol.** Every ticket this specification waited on has now resolved and
amended it. Anything that **contradicts** a locked decision here reopens a ticket rather than
being silently edited in.

---

## 13. Deferred but specified

In this specification and build-ready, but outside the first shippable slice:

- The divergence band (§4.1).
- The cross-run accordion (§5.2).
- Progressive-edge resolution (§7.8) — below the 25-member threshold, eager resolution is
  the whole behaviour.
- TLS (§7.6).
- The run-index filter set (§8.2) — the ordered list itself ships.

**First shippable slice:** the three bands, the derived graph, runtime unfolding, the stage
inspector, transcript excerpts with redaction, and the credentialed listener.

**Two things are explicitly not deferrable.** **Redaction** guards the network boundary
§7.6 opened. **The availability axis** is woven through every renderer, so retrofitting it
means touching everything twice.

---

## 14. Out of scope

- Write controls of any kind — start, pause, retry, cancel, intervention.
- A separately managed daemon.
- Multiple repositories in one dashboard.
- Persisting complete transcripts.
- Scheduler recovery or replay.
- Changing serial execution or worker routing.
- As-of graph reconstruction — rejected as **impossible**, not undesirable (§4.1).

---

## 15. Amendment log

| Date | Change | By |
|---|---|---|
| 2026-08-14 | Initial lock. | #74 |
| 2026-08-15 | O10 and O11 discharged. §7.2 store root corrected to `getAgentDir()` / `PI_CODING_AGENT_DIR` — `PI_AGENT_DIR` is not a pi variable. §7.3 and O11 start trigger narrowed to runs started from a tab, since the shell binary is now the primary entry point; the factory reaches the monitor by typed `pi.events` request only. | #82 |
| 2026-08-15 | O9 (transcript half) and O13 discharged. §8.1 gains a **fourth pin** (an unresolved effect) and splits configurable horizon values from constant pins; §8.6 records that the factory **never** deletes a transcript, and that an expired digest-referenced artifact leaves a **dated tombstone row** rather than an unknown digest. §12 rows for #84 and #85 brought up to date. | #86 |
| 2026-08-15 | §3.2 end-reason enum widened to **seven** members — `abandoned` and `lease-lost` added, reconciling #82's list with #85's independently enumerated one. O10 annotated. The factory specification is locked at [`software-factory.md`](software-factory.md); all fourteen obligations are checked off in its §16, with O12 verified against #84's own resolution rather than this document's table row. | #87 |
