# Subscription worker for Claude Code

Delegate a bounded task from Pi to the **unmodified, installed Claude Code CLI**.
The extension does not extract credentials, register a model provider, or proxy
Anthropic requests. Claude Code owns its tools, context, hooks and permissions.

Local source inspection of installed Claude Code **2.1.287** confirms that open
stdin keeps its stream session alive and that JSON-schema reports are returned as
`structured_output`. The installed Pi extension loader was checked separately.
Older versions without the expected authentication/control metadata fail closed.
Deterministic fixtures cover the protocol; no live inference/permission probe was
conducted. This does not establish the cause of any historical cancellation.
The extension launches nothing when it loads.

## Setup

1. Install Claude Code separately and sign in with `claude auth login`, choosing
   your Claude subscription account rather than Console/API billing.
2. Confirm subscription authentication with `/status` in Claude Code.
3. **Disable extra usage in your Claude account** if you want Claude Code to stop
   at your allowance. Subscription authentication alone does not prevent charges
   when extra usage is enabled.
4. Install/update oh-my-slop, then restart Pi or run `/reload`.

To try this checkout without changing installed-package settings:

```sh
pi -e ./extensions/claude-worker/index.ts
```

## Commands

| Command | Behavior |
|---|---|
| `/cc <task>` | Supervise a new bounded task in Pi's current project. |
| `/cc-followup <information or instruction>` | Supply missing input or recover the last saved task in the same directory. |
| `/cc-status` | Show current/last activity, elapsed time, session, log path and terminal diagnostics. |
| `/cc-log` | Show a retained activity snapshot; expand the message for tool inputs/results. |
| `/cc-stop` | Terminate the worker; retain its session and any existing file changes. |

Example:

```text
/cc Inspect the payment validation tests. Make no changes; report missing cases.
/cc-followup Add the missing cases and the smallest fix. Do not commit or push.
```

Workers default to Claude Code's native **auto permission mode**, including resumed
tasks. Routine actions can run without prompting; any permission request Claude
Code still sends to the host appears as a Pi confirmation dialog. Auto mode is not
permission bypass, and its availability depends on Claude Code's model/account
and policy settings.

Commands stream a short preview and display the final result **without triggering
a Pi model turn**. Follow-ups are resumed turns, not live interruption messages:
stop the current task before sending a correction. Direct commands keep their
result in the Pi transcript; they do not automatically ask Pi to review it.

## Supervision, outcomes and recovery

Both `/cc` and `claude_worker` supervise the approved **task**, not merely one CLI
turn. Waiting for required background work is nonterminal: input stays open,
native task notifications are consumed, and the host continues outstanding work
after the native turn result. Unrelated results and duplicate notifications must
not finish the task or dispatch duplicate continuations. Continuation never adds
permissions or expands the original task.

Default safety limits are **8 host continuations** and a **30-minute transport
budget after subscription authentication** per invocation. Authentication has a
separate 10-second preflight timeout; initialization must finish within 10 seconds
inside the transport budget. Exhaustion returns unfinished/interrupted, not success. Terminal EOF
has a one-second exit allowance before SIGTERM, then a further one second before
SIGKILL. Stop and shutdown use the same bounded owned-process cleanup. On POSIX,
invocation settlement waits for group escalation even if the immediate process
exits first, so that TERM-ignoring descendants do not outlive cancellation.
Same-session cleanup frames still enter the diagnostic log and task history;
ending supervision disables dispatch and approval, not evidence retention.

The host requests a strict JSON-schema report through Claude Code's
`StructuredOutput`, with these fields (all required except `resolved_failures`):

| Field | Meaning |
|---|---|
| `task_id` | Host-assigned identity for the approved task, retained by same-task follow-ups. |
| `disposition` | `waiting`, `finished`, `needs_input` or `unfinished`. |
| `outcomes` | Requested requirements, each with `requirement`, `status` (`verified` or `unverified`) and `evidence` strings naming tests, checks or artifacts. |
| `outstanding`, `unverified` | Explicit lists of remaining actions and missing verification. |
| `question` | Precise missing information for a needs-input pause; empty otherwise. |
| `background_task_ids` | Required background work identities, retained across waiting turns. |
| `resolved_failures` | Optional explicit resolution of failed intermediate checks: entries with failed `task_id`, fresh completed `replacement_task_id`, and nonempty `evidence` explaining the repair and passing rerun. |

Free-form “done”, exit code 0, `end_turn`, an empty active-task list or a successful
CLI result is insufficient. Unsupported/missing reports remain unresolved within
the safety limits. Finished requires an explicit mapping of every requested
outcome to evidence, with no outstanding required work or missing evidence.
Previously declared requirement wording must remain stable across reports; omitting
an outcome does not erase its obligation, even if it was previously verified.
Every item in `outstanding` or `unverified` is a retained obligation too: resolve it
explicitly in `outcomes` using the same exact wording and current evidence. Clearing
the lists alone is not resolution. Omitted outcomes and their prior evidence remain
visible in the unfinished handoff. New checkpoints retain a SHA256 identity of each
original requirement before display redaction/truncation, so equal sanitized labels
cannot collapse distinct obligations. If original wording cannot be recovered,
completion stays unresolved; do not substitute truncated/redacted display text.
Older checkpoints cannot recover identity/evidence already lost before this change.
The cumulative requirement ledger survives intentional pauses, recovery follow-ups
and Pi session restoration in the same branch/directory. A supplied answer does
not waive known verification: each requirement still needs explicit current evidence.
Older saved runs recover available requirements from their report and omitted-outcome
metadata. Authoritative task identity, cumulative outcomes and notification-delivery
state are checkpointed during supervision, not only at terminal settlement; an
interrupted observation can therefore retain requirements learned while waiting.
A new `/cc` task starts a separate identity and ledger.
Stopped required tasks prevent finished in that invocation. A failed intermediate
check does not end supervision while approved repair or other required work remains.
Its identity and failed history stay in the handoff. A passing check under a new ID
does not silently resolve it: Claude must explicitly attribute replacement evidence
through `resolved_failures`, and the replacement must be observed completed after
the failed check. Unresolved failures and unknown outcomes still prevent finished;
stopped work and transport/execution errors cannot be resolved by this field.
This is **Claude Code's evidence-backed self-report, not independent Pi certification**.

Terminal handoffs use the same three dispositions on both entrypoints:

- **Finished**: attributable Claude Code completion report and evidence.
- **Needs input**: intentional pause with its precise question and saved context.
  Answer with `/cc-followup <information>` or `claude_worker` with `resume: true`.
- **Unfinished/interrupted**: limits, inability to continue, cancellation or errors.
  Stopped and failed runs retain distinct labels; unknown task outcomes are not
  described as failed verification. Inspect partial changes, outstanding work and
  retained evidence before resuming; nothing is rolled back.

Resume in the **same working directory**, using either follow-up entrypoint or
`claude --resume <session-id>` for interactive recovery. Session IDs follow the
active Pi branch; another branch/directory cannot silently resume this task.
Native task identities and histories survive follow-up too. Previously running work
is restored as unknown until fresh live evidence arrives; deliberate recovery may
restart previously stopped work without erasing its history.
Tree navigation stops the worker and retains its interrupted handoff on the
launching branch before moving the leaf. A post-navigation cleanup fallback
retains diagnostics only in the private log, never on the newly selected branch.
If no session ID was assigned, inspect the log and partial work before starting
a new `/cc` task. No automatic retry follows a terminal failure. Same-task resumes
retain sanitized prior handoffs and prior log references separately from the current
report, including when authentication fails before any new report. Prior evidence
remains labelled historical, never current completion certification; a fresh `/cc`
task does not inherit these handoffs.

## Activity inspection

The live widget shows the current tool/activity, elapsed time, time since the last
reported activity, tool counters and reported active tasks. `/cc-log` adds a
snapshot to the Pi transcript; use Pi's tool-output expansion shortcut (default
**Ctrl+O**) to inspect inputs, results, stderr, approvals, hooks and task updates.
Run the command again to refresh a running worker's snapshot. The inspector shows
12 recent summaries collapsed, or up to 200 records expanded, with a 64,000-character
view limit. Omitted records/view truncation are explicit; use the displayed log
path to inspect everything that was retained.

Live status includes the supervision reason and continuation count. Terminal
reports retain exit code, signal, result subtype, stop/terminal reason, permission
denials, last activity, outcomes/evidence, precise question, outstanding and
unverified work. Stopped/failed/completed task identities remain visible even
after the active-task list clears. Failures and stops leave a report in the Pi
transcript, not just a transient notification. The latest run's metadata follows
the Pi branch across reloads. If observation was interrupted without a retained
terminal outcome, the status says it is unknown and unfinished, not finished.

Each run creates a private temporary directory (`pi-cc-worker-*`) containing
`activity.jsonl`, with file mode `0600`. Logs retain prompts and reported tool
inputs/results; they can contain source code or other sensitive project data.
Common credential patterns are redacted; **redaction is not a guarantee that all
secrets are removed**. Authentication/control frames and thinking are excluded.
Individual retained strings are capped at 16,000 characters; activity details
are capped at 8 MiB, with an explicit notice and terminal outcome still retained.
The extension does not automatically delete logs; OS temporary-directory cleanup
can remove them. A missing/unreadable log is reported rather than hidden.

The transport sends a UUID with each submitted user turn and correlates results
within the saved session. A required native task completion drives continuation
only after the native turn result; waiting turns do not close input. An identical
native result without a delivery ID cannot prove that a later queue has drained;
ambiguous redelivery remains unresolved within the safety limits. Native task-notification
deduplication also survives same-task follow-up and restoration: an old completion
delivery is not fresh evidence for previously restarted work. Completion is checked
again after EOF cleanup; contradictory stopped/pending work downgrades the handoff
to unfinished without starting another turn. This guards
against premature ending but does not identify who cancelled historical work.

The `claude_worker` tool lets Pi delegate too. It takes a `prompt` and optional
`resume: true`, requires human confirmation, streams updates and returns the
result to Pi. **Pi's coordinating model still consumes its own provider usage.**
Nothing automatically routes other Pi tools or subagents through Claude Code.

## Safety and boundaries

- Runs one worker at a time, in a trusted project, with a dialog-capable Pi UI
  (terminal or RPC). Headless delegation is refused.
- Reuses Claude Code's own stored subscription login. API credentials and provider
  selectors are removed from the child environment; ambiguous billing sources
  are rejected by `claude auth status --json`. The same environment and working
  directory are used for the worker.
- Checks the worker's initialized account **before sending the task prompt**.
  Settings that reintroduce API credentials or a different provider fail this
  check. Hooks/settings themselves are trusted code; their arbitrary side effects
  are not sandboxed or made free by this extension.
- Uses native auto permissions and forwards unresolved tool requests to Pi
  confirmation dialogs. Claude Code's auto-mode checks, allow/deny rules and hooks
  govern actions that do not reach the host. Host approval applies to that call
  only. Unsupported specialized interactions are denied. Cancelled/duplicate
  requests cannot gain late approval.
- Keeps native settings, skills, MCP servers and hooks; does not use `--bare`,
  `bypassPermissions` or `--dangerously-skip-permissions`.
- **No automatic worktree, rollback, commit or push.** Claude Code can modify the
  current project and run approved commands. Do not let Pi or another worker edit
  the same files concurrently; put isolated work in a separate worktree yourself.
- Stop/reload/session shutdown aborts owned processes with SIGTERM, escalating to
  SIGKILL after one second.
  POSIX cancellation targets the worker's process group; Windows cancellation is
  limited to the immediate process.
- Saved session IDs follow the active Pi branch and are scoped to the working
  directory. A stopped worker may leave partial changes; inspect them before
  resuming or running another agent.
- Assembled run reports, including task outcomes and evidence, are capped at
  50 KiB or 2,000 lines (whichever is reached first), including the truncation
  notice. The notice points to a private `pi-cc-report-*` file containing the
  complete sanitized report; retained metadata still has the individual-string
  limits described above. Open the saved session with `claude --resume <session-id>`
  for the complete native history or an unsupported interaction.

There is no fallback to API billing and no automatic retry after a failed worker.
If authentication is rejected, correct it in Claude Code and try again.

## Protocol sources and validation

Uses Claude Code's newline-delimited JSON control protocol, including initialization,
one-shot permission responses and cancellation:

- [Anthropic SDK transport](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py)
- [Anthropic control protocol](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)
- [Authentication precedence](https://code.claude.com/docs/en/authentication)
- [Credential-use policy](https://code.claude.com/docs/en/legal-and-compliance)

Tests use subprocess-backed local CLI fixtures and Pi API fixtures. No paid/live
probe is part of the Node test glob.
