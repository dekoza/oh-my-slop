# Subscription worker for Claude Code

Delegate a bounded task from Pi to the **unmodified, installed Claude Code CLI**.
The extension does not extract credentials, register a model provider, or proxy
Anthropic requests. Claude Code owns its tools, context, hooks and permissions.

Verified against Claude Code **2.1.287** and the installed Pi extension loader.
Older versions without the expected authentication/control metadata fail closed.
Fixture tests cover the protocol; a real inference/permission roundtrip has not
been run. The extension launches nothing when it loads.

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
| `/cc <task>` | Start a new worker in Pi's current project. |
| `/cc-followup <instruction>` | Resume the last saved worker session after it finishes or stops. |
| `/cc-status` | Show running/finished/failed status and the saved session ID. |
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
- Stop/reload/session shutdown aborts owned processes, escalating after one second.
  POSIX cancellation targets the worker's process group; Windows cancellation is
  limited to the immediate process.
- Saved session IDs follow the active Pi branch and are scoped to the working
  directory. A stopped worker may leave partial changes; inspect them before
  resuming or running another agent.
- Final output is capped at 64,000 characters with an explicit truncation notice.
  Open the saved session with `claude --resume <session-id>` for the complete
  history or an unsupported interaction.

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
