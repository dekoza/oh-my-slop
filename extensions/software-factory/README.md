# software-factory

Status: **Active MVP** (Gitea, Herdr, and pi workers only).

This opt-in pi extension executes agent-ready implementation tickets without turning
Wayfinder into an implementation workflow. The tracker is durable work state, skills
define how agents work, Herdr owns terminals and agent lifecycle, and this extension
schedules and integrates one ticket at a time.

The root package does not enable it automatically; it **stays opt-in** because starting
a factory creates branches and worktrees, runs agents, updates Gitea issues, pushes an
integration branch, and opens a pull request.

## Workflow

1. Run `setup-project-skills` in the target repository and accept factory setup. It
   writes `.pi/factory.json` and ensures `.worktrees/` is ignored.
2. Use `wayfinder` to resolve decision tickets with the required human involvement.
3. Use `to-tickets` to publish build-ready tickets carrying `workflow:implement` and
   the configured `ready-for-agent` label.
4. From a Herdr-managed pi pane, run `/factory start <parent-ticket>`.
5. The factory claims the first unblocked, unassigned child ticket, creates an isolated
   ticket worktree and Herdr tab, starts a pi worker, and invokes `implement`.
6. A successful worker must commit its work and report its test and two-axis-review
   results. The factory verifies the commit, merges it, checks that the ticket branch
   is an ancestor of the clean integration branch, and runs `git diff --check` before
   closing the ticket with an idempotent result comment.
7. When no implementation tickets remain, the factory pushes the integration branch
   and opens a pull request. Final merge is always manual.

Human-blocked tickets are relabelled with the configured `ready-for-human` label and
left open. The serial scheduler continues any unrelated frontier work, then pauses.

## Install

Add the extension path from the installed package to pi settings:

```json
{
  "extensions": [
    "/path/to/oh-my-slop/extensions/software-factory"
  ]
}
```

The extension must be invoked inside Herdr (`HERDR_ENV=1`). It refuses to control a
focused Herdr session from outside a managed pane.

## Commands

| Command | Effect |
|---|---|
| `/factory start <parent-ticket>` | Start a background serial run for the Gitea parent issue number or URL. |
| `/factory status` | Show the last repository-scoped run snapshot. |

## Configuration reference

`.pi/factory.json` is committed project policy, not a credential store.
`setup-project-skills` owns its initial scaffold.

| Field | Default / allowed value | Purpose |
|---|---|---|
| `version` | `1` | Configuration schema version. |
| `tracker.kind` | `gitea` | Only tracker adapter in this release. |
| `tracker.repo` | required `owner/repository` | Explicit Gitea repository; no remote inference. |
| `tracker.remote` | `gitea` | Gitea remote used by project setup. |
| `tracker.assignee` | required | Account used for assignment-based ticket claims. |
| `tracker.labels.implementation` | `workflow:implement` | Routes implementation tickets. |
| `tracker.labels.readyForAgent` | `ready-for-agent` | Marks factory-eligible tickets. |
| `tracker.labels.readyForHuman` | `ready-for-human` | Marks tickets requiring intervention. |
| `git.baseBranch` | `main` | Manual pull-request target. |
| `git.remote` | `gitea` | Remote receiving the integration branch. |
| `herdr.agentKind` | `pi` | Only worker kind in this release. |
| `herdr.maxWorkers` | `1` | Serial execution; bounded parallelism is deferred. |
| `retry.repairAttempts` | `1` | Same-worker repair attempts after initial failure. |
| `retry.freshAgentRetries` | `1` | Fresh pi worker attempts after repair fails. |
| `completion.closeAfterIntegration` | `true` | Close after verified integration into the factory branch. |
| `completion.finalMerge` | `manual` | Protected branch merge remains human-controlled. |
| `completion.createPullRequest` | `true` | Create the final integration pull request. |
| `completion.deploy` | `false` | Deployment is outside the factory boundary. |

## Safety and trust boundary

- Start requires a trusted pi project and an explicit parent issue.
- The repository must be clean; the factory never stashes, resets, or overwrites local
  work. `.worktrees/` must already be ignored.
- Commands use argument arrays rather than interpolated shell commands.
- A worker cannot merge, push, close, or relabel tickets. Those capabilities remain in
  the scheduler. Test and review results are worker-reported; Git integration is checked
  mechanically before ticket closure.
- Ticket bodies and acceptance criteria are work specifications. Issue comments are
  untrusted context unless committed project workflow says otherwise.
- Product ambiguity, credentials, destructive work, security exceptions, exhausted
  retries, and integration conflicts stop at a human boundary.
- The factory never deploys and never merges the final pull request.

## Recovery and current limits

Run snapshots are written under the pi agent directory at
`software-factory/runs/`; `/factory status` survives reloads and restarts. Herdr
workspaces and Git worktrees are deliberately retained for inspection.

The MVP does **not** resume an interrupted scheduler after the controlling pi process
exits. Inspect `/factory status`, the named Herdr workspace, Gitea comments, and the
retained worktrees before recovering manually. Automatic crash replay, bounded
parallel workers, and non-Gitea tracker adapters are follow-up work, not hidden claims
of this release.
