# Survey: Software Factory foundations (2026-08-13)

**Status:** Decision evidence for the Gitea ticket **“Survey the failed factories and
harness-native orchestration contracts”** in the Wayfinder map **“Specify a reliable
Software Factory”**. This document records evidence; it does not specify or implement the
replacement factory.

## Question

What can a new Software Factory safely learn from the archived `job-pipeline` and
`software-factory` implementations, and what is the strongest supported way for its pi and
Claude Code workers to load and invoke this package's named workflow skills in arbitrary
consumer repositories?

## Method and evidence boundary

The two archived implementations were treated as **failed evidence, not candidate
architectures**. The survey read their source, READMEs, historical tests, package entrypoints,
current repository tests, pi 0.84.1's installed documentation and runtime source, Claude Code
2.1.229's installed plugin documentation and CLI help, the Herdr worker-launch contract, and
the local Gitea history already gathered for issue #64 and map #67. It did not start a factory,
run a model worker, mutate a tracker, or modify a consumer repository.

Local source citations use repository-relative links and line ranges where possible. Installed
harness documentation is cited by absolute local path and line range because it is not part of
this repository. Claims based on live tracker or CLI inspection are labelled as observations,
not durable API contracts.

The detailed monitor/retention investigation remains in
[`software-factory-observation-surfaces-2026-08-13.md`](software-factory-observation-surfaces-2026-08-13.md).

---

## Executive verdict

1. **Inherit neither archived architecture.** `job-pipeline` is an idea-to-merge monolith whose
   parallel workers share one mutable worktree. `software-factory` is closer to the desired
   ticket-driven boundary, but it is a non-resumable scheduler whose completion protocol depends
   on terminal scraping and whose claims and locks do not provide recoverable ownership.
2. **Preserve contracts, not implementations.** Tracker-driven work, isolated Git integration,
   deterministic worker routing, structured append-only events, explicit human boundaries,
   reviewer non-mutation checks, and observable worker lifecycle are independently useful.
3. **Pi verdict:** resolve the installed package root outside the model, launch the worker with an
   explicit additive skill path—preferably `--no-skills --skill "$PACKAGE_ROOT/skills"` for a
   hermetic factory worker—mechanically verify `skill:implement` or
   `skill:two-axis-review`, then make the first worker prompt the native
   `/skill:<name> ...` command.
4. **Claude Code verdict:** build a valid, flattened Claude plugin artifact with a stable
   manifest name, and launch each worker with session-local `--plugin-dir "$PLUGIN_ROOT"` plus
   `--model opus` or `--model fable`. Preflight the plugin, then directly invoke the documented
   `/plugin-name:skill-name` surface—for example `/oh-my-slop:implement`. The current repository
   is not such a plugin. Until that artifact exists, the tested one-level symlink bridge is the
   strongest implemented route, but it is user-global and not hermetic.
5. **Prompt prose is not loading.** “Use the `implement` skill” and “find its `SKILL.md`” remain
   fallbacks. They do not prove that the harness registered the skill or that the model loaded it.

---

## 1. Attempted capabilities

### 1.1 `job-pipeline`: own the entire idea-to-merge lifecycle

The older pipeline attempted an end-to-end product-development process: interview/scout,
planning and critique, task decomposition, UI design, dependency-batched workers, proof
generation, independent review, human approval, direct merge, and retrospective. Its README
advertises dependency-ordered parallel workers, proof-backed review, and merge after a human gate
([`extensions/.legacy/job-pipeline/README.md:23-57`](../../extensions/.legacy/job-pipeline/README.md#L23-L57)).

The implementation reflects that broad ownership. It creates one job worktree, executes every
worker task there, compiles proof, runs review, asks for approval, and then merges back into the
repository ([`pipeline.mjs:368-470`](../../extensions/.legacy/job-pipeline/lib/pipeline.mjs#L368-L470),
[`pipeline.mjs:617-685`](../../extensions/.legacy/job-pipeline/lib/pipeline.mjs#L617-L685)). It also
introduced potentially useful operational components: sequenced events, persisted stage/task
artifacts, snapshots reconstructed from events, job diagnostics, and PID-liveness lock inspection
([`job-events.mjs:18-55`](../../extensions/.legacy/job-pipeline/lib/job-events.mjs#L18-L55),
[`job-events.mjs:62-117`](../../extensions/.legacy/job-pipeline/lib/job-events.mjs#L62-L117),
[`state.mjs:52-85`](../../extensions/.legacy/job-pipeline/lib/state.mjs#L52-L85),
[`job-locks.mjs:31-81`](../../extensions/.legacy/job-pipeline/lib/job-locks.mjs#L31-L81)).

### 1.2 `software-factory`: execute build-ready tracker tickets

The later factory narrowed the stated boundary: Wayfinder and ticket-writing happen before the
factory; the factory claims one ready implementation ticket, routes a worker profile, creates a
ticket worktree, launches implementation and review workers through Herdr, integrates verified
commits, and stops at manual final merge
([`extensions/.legacy/software-factory/README.md:5-14`](../../extensions/.legacy/software-factory/README.md#L5-L14),
[`README.md:18-41`](../../extensions/.legacy/software-factory/README.md#L18-L41)).

Its scheduler was serial. It selected the first frontier ticket, created an isolated branch and
worktree, ran bounded repair/fresh-worker attempts, then merged into a run-level integration branch
([`factory.mjs:135-218`](../../extensions/.legacy/software-factory/lib/factory.mjs#L135-L218),
[`factory.mjs:229-319`](../../extensions/.legacy/software-factory/lib/factory.mjs#L229-L319)). Worker
routing was deterministic: first matching phase/label rule, otherwise the phase default
([`routing.mjs:1-9`](../../extensions/.legacy/software-factory/lib/routing.mjs#L1-L9)).

The factory also attempted explicit authority separation. Worker prompts prohibited merge, push,
close, and relabel operations; reviewers were told not to mutate files; the scheduler retained
integration authority ([`herdr.mjs:28-64`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L28-L64)).
That separation was behavioral rather than a credential sandbox, a limitation the archived README
acknowledged ([`README.md:189-209`](../../extensions/.legacy/software-factory/README.md#L189-L209)).

---

## 2. Observed failures and unsupported claims

### 2.1 `job-pipeline` failures

#### Parallel workers shared one mutable worktree

The dependency resolver intentionally groups independent tasks into parallel batches
([`tasks.mjs:1-34`](../../extensions/.legacy/job-pipeline/lib/tasks.mjs#L1-L34)). `executeWorkers()`
then runs each batch with `Promise.all`, passing the **same `worktreePath`** to every worker
([`pipeline.mjs:827-869`](../../extensions/.legacy/job-pipeline/lib/pipeline.mjs#L827-L869)). This is
not isolation: workers can overwrite, stage, commit, or invalidate each other's changes. A future
factory must never infer that task-graph independence makes a shared filesystem safe for parallel
writers.

#### Review did not mechanically veto merge

The review result is persisted, but after recording `review.verdict` the pipeline advances to
`human-review` without requiring a passing verdict
([`pipeline.mjs:577-615`](../../extensions/.legacy/job-pipeline/lib/pipeline.mjs#L577-L615)). If the
proof gate is configured for `auto-accept`, the code marks the gate approved regardless of that
verdict and proceeds to merge
([`pipeline.mjs:619-685`](../../extensions/.legacy/job-pipeline/lib/pipeline.mjs#L619-L685)). Review
therefore produced evidence, not an enforced merge predicate.

#### Git operations were overpowered and unsafe

Git commands interpolate branch names and paths into shell strings. Finalization runs `git add -A`,
may commit everything in the job worktree, merges directly into the current main-worktree branch,
then forcibly removes the worktree; abandonment uses forced worktree and branch deletion
([`worktree.mjs:37-52`](../../extensions/.legacy/job-pipeline/lib/worktree.mjs#L37-L52),
[`worktree.mjs:65-92`](../../extensions/.legacy/job-pipeline/lib/worktree.mjs#L65-L92),
[`worktree.mjs:95-123`](../../extensions/.legacy/job-pipeline/lib/worktree.mjs#L95-L123)). The same
module silently edits the consumer repository's `.gitignore`
([`worktree.mjs:138-157`](../../extensions/.legacy/job-pipeline/lib/worktree.mjs#L138-L157)). None of
these behaviors is suitable as an implicit scheduler side effect.

#### Persistence could fail silently

`writeJobState()` wraps validation, run creation, snapshot writing, and active-pointer updates in a
blanket `try/catch` whose catch does nothing
([`state.mjs:88-125`](../../extensions/.legacy/job-pipeline/lib/state.mjs#L88-L125)). A scheduler
cannot claim resumability or durable state when persistence loss is deliberately hidden.

#### The boundary was too broad

The pipeline owned discovery, planning, task writing, implementation, review, approval, merge, and
retro. This couples high-ambiguity product decisions to repository mutation and makes crash replay
hard: resuming a deterministic ticket execution is materially simpler than replaying an evolving
multi-agent interview and plan. The broad process is evidence about possible phases, not a module
boundary to preserve.

### 2.2 `software-factory` failures

#### Terminal scraping was the completion protocol

The worker and reviewer were required to print `FACTORY_RESULT` or `FACTORY_REVIEW` as their final
single line. The scheduler regexed the last matching line from a Herdr
`recent-unwrapped` capture ([`herdr.mjs:28-64`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L28-L64),
[`herdr.mjs:67-130`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L67-L130)). It blocked
on `herdr agent prompt --wait` for up to two hours and only afterwards read 240 requested terminal
lines ([`herdr.mjs:235-259`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L235-L259)).
Visible terminal output is a lossy presentation surface, not authoritative run state.

Tracker history on `minder/oh-my-slop#64`, inspected read-only during this survey, contains real
failures from this boundary: `Herdr returned invalid JSON`, protocol/approval misclassification,
and a direct-ticket frontier failure. Those observations establish that the adapter failed in use;
they do not establish a replacement Herdr protocol.

#### Generic Herdr status was not a domain blocker

A recursively discovered `agent_status` or `status` string equal to `blocked` was converted into a
generic human-input result
([`herdr.mjs:16-26`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L16-L26),
[`herdr.mjs:241-245`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L241-L245)). That loses
the reason, prompt, phase, and whether the stop represents product ambiguity, permission approval,
transport failure, or harness UI state. Worker lifecycle status may be an observation; it must not
be the sole domain transition.

#### Runs were snapshots, not resumable executions

The store atomically overwrote one JSON run document and one active pointer
([`store.mjs:9-28`](../../extensions/.legacy/software-factory/lib/store.mjs#L9-L28)). It had no event
log, schema version, lease renewal, attempt identity, or replay operation. The archived README
explicitly states that an interrupted scheduler does not resume after its controlling pi process
exits ([`README.md:211-224`](../../extensions/.legacy/software-factory/README.md#L211-L224)).

#### Locks had no stale-owner recovery

The lock recorded a run ID and PID, but `acquire()` treated every existing lock—including a dead
owner—as authoritative. It did not test PID liveness or define takeover semantics
([`store.mjs:30-49`](../../extensions/.legacy/software-factory/lib/store.mjs#L30-L49)). The companion
observation survey found a persisted `running` snapshot whose lock owner PID was dead. A future
lease needs owner identity, heartbeat/expiry, fenced takeover, and an idempotent recovery decision;
PID presence alone is insufficient across PID reuse and hosts.

#### Ticket claims were not atomic leases

The frontier filtered out already assigned issues, but claim was a later `issues edit
--add-assignees` call with no compare-and-set or post-claim ownership verification
([`gitea.mjs:104-131`](../../extensions/.legacy/software-factory/lib/gitea.mjs#L104-L131)). Two
schedulers can observe the same unassigned ticket before either writes. Assignment is useful
tracker state, but not by itself a scheduler lease.

#### Parentage was inferred from prose

Map membership was inferred from either `Part of #N` or a `## Parent` section in mutable issue body
text ([`gitea.mjs:27-34`](../../extensions/.legacy/software-factory/lib/gitea.mjs#L27-L34),
[`gitea.mjs:74-101`](../../extensions/.legacy/software-factory/lib/gitea.mjs#L74-L101)). Gitea's
issue dependency graph and Wayfinder parent membership are distinct contracts. A replacement must
define both explicitly rather than treating prose parsing as a durable graph API.

#### Durable state dropped execution detail

The run state retained arrays of ticket numbers and a final review summary, while repair attempt,
fresh retry, per-ticket profile, test evidence, and review result remained loop-local or were only
written into mutable tracker comments
([`factory.mjs:30-45`](../../extensions/.legacy/software-factory/lib/factory.mjs#L30-L45),
[`factory.mjs:187-267`](../../extensions/.legacy/software-factory/lib/factory.mjs#L187-L267),
[`gitea.mjs:164-177`](../../extensions/.legacy/software-factory/lib/gitea.mjs#L164-L177)). This is
insufficient for restart, audit, or an honest monitor.

### 2.3 Current package drift

The archived factory is no longer a live package entrypoint. The root manifest exposes only
`workflow-watchdog` and records `software-factory` under `removedExtensions`
([`package.json:12-33`](../../package.json#L12-L33)). The README still says both extensions load
automatically and links to a non-existent live factory path
([`README.md:17-28`](../../README.md#L17-L28), [`README.md:88-100`](../../README.md#L88-L100)).

Tests also encode the old surface. The installability test expects both extensions
([`tests/test_pi_package_installability.py:118-129`](../../tests/test_pi_package_installability.py#L118-L129)),
while its own invariant rejects tests importing archived or missing extension paths
([`tests/test_pi_package_installability.py:149-165`](../../tests/test_pi_package_installability.py#L149-L165)).
Eight `tests/node/software_factory_*.test.mjs` files still import or copy
`extensions/software-factory`, for example
[`software_factory_herdr.test.mjs:1-11`](../../tests/node/software_factory_herdr.test.mjs#L1-L11)
and [`software_factory_extension.test.mjs:8-13`](../../tests/node/software_factory_extension.test.mjs#L8-L13).
This drift must be resolved as an explicit migration; it is not evidence that the archived
extension remains supported.

---

## 3. Verified harness-native skill contracts

### 3.1 Pi

Pi's installed documentation states that it loads skills from package `pi.skills` entries,
recursively discovers directories containing `SKILL.md`, and accepts repeatable CLI
`--skill <path>` entries that remain additive even with `--no-skills`
(`/home/minder/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md:20-41`). The
root package already declares `"skills": ["./skills"]`
([`package.json:12-18`](../../package.json#L12-L18)).

Pi documents `/skill:name` as the force-loading path and warns that models do not always load a
matching skill merely because its metadata is present
(`/home/minder/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md:64-89`). Runtime
source confirms the mechanism: pi finds the named discovered skill, reads `SKILL.md`, strips its
frontmatter, wraps the body with its resolved location/base directory, and appends command
arguments before the model sees the request
(`/home/minder/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:948-976`).
An unknown name is passed through unchanged, so discovery must be preflighted rather than assumed.

Pi RPC exposes discovered skills as `skill:<name>` command records
(`/home/minder/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:540-565`).
Skill commands default to enabled
(`/home/minder/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:235-248`).
During the investigation, the installed git package was listed by `pi list`, and pi's resource
loader resolved `implement`, `two-axis-review`, `tdd`, and `testing-workflow` from the installed
package with no diagnostics. That is current-machine evidence, not a guarantee for another worker.

Herdr supports passing native agent arguments after `--`, so explicit pi skill flags can be part of
the worker launch rather than text the worker must interpret
(`/home/minder/.agents/skills/herdr/SKILL.md:108-120`).

**Pi loading verdict:**

```bash
# PACKAGE_ROOT is resolved and verified by the scheduler, never guessed by the model.
herdr agent start "$WORKER" --kind pi --pane "$PANE" -- \
  --no-skills \
  --skill "$PACKAGE_ROOT/skills" \
  ...
```

Then submit a first prompt beginning with:

```text
/skill:implement <ticket and repository context>
```

or:

```text
/skill:two-axis-review <fixed point, ticket/spec, and review scope>
```

Using `--no-skills` is a factory-isolation choice, not a general pi recommendation. If consumer or
user skills are intentionally part of policy, omit it but still pass the package skill path
explicitly and reject duplicate-name ambiguity during preflight.

### 3.2 Claude Code

Claude's installed first-party plugin guidance requires a manifest at
`.claude-plugin/plugin.json` and plugin components at the plugin root. Skills live one level below
`skills/`, each in its own directory containing `SKILL.md`
(`/home/minder/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/plugin-structure/SKILL.md:20-44`,
`:164-183`). Claude loads skill metadata first and the full body when the skill triggers
(`/home/minder/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/skill-development/SKILL.md:77-85`,
`:269-276`). Skills are also user-invocable slash commands by default, and first-party plugin
authoring guidance gives the namespaced form as `/plugin-name:skill-name`
(`/home/minder/.claude/plugins/marketplaces/claude-plugins-official/plugins/example-plugin/README.md:23-50`,
`/home/minder/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/commands/create-plugin.md:321-326`).
The same guidance recommends local plugin testing with `--plugin-dir /path/to/plugin`
(`/home/minder/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/skill-development/SKILL.md:282-291`).

Local `claude --help` for 2.1.229 verifies that:

- `--plugin-dir <path>` loads a directory or ZIP for the current session and is repeatable;
- `--model` accepts aliases including `fable` and `opus`;
- `--disable-slash-commands` disables all skills.

Local `claude plugin validate --help` verifies a `--strict` mode that turns warnings into failures.
Running `claude plugin validate --strict .` against this repository failed because no
`.claude-plugin/plugin.json` or marketplace manifest exists. In addition, the repository's
`skills/<bucket>/<name>/SKILL.md` taxonomy is one level deeper than the documented plugin shape.
Therefore the current package root must not be passed to `--plugin-dir` and called supported.

**Claude Code loading verdict:** produce a generated or packaged artifact such as:

```text
oh-my-slop-claude-plugin/
├── .claude-plugin/
│   └── plugin.json          # name: oh-my-slop
└── skills/
    ├── implement/
    │   └── SKILL.md
    ├── two-axis-review/
    │   └── SKILL.md
    ├── tdd/
    │   └── SKILL.md
    └── testing-workflow/
        └── SKILL.md
```

Supporting `references/`, `scripts/`, and `assets/` must remain next to their owning skill. Then:

```bash
claude plugin validate --strict "$PLUGIN_ROOT"
herdr agent start "$WORKER" --kind claude --pane "$PANE" -- \
  --plugin-dir "$PLUGIN_ROOT" \
  --model opus \
  ...
```

Use `--model fable` where policy selects Fable. With manifest name `oh-my-slop`, invoke the
implementation role as `/oh-my-slop:implement <ticket context>` and the review role as
`/oh-my-slop:two-axis-review <fixed point and review context>`. The naming form is documented; a
post-launch inventory check should still reject packaging drift or a disabled skill before work
starts. Actual execution of those commands by Opus and Fable remains an end-to-end test, not a
conclusion from manifest validation.

### 3.3 Existing Claude symlink bridge

`scripts/link-skills.sh` flattens every bucketed skill into an immediate child of a target directory,
defaulting to `~/.claude/skills`
([`scripts/link-skills.sh:1-20`](../../scripts/link-skills.sh#L1-L20),
[`scripts/link-skills.sh:51-69`](../../scripts/link-skills.sh#L51-L69)). Tests cover complete
linking and `SKILL.md` resolution, idempotence, dry-run behavior, removal of whole-bucket links, and
safe opt-in pruning
([`tests/test_link_skills.py:36-67`](../../tests/test_link_skills.py#L36-L67),
[`tests/test_link_skills.py:70-107`](../../tests/test_link_skills.py#L70-L107)).

This is the strongest **currently implemented** Claude route, but not the strongest factory
contract:

- it mutates user-global discovery state;
- it can collide with unrelated skills of the same name;
- it depends on links remaining live after checkout/package movement;
- it gives the worker no session-local package/version identity;
- package postinstall does not run the linker—it only repairs a Bun global-package prerequisite
  ([`scripts/postinstall.mjs:1-39`](../../scripts/postinstall.mjs#L1-L39)).

Use it for developer setup until a plugin artifact exists, not as the scheduler's hidden
precondition.

### 3.4 Prompt handoffs and path fallbacks

The archived factory sent pi `/skill:implement`, but only told Claude to “Use the `implement`
skill” and, if absent, locate the installed `SKILL.md`
([`herdr.mjs:28-31`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L28-L31)). Its reviewer
prompt merely named `two-axis-review`
([`herdr.mjs:45-48`](../../extensions/.legacy/software-factory/lib/herdr.mjs#L45-L48)). Historical
tests assert those prompt shapes, not successful skill loading
([`software_factory_herdr.test.mjs:17-27`](../../tests/node/software_factory_herdr.test.mjs#L17-L27),
[`software_factory_herdr.test.mjs:70-80`](../../tests/node/software_factory_herdr.test.mjs#L70-L80)).

Current prompt-template policy likewise treats a “find `SKILL.md`” clause as fallback behavior for
manual-only skills; it does not make that clause a native loader
([`tests/test_prompt_templates.py:22-27`](../../tests/test_prompt_templates.py#L22-L27),
[`tests/test_prompt_templates.py:110-131`](../../tests/test_prompt_templates.py#L110-L131)). The
scheduler may retain an absolute, scheduler-resolved `SKILL.md` read instruction as emergency
recovery, but it must report that degraded mode instead of claiming native invocation.

---

## 4. Mechanical preflights

These checks can be enforced without asking a model to self-report success.

### Shared package checks

1. Resolve the package/plugin root outside the worker and canonicalize it with `realpath`.
2. Pin or record the package revision/version used by the run.
3. Require readable `SKILL.md` files for every directly invoked and transitively required skill.
   `implement` currently requires `tdd`, `testing-workflow`, and `two-axis-review`
   ([`skills/workflow/implement/SKILL.md:8-16`](../../skills/workflow/implement/SKILL.md#L8-L16)).
4. Validate frontmatter, bundled references, scripts, and unique names.
5. Reject symlinks that escape the expected artifact or resolve into a mutable development checkout
   when an installed package was requested.
6. Record the exact launch command and resource inventory as run events, with credentials redacted.

### Pi worker checks

1. Check the pi CLI version and requested provider/model availability.
2. Launch with the resolved explicit `--skill` path; use `--no-skills` when hermetic policy requires
   it.
3. Query the resource/command inventory and require `skill:implement` or
   `skill:two-axis-review`, plus required discipline skills.
4. Fail on loader diagnostics, missing files, or duplicate skill names.
5. Assert that the generated first prompt begins with the intended `/skill:` command.
6. Treat an unknown command passed through to the model as a launch failure, not a worker failure.

### Claude Code worker checks

1. Check the Claude Code version and requested model alias syntax.
2. Run `claude plugin validate --strict "$PLUGIN_ROOT"` before creating a worker pane.
3. Launch with that exact session-local `--plugin-dir`; do not depend on a consumer repo's
   `.claude/` state.
4. Inspect the post-launch component/skill inventory and require the expected
   `/plugin-name:skill-name` identifier derived from the validated manifest and skill frontmatter.
5. Invoke that identifier directly and retain trace evidence that the skill body loaded.
6. Reject `--disable-slash-commands` and incompatible bare-mode settings.
7. If temporarily using symlinks, check every required link and resolved target before launch.

Structural validation proves discovery inputs, not model compliance. A worker still needs output,
test, Git, and review verification.

---

## 5. Reusable invariants and primitives

These survive the architectural rejection because each can be justified independently.

### Work ownership and boundaries

- **Tracker-driven implementation frontier.** Operate on explicit build-ready
  `workflow:implement` tickets rather than inventing work inside the scheduler.
- **Explicit human transitions.** Product decisions, credentials, destructive actions, security
  exceptions, unresolved conflicts, and final protected-branch merge remain human boundaries.
- **Scheduler-owned integration.** Workers do not merge, push, close, relabel, or claim completion.
- **Automation failure is not a product blocker.** Transport, protocol, verification, and capacity
  failures must remain distinguishable from “needs a human decision.”

### Git safety

The later factory's checks are useful contracts:

- reject dirty or untracked controller checkouts and require `.worktrees/` to be ignored
  ([`git.mjs:28-44`](../../extensions/.legacy/software-factory/lib/git.mjs#L28-L44));
- create per-ticket branches/worktrees from a run integration branch
  ([`git.mjs:46-61`](../../extensions/.legacy/software-factory/lib/git.mjs#L46-L61));
- require a clean ticket worktree and at least one commit
  ([`git.mjs:64-77`](../../extensions/.legacy/software-factory/lib/git.mjs#L64-L77));
- capture reviewer HEAD/status and quarantine any mutation
  ([`git.mjs:79-96`](../../extensions/.legacy/software-factory/lib/git.mjs#L79-L96));
- after integration, require a clean worktree, ancestry, and `git diff --check`
  ([`git.mjs:98-121`](../../extensions/.legacy/software-factory/lib/git.mjs#L98-L121)).

These are necessary but not sufficient. The replacement still needs idempotent merge semantics,
conflict policy, branch/commit attribution, protected remote behavior, and safe cleanup planning.

### Durable run state

- atomic writes through temporary file plus rename
  ([`software-factory/store.mjs:9-13`](../../extensions/.legacy/software-factory/lib/store.mjs#L9-L13));
- append-only, sequenced, timestamped events with integrity diagnostics
  ([`job-pipeline/job-events.mjs:18-33`](../../extensions/.legacy/job-pipeline/lib/job-events.mjs#L18-L33),
  [`job-events.mjs:62-117`](../../extensions/.legacy/job-pipeline/lib/job-events.mjs#L62-L117));
- snapshots as disposable projections rebuilt from canonical events
  ([`job-pipeline/state.mjs:64-85`](../../extensions/.legacy/job-pipeline/lib/state.mjs#L64-L85));
- inspectable locks with PID-liveness evidence and explicit stale status
  ([`job-pipeline/job-locks.mjs:31-58`](../../extensions/.legacy/job-pipeline/lib/job-locks.mjs#L31-L58));
- dependency-injected tracker, Git, Herdr, and store adapters, as used by `runFactory()`
  ([`software-factory/factory.mjs:20-29`](../../extensions/.legacy/software-factory/lib/factory.mjs#L20-L29)).

Do not copy these modules unchanged. In particular, checksum-per-file is not tamper-proof,
`getNextSequence()` is not safe under concurrent writers, and PID-liveness replacement is not a
fenced distributed lease.

### Routing and observability

- deterministic, inspectable profile selection by phase and explicit ticket labels;
- a stable run ID propagated through tracker, Git, worker, and event records;
- structured worker lifecycle events rather than terminal text as state;
- durable phase/attempt/session identifiers before a worker starts;
- monitor state derived from canonical events and tracker/Git facts, not a second scheduler state
  machine.

The observation survey found useful read surfaces in Gitea timelines, Herdr events/topology, Git
refs, pi session entries, and worker transcripts. Those sources should be joined by explicit IDs;
they should not be forced to infer one another after a crash.

---

## 6. Rejected inheritance

The replacement must not inherit any of the following:

- an idea-to-merge monolith that owns interviews, planning, decomposition, execution, and merge;
- concurrent writers sharing one worktree;
- direct merge into the controller's current branch;
- shell-interpolated Git commands, `git add -A`, hidden commits, or forced cleanup;
- persistence errors swallowed as “non-critical”;
- a mutable snapshot as the canonical run history;
- terminal rows, sentinel lines, or generic Herdr `blocked` payloads as authoritative completion;
- issue assignment as the only claim/lease mechanism;
- parent/dependency reconstruction solely from mutable issue prose;
- tracker comments as the only durable test/review evidence;
- worker-reported tests accepted without scheduler/reviewer verification policy;
- reviewer read-only behavior enforced only by prompting;
- worker authority constrained only by prose while credentials remain unrestricted;
- final review that does not mechanically gate publication;
- cleanup that destroys the only recovery artifact before durable integration evidence exists;
- model-driven discovery of an installed package path;
- global Claude symlinks as an undocumented worker prerequisite;
- “Use the `<name>` skill” prose presented as proof of native loading.

---

## 7. Still-unverified claims and open architecture decisions

### Harness behavior requiring live proof

- Opus and Fable actually load and follow the named skills from the proposed plugin artifact.
- Successful execution of the documented `/plugin-name:skill-name` command from a session-local
  plugin in interactive versus headless Claude workers.
- Account entitlement and actual resolution of the `opus` and `fable` aliases; CLI help proves
  accepted syntax, not access.
- Skill-trigger consistency across Claude Code versions and between Opus and Fable.
- Whether traces expose enough evidence to distinguish native Skill loading from a model merely
  reading a path.
- The complete transitive skill set needed by each factory role under arbitrary consumer
  instructions.

A proper Claude proof needs a valid plugin plus an eval/trace matrix for Opus and Fable. Direct
invocation and natural-language auto-triggering are separate test cases; success in one does not
prove the other.

### Factory decisions not settled by either prototype

1. **Factory boundary:** accept only build-ready implementation tickets, or also own interview,
   planning, and decomposition? The evidence favors the narrower boundary, but the specification
   must state it.
2. **Canonical run model:** event schema/versioning, phase and attempt identity, causal ordering,
   idempotency keys, and snapshot projection.
3. **Tracker graph contract:** map membership, parentage, dependencies, direct-ticket targets, and
   reconstruction after body edits.
4. **Claiming:** lease owner, expiry/heartbeat, fencing token, takeover, duplicate completion, and
   multi-host semantics.
5. **Scheduler ownership:** pi extension, separate service, Herdr plugin, or another process; plus
   live event transport and restart behavior.
6. **Worker completion:** authoritative structured result channel, process/agent termination,
   cancellation, timeout, and partial-result semantics.
7. **Verification:** which tests the scheduler reruns, what reviewers verify independently, and
   what evidence blocks integration.
8. **Concurrency:** isolation unit, capacity policy, dependency scheduling, integration queue, and
   conflict handling. Concurrency is not justified until isolation and leases exist.
9. **Permissions:** per-role tools, credentials, network access, tracker/Git authority, and how
   policy is enforced beyond prompts.
10. **Retention:** event, transcript, pane, worktree, branch, proof, and tracker-comment lifetimes;
    redaction and deletion policy.
11. **Integration lifecycle:** publication, pull request creation, final review predicate, manual
    merge, abandonment, and cleanup.
12. **Migration:** `/factory`, `.pi/factory.json`, labels/comments, run artifacts, stale README
    claims, orphaned tests, and the removed package entrypoint need an explicit keep/replace/retire
    decision.

---

## 8. Decision consequence

The next Software Factory design should start from four explicit interfaces:

1. **Tracker frontier and lease interface** — identifies build-ready work and owns claim/release
   transitions.
2. **Run/event store** — canonical, versioned, append-only execution facts with replayable
   projections.
3. **Worker harness adapter** — launches a pinned role with mechanically verified skills and emits
   structured lifecycle/result events.
4. **Git integration adapter** — isolated branches/worktrees, explicit verification predicates,
   publication, and cleanup plans.

Pi and Claude should differ only behind the worker harness adapter. The scheduler should ask that
adapter for a verified named capability such as `implement`; it should not contain harness-specific
prompt folklore or ask a model to find its own operating instructions.

That is the strongest common foundation supported by the failed implementations and the verified
harness contracts. Everything beyond it remains a specification decision or an experiment, not an
inherited fact.
