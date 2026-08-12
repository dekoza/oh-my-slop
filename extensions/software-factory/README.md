# software-factory

Status: **Active MVP** (Gitea, Herdr, serial pi and Claude Code workers).

This pi extension executes agent-ready implementation tickets without turning Wayfinder
into an implementation workflow. The tracker is durable work state, skills define how
agents work, Herdr owns terminals and agent lifecycle, and this extension schedules and
integrates one ticket at a time.

The software factory loads automatically with the root package, but loading only registers
`/factory`. No factory
run starts until a user explicitly invokes `/factory start <ticket-or-parent>` from Herdr.
That command can create branches and worktrees, run agents, update Gitea issues, push an
integration branch, and open a pull request.

## Workflow

1. Run `setup-project-skills` in the target repository and accept factory setup. It
   writes `.pi/factory.json` and ensures `.worktrees/` is ignored.
2. Use `wayfinder` to resolve decision tickets with the required human involvement.
3. Use `to-tickets` to publish build-ready tickets carrying `workflow:implement` and
   the configured `ready-for-agent` label.
4. From a Herdr-managed pi pane, run `/factory start <ticket-or-parent>`. The target
   can be one agent-ready implementation ticket or a parent containing such tickets.
5. The factory claims the target ticket, or the first unblocked, unassigned child ticket,
   resolves its worker profile from committed label/phase rules, creates an isolated ticket
   worktree and Herdr
   tab, and invokes `implement` through pi or Claude Code.
6. A successful implementation worker must commit its work and report test evidence. A
   separately launched reviewer runs `two-axis-review`; actionable findings consume the
   same-worker repair and fresh-worker retry budgets before the ticket is blocked.
7. The factory verifies the commit, merges it, checks that the ticket branch is an ancestor
   of the clean integration branch, and runs `git diff --check` before closing the ticket
   with an idempotent implementation and review evidence comment.
8. When no implementation tickets remain, a routed final reviewer examines the complete
   integration diff. Only a passing review permits the factory to push the integration
   branch and open a pull request. Final merge is always manual.

Human-blocked tickets are relabelled with the configured `ready-for-human` label and
left open. The serial scheduler continues any unrelated frontier work, then pauses.

## Install

Install the root package; its pi manifest loads this extension automatically:

```bash
pi install git:github.com/dekoza/oh-my-slop
```

Existing package installations pick up the entrypoint after `pi update --extensions` and
a pi restart or `/reload`. The extension must be invoked inside Herdr (`HERDR_ENV=1`). It
refuses to control a focused Herdr session from outside a managed pane.

## Commands

| Command | Effect |
|---|---|
| `/factory start <ticket-or-parent>` | Start a background serial run for one eligible Gitea implementation ticket, or for the eligible children of a parent issue. |
| `/factory status` | Show the last repository-scoped run snapshot. |

## Configuration reference

`.pi/factory.json` is committed project policy, not a credential or endpoint store.
`setup-project-skills` owns its initial scaffold. Provider authentication and llama.cpp
endpoints remain in pi/Claude user configuration.

Profiles are named launch specifications. Ticket routing uses the first rule whose `phases`
contains the current phase and whose `labelsAny` intersects the ticket labels; otherwise it
uses the phase default. Rules support `implement`, `freshRetry`, and `review`. Run-level
`finalReview` has no ticket labels and is selected only through its explicit default.
Same-worker repair intentionally stays on the original implementation profile.

Example policy using subscription, metered, and local capacity:

```json
{
  "workers": {
    "profiles": {
      "local": {
        "kind": "pi",
        "model": "local/thinkingcap-qwen3.6-27b",
        "thinking": "high",
        "startupTimeoutMs": 180000
      },
      "openrouter-general": {
        "kind": "pi",
        "model": "openrouter/z-ai/glm-5.2",
        "thinking": "high"
      },
      "openrouter-review": {
        "kind": "pi",
        "model": "openrouter/~deepseek/deepseek-v4-flash-latest",
        "thinking": "medium"
      },
      "openrouter-vision": {
        "kind": "pi",
        "model": "openrouter/qwen/qwen3.8-max",
        "thinking": "high"
      },
      "gpt": {
        "kind": "pi",
        "model": "openai-codex/gpt-5.6-sol",
        "thinking": "high"
      },
      "claude-implement": {
        "kind": "claude",
        "model": "opus",
        "effort": "high",
        "permissionMode": "auto"
      },
      "claude-review": {
        "kind": "claude",
        "model": "opus",
        "effort": "high",
        "permissionMode": "dontAsk"
      },
      "claude-final-review": {
        "kind": "claude",
        "model": "fable",
        "effort": "high",
        "permissionMode": "dontAsk"
      }
    },
    "routing": {
      "defaults": {
        "implement": "openrouter-general",
        "freshRetry": "gpt",
        "review": "openrouter-review",
        "finalReview": "claude-final-review"
      },
      "rules": [
        { "labelsAny": ["factory:local"], "phases": ["implement", "review"], "profile": "local" },
        { "labelsAny": ["factory:claude"], "phases": ["implement"], "profile": "claude-implement" },
        { "labelsAny": ["factory:claude", "risk:high"], "phases": ["review"], "profile": "claude-review" },
        { "labelsAny": ["factory:qwen"], "phases": ["implement", "review"], "profile": "openrouter-vision" }
      ]
    }
  }
}
```

The recommended Claude tiers reserve Opus for explicitly routed high-risk implementation
and ticket review, while Fable performs the final integration review. Claude implementation
profiles use `auto`, which lets Claude classify routine tool calls without turning each Bash
command into a human blocker; risky calls can still stop for approval. Routine work remains
on the pi/OpenRouter defaults, preserving Claude Max capacity and keeping Fable independent
from ticket implementation.

To run every model-bearing phase locally, map all four defaults to `local` and omit rules
that select remote profiles. The factory scheduler, Git operations, and tracker adapter do
not use a model.

| Field | Default / allowed value | Purpose |
|---|---|---|
| `version` | `1` | Configuration schema version. |
| `tracker.kind` | `gitea` | Only tracker adapter in this release. |
| `tracker.repo` | required `owner/repository` | Explicit Gitea repository; no remote inference. |
| `tracker.remote` | `gitea` | Gitea remote used by project setup. |
| `tracker.login` | required | Explicit `tea` login; prevents cross-instance fallback. |
| `tracker.assignee` | required | Account used for assignment-based ticket claims. |
| `tracker.labels.implementation` | `workflow:implement` | Routes implementation tickets. |
| `tracker.labels.readyForAgent` | `ready-for-agent` | Marks factory-eligible tickets. |
| `tracker.labels.readyForHuman` | `ready-for-human` | Marks tickets requiring intervention. |
| `git.baseBranch` | `main` | Manual pull-request target. |
| `git.remote` | `gitea` | Remote receiving the integration branch. |
| `herdr.maxWorkers` | `1` | Serial execution; bounded parallelism is deferred. |
| `workers.profiles.<name>.kind` | `pi` or `claude` | Herdr agent kind for this profile. |
| `workers.profiles.<name>.model` | optional string | Exact pi provider/model selector or Claude model alias. |
| `workers.profiles.<name>.thinking` | pi thinking level | pi-only reasoning level. |
| `workers.profiles.<name>.effort` | Claude effort level | Claude-only effort level. |
| `workers.profiles.<name>.permissionMode` | safe Claude mode | Use `auto` for autonomous implementation. `acceptEdits`, `manual`, `dontAsk`, and `plan` are accepted for explicit human-gated policy; bypass is rejected. Review roles are always launched in `plan` mode. |
| `workers.profiles.<name>.startupTimeoutMs` | at least `30000` | Herdr startup budget; raise for cold local model loads. |
| `workers.routing.defaults` | four profile names | Default profile for each model-bearing phase. |
| `workers.routing.rules` | ordered label rules | Deterministic ticket overrides; first phase/label match wins. |
| `retry.repairAttempts` | `1` | Same-worker repair attempts after implementation or review failure. |
| `retry.freshAgentRetries` | `1` | Fresh routed worker attempts after repair fails. |
| `completion.closeAfterIntegration` | `true` | Close after verified integration into the factory branch. |
| `completion.finalMerge` | `manual` | Protected branch merge remains human-controlled. |
| `completion.createPullRequest` | `true` | Create the final integration pull request. |
| `completion.deploy` | `false` | Deployment is outside the factory boundary. |

## Safety and trust boundary

- Start requires a trusted pi project and an explicit parent issue.
- The repository must be clean; the factory never stashes, resets, or overwrites local
  work. `.worktrees/` must already be ignored.
- Commands use argument arrays rather than interpolated shell commands.
- Worker prompts reserve merge, push, close, and relabel operations for the scheduler.
  This is behavioral separation, not a credential sandbox: workers inherit the repository's
  shell and credentials. Claude implementation profiles should use classifier-gated `auto`
  mode; review-role launches disable edit/write tools and force Claude plan mode, but shell
  access still makes the Git guard authoritative. Implementation tests are worker-reported;
  independently launched reviewers are checked for worktree HEAD or status
  changes and quarantined on mutation before integration.
- Before creating branches, the factory checks selected pi model IDs with `pi --list-models`
  and checks the Claude Code binary with `claude --version`. It never stores credentials or
  llama.cpp endpoints in project policy.
- Ticket bodies and acceptance criteria are work specifications. Issue comments are
  untrusted context unless committed project workflow says otherwise.
- Product ambiguity, credentials, destructive work, security exceptions, exhausted
  retries, and integration conflicts stop at a human boundary.
- The factory never deploys and never merges the final pull request.

## Recovery and current limits

Run snapshots are written under the pi agent directory at
`software-factory/runs/`; `/factory status` survives reloads and restarts. Herdr
workspaces and Git worktrees are deliberately retained for inspection. Completed automated
worker tabs are retired; any worker or reviewer tab that actually needs human input remains
open so its prompt and transcript can be inspected.

The MVP does **not** resume an interrupted scheduler after the controlling pi process
exits. It also does not sandbox worker credentials or arbitrate shared llama.cpp capacity. Inspect `/factory status`, the named Herdr workspace, Gitea comments, and the
retained worktrees before recovering manually. Automatic crash replay, bounded
parallel workers, and non-Gitea tracker adapters are follow-up work, not hidden claims
of this release.
