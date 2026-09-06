# Shared resource admission — contract v1

**Status: proposed for acceptance by #228 (part of #226); not deployed.** The repository
controller owns this interface to the operator-wide capacity authority. Acceptance freezes
v1; incompatible changes require a new contract-version ticket and blocking edges, not an
implementation-side amendment. [Operator-policy v1](operator-policy-v1.md), accepted by
#227, is an input and is not changed here. The Software Factory specification §9.10
incorporates this contract. The existing v2 runtime is unchanged.

The executable value boundary is
[`factory/lib/capacity/shared-admission-v1.mjs`](../../factory/lib/capacity/shared-admission-v1.mjs).
It validates requests and replies; it implements neither an allocator nor a transport.
Repository controllers validate both ends and retain immutable snapshots. A well-shaped
reply is not proof that a provider implemented durability, fencing or liveness correctly.
Those obligations require process-level evidence in the implementation tickets.

## Authority, enrollment and lifetime

There is exactly one authority for the enrolled `(operatorId, controllerHostId)` pair within
#227's OS-enforced managed boundary. Its durable namespace is
`/var/lib/oh-my-slop/factory/authority`; its local rendezvous is
`/run/oh-my-slop/factory/admission`. These are operator-owned, canonical managed mounts,
not per-repository paths, SDK agent roots, environment overrides or command-line options.
The rendezvous is a logical access point: v1 does not choose a socket protocol, daemon,
database engine or service manager. An implementation must preserve these names and semantics.
Test providers can use isolated fixture roots; production cannot relocate into a second root.

Enrollment records one random UUID `repositoryId`, its canonical Git common directory/root,
forge-qualified tracker identity, and repository store instance UUID. Worktrees and repeated
checkouts of the same registered repository cannot enroll as extra fair-turn identities.
Ambiguous clone/forge aliases require explicit enrollment resolution. Store replacement is a
reconciliation boundary, not permission to register a new empty repository. Roots and store
identities are looked up in this protected registry, never accepted from a mutation request.
Enrollment is migration's operator action, not an automatic side effect of inspection/attach.

An authority epoch is a durable, monotonically increasing positive integer. Restart or
ownership transfer increments it **before** serving mutations; the predecessor is excluded
from writes and launch authorization by the managed boundary. It never starts from an empty
ledger after loss/corruption. Unreadable state, an unexcluded predecessor, unknown epoch or
unreconciled ownership enters recovery-only service: inspect/reconcile/cancel/stop remain
possible where their evidence is available, but no new grants or launch authorizations.
Recovery checks all nonterminal grants, including repositories with no current controller.
The operator starts recovery explicitly when no repository controller is present; no resident
service is allowed to discover tickets or start runs on its own.

The authority may outlive any run, and its records must. Implementation may be a serialized
local library or a capacity-only service; no autonomous resident ticket scheduler is implied.
It never reads the Gitea frontier, claims work, creates attempts, starts runs or selects a
weaker role. Repository controllers remain run-scoped; Gitea remains readiness authority.
Independent hosts or independently mounted authority roots do **not** enforce one shared
limit. Such a deployment refuses enrollment until it has one explicit common authority;
remote-worker or multi-host coordination is outside v1. Rico serves inference only.

## Closed wire values

All records below have exactly the listed keys. Unknown keys/operations/versions and malformed
values refuse at the boundary. `UUID` means lowercase RFC UUID syntax; `ID` is #227's
`[a-z][a-z0-9_-]{0,31}`; `revision` is lowercase SHA-256 hex. Integers are nonnegative safe
integers unless positive is stated. Tokens are random 128-bit lowercase hex capabilities,
never PID/clock proof. Secrets and capability tokens must be redacted from reports; token
authentication uses constant-time comparison. Value guards do not authenticate tokens.

- `Authority = { operatorId: ID, controllerHostId: ID }`.
- `Owner = { repositoryId: UUID, runId: ULID, controllerId: UUID,
  generation: positive integer, token: token }`. `runId` retains §2.1's identity, including
  preflight. `controllerId` identifies one process incarnation; local lease generation/token
  are §4.6's actual capabilities. Generations are comparable only within one repository store.
- `Subject = { kind: "attempt", id: attempt_id, ticket: positive integer }` or
  `{ kind: "probe", id: UUID, purpose: "preflight" | "readmission" }`. An attempt ID must
  contain the owner's run and ticket and a positive attempt ordinal. Probe identity is persisted
  before any model use, including ticketless preflight; a recovery keeps it rather than minting
  another probe. Every review, repair and retry is an attempt, not exempt overhead.
- `Policy = { request, resolution }`, exactly the accepted #227 policy request and resolution.
  Admission requires `view: "applied"`, `state: "applied"`, matching enrolled identities and
  revision/provenance; a desired preview is never accepted as admission input.
- `Grant = { id: UUID, token: token, owner: Owner, subject: Subject, contenderId: UUID,
  policyRevision: revision, profileId: ID, bindingId: ID, resourceId: ID,
  aggregateSlot: integer, resourceSlot: integer, state, launchId: UUID | null }`.
  `state` is `held | launch-pending | running | released`. `held` has `launchId: null`;
  pending/running require a launch ID; released retains whatever launch ID it had.
  Both slots are owned indivisibly, never transferred/released separately. Binding/profile
  snapshots are pinned in the authority under the revision; the grant carries their identities.

`authority.exchange(request) -> Promise<reply>`. Transport errors reject the promise and mean
**unknown success**, not busy or a safe retry with a new identity. Invalid replies are protocol
errors with the same conservative recovery requirement. No raw transport/parser error is
copied to public evidence. The caller records a safe unavailable reason plus the pending
request ID, then inspects/reconciles before any launch, replacement or capacity reuse.

Every request starts with `{ contractVersion: 1, operation, requestId: UUID, authority }`.
Mutation requests additionally have `{ owner, epoch: positive integer }`; `attach` also uses
these fields, with the epoch obtained from inspection. Each new logical mutation gets a new
request ID recorded in the repository before sending it. Identical retries return the committed
reply; same ID with different payload is `payload-conflict`. Mutable contender offers are new
requests with the **same contender ID**. After busy/wait, reconsideration uses a new request
ID: replaying a busy request returns its original busy reply, not a new arbitration decision.
Deduplication is scoped by authority and repository,
not connection. Terminal request/grant/contender tombstones survive run expiry and remain
available until explicit drained protocol-version retirement; v1 has no clock-based deletion.

| Operation | Additional request fields | Success reply fields (beside envelope) |
|---|---|---|
| `inspect` | `repositoryId: UUID | null`; no owner/epoch | `status: "snapshot", snapshot` |
| `attach` | none beyond mutation fields | `status: "attached"` |
| `acquire` | `contenderId: UUID, subject, policy: Policy, offers: ID[]` | `status: "granted", grant` |
| `confirm` | `grant: Grant` | `status: "launch-authorized", grant` |
| `release` | `grant: Grant` | `status: "released", grantId: UUID, evidence: EndEvidence` |
| `reconcile` | `grant: Grant` (last known predecessor value) | `status: "reconciled", grant, liveness, adoptable: boolean` |
| `observe` | `grant: Grant, observation: RefusalObservation` | `status: "observed", availability: Availability` |
| `readmit` | same fields as acquire plus `availabilityRevision: integer` | `status: "granted", grant` (readmission probe only) |
| `wait` | `contenderId: UUID, after: integer` | `status: "changed", cursor: integer` |
| `cancel` | `contenderId: UUID` | `status: "cancelled", contenderId: UUID, grantId: UUID | null, evidence: EndEvidence | null` |
| `refresh` | `policyRequest` (#227 request with `view: "applied"`) | `status: "policy", resolution` (#227 resolution) |

An `offers` array is nonempty, unique, and names policy-enabled profiles, in controller-ranked
order. The controller proves role eligibility and qualification, retains §11.5 routing order/
utilization ranking and both review axes, and refreshes offers when observations change. The
authority chooses the first offer whose resource and aggregate dimensions are available when
that repository gets its turn. It cannot add offers, enable profiles, rewrite a minted route or
infer ticket readiness. `acquire` rejects a readmission subject; `readmit` requires one and
exactly one offered profile/resource. The result names an offered profile and its actual #227
binding/resource, and both slot indices are below the admitted policy's limits.

The reply envelope is `{ contractVersion: 1, operation, requestId, epoch, status, ... }`.
It echoes operation/request ID. `epoch` is positive except an unavailable authority or
incompatible peer may return null. Successful mutations match the requested epoch; epoch
mismatch is a refusal, never silently reattached. A received envelope on an unknown version
is a protocol error even if it claims a grant. A v1 compatibility refusal uses
`status: "incompatible", supportedVersions: positive integer[]` (nonempty, unique); it
never carries a grant. No downgrade, partial operation support or mixed-version launch.

All operations may return `status: "unavailable", reason, cursor: integer | null`:
`authority-unavailable | ownership-inconclusive | policy-unavailable | resource-disabled |
exhausted | authentication | endpoint-outage | no-eligible-route`.
They may return `status: "refused", reason`:
`identity-mismatch | boundary-unproven | stale-owner | epoch-mismatch | revision-conflict |
payload-conflict | invalid-transition | unknown-grant`.
Acquire/readmit may return `status: "busy", contenderId, reason, cursor: integer`:
`aggregate | resource | fair-turn | readmission-in-flight`.
None of these replies contains a grant or frees an old one. Refusal of a new request proves
no new grant for that request, not absence of a previously ambiguous acquisition. No admission
wait/refusal spends a worker repair, fresh-retry or automation retry budget.

### Inspection, observations and waiting values

`Snapshot = { cursor: integer, recovering: boolean, aggregate: Occupancy,
resources: ResourceStatus[], grants: Grant[], contenders: Contender[], policies: PolicyStatus[] }`.
Snapshot is one consistent authority read; a repository filter restricts grants/contenders/
policies, **not global occupancy**. This is a privileged controller/operator interface, not a
monitor response: the authenticated caller must be authorized for the requested repository or
operator-wide view, and tokens are stripped before any reporting. No stale cached success is
substituted for an unavailable read.

- `Occupancy = { limit: integer, held: integer }`; excess is `max(0, held - limit)`, never
  clamped away. All held/pending/running grants, including inconclusive ones, count once.
- `ResourceStatus = { resourceId: ID, occupancy: Occupancy, availability: Availability }`.
- `Availability = { resourceId: ID, revision: integer, state, retryAfter: integer | null,
  observationId: UUID | null }`; state is `available | disabled | exhausted | authentication |
  endpoint-outage | inconclusive`. `retryAfter` is authority-observed UTC epoch milliseconds,
  a not-before hint, never admission proof. Every non-available state blocks ordinary grants.
- `Contender = { id: UUID, owner: Owner, subject: Subject, offers: ID[], state,
  lastGrantSequence: integer, cursor: integer }`; state is `waiting | suspended | cancelled`.
- `PolicyStatus = { repositoryId: UUID, desiredRevision: revision | null,
  appliedRevision: revision | null, state: "applied" | "rejected" | "unavailable",
  reason: ID | null }`. Reason is a redacted #227 rejection code, not source text.
- `RefusalObservation = { id: UUID, kind: "exhausted" | "authentication" | "endpoint-outage",
  source: "harness" | "transport", evidenceDigest: revision, retryAfter: integer | null }`.
  Evidence is content-addressed, not a filesystem path or provider text. The authority validates
  correlation and re-observes the registered source; an unverified caller assertion cannot
  alter availability. Refusals are shared by resource identity, not model/URL/provider alias.
- `EndEvidence = { kind: "never-launched" | "proven-ended", observationId: UUID }`.
  This refers to the authority's durable gate/harness observation, never an outbox result.
- Reconciliation `liveness` is `proven-live | proven-ended | never-launched | inconclusive`.
  Proven-ended/never-launched return a released grant and `adoptable: false`; proven-live
  retains a running grant, with adoption only after identity and both fences are proven.
  Inconclusive retains an unreleased grant and `adoptable: false`.

`wait` is a bounded, cancellable notification read, not a reservation, a grant, or an automatic
retry. It returns changed cursor or the current cursor on a provider-bounded timeout; a caller
backs off on unchanged results. A disconnected waiter changes no contender state. `cancel`
is a durable operation, not merely aborting the wait's transport. Stop/abandon/lease loss break
local waiting immediately; if cancellation cannot be confirmed, its ID stays pending for
reconcile. Notifications can be lost: compare cursor and re-inspect on reconnect. No busy loop.

## Admission, claims and launch: recoverable boundaries

The authority serializes application, contention, all grant transitions and availability.
Durable commit precedes a success reply. Repository event/effect writes commit only in the
repository store. No transaction covers both stores, Gitea and Herdr.

1. Under the repository controller lease, persist owner, prospective subject identity,
   contender ID and request intent before acquisition. Reserving an attempt ordinal is not
   `attempt.launched`; only a recorded grant pins the eventual mint's route. Probes persist
   the analogous record before preflight model use. Re-read the Gitea frontier before offering
   unstarted work; do not claim merely to enter contention.
2. `attach` verifies current enrollment, managed boundary and the actual local controller
   lease through the registered store, then fences the previous controller incarnation at
   the authority. It is idempotent and grants no capacity. A local lease alone cannot mutate
   global holds, and a global attachment cannot replace the local lease. Every mutation and
   launch gate checks both; repository generations from different stores are never compared.
3. `acquire` observes current policy sources and applies/rejects them under #227's ordering,
   checks requested revision and ownership, and registers/updates the persistent contender's
   offers. Busy preserves that waiting contender; policy/resource unavailability suspends it
   until fresh validation. A granted contender is no longer eligible to receive another grant;
   its subject has at most one nonterminal grant. The authority then atomically owns **one aggregate and one
   resource slot**, records the grant and advances the repository's fair turn. Busy/refused
   creates neither partial slot. All pending grants count, not merely visible worker activity.
4. Record the returned grant and route locally. For an initial ticket execution, try its local
   ticket slot **nonblocking**, then record the capacity/claim intent and perform §3.3's claim
   and re-read. Local acquisition failure or a failed/lost claim cancels the entire contender/
   unlaunched grant before retrying another offer. Never wait holding a global grant for a
   local ticket slot, or hold one global dimension while asking for another. Later model phases
   retain the existing ticket slot; it is not a scarce resource another repository needs.
5. After a successful claim (or for a ticketless probe), write the immutable attempt/probe
   manifest, grant correlation and launch intent locally. `confirm` atomically changes `held`
   to `launch-pending` and assigns one stable launch ID, only while both owners are current
   and the authority is available. It confirms the **admitted snapshot**, not a new policy
   decision: an earlier grant may launch after a mode change, lower limit or rejected edit.
6. The managed launch gate consumes that launch ID **once**, checks current authority epoch
   and both fences at execution, durably records launch-pending before invoking Herdr and
   records running only after correlation. Retrying confirm returns the same ID; it does not
   authorize a second worker. An old reply is not an offline bearer permit. Authority loss
   bars consumption, while an already consumed launch remains accounted and is reconciled.
   There is no claim that gate storage and Herdr start commit atomically. An ambiguous start
   is probed, never blindly repeated; before an absent worker can be relaunched/released,
   exclude the old launcher and settle **every pending start invocation** so a delayed call
   cannot appear after the absence observation. If the adapter cannot prove that exclusion,
   hold capacity and report inconclusive. Fencing a launcher does not kill an existing worker.
7. A result may settle a pipeline outcome but cannot release model capacity. `release`
   invalidates unused launch authorization atomically and proves never-launched, or observes
   the correlated model worker ended with no pending start capable of reviving it. Only then
   are **both** slots released in one authority commit. An idle pane alone uses no model slot;
   an interactive harness still able to issue model calls retains its grant until confirmed
   stopped. Mechanical checks use no model slot. No capacity TTL or result-based shortcut.

| Crash/race boundary | Required recovery, never inference |
|---|---|
| Local intent committed, acquisition reply absent | Inspect by persisted contender/subject; retry the same request only under valid fences. Never acquire under a new identity to escape uncertainty. |
| Grant committed, local grant write absent/fails | Inspect finds the orphan grant; reconcile/cancel the whole grant. It cannot be partially reused or hidden by a missing repository record. |
| Local ticket acquisition or tracker claim fails | Cancel the contender and unlaunched grant atomically at authority; locally release only owned ticket/claim records. An ambiguous Gitea claim is re-read; do not clear a winner's assignee. |
| Claim committed, confirm not sent | Recover claim and local intent; continue under proven ownership or cancel the whole unused grant and settle the claim. |
| Confirm committed or Herdr call unanswered | Probe the durable launch ID plus subject correlation and fence pending launchers; do not launch a replacement or release on timeout. |
| Worker ended, release reply absent | Reconcile or repeat identical release; released tombstone confirms the whole grant. Local release event can follow, never precede proof. |
| Controller lease lost | Stale controller issues no new effects and exits 6, leaves run open. Successor attaches, reconciles all grants and pending requests; no local clock frees global holds. |
| Authority/store loss or liveness unanswered | Stop new grants/authorizations globally; retain live/unknown occupancy and surface recovery-only state. Restore/reconcile the authority, never recreate an empty allocator. |

`cancel` linearizes against acquire/confirm: if still waiting it tombstones the contender with
`grantId: null, evidence: null`; if granted but provably unlaunched it tombstones the contender
and releases the entire grant with EndEvidence. If a start is pending/live/unknown, it returns
unavailable/refused and retains the grant. It never stops a worker. A confirmed cancellation
cannot later be resurrected by a delayed acquire. Contender identity remains terminal; genuine
new work uses a new subject/contender without resetting repository fairness history.

## Fair turns and shared readmission

Fairness is **grant-based among eligible repositories**, not token volume, completion time,
connection count, worker count or guaranteed occupancy. The authority durably records a global
grant sequence and each repository's last successful sequence (initially zero). Among active
waiting repositories with an offer that can use currently free dimensions, choose the least
recently granted; ties use persistent first-contender registration order. Advance only on an
atomic successful grant, including a probe; failed claims do not refund the turn. Within one
repository the controller's existing ticket/pipeline ordering remains authoritative; it presents
one current next offer per free local lane/probe, not a backlog. Multiple contenders cannot give
one repository additional weight. No reservations, preemption, priority knobs or aging.

A continuously eligible repository receives a contested turn before a previously granted peer
gets another. A repository unable to use free resources is skipped, not promised reserved slots.
Updating offers/reconnecting retains contender identity and repository history. A cancelled,
ended-run or proven-stale controller's waiting contender is suspended/removed from eligibility;
a clock or broken connection can suspend waiting offers, but cannot release any grant. Reattach
and fresh frontier/offer validation are required to resume. Restart preserves turn history.
The authority remembers capacity demand only, never tickets' dependency graph or ready state.

An observed resource refusal advances one shared availability revision. Ordinary grants stop
for exhausted/authentication/outage/inconclusive resources; authentication and outage are never
mislabelled quota exhaustion. A not-before clock permits **considering** readmission, never
clears the state. `readmit` compares availability revision and applied policy atomically and
admits at most one resource's readmission probe at a time, under the same fair turns and
aggregate/resource slots. It may bypass the named availability block for the test, never policy
disablement, zero limits, another probe, fencing or unknown ownership. Its probe must retain a
policy-enabled/qualified runtime and the production binding.

Readmission evidence is settled by `reconcile` on that probe grant: the authority obtains the
correlated probe's result and liveness independently. Only a successful capability observation
**and** proven probe termination can clear the same availability revision. A newer refusal
wins over an older successful probe. Refused/inconclusive results retain or renew the shared
block and an explicit not-before hint; a clock alone never reopens it. Releasing/cancelling a
probe without successful evidence frees only its slots, never availability. Disabled resources
cannot be tested to implicitly enable them, and OpenRouter never becomes a fallback implicitly.

## Policy revisions, recovery and reporting

`refresh` is the authority's application boundary for #227: it observes sources, validates and
atomically applies/rejects under the same serialization as acquire/readmit. It returns the
unchanged #227 resolution schema. Acquire/readmit perform this boundary too; an old snapshot
receives `revision-conflict` and no new grant. A controller then refreshes its applied resolution
and reoffers, preserving contender/subject identity. A malformed operator edit suspends all
new admissions; a repository edit suspends that repository. Applied and rejected desired
revisions remain durable and observable. Already admitted grants retain their snapshots.
Resource identity rebinding/removal waits for all live/unknown grants and pending starts.
Lowered limits display excess occupancy and grant nothing in an overfull dimension.

In Owner, `runId` names the work being addressed, not necessarily the successor's new run:
under its current repository lease a successor can reconcile older/ended runs using their
original run IDs. Attachment fences controller incarnations repository-wide. Grant run/subject
identity is never moved into the successor's new run.

A successor's reconciliation distinguishes **proven-live**, **proven-ended/never-launched**,
and **inconclusive**. Proven-live adoption requires §5.5's complete worker identity plus both
fences; a live worker with a missing worktree/correlation is not dead and is not replaceable.
Return non-adoptable live ownership, retain its slots, and ask for recovery. Inconclusive
ownership suspends new global grants until reconciled, not merely one repository's grants.
Neither authority loss nor unanswerable liveness authorizes killing/replacing live workers.
Only normal operator stop/worker outcome policy can request the existing quit sequence; even
then release waits for proof. Abandon may end the run/release its ticket claim, but global model
holds and pending requests outlive it and stay in reconciliation scope and retention pins.

Shared-mode reporting must show authority identity/epoch/cursor, known versus unavailable
reads, recovering state, aggregate and per-resource limits/held/excess, global and selected
repository grants, profile/binding/resource identities, applied/rejected desired revisions,
shared availability/cooldown, contender wait reasons and operator action. Redact all tokens;
unknown occupancy is **not zero**. The repository records admission intent/resolution and
observations with authority epoch/cursor; they are external effects/observations under §4.5,
not local capacity events pretending to be global ownership. Projection payloads must be
versioned when wired, and cached observations labelled as-of, never used for new grants.

Temporary busy, exhausted, disabled, missing-route, authority-unavailable and policy waits
remain visible and stoppable in the existing run lifecycle (`preflight`, `running`, or
`draining` with a separate wait reason). They do not mean drained or baseline success, spend
no retry budget, and do not autonomously end a shared-mode run with legacy exit 9. Stop on an
unclaimed wait ends at the existing ticket boundary (exit 3); drain with claimed work may wait
for its required model phases; a second stop abandons (exit 4) and retains unresolved global
holds. Lease loss retains exit 6. No new lifecycle enum or CLI exit code is added here.
The monitor's exact global read/JSON projection contract belongs to #239; this is its source
interface, not a silent amendment of its current schema. `doctor --policy` remains #227's
read-only desired preview and never calls this authority.

## Verification boundary

`tests/node/factory_shared_admission_contract.test.mjs` exercises a repository-controller
consumer against a stub authority using the executable artifact: grants/busy/unavailable,
revision races, failed local acquisition/claims, stale owners, unknown success, recovery,
probe readmission, cancellation and version incompatibility. Stub replies demonstrate consumer
contract behavior, **not** interprocess exclusion, real liveness or allocator fairness.
Implementation tickets must prove every crash row with real filesystem/subprocess fixtures,
including two repository stores, delayed launch calls and a separately restarted authority.
No paid/live trial, deployment, installed configuration change, Factory run, higher ticket
ceiling or model selection is authorized here. #227's drain-before-migration/rollback and
OS-enforced legacy exclusion are unchanged prerequisites.

Glossary gap for the map owner: shared admission, authority epoch, grant, contender and
readmission are defined locally here; shared `CONTEXT.md` is deliberately not edited.
