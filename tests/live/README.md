# Live probes

Scripts that answer a question about a **running** Herdr server by talking to it, rather than
about this repository's code by importing it.

**They are not part of any suite and must not become one.** `node --test tests/node/*.mjs` globs
every `.mjs` under `tests/node/`, so a probe placed there would create workspaces — and in one
case start a paid model session — on every full test run. That is why they live here.

Run one by hand, when you need the answer:

```sh
node tests/live/herdr-subscription-frames.mjs
```

Each probe cleans up the workspaces it creates. Each prints a timestamped transcript of what it
saw; the transcript is the deliverable, and a captured frame is the right fixture for a unit test
written afterwards (§5.1's parser is exactly the thing that cannot be tested against frames
somebody wrote to match it).

| Probe | Costs a model session | Answers |
|---|---|---|
| `herdr-subscription-frames.mjs` | no | Which event names does the socket actually deliver, and does the factory's subscription request accept them? |
| `herdr-pane-exit-frame.mjs` | no | Does closing a pane emit a frame, and under which name? |
| `herdr-isolated-worker-status.mjs` | **yes** | Does a worker pane launched under §6.8 isolation report an agent status to Herdr? |
| `herdr-tab-env-reaches-agent.mjs` | no | Does a variable set with `tab create --env` reach the agent process `agent start` launches later, or only the pane's shell? |

`herdr-isolated-worker-status.mjs` starts a real Claude session and prompts it. Keep the prompt
trivial and expect it to cost what one short turn costs.

## What they established

Against Herdr 0.8.0, protocol 19, on 2026-08-17 (#149):

**The wire names are inconsistent, and exactly one of the three does not match what the factory
tests for.**

| subscribed as | delivered as | `fromFrame` tests for | |
|---|---|---|---|
| `pane.agent_detected` | `pane_agent_detected` | `pane_agent_detected` | matched |
| `pane.agent_status_changed` | **`pane.agent_status_changed`** | `pane_agent_status_changed` | **dropped** |
| `pane.exited` | `pane_exited` | `pane_exited` | matched |

- `pane.agent_status_changed` **requires** its `pane_id` filter; an unfiltered subscription is
  refused with `invalid_request: missing field 'pane_id'`. The other two are server-wide.
- A pane whose shell exits emits `pane_exited` and takes a single-pane workspace with it.
- **Isolation does not affect agent-status detection, in either runtime.** Under an isolated
  config with no operator hooks or extensions, the detector still moved `idle → working → idle`:
  Claude by OSC-title parsing (rule `osc_title_working`), pi by the `working_literal` screen rule.
  Both runs saw exactly one socket transition — `pane_agent_detected` — while the detector saw
  three.
- pi's detection is much thinner than Claude's: its manifest carries a single rule, and `idle` is
  the engine's default when nothing matches (`matched_rule: null`). For pi, "idle" is therefore
  *no evidence of anything on screen*, not evidence of a finished turn — which is why a deadline
  fed by status alone is not enough (#150).

Against Herdr 0.8.0 on 2026-08-17 (#157):

**`tab create --env` reaches the agent process, not merely the pane's shell.** Herdr's help says
`--env` sets "an environment variable for the launched process", and the launched process is the
shell — so whether the agent inherits it was the open question, and it does. Read out of
`/proc/<pid>/environ` on both hops: the tab's shell, then the `pi` process `agent start` put in
that shell afterwards. Both carried `FACTORY_WORKTREE=/state/my worktrees/it's` byte for byte,
so a value with a space and an apostrophe in it crosses as one argv element and needs no
quoting of ours. The pane's scrollback contained neither value. That is what let §6.5's identity
and §6.8's binding move off `pane run export …`, and with them the factory's POSIX quoting
helper.

**`agent start` still takes no environment** — not in the CLI (`<NAME> --kind --pane --timeout
[-- AGENT_ARG...]`) and not in the socket API. `workspace create` and `tab create` are the only
two of the three that do, which is why the binding is assembled at the tab.
