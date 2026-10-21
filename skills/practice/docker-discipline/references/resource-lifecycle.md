# Docker resource lifecycle

Apply this policy before creating Docker resources for tests, reviews, prototypes or CI,
and close the lifecycle on successful, failed and blocked exits. It governs runtime
resources, not deletion of source worktrees or user files.

## Own before creating

Record the selected daemon/context and builder, exact Compose project, ordered files,
project directory, environment-file paths and explicit overrides. Give concurrent runs
unique project identities. Record resource names/IDs and inspectable owner/run/lifecycle
metadata; Compose project labels help establish provenance but do not grant disposal rights.

Classify each resource before creation:

| Class | Required lifecycle |
|---|---|
| Disposable run fixture | Explicitly owned containers, networks, database/cache volumes and helper images are removed at run closeout after saving required evidence. |
| Intentional cache | Name its owner, reuse scope, compatibility key, retention/size bound and cleanup mechanism. Shared caches are not a run's disposable resources. |
| Borrowed or durable state | Preserve pre-existing services, external volumes and valuable data unless their owner separately authorizes a change. |

**Done:** every planned resource has a known owner and disposition. A name prefix, age,
matching label or lack of container references alone does not make existing data disposable.

## Bound reuse

Keep test caches warm across reruns **within the owned run**. Persisting `.pytest_cache`
for `--lf` does not require keeping a new volume after every run. Use a run-owned bind
mount or disposable volume; retain it longer only under an explicit cache policy.

Prefer dependencies installed from the lockfile into the image, with selective source
mounts or an environment outside a whole-checkout mount. Avoid creating a persistent
`.venv` volume per worktree/job merely to compensate for a bind mount hiding the baked
environment. If a reusable environment is justified, isolate mutable writers and key it
by lockfile, interpreter and platform under a bounded cache policy.

**Done:** caches have a bounded lifetime and reuse cannot mix incompatible environments.

## Close the exact scope

Register cleanup before startup. Retain needed logs/reports outside disposable resources,
then run finalization on success, failure and ordinary cancellation. Preserve the original
test/command exit status and report cleanup failures separately; a cleanup error must not
turn a failed test into success or disappear behind a successful final command.

Use the original daemon, project and complete Compose invocation, not a directory-derived
default. `run --rm` removes the one-off container, not dependent services or named volumes;
`down` alone also leaves named volumes. For a wholly owned disposable project, teardown is
`docker compose <original scope arguments> down --volumes --remove-orphans`. Use orphan
removal only when the entire project is exclusive to this run. For mixed ownership,
remove only explicitly identified run-owned resources; preserve borrowed services/state.

Remove disposable helper images only by recorded identity after checking consumers and
retention needs. Do not remove a reused/shared image just because its tag matches a run.
Shared builder cache needs its owner's GC policy, not per-run pruning. Retain a temporary
image only with a recorded owner, reason and expiry.

**Done:** inspect the recorded resources and verify disposable containers, networks,
volumes and temporary images are absent; verify borrowed resources remain. Report exact
leftovers, failures and the responsible recovery owner. A stopped stack is not proof that
its volumes were removed. If Docker is unavailable, record cleanup as unverified rather
than claiming a clean closeout. Preserve source worktrees independently of runtime cleanup.

## Recover abandoned CI runs

When authoring CI, provide an unconditional finalization step and an owner-approved stale-run
recovery path. Shell traps and CI finalizers cannot guarantee cleanup after SIGKILL, runner
loss or host failure. Recovery must check explicit ownership, configured age/expiry, job
inactivity and Docker references (including stopped containers); ambiguous resources stay
for owner review. Verify success, test failure, cancellation and stale-run recovery against
isolated disposable fixtures, including a neighboring project that must survive.

Bound intentional caches, images/build cache and logs separately; BuildKit GC does not
remove named volumes. Record pending retention choices or missing janitor ownership rather
than silently deploying a host-wide cleanup service or inventing a retention period.

**Done:** normal teardown and crash recovery have scoped verification and accountable owners.

## Inspect before deleting

Use Docker's read-only inventory and inspection commands for diagnosis. Obtain scoped
disposal authority before removing existing data; explain permanent loss and recovery
prerequisites. Use Docker APIs for removal, not raw deletion inside its storage directories.
Daemon-wide prune commands are not a substitute for ownership checks on a shared host.
