# Operator inventory and effective policy — contract v1

**Status: proposed for acceptance by #227 (part of #226); not deployed.** This is the
consumer-owned interface between repository-scoped Factory commands/controllers and the
operator inventory resolver. Acceptance freezes v1; incompatible changes require a new
contract-version ticket and blocking edges before affected consumers start.

The executable boundary is [`factory/lib/config/operator-policy-v1.mjs`](../../factory/lib/config/operator-policy-v1.mjs).
Its guards validate values, not files, credentials, host identity, revision history, or grants.
The resolver and application/admission implementation are deliberately absent in this slice.
The [Software Factory specification](software-factory.md) §11.9 incorporates this contract;
its v2 runtime remains unchanged until the migration and admission tickets land.

## Discovery and versions

1. Resolve the invocation's Git root exactly as §11.1; read only
   `<repository root>/.pi/factory.json`. A nearer file never shadows it. No `--config`.
2. Shared repository documents use `schemaVersion: 3`. They name `operatorId`, not an
   inventory pathname or an arbitrary authority address. No v2/v3 automatic fallback.
3. The managed execution boundary mounts exactly one read-only operator inventory at
   `/etc/oh-my-slop/factory/operator.json`, with `schemaVersion: 1`. This is neither an
   XDG default nor a merge layer. It is operator-owned, not writable by repositories or
   workers. The resolver verifies owner/access restrictions and canonical mount identity.
   Symlinks escaping the managed mount refuse. Test fixtures may mount a synthetic root;
   production accepts no environment or command-line relocation channel.
4. That inventory identifies one `operatorId` and `controllerHostId`, stable opaque IDs
   assigned explicitly at enrollment, not derived from username, hostname, URL, provider,
   model, or credentials. Enrollment binds them to the managed boundary out of band.
   Copying the file onto another host does not enroll it. An identity mismatch refuses.
5. The resolver accepts contract version 1 only. Inventory v1, repository v3, and result v1
   are separate version domains. Unknown versions, missing/unknown keys at any depth,
   unresolved references, JSON parse failures (including duplicate object keys), and
   residual `TODO` sentinels refuse. Unsupported versions never negotiate down silently.
6. Repository/tracker remote identity checks still apply, including the forge host, not just
   the `owner/repo` slug. No read makes an unregistered repository a participating run.
   Registration and authority transport belong to the shared-admission contract.

## Closed configuration schema

All fields listed below are required unless explicitly marked optional. IDs and map keys
match `[a-z][a-z0-9_-]{0,31}`; revisions are lowercase SHA-256 hex. Strings are nonempty,
trimmed and single-line. Maps may be empty unless stated otherwise. Integers are safe
integers. No numeric worker capacity or model selector defaults are introduced here.
All referenced objects must exist, including references from dormant entries and modes.
Disabled is not incomplete: a disabled profile still has a valid exact runtime selector.
An unqualified resource/profile is kept disabled until the separate human gate approves it.

### Operator inventory v1

| Field | Type and rule |
|---|---|
| `schemaVersion` | literal `1` |
| `operatorId`, `controllerHostId` | stable IDs, matched to enrollment |
| `resources` | map of resource ID to Resource |
| `bindings` | map of binding ID to Binding |
| `credentials` | map of credential ID to Credential reference; never secret bytes |
| `profiles` | map of profile ID to Profile |
| `aggregateLimit` | integer ≥ 0; hard ceiling, zero suspends new admission |
| `modes` | nonempty map of mode ID to Mode |
| `activeMode` | existing mode ID; selected only here, never by a repository or env |

Resource: `{ identity, enabled, limit }`.

- `identity` is exactly `{ kind: "gpu", hostId, deviceId }` or
  `{ kind: "account", provider, accountId, quotaId }`. GPU IDs name a physical host/device;
  account IDs and quota IDs are nonsecret operator-confirmed provider identities. A subscription
  and API credits are not interchangeable quota identities. All values are IDs.
- `enabled` is a boolean, independent of mode membership; `limit` is an integer ≥ 0.
- No two resources may declare an identical physical/quota identity, even while disabled.
  Resource IDs are aliases for these identities, not authority to create capacity.

Binding: `{ resourceId, credentialId, endpoint }`.

- `resourceId` must exist. `credentialId` is a credential ID or explicit `null` for an
  endpoint whose managed network access is its authentication boundary.
- `endpoint` is explicit `null` for a supported runtime's hosted connection, or
  `{ env, url }`. `env` follows §6.8's declared-environment predicate; `url` is absolute
  HTTP(S), without userinfo, query, or fragment (none can carry secrets into evidence).
- A GPU binding requires an endpoint. An account binding requires a credential reference.
- A credential reference cannot bind two different resources. All credential mechanisms
  accessing one shared quota bind the same resource, not just credentials with equal names.
- Equal canonical endpoint URLs cannot bind different resources. Different aliases, schemes,
  paths or ports are **not** evidence of independence: enrollment must prove their physical
  bindings, or ask which host/device serves each. No DNS-based guessing or pool splitting.
- Several ports/models on one GPU bind that one Resource; independent GPUs on one host can
  be separate only with explicit device identities. Independent accounts with the same provider
  remain separate. If separate apparent quotas overlap, enrollment refuses until the operator
  identifies one shared quota resource or proves independence. v1 admits one resource per
  attempt; overlapping multi-resource quota hierarchies are not silently approximated.
- A binding's resource identity is immutable while any live/unknown hold refers to it.
  Rebinding, retirement or identity correction requires drain and reconciliation first.

Credential reference: `{ kind: "runtime-auth", runtime, name }`.
`runtime` is `pi | claude`; `name` is an opaque ID resolved by the managed boundary to an
existing supported runtime credential mechanism. It is not a file path, env name, token,
or promise that subscription login works. Unknown references refuse at enrollment even
when dormant; an enrolled but expired/unavailable credential is an availability problem,
not an unresolved reference. Enabled routes need capability evidence; disabled routes are
not live-probed. Runtime-specific promotion preserves §6.8's isolation and secret redaction.
No new provider or authentication implementation is authorized by this contract.

Profile: `{ enabled, bindingId, runtime }`.
`bindingId` must exist; `enabled` is a boolean. `runtime` has §11.4's `kind`, `model`, and
optional `thinking` (pi only), `effort` (claude only), `startupTimeoutMs`,
`attemptTimeoutMs`, `noProgressTimeoutMs` (positive integers). Thinking/effort retain the
existing closed vocabularies. Pi's model is an exact `provider/model` selector; the existing
Opus/Fable-on-pi refusal remains. Endpoint is owned by Binding, not Profile. A referenced
credential must match the profile runtime. Profile permissions, resource overrides, and
arbitrary env are not fields. No installed model spelling is supplied by this contract.

Mode: `{ aggregateLimit, resources }`, where `resources` maps existing resource IDs to
integer ceilings ≥ 0. The aggregate ceiling cannot exceed inventory `aggregateLimit`;
each resource ceiling cannot exceed that resource's `limit`. Omitted resources are disabled
in that mode. Every mode, including inactive modes, validates. No mode can enable an
inventory-disabled resource. No implicit paid fallback exists.

### Repository policy v3

Exactly `{ schemaVersion, operatorId, tracker, git, routing, checks, concurrency }`, plus
optional `budgets`, `retention`, `package`, `worker`.

- `schemaVersion` is `3`; `operatorId` must equal the enrolled inventory identity.
- `tracker`, `git`, `checks`, `budgets`, `retention`, `package`, and `worker` retain §§11.2,
  11.6–11.7 and 6.8's closed schemas and existing defaults. The guard validates their
  structural/semantic rules; the resolver also cross-checks real Git/forge/enrollment facts.
- `concurrency` is exactly `{ maxTicketExecutions }`, positive and subject to the unchanged
  code-owned supported ticket ceiling at application. No `resources` key or worker cap.
- `routing` retains §11.5's roles, label rules, fallback orders, pooling and named sets,
  but every profile name references the operator inventory. Dormant/disabled profiles are
  valid references, never automatically dispatchable. Both review axes remain explicit.
- An explicit request's `routingSet` selects an existing named set; `null` uses
  `routing.activeSet`, then the file-level routing. This is selection within repository-owned
  policy, not precedence over operator enablement/limits. The effective selected name is recorded.
- Repository `profiles`, `modes`, `bindings`, `credentials`, `aggregateLimit`, and resource
  sizes are forbidden ownership conflicts, not values to merge, clamp or warn about.
- `worker.piExtensions[].env` cannot redeclare any inventory binding's endpoint env, even
  with an equal value. Resource authentication and endpoint selection cannot enter through
  per-run overrides, inherited env, model-catalogue aliases or extension settings. The managed
  boundary must constrain actual connections to the admitted binding; metadata alone is not
  enforcement. Other worker permission additions can only strengthen the established floors.

## Consumer seam and effective policy v1

`resolver.resolve(request) -> Promise<resolution>`; local transport errors reject the promise.
Consumers validate both ends with `assertPolicyRequest` / `assertPolicyResolution` from the
executable artifact. A transport or boundary-validation error permits no policy-dependent
work. Resolving is read-only: it neither applies edits, grants capacity, claims tickets, nor
starts/probes models. The result is a snapshot, **never a launch permit**.

Request: exactly `{ contractVersion: 1, repositoryRoot, routingSet }`.
`repositoryRoot` is the canonical absolute root discovered above; `routingSet` is an ID or
`null`. There is no operator path, mode, capacity, credential, or env override input.

Resolution: exactly `{ contractVersion: 1, state, desiredRevision, appliedRevision, policy,
rejection }`.

| Field | Rule |
|---|---|
| `state` | `applied | rejected | unavailable` |
| `desiredRevision` | observed candidate revision; `null` exactly for `authority-unavailable` |
| `appliedRevision` | last committed effective revision or `null` before first application |
| `policy` | EffectivePolicy only when `applied`; otherwise `null` (no stale dispatch object) |
| `rejection` | `null` when applied; otherwise `{ code, scope, at, question }` |

`scope` is `operator | repository`; `at` is a safe structural location, never offending
values or source text. `question` is a focused operator question or `null`; required for
`ambiguous-binding`. Closed codes: `invalid-document`, `unsupported-version`,
`ownership-conflict`, `unknown-reference`, `ambiguous-binding`, `identity-mismatch`,
`boundary-unproven`, `revision-conflict`, `source-unavailable`, `authority-unavailable`.
The last two use `unavailable`; other codes use `rejected`. No result contains secrets,
parser excerpts, access tokens, or credential source locations.

EffectivePolicy is exactly `{ operator, repository, routingSet, limits, profileAvailability,
provenance }`:

- `operator` and `repository` are complete validated snapshots of the two documents above.
  This partition preserves disjoint ownership rather than returning a merged config that could
  be mistaken for v2. Existing code-owned defaults remain absent in the source snapshots;
  the implementation's project-policy loader materializes only those documented defaults.
- `routingSet` is the selected set name or `null` for file-level routing.
- `limits` is `{ aggregate, resources }`: aggregate equals the active mode's ceiling;
  resources contains **every** inventory resource exactly once. Its value is zero when
  inventory-disabled or omitted from the mode, otherwise its mode ceiling. Limits are not
  occupancy, available slots, spend limits, or promises of measured sustainable capacity.
- `profileAvailability` contains **every** profile exactly once, valued
  `enabled | profile-disabled | resource-disabled | mode-disabled | zero-capacity`.
  First matching reason in that order of restrictions wins: disabled profile, disabled
  resource, absent mode membership, zero resource/aggregate ceiling, otherwise enabled.
  Enabled means policy permits consideration, not that the repository routes to it, its
  capability is qualified, its endpoint is live, its quota is available, or admission is free.
- `provenance` is exactly `{ operatorFile, operatorDigest, repositoryFile, repositoryDigest }`.
  Files are the canonical paths above, digests hash exact source bytes, not normalized JSON.
  The resolver guarantees snapshots came from those bytes. Guard validation alone cannot.
- Applied responses require `desiredRevision === appliedRevision`, a non-null revision,
  matching operator IDs, and a repository path matching the request. They preserve the selected
  routing semantics. Consumers keep revision/provenance in manifests and admission requests;
  the shared admission contract must reject stale revision preconditions atomically.

## Revision and application lifecycle

A source observation is `{ state: "read", digest: <SHA-256 of exact bytes> }`, or
`{ state: "missing" }`, or `{ state: "unreadable" }`. Hash the UTF-8 compact JSON array
`[1, operatorObservation, repositoryObservation, requestedRoutingSet]`, using field order
as written here, to identify the desired effective revision. Raw bytes hash even when JSON
is malformed; missing/unreadable are explicit observations, never an empty document. The
same bytes and selector identify the same candidate. An authority outage is not an observed
file revision: its unavailable response has `desiredRevision: null`.

The operator application owner serializes **observation → validation → application** with
admission. File writes are desired state only, not grants; atomic rename is recommended but
does not constitute application. Each admission must establish current source observations
under that ordering (a watcher alone is insufficient), compare the requested applied revision,
and grant or refuse in the authority's serialization order. An edit racing that observation
belongs to the next observation boundary; no filesystem/DB cross-transaction is claimed.
Multi-file staged edits use the last coherent applied snapshot until the next observation,
then either apply the complete validated candidate or reject; never merge partial candidates.

- Apply an inventory revision all-or-nothing after validating the whole inventory and its
  references against every enrolled repository's pinned policy. Removing a profile still
  referenced by any repository rejects the operator revision, not just that repository.
- A repository edit is validated/application-committed atomically for that repository only.
  During a run, routing, checks, budgets, ticket concurrency and permission policy remain
  pinned to its repository revision. Changed repository bytes pause new admissions for that
  repository as `revision-conflict`; adoption/stop and already admitted attempts remain valid.
  Drain all its runs before applying the new repository policy. Operator mode/enablement/limit
  edits are different: they apply across running controllers immediately at admission order.
- **Malformed/invalid operator edits suspend all new participating admissions; malformed/invalid
  repository edits suspend that repository only.** Keep the last applied revision for history,
  reconciliation and already admitted attempts, but return `policy: null` on rejection.
  No last-known-good admission fallback, deletion fallback, or automatic downgrade exists.
- Rejected desired revision, scope, safe code, last applied revision and an operator action
  are durably observable. Read-only resolution/doctor can report them with an invalid file;
  it does not secretly apply it. The applying owner records observations and rejections.
- Correcting the file revalidates the whole candidate. Restoring prior valid bytes is allowed
  but must explicitly clear the suspension under the same serialized application boundary;
  matching an old digest alone never clears a rejection or proves the authority is live.
- Already admitted attempts keep their grant and immutable binding/profile snapshot; they may
  launch after a mode change and finish. Identity changes/removals wait for all live or unknown
  holds to reconcile. Lower limits expose draining excess occupancy and grant nothing in an
  overfull dimension until both dimensions permit admission. No preemption or raised ticket cap.
- Applied snapshots/rejection records survive authority/controller restarts. A lost authority
  permits no new admission or unconfirmed launch. Already running workers are not killed.
  Cross-store grant recovery and how an existing grant confirms launch belong to #228, not
  this read interface. Unknown liveness never releases capacity.

## Migration, compatibility and rollback boundary

The operator explicitly approved an **OS-enforced managed execution boundary** for shared
mode in #227. This is a deployment prerequisite, not something this contract deploys.

- Drain all legacy controllers and model-using probes, reconcile live/unknown work, preserve
  exact original configs and state in exclusive-create backups, then enroll resources and
  repositories. Migration produces a reviewable v3 draft; it does not auto-enable resources,
  invent selectors/capacities, mutate installed consumer settings, or discard dormant profiles.
  Endpoint aliases/ports and provider prefixes are insufficient evidence for resource identity;
  report a focused binding question rather than emitting apparently independent pools.
- Required enforcement: the boundary's operator-owned executable policy permits only approved
  package digests/contract versions for controller/admission execution; mutable scripts, dynamic
  imports, interpreters, old binaries and worker command execution cannot escape that rule.
  Runtime model connections must pass through access controls tied to admitted bindings/grants.
  Workers may run arbitrary project checks but may not reuse promoted credentials or direct GPU
  access to start an unaccounted Factory/model client. A dedicated UID alone is insufficient.
- Shared credentials/endpoints must be inaccessible to legacy paths outside that boundary:
  rotate/revoke old credential copies and enforce endpoint ingress/egress controls as needed.
  Qualification must demonstrate denial with an actual old binary, alternate executable paths,
  old credential copies and direct endpoint access, using non-paid stubs first. Merely putting
  a wrapper earlier on PATH, updating a symlink, setting a minimum-version marker, or trusting
  old code to read new state is not exclusion. If the deployed subscription mechanism cannot
  meet these restrictions, that resource remains disabled; ask for an enforceable gate.
- Enrollment records verified boundary identity and supported versions. New binaries refuse
  shared startup/admission as `boundary-unproven` unless the deployment attestation is current.
  Attestation records evidence; it does not replace OS/resource enforcement. No mixed legacy
  controller is allowed inside a boundary claiming global enforcement. No new shared command
  silently interprets v2 as globally accounted; standalone v2 behavior remains legacy-only.
- Guarantee limits: one managed controller host and its participating Factory clients. Root,
  a privileged operator changing enforcement, independent hosts, unrelated interactive clients,
  and external GPU users are outside the guarantee. If external access cannot be separated,
  report that exclusion cannot be proven and do not claim global enforcement. Factory's limits
  do not imply exclusive GPU access or provider quota reservations outside this boundary.
- Rollback first suspends new admissions, drains and reconciles **every** global attempt/probe
  hold, including unknown liveness and pending launches, and verifies no shared controller can
  restart/admit. Only then may an operator restore preserved v2 config/state and re-enable
  independent accounting/access. Preserve the global ledger and revisions for audit; never
  convert live global holds into independent local holds or delete them to make rollback pass.
  Unknown holds block rollback. No rollback or credential operation is executed by this slice.

## Acceptance evidence and remaining boundaries

`tests/node/factory_operator_policy_contract.test.mjs` is a consumer test against a stub
resolver, importing the same guards future resolver/consumers must use. Synthetic selectors,
IDs and limits in tests are not operator settings or capacity evidence. It proves the wire
contract, not filesystem discovery, durable application, deployment exclusion or dispatch.
Those process/ownership boundaries require real filesystem/subprocess tests in their owning
implementation tickets; no fake multi-process proof is claimed here.

#228 consumes revision preconditions and operator identity; migration and doctor consumers
consume the document shapes, refusal codes and provenance. Existing native blocking edges
must remain until this contract is accepted. The glossary currently lacks operator inventory,
resource binding and effective policy; these terms are defined here for this interface. The
map owner owns any shared `CONTEXT.md` addition, not this parallel implementation slice.
