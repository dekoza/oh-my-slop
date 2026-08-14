# Hostile adoption audit: Babysitter vs Software Factory #75

**Status:** Decision evidence for Gitea map [#75](http://192.168.129.37:30008/minder/oh-my-slop/issues/75) and its decision tickets. This is not a recommendation to depend on Babysitter or to copy its architecture.

## Verdict

Remove Babysitter. Do not adopt its SDK, process model, Pi extension, journal implementation, lock implementation, scheduler, doctor skill, or cleanup flow.

There are **six ideas worth reimplementing narrowly** inside the factory contracts:

1. separate canonical events from rebuildable projections;
2. represent external work as requested/resolved effects with semantic idempotency keys;
3. persist schema-versioned task/result envelopes with artifact references;
4. distinguish completed, intentional halt, worker failure, and controller/process failure;
5. expose machine-readable status, event inspection, projection rebuild, and dry-run repair plans;
6. carry concurrency intent as data while the scheduler owns actual capacity arbitration.

None is a missing product concept in #75. Babysitter is useful mainly as implementation evidence and as a catalogue of traps. The open tickets that should consume the evidence are [#79](http://192.168.129.37:30008/minder/oh-my-slop/issues/79), [#81](http://192.168.129.37:30008/minder/oh-my-slop/issues/81), [#82](http://192.168.129.37:30008/minder/oh-my-slop/issues/82), [#84](http://192.168.129.37:30008/minder/oh-my-slop/issues/84), [#85](http://192.168.129.37:30008/minder/oh-my-slop/issues/85), and [#86](http://192.168.129.37:30008/minder/oh-my-slop/issues/86).

## Evidence boundary

The audit used four primary surfaces:

- the full bodies and comments of Gitea [#75–#87](http://192.168.129.37:30008/minder/oh-my-slop/issues/75), fetched with explicit repository scope;
- the installed Pi package **@a5c-ai/babysitter-pi 6.0.3**;
- the exact published npm artifact **@a5c-ai/babysitter-sdk 6.0.3**, tarball integrity `sha512-+gN0CSdbexwSH+kxgNQuG9xfXxkFpnyCT7HnANgRpebh327/VbFzqNCbb4VCvKuiDNjOUps2WjAJReSHJsruXw==` ([registry tarball](https://registry.npmjs.org/@a5c-ai/babysitter-sdk/-/babysitter-sdk-6.0.3.tgz));
- the actually resolved global `babysitter` executable, which is the obsolete **@a5c-ai/babysitter-sdk 0.0.187**, plus globally installed **@a5c-ai/babysitter-pi 0.1.3**.

The published 6.0.3 SDK and Pi package declare MIT. Reimplementation is still preferable to copying: the factory has a narrower boundary, different durable authority, and stronger recovery and Git guarantees. Any literal copied code would also require preserving its licence notice.

## Steelmanned Babysitter thesis

Babysitter's strongest claim is coherent: deterministic process code replays against an append-only journal; side effects become durable requested/resolved records; harness differences sit behind adapters; run state can be inspected and rebuilt; breakpoints provide human control; and parallel effect groups allow bounded execution. That is a credible generic workflow engine.

The factory is not a generic workflow engine. Gitea already owns the durable delivery graph, named skills own worker process, Herdr owns agent lifecycle, and the controller owns integration. Importing Babysitter would create a second graph, second session lifecycle, second plugin system, second retention model, and second operator vocabulary.

## Highest-risk findings

### 1. The installed Pi bridge is broken and hides the breakage

The installed package declares `"type": "module"`, but every proxied hook file is a `.js` file using CommonJS `require()`. Executing the installed stop bridge fails immediately with `ReferenceError: require is not defined in ES module scope`. If that were corrected, the bridge next invokes `hooks/stop.sh`, which is absent from the installed package. The same target class is absent for session start and the other proxied hooks.

The extension's `runProxiedHook()` catches every bridge exception and returns `{}`. Session-start and stop-hook failures therefore become silent no-ops. This is exactly the opposite of #75's rule that infrastructure and protocol failures are automation failures.

Sources: [Pi package manifest](https://unpkg.com/@a5c-ai/babysitter-pi@6.0.3/package.json), [extension entrypoint](https://unpkg.com/@a5c-ai/babysitter-pi@6.0.3/extensions/index.ts), and [proxied stop bridge](https://unpkg.com/@a5c-ai/babysitter-pi@6.0.3/hooks/babysitter-proxied-stop.js).

**Factory lesson:** preflight must execute the production bridge, not merely discover files or commands. A bridge may exist, load, and still be behaviorally dead. Never convert launch, protocol, or lifecycle errors into an empty success-shaped value.

### 2. Version identity is split across three installations

The active Pi package is 6.0.3 and its versions file asks for SDK 6.0.3. The `babysitter` executable on `PATH` resolves to SDK 0.0.187, installed through a separate global Pi package 0.1.3. Package discovery can therefore say "installed" while the invoked runtime is from a different release family.

**Factory lesson:** #84 should require an executable handshake that records resolved binary path, package identity, exact version, and artifact hash. A manifest version is not proof of the process that will execute.

### 3. The event journal is not an integrity boundary

The 6.0.3 journal has useful mechanics: one event per file, monotonic filenames, atomic writes, a per-event SHA-256 checksum, and an in-process append queue. It does **not** verify checksums while loading. Its replay index validates filename sequence and ULID order but discards each event checksum when constructing the journal head. The projection comparison only compares checksums when both sides have one, so a missing checksum weakens the comparison silently.

The checksum covers only `{type, recordedAt, data}`. It does not bind sequence number, event ID, or previous event hash. It therefore detects some content edits only when a separate doctor remembers to recompute it; it does not make deletion, reordering, renaming, or history replacement tamper-evident.

The append queue is process-local. Two controller processes can both read the same maximum sequence and write distinct files with the same sequence. The obsolete installed SDK was dynamically probed with twelve concurrent appends and produced twelve sequence-1 events; current 6.0.3 fixes only the same-process form.

Sources: [journal implementation](https://unpkg.com/@a5c-ai/babysitter-sdk@6.0.3/dist/storage/journal.js), [effect replay index](https://unpkg.com/@a5c-ai/babysitter-sdk@6.0.3/dist/runtime/replay/effectIndex.js), and [state cache](https://unpkg.com/@a5c-ai/babysitter-sdk@6.0.3/dist/runtime/replay/stateCache.js).

**Factory lesson:** steal the event/projection split, not this journal. #79 needs one serialized writer or transactional append, an event envelope containing identity and causal predecessor, mandatory verification during every replay, and fail-closed projection-head comparison.

### 4. The lock is a PID file, not a recoverable lease

The lock stores PID, owner text, and acquisition time. Staleness is decided by PID liveness alone. It has no random ownership token, host/boot identity, process start time, expiry, renewal, or compare-and-delete release. `releaseRunLock()` unconditionally removes the path. PID reuse and replacement races can therefore make an unrelated live process look like the owner or let one owner remove another owner's lock.

The runtime can hold this lock around an entire orchestration iteration. A hung iteration has no lease expiry or fencing token.

Source: [lock implementation](https://unpkg.com/@a5c-ai/babysitter-sdk@6.0.3/dist/storage/lock.js).

**Factory lesson:** #79 needs an inspectable lease with a random holder token and fencing generation. Recovery should prove ownership against durable controller/session evidence; it must not infer ownership from PID liveness.

### 5. User-controlled identities can escape the state root

`createRun()` validates only that `runId` is a non-empty string. `getRunDir()` joins it directly to the run root. A value such as `../escaped` resolves outside that root. The obsolete installed SDK was dynamically probed and created the escaped directory; the 6.0.3 source retains the same validation and path construction.

Sources: [run creation](https://unpkg.com/@a5c-ai/babysitter-sdk@6.0.3/dist/runtime/createRun.js) and [storage paths](https://unpkg.com/@a5c-ai/babysitter-sdk@6.0.3/dist/storage/paths.js).

**Factory lesson:** every run, ticket, phase, attempt, artifact, branch, and pane identity must be parsed as a typed value before path construction. Resolve and prove containment under the controller-owned root after canonicalization.

## Coverage against #75 and every subticket

| Ticket | Babysitter overlap | Hostile assessment | Disposition |
|---|---|---|---|
| [#76](http://192.168.129.37:30008/minder/oh-my-slop/issues/76) foundations | Generic harness adapters, events, effects, breakpoints | Adds evidence but does not overturn the closed decision. Its Pi bridge demonstrates why native inventory and live invocation probes are necessary. | Add as adverse evidence; inherit no module. |
| [#77](http://192.168.129.37:30008/minder/oh-my-slop/issues/77) tracker scheduling | Internal process/effect graph and in-memory priority queue | No Gitea frontier, dependency closure, claim arbitration, human ownership, or drain classification. Its graph would violate the sole-durable-delivery-graph decision. | Reject. |
| [#78](http://192.168.129.37:30008/minder/oh-my-slop/issues/78) worker launch/result | Harness adapter interface; effect/task/result IDs; schema versions; stdout/stderr references | No Herdr lifecycle, package skill closure, native skill preflight, interactive pane contract, or first-signal outbox/liveness table. `invocationKey` is optional when posting a result, weakening correlation. | Reimplement only the envelope pattern. |
| [#79](http://192.168.129.37:30008/minder/oh-my-slop/issues/79) events/reconcile/locks | Closest overlap: append-only journal, replay index, projection rebuild reasons, task effects, run lock, repair command | Valuable shape, unreliable primitives: no load-time checksum verification, no hash chain, process-local append serialization, PID-only lock, weak path validation, and repair that rewrites history. | Primary source of positive and negative design evidence. |
| [#80](http://192.168.129.37:30008/minder/oh-my-slop/issues/80) Git lifecycle | Prompt-level Git safety and a check for leaked run work directories | No private bare clone, fetch-pinned base, attempt branch/worktree, rebase evidence ref, integration predicates, safe publication, or PR lifecycle. | Nothing substantive to adopt. |
| [#81](http://192.168.129.37:30008/minder/oh-my-slop/issues/81) verification/outcomes | Result schema validation; `completed`, `halted`, `failed`, `process-error`, cancellation; breakpoint effects | No controller-rerun mechanical checks, independent two-axis review, reviewer mutation attestation, repair budget, or factory-specific outcome taxonomy. Signed breakpoint machinery solves a different problem. | Steal outcome separation; reject policy. |
| [#82](http://192.168.129.37:30008/minder/oh-my-slop/issues/82) lifecycle/operator surface | JSON CLI for status/events/tasks/rebuild; dry-run flags; health command; session resume | Useful verb vocabulary. The Pi extension is not a dependable service boundary and silently swallows lifecycle failures. The doctor skill is a long model checklist, not a reliable diagnostic program. | Reimplement a small deterministic command surface. |
| [#83](http://192.168.129.37:30008/minder/oh-my-slop/issues/83) trust/permissions | Harness capability metadata and prompt-level safety text | No equivalent to controller config isolation, credential withholding, scheduler-only verbs, hard deny floor, or reviewer attestation. Some generic harness launch policies favor bypass modes. | Reject; #83 is already stronger. |
| [#84](http://192.168.129.37:30008/minder/oh-my-slop/issues/84) config/routing/migration | SDK version fields, process code hash, config validation, harness metadata | The live 6.0.3/0.0.187 split proves metadata alone is insufficient. No factory profile/label routing or Opus/Fable rule. | Adopt executable/version handshake and manifest hashing. |
| [#85](http://192.168.129.37:30008/minder/oh-my-slop/issues/85) bounded parallelism | Effect groups, execution strategy hints, max-concurrency hints, wave building, result strategies | This is local Promise-pool machinery plus an in-memory priority queue. It has no durable capacity lease, model/runtime arbitration, fairness, backpressure, or integration lock. Knobs are not a scheduler. | Adopt data shape only after #85 defines real policy. |
| [#86](http://192.168.129.37:30008/minder/oh-my-slop/issues/86) retention/cleanup | Artifact references, large-value spill, disk accounting, orphan scan, archive/restore, cleanup skill | The archive treats every file as UTF-8, has no archive integrity check, and restores archive-controlled relative paths without an explicit containment guard. Cleanup logic and blob layout disagree in places. The cleanup skill delegates deletion policy to a generated process. | Adopt manifests and mark/sweep concepts; reject implementation. |
| [#87](http://192.168.129.37:30008/minder/oh-my-slop/issues/87) locked spec | A broad generic workflow vocabulary | Importing it would reopen settled boundaries and bloat the build-ready spec. | Cite only the six narrow contracts below. |

## The six ideas worth taking

### A. Canonical events plus disposable projections — target #79

Use one authoritative event stream and rebuild status/read models from it. Persist a projection head and explicit rebuild reason. Strengthen the Babysitter shape:

- one writer owns sequence allocation;
- every event contains schema version, event ID, run/ticket/phase/attempt identity, causal command ID, predecessor hash, recorded time, and typed payload;
- replay verifies schema, contiguous sequence, predecessor hash, and event checksum before applying anything;
- projections compare the entire head identity with no "compare only when present" downgrade;
- invalid journals stop reconciliation; repair produces a reviewed plan and a new derived stream or explicit tombstone, never silently rewritten history.

### B. Requested/resolved external effects — targets #79 and #82

Babysitter's strongest reusable abstraction is that an external action first becomes durable intent, then receives one correlated result. Apply this only to controller effects such as claim, worker launch, worker stop, mechanical verification, push, and PR creation. Do not encode Gitea tickets as private tasks.

Use semantic idempotency keys, for example `run/ticket/phase/attempt/push`, not replay position alone. Include all identity fields in the key derivation and require the key on result commit; Babysitter allows it to be omitted. A repeated post should return the existing committed result when identical and a typed conflict when different, rather than the generic "already resolved" failure.

### C. Schema-versioned result envelopes and artifact references — targets #78 and #81

Keep task/result documents small and stable. Put large stdout, stderr, logs, and evidence in immutable artifact objects referenced by digest. Validate the outbox before changing state. Improve the source design:

- validate every worker status, not only selected task kinds;
- require the full run/ticket/phase/attempt/commit/evidence tuple;
- store digest, media type, byte count, producer, and retention class for every artifact;
- never accept an absolute or escaping artifact path;
- separate worker claims from controller-attested verification.

### D. Outcome separation — target #81

The distinction among successful completion, intentional halt, task/worker error, cancellation, and controller/process error is worth preserving. Map it to the factory's own taxonomy rather than importing names. In particular, `needs-human`, worker failure, automation failure, timeout, invalid result, dead worker, review rejection, review mutation, and rebase conflict must remain distinct because they drive different tracker and recovery actions.

### E. Deterministic operator verbs with JSON and dry-run — targets #82 and #86

Babysitter's CLI shape is better than its doctor skill. Provide deterministic implementations for status, events, reconcile, doctor, cleanup-plan, and cleanup-execute. Every mutating repair or cleanup command should support a machine-readable dry run and consume the exact plan identity during execution.

Do not ask a model to recompute checksums, infer stale locks, or manufacture shell repair commands. Do not let doctor mutate the state it diagnoses. Keep monitor presentation under [#67](http://192.168.129.37:30008/minder/oh-my-slop/issues/67); these commands expose facts only.

### F. Concurrency intent as data — target #85

Carry group ID, requested resource class, timeout, and maximum concurrency on schedulable work. That makes serial v1 and bounded-parallel v2 share an interface. The scheduler must still own leases, fairness, resource limits, cancellation, and integration serialization. Do not mistake `Promise.all` with a limit for resource arbitration.

## Ideas to reject explicitly

1. **A private generated task graph.** It duplicates Gitea and violates #77.
2. **Stop-hook-driven continuation as the controller.** It couples correctness to host turn events and, in the installed package, fails silently.
3. **PID-only stale-lock cleanup.** It is not ownership proof.
4. **Checksums verified by a doctor prompt.** Integrity belongs in the loader and replay path.
5. **Automatic journal rewriting.** The repair command drops corrupt and duplicate events, assigns new IDs, and replaces the journal; that destroys forensic identity even though it keeps a backup.
6. **Generic priority labels.** #77 deliberately chose dependency-constrained ascending ticket order for v1.
7. **First-success/quorum strategies for factory truth.** Worker implementation, verification, and review are not interchangeable votes.
8. **Generic breakpoints and signed-approval infrastructure.** Factory human boundaries already live on Gitea and risky mid-attempt approval is out of scope.
9. **Archive/restore wholesale.** The published implementation reads every file as UTF-8 and lacks a trustworthy archive manifest/digest boundary.
10. **Model-authored cleanup.** Deletion must be whitelist-derived, plan-bound, and controller-executed.
11. **SDK dependency adoption.** It would import over 1,000 files and multiple plugin/harness subsystems to obtain a few small contracts.

## Red-team synthesis

The asset is not "a run that usually finishes". It is the claim that only independently verified commits can become a published factory PR and that a crash cannot make the controller lie about ownership or completion.

The strongest adversaries are ordinary failures: a second controller starts, a worker writes a plausible but mismatched result, a process dies after an external side effect but before recording it, a PID is reused, a package update breaks the bridge, or an operator repairs the wrong run. Babysitter has names for several of these states, but its shipped bridge, lock, journal integrity, and repair behavior do not meet the factory's evidence standard.

The correct synthesis is therefore **contract harvesting, not dependency reuse**. Take the six shapes above into the named open decision tickets. Treat every Babysitter implementation as adversarial test material: the factory acceptance suite should include version split-brain, dead bridge, duplicate sequence, checksum tamper, PID reuse/replacement, path escape, duplicate result, crash-after-side-effect, projection mismatch, and stale cleanup-plan scenarios.

## Removal inventory

At audit time, three independently installed surfaces existed:

1. Pi user package `npm:@a5c-ai/babysitter-pi` at 6.0.3;
2. global npm package `@a5c-ai/babysitter-pi` at 0.1.3;
3. global npm package `@a5c-ai/babysitter-sdk` at 0.0.187, which owned the `babysitter` executable.

Package-only removal completed after the audit. `pi list` no longer contains Babysitter, the two global npm packages are absent, and `babysitter` is no longer on `PATH`.

No project-local `.a5c` tree exists in this repository. User data remains under `~/.a5c`, including runs, logs, profiles, and a process-library checkout. Package removal did **not** delete that user data. If it is ever removed, the permanent loss is historical runs, logs, and profiles; recovery requires a backup made first.

The package-only removal commands were:

```text
pi remove npm:@a5c-ai/babysitter-pi
npm uninstall -g @a5c-ai/babysitter-pi @a5c-ai/babysitter-sdk
```

Afterward, verify with `pi list`, `npm ls -g --depth=0`, and `command -v babysitter`. Leave `~/.a5c` untouched unless a separate, explicit data-retention decision authorizes its deletion.
