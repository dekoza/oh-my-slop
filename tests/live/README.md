# Live probes and proofs

Scripts that answer a question by talking to something **real and running** — a Herdr server, an
installed harness binary — rather than about this repository's code by importing it.

**They are not part of any suite and must not become one.** `node --test tests/node/*.mjs` globs
every `.mjs` under `tests/node/`, so one placed there would create workspaces — and in some cases
start paid model sessions — on every full test run. That is why they live here.

Two kinds share the directory, because they share that hazard and that rule:

- **Probes** answer an open question and leave a transcript. The transcript is the deliverable, and
  a captured frame is the right fixture for a unit test written afterwards (§5.1's parser is
  exactly the thing that cannot be tested against frames somebody wrote to match it).
- **Proofs** discharge a standing acceptance obligation and write a durable artifact under
  [`docs/proofs/`](../../docs/proofs/). What they *conclude* lives in `factory/lib/` and is
  unit-tested under `tests/node/`; what lives here is the wiring and the spending.

Run one by hand, when you need the answer:

```sh
node tests/live/herdr-subscription-frames.mjs
```

Each probe cleans up the workspaces it creates, and each prints a timestamped transcript of what
it saw.

| Script | Kind | Costs a model session | Answers |
|---|---|---|---|
| `herdr-subscription-frames.mjs` | probe | no | Which event names does the socket actually deliver, and does the factory's subscription request accept them? |
| `herdr-pane-exit-frame.mjs` | probe | no | Does closing a pane emit a frame, and under which name? |
| `herdr-isolated-worker-status.mjs` | probe | **yes** | Does a worker pane launched under §6.8 isolation report an agent status to Herdr? |
| `herdr-tab-env-reaches-agent.mjs` | probe | no | Does a variable set with `tab create --env` reach the agent process `agent start` launches later, or only the pane's shell? |
| `herdr-agent-stop-latency.mjs` | probe | no | How long after §13.B's quit keys does Herdr stop reporting an agent in the pane — the lag #152's bound has to cover? |
| `herdr-agent-quit-sequence.mjs` | probe | **yes**, unless `--no-prompt` | Does §13.B's quit sequence quit **at all**, key by key and call by call, against a worker that is mid-turn rather than idle? |
| `herdr-agent-presence-source.mjs` | probe | no | What is `pane.agent` — the one fact §5.2 trusts — derived from: the screen, the process, or somebody reporting it? |
| `claude-chrome-cache.mjs` | probe | no | Does an interactive Claude session warm `cachedChromeExtensionInstalled` in the controller-owned config state, and does §6.8's browser fence stop it? |
| `prove-skill-loading.mjs` | proof | **yes** | §6.7 / §15 — do Opus and Fable *load and follow* a skill body, or merely register its name? Writes `docs/proofs/skill-loading-<version>-<digest>.md`. |

`herdr-isolated-worker-status.mjs` starts a real Claude session and prompts it. Keep the prompt
trivial and expect it to cost what one short turn costs.

`herdr-agent-quit-sequence.mjs` costs the same — one short turn, on `--model haiku` by default,
whose only work is to run a script that waits. `--no-prompt` skips the prompt and costs nothing,
which is the idle control for the same send plan. Its `--keys` flag is the send plan itself:
spaces separate `send-keys` **calls**, commas separate keys **within** a call, so
`esc,ctrl+c,ctrl+c` is the pre-#158 single call and `esc ctrl+c,ctrl+c` is what ships now.

`claude-chrome-cache.mjs` needs a **TTY**, and that is the finding rather than an inconvenience: on
Claude Code 2.1.241 the detection does not run in a `--print` session at all, so a headless test
asserting the key's absence is green with or without the fence. It allocates the pty through
`script(1)`, runs three successive startups per side in one controller-owned config root, and kills
each at its prompt — no turn, no tokens. It runs **both sides**, for the reason §6.2's discovery
fence does: an absence under a run that could not have seen the write is not evidence of a fence,
and the probe exits 2 saying so.

`prove-skill-loading.mjs` spends one short turn per cell — three cells per model, two models by
default. Run `--dry-run` first to see the plan, the argv and the prompts without spending
anything.

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

Against Herdr 0.8.0, protocol 19, Claude Code 2.1.233, on 2026-08-18 (#158):

**§13.B's quit sequence was not a sequence of keys but a sequence of *calls*, and the grouping
decided whether a worker quit at all.** Every row below is one
`herdr-agent-quit-sequence.mjs` run; "gone" is the agent leaving the pane record, timed from
the last `send-keys` call. The idle rows are **controls for the send plan, not a re-measurement
of the discharged latency** — claude 729 ms and pi 418 ms stand as #152 recorded them, cited
where the bound is defined (`STOP_CONFIRM_BACKOFF_MS`); these rows exist only to show one send
plan getting a different answer from a working harness than from an idle one.

| state when the keys were sent | send plan | result |
|---|---|---|
| idle, never prompted | `esc ctrl+c ctrl+c` — one call | gone in 721 ms |
| idle | `esc` · `ctrl+c` · `ctrl+c` — three calls, 500 ms apart | gone ~620 ms after the last call (1635 ms from the first) |
| idle | three calls, 1000 ms apart | **never** — still there after 15 s |
| idle | three calls, 1500 ms apart | **never** — still there after 30 s |
| idle | `esc` · `ctrl+c ctrl+c` — two calls, 1500 ms apart | gone in 621 ms |
| turn just ended, empty input box | one call | gone in 430 ms |
| working, mid-inference | one call | **never** — interrupted, agent resident |
| working, tool running (`esc to interrupt` on screen) | one call | **never** — interrupted, agent resident |
| working, tool running | `esc` · `ctrl+c` · `ctrl+c` — three calls, 1000 ms apart | **never** — still there after 15 s |
| working, mid-inference | two calls, 1500 ms apart | gone in 723 ms |
| working, tool running | two calls, at 0 ms, 250 ms and 1500 ms apart | gone in 723, 419 and 412 ms |

A further run, made after the change landed and reading its send plan straight out of
`AGENT_STOP_KEY_CALLS` and `AGENT_STOP_SETTLE_MS`, quit a worker whose tool was running in
423 ms — the shipped configuration, end to end.

Two independent facts fall out, and the shipped sequence needs both:

- **The two `ctrl+c` must ride one call.** Claude's exit affordance is a double press with a
  window somewhere between 500 ms and 1000 ms; spaced beyond it, the presses never compose into
  an exit and nothing quits — not even an idle harness.
- **`esc` must not ride with them.** Sent in the same call at a working Claude, the whole
  sequence is consumed as a bare turn interrupt: the turn stops, the interrupted prompt is
  restored to the input box, and the agent stays. This is the wedge run
  `01M0859CJAA1Z8XK41756H5Y30` left on three attempts of #114, reproduced here on demand.
  Splitting `esc` into its own call fixes it, and **the call boundary is what matters, not the
  delay** — two calls 8 ms apart quit a working worker as reliably as 1500 ms apart.

**The stop-confirmation bound was never the problem** (#152's `STOP_CONFIRM_BACKOFF_MS`). Once
the sequence is right, a mid-turn stop is observed at 412–723 ms, the same order as the idle
729 ms already recorded — Herdr's detection cycle dominates, and the harness's teardown does
not. The bound is confirmed unchanged; what changed is the sequence.

**pi quits under either shape** (106 ms and 209 ms idle), so one sequence still serves both
harnesses. pi's mid-turn case is unmeasured: #158 scoped the paid measurement to Claude, which
is the runtime whose interrupt affordance absorbed the sequence.

**`pane.agent` follows the pane's foreground process, not its screen**
(`herdr-agent-presence-source.mjs`, no model cost). This is the signal `agentAlive` reads, so
every confirmed stop is an absence of it, and the question was whether a mid-turn screen that
stopped matching the detection rules could manufacture that absence. It cannot:

| what was in the pane | `pane.agent` | `agent explain` |
|---|---|---|
| a shell, nothing else | `null` | no agent, no rules evaluated |
| `claude` launched **at the shell**, never `agent start`ed | `claude` | `idle`, rule `live_prompt_box` |
| a bare `sleep` whose argv names it `claude`, **blank screen** | `claude` | `idle`, **`matched_rule: null`**, 12 rules evaluated |
| `claude` through `agent start`, first-run dialog on screen | `claude` | `idle`, `matched_rule: null` |
| the same, after `pane release-agent` | `claude` — unchanged | unchanged |
| the same, after a foreign `pane report-agent … --state working` | `claude`, and `agent_status` **moved to `working`** | still `idle` from the screen |

So the rules decide **state**; presence is the process. Two consequences the factory depends on:

- **No false absence.** A screen matching nothing leaves presence intact, which is why
  `stopped: true` cannot be written about a worker that is still working. Measured directly as
  well as structurally: across two held turns with a tool running, 292/292 and 195/195 reads of
  the pane record saw the agent, none saw absence.
- **A false *presence* is constructible** — anything whose argv wears the harness's name reads
  as an agent. That is the conservative direction: it produces §13.B's `wedged-pane`, never a
  confirmation.

Agent **status** carries no such guarantee. A `pane report-agent` from a source that owns
nothing moved `agent_status` to `working` while the screen still read `idle`, so the two can be
made to disagree — worth knowing wherever status, rather than presence, is what a decision rests
on (§6.6, #150).

**Aside, not #158's to fix:** with the binding correctly declared on the tab, a session under a
fresh isolated `CLAUDE_CONFIG_DIR` still came up on a first-run dialog asking about browser
access, waiting on a keypress a worker has nobody to supply — and Herdr read that screen as
`idle` with `matched_rule: null`, so a deadline fed by status would see a settled agent rather
than a stuck one. (A folder-trust dialog also appeared once, but that was the probe's own bug:
its tab carried no binding, so the session ran on the operator's config. §6.8's pre-trust was
never in question.) §6.8 proves no *trust* dialog can reach a worker pane; a first-run prompt
about something else is a different door into the same hang.

That aside became #178, and `claude-chrome-cache.mjs` settled it.

**An operator hook can reach an isolated worker.** A first run of the probe held its turn open
with `sleep 240` and had it refused by a hook — with the refusal, the turn ended, and the
"mid-turn" measurement was in fact a measurement of a finished one. What holds a probe's turn
open must be something no hook has an opinion about; this one commits a script and asks the
worker to run it.

Against Claude Code 2.1.241, on 2026-08-30 (#178):

**The browser prompt is not a first-run prompt — it is a warm-cache one, and the cache is the
harness's own.** Three successive interactive startups in one controller-owned config root, with
credentials promoted the way §6.8 promotes them:

| session binding | after 1 | after 2 | after 3 |
|---|---|---|---|
| the worker binding | `cachedChromeExtensionInstalled` absent | absent | absent |
| the same, minus `--no-chrome` | `true` | `true` | `true` |

Three things follow, and all three are why the fix is a flag on the binding rather than a rule
about a screen:

- **The first session is the one that warms it**, and a *later* one is the one that raises the
  prompt — so a single-session test proves nothing, and the assertion has to be an absence over
  several.
- **A `--print` session never warms it at all**, with or without the flag. So the same assertion
  taken without a TTY is green over a live bug, which is why this probe allocates one.
- **The write needs credentials.** An isolated config root with none is "not logged in", the
  detection does not run, and the key stays absent for a reason that says nothing about the
  fence. The probe promotes them through `prepareWorkerEnvironment`, exactly as a run does.
