# Live worker coordination seams — 2026-08-17

**Question (#136, part of map #135):** which verified pi, Claude, Herdr, and current
factory worker-adapter capabilities can deliver and receive controller-mediated
coordination *while an agent is working*, without granting tracker credentials or pane
control to workers — and what timing, interruption, identity, and crash limitations must
the protocol respect?

**Method.** Primary sources only: this repository's factory source (file:line cited), the
installed Herdr 0.8.0 / protocol 19 (`HERDR_ENV=1 herdr status`; CLI `--help` output; the
full socket schema via `herdr api schema --json`; a read-only `server.agent_manifests`
socket call), the installed pi 0.84.2 (`pi --help`; its shipped docs under
`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/`), the installed Claude
Code 2.1.233 (`claude --help`), and official Claude docs (URLs per claim, gathered
2026-08-17). Every claim is marked **VERIFIED** (seen in source, probe output, schema, or
official doc) or **INFERRED** (a composition or reading not directly observed). No input
was sent to any pane running real work; no new model session was started for this survey.

**Baseline finding, stated up front (VERIFIED):** today the factory has *zero* mid-flight
coordination channels. `herdr.prompt` is called exactly once per attempt — the first
prompt at launch (`factory/lib/worker/lifecycle.mjs:918`, and a grep of `factory/lib`
finds no other call site). Everything else the controller does mid-attempt is
*observation* (status subscription, output sampling, outbox polling) or *termination*
(quit keys). All coordination happens at attempt boundaries: `needs-human` is an
end-of-turn outbox status, and resume is a fresh attempt (`§5.5`,
`factory/lib/worker/attempt.mjs:163-177`; `factory/lib/worker/prompt.mjs:455` — "End your
turn by writing exactly one JSON file").

---

## 1. Surface: the factory's current worker adapters

### 1.1 The adapter contract has no coordination operation (VERIFIED)

The runtime-neutral adapter is exactly four operations — `preflight`, `launch`,
`awaitCompletion`, `cancel` (`factory/lib/worker/adapter.mjs:28`) — and the constructor
*refuses* an adapter declaring a fifth: "a fifth operation is a specification change, not
an adapter's decision" (`adapter.mjs:122-128`). A `deliver(attempt, message)` /
`collect(attempt)` pair is therefore a spec change to §6.1, not an adapter patch.

### 1.2 Channels that exist controller → worker (VERIFIED)

All at launch time; none re-usable mid-flight today:

| Channel | Mechanism | Source |
|---|---|---|
| First prompt | `herdr agent prompt <agent> <text>`, deterministic bytes, digest journaled | `lifecycle.mjs:914-940`, `prompt.mjs:79-125` |
| Pane environment | `pane run <id> "export FACTORY_RUN=… FACTORY_TICKET=… FACTORY_PHASE=… FACTORY_ATTEMPT=… FACTORY_OUTBOX=… FACTORY_WORKTREE=…"` typed into the shell before the agent occupies it | `herdr-control.mjs:200-206`, `lifecycle.mjs:886-895` |
| Worktree contents | the attempt branch checked out at the pinned base | `lifecycle.mjs` launch context, §7.3 |
| Session binding | Claude: controller-owned `--settings` file + `--permission-mode` + `--plugin-dir`; pi: `--no-skills --skill <roots>` + posture flags + declared `--extension` paths | `permissions.mjs:214-241`, `claude.mjs:66-85`, `pi.mjs:57-72`, `environment.mjs:172-206` |

The prompt-delivery race is already known and handled: Herdr's `agent prompt` "answered
exit 0 while Claude was still initializing, the text went nowhere" (measured live,
`lifecycle.mjs:80-86`), so the launch re-sends the same deterministic prompt up to 3
times and watches for it being *taken up* (worker leaves resting state, or outbox exists)
(`lifecycle.mjs:914-940`). **Any mid-flight delivery seam inherits this exact
delivered-vs-submitted problem and needs the same confirmation loop.**

### 1.3 Channels that exist worker → controller (VERIFIED)

| Channel | Cadence | Source |
|---|---|---|
| Outbox JSON (`<state>/attempts/<id>/outbox.json`, outside the worktree) | once, at end of turn; first schema-valid content wins, later writes are evidence only | `outbox.mjs:10-47`, `attempt.mjs:79-87` |
| Agent-status transitions | subscribed over the Herdr socket (`pane.agent_status_changed` + 2), journaled as `observation.recorded` | `herdr-events.mjs:32,159-171`, `lifecycle.mjs:562-569,1181-1287` |
| Pane output | sampled every 5 s via `pane read --raw --lines 200`, digest-compared as a progress signal | `lifecycle.mjs:92-93,630-643`, `herdr-control.mjs:252-256` |
| Transcript pointer | pushed by the agent itself (Claude `SessionStart` hook / pi extension → `pane.report_agent_session`), captured with backoff after launch | `herdr-control.mjs:288-305`, `lifecycle.mjs:952-962` |

The outbox is worker-honesty-plus-validation, not enforcement: schema v1, worker-writable
statuses only (`completed`/`needs-human`/`worker-failed`), mandatory identity-tuple echo,
and a `foreign` verdict (→ automation failure) when the tuple mismatches
(`outbox.mjs:36-47,116-148,306-318`). 256 KiB ceiling (`outbox.mjs:47`).

### 1.4 What the current prompts tell workers (VERIFIED)

Workers are told: no push, no tracker verbs (`tea`/`gh` denied), no writes outside the
worktree except the one outbox path, and — critically for any coordination protocol —
**"There are no mid-attempt approvals … Nobody is watching this pane for a prompt"**
(`prompt.mjs:31-36`, `permissions.mjs:111-114`). No inbox convention exists anywhere in
the factory source (grep for "inbox" in `factory/lib` finds nothing; the only
worker-facing file contract is the outbox). Workers hold no tracker credential; the
ticket reaches them as a claim-time snapshot (`prompt.mjs:25-27,104-109`).

### 1.5 Completion, cancellation, crash — the semantics a protocol inherits (VERIFIED)

- **First-signal-wins wait** over (outbox validity × liveness), two clocks: hard ceiling
  3 h default anchored to launch-completion time (survives controller re-entry), and a
  10-min no-progress clock reopened by any status transition, output change, or —
  degraded-observation aware — charged to the automation budget when the controller's own
  socket failed (`lifecycle.mjs:170-182,498-649,686-748`).
- **Stop is keystrokes, not a kill**: `agent send-keys <esc, ctrl+c, ctrl+c>`; Herdr has
  no `agent.stop` method and no exit code anywhere in its API (`herdr-control.mjs:84-98`;
  schema method list, §2.2 below). Confirmation is a bounded re-probe (250…4000 ms);
  measured agent-leaves-pane latency: **claude 729 ms, pi 418 ms** from quit keys, idle
  case (`lifecycle.mjs:105-135`, `tests/live/herdr-agent-stop-latency.mjs`). Unconfirmed
  stops are typed (`wedged-pane` / `stop-unconfirmed` / `quit-undelivered`,
  `lifecycle.mjs:151-155`) and a wedged pane is accepted, never escalated (§13.B).
- **Controller crash mid-launch**: `attempt.launched` (mint) vs `attempt.correlated`
  (launch finished) bracket the launch; re-entry finishes an uncorrelated launch —
  re-sending the same deterministic prompt — and refuses to relaunch a correlated one; a
  live worker is adopted, not restarted (`lifecycle.mjs:286-295,404-407`).
- **needs-human is not mid-flight**: it ends the turn, the agent is stopped, the ticket
  pauses; the human's reply arrives via a *fresh attempt* (`prompt.mjs:495-497`,
  `pipeline/dispositions.mjs:95-101`).

---

## 2. Surface: Herdr

All verified against the running Herdr 0.8.0, protocol 19 (`HERDR_ENV=1 herdr status`),
its CLI help, and the bundled schema (`HERDR_ENV=1 herdr api schema --json`, 251 KB,
saved to scratchpad during this survey).

### 2.1 Input into a pane/agent (VERIFIED, CLI help)

- `herdr agent prompt <TARGET> <TEXT> [--wait [--until idle|working|blocked|done|unknown] [--timeout MS]]`
  — submits text + Enter atomically through the agent surface, under live
  bracketed-paste. Its own help documents the delivery race: "When submission starts from
  a non-working state, --wait first requires an observed state change within 5000ms;
  otherwise it returns `agent_prompt_stalled`. … It does not track turns: if the agent is
  already working, that active turn's completion may match."
- `herdr agent send-keys <TARGET> <KEY>...` — raw keys (the stop path).
- `herdr pane send-text` / `pane send-keys` / `pane run` — pane-level equivalents.

**There is no scoped delivery capability.** The socket API (90 methods enumerated from
the schema) has no auth, ACL, or per-pane capability parameters; the transport is one
Unix socket, mode 0600, same user (`herdr status` → `socket:
/home/minder/.config/herdr/herdr.sock`; transport facts also in
`docs/surveys/software-factory-observation-surfaces-2026-08-13.md` §4). Anything that can
reach the socket can control every pane. Consequently **"workers get no Herdr control" is
policy, not enforcement**: a worker's Bash runs as the same user and could set
`HERDR_ENV=1` and drive the socket. The deny floor does not deny `herdr`
(`permissions.mjs:43` denies only `git push`, `tea`, `gh`). INFERRED consequence,
VERIFIED premises.

### 2.2 Events out of a pane (VERIFIED, schema + live probes recorded in-repo)

`events.subscribe` (socket only — no CLI equivalent) accepts, per the schema's
`Subscription` oneOf: workspace/tab/pane lifecycle events, `pane.exited`,
`pane.agent_detected`, `pane.agent_status_changed` (requires `pane_id`), **and two
under-used kinds relevant here**:

- `pane.output_matched` — `{type, pane_id, source: visible|recent|recent-unwrapped,
  match: literal|regex, lines, strip_ansi}`: the server pushes a frame when a pane's
  output matches a pattern. A prior live probe on this host subscribed to it successfully
  (`docs/surveys/software-factory-observation-surfaces-2026-08-13.md` §4.2: subscription
  accepted, 86 frames in 8 s across kinds).
- `pane.scroll_changed`.

Blocking one-shots exist as CLI: `pane wait-output --match|--regex [--source] [--timeout]`,
`agent wait --until`, and socket `events.wait` with an `EventMatch`.

Wire-spelling inconsistency is real and handled: subscribed dotted, delivered
`pane_exited` / `pane_agent_detected` underscored while `pane.agent_status_changed` stays
dotted — measured live against protocol 19, table in `tests/live/README.md:35-44`,
matcher in `factory/lib/controller/herdr-events.mjs:178-190`. An unfiltered
`pane.agent_status_changed` subscription is refused (`invalid_request: missing field
'pane_id'`, `tests/live/README.md:43`).

**No termination detail**: `exit_code` occurs exactly once in the whole schema, on
`PluginCommandLogInfo` (verified by grep of the schema dump); `pane_exited` carries only
`{pane_id, workspace_id}`. Herdr can say *that* an agent stopped being detected, never
*how* it ended.

### 2.3 Agent status is screen-scraping, and pi's is one rule (VERIFIED)

Detection manifests are TOML rule files fetched by Herdr. Read directly on this host:

- `~/.local/state/herdr/agent-detection/remote/pi.toml` — **exactly one rule**:
  `working_literal`, `state = "working"`, `contains = ["Working..."]`. Everything else
  defaults to `idle` with `matched_rule: null`, so for pi **"idle" is no evidence of
  anything on screen**, not evidence of a finished turn (`tests/live/README.md:52-55`).
  pi has no `blocked` detection at all.
- `~/.local/state/herdr/agent-detection/remote/claude.toml` — 12 rules, including
  `osc_title_working`, four `blocked` rules (permission prompts, live forms), `idle`,
  `unknown`.

`herdr agent explain [TARGET]` exposes this detection state per pane (CLI help). The
agent-status vocabulary is `idle|working|blocked|done|unknown`; `unknown` means "present
but unclassified" and must be read as alive (`herdr-control.mjs:311-319`).

### 2.4 What Herdr offers a coordination protocol

- **Delivery**: `agent prompt` is the only text-delivery primitive that composes with a
  live TUI agent (paste + Enter, atomically). What it *means* to the receiving agent is a
  runtime property (§3.5, §4.1 below), not Herdr's.
- **Receipt**: `pane.output_matched` is a genuine push channel *from* a worker: prompt
  the worker to print a sentinel line (e.g. `FACTORY-SIGNAL <attempt> <token>`), and the
  controller's existing socket subscription receives a frame without polling. Limitations:
  payloads must be small and screen-safe; the pane scrollback is the medium (visible to
  the operator and to `pane read`); no ordering/durability guarantees (frames are live
  only — pane buffer does not survive server restart, observation-surfaces survey §4.3);
  and the factory's own subscription experience says spellings must be probed, not
  assumed (#149).
- **Identity**: pane tokens (`FACTORY_ATTEMPT`, `pane report-metadata --source
  software-factory`, `herdr-control.mjs:74-81,166-182`) attribute panes; a
  `pane.output_matched` frame carries `pane_id`, which the controller already correlates
  to an attempt via the token.

---

## 3. Surface: Claude Code as a worker

Local binary: **2.1.233** (`claude --version`). Doc citations were collected 2026-08-17
from code.claude.com by a doc-verification pass; each claim carries its URL.

### 3.1 Steering a working interactive session (VERIFIED, docs)

https://code.claude.com/docs/en/how-claude-code-works.md — "Type a correction and press
`Enter` to send it without stopping the running tool. Claude reads it as soon as the
current action completes and adjusts before deciding its next step." And: "Press `Esc` to
stop Claude immediately. The running tool call is canceled and Claude waits for your next
instruction."

**Composition with Herdr (INFERRED, both halves verified separately):** `herdr agent
prompt <agent> <text>` types text + Enter into the interactive pane; per the doc above, a
*working* Claude treats that as a queued steering message read at the next action
boundary. This is a controller→worker mid-flight delivery seam requiring no new
infrastructure — but it has not been live-probed here (a probe costs a model session),
and the launch experience proves submission-vs-uptake must be confirmed, not assumed
(`lifecycle.mjs:80-86`).

### 3.2 Hooks: pull-triggered context injection (VERIFIED, docs)

https://code.claude.com/docs/en/hooks.md — hook events include `SessionStart`, `Setup`,
`SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
`SubagentStart`, `SubagentStop`, `Stop`, `PreCompact`/`PostCompact`, `PermissionRequest`,
`PermissionDenied`, `Elicitation`, `FileChanged`, `TaskCreated`, `TaskCompleted`,
`TeammateIdle`, and more. `hookSpecificOutput.additionalContext` — a string the model
sees — is supported on **UserPromptSubmit, PostToolUse, PostToolUseFailure,
PostToolBatch, SubagentStop, and Stop**; `PreToolUse` has no additionalContext (only
`permissionDecision` / `updatedInput`); `SessionStart` uses `systemMessage`.

Seam: a `PostToolUse` hook that reads a controller-designated inbox file and returns
`additionalContext` injects controller messages into the model **at tool-call cadence**
while it works, and a `Stop` hook can inject at turn end. Delivery channel for the hook
configuration already exists and is controller-owned: the per-posture `--settings` file
the factory writes (`environment.mjs:129-133`) — today deliberately permissions-only
("this file is the worker's whole user-level settings surface", `permissions.mjs:177-183`),
so adding hooks there is a policy decision, not a new mechanism. INFERRED composition;
hook fields VERIFIED in docs.

Timing limitation: hooks fire only when the agent acts. An agent stuck in one long Bash
call or pure inference receives nothing until the next hook event.

### 3.3 stream-json stdin: real in the binary, thin in the docs (VERIFIED locally)

`claude --help` (2.1.233): `--input-format <format>  Input format (only works with
--print): "text" (default), or "stream-json" (realtime streaming input)`, plus
`--replay-user-messages  Re-emit user messages from stdin back on stdout for
acknowledgment (only works with --input-format=stream-json and
--output-format=stream-json)`. The factory's own preflight already drives a
`control_request`/`control_response` exchange (`initialize`) over this mode, live, on the
production flag set (`factory/lib/worker/claude.mjs:40-47,324-371`). The public docs do
not document the stream-json *input* protocol or its control subtypes
(https://code.claude.com/docs/en/headless.md covers output only) — so the seam is
**binary-verified but contractually undocumented**: version-fragile, and it requires
launching the worker headless (`--print`), which contradicts §6.4's "an interactive pane,
never a headless run" (`herdr-control.mjs:210-213`) and would cost Herdr's screen-rule
status detection.

### 3.4 CLAUDE.md and file-based context (VERIFIED, docs)

https://code.claude.com/docs/en/memory.md — CLAUDE.md files load at session start;
project-root CLAUDE.md is re-read only after `/compact`; nested CLAUDE.md files reload
"the next time Claude reads a file in that subdirectory". **No mechanism delivers an
external file change into a running session without the agent choosing to read** (no
hook fires on CLAUDE.md change). File seams are therefore poll-only for Claude.

### 3.5 Cross-session messaging (VERIFIED, docs; scope caveats)

https://code.claude.com/docs/en/cross-session-messaging.md — `ListAgents` and
`SendMessage` tools between local Claude Code sessions, v2.1.224+ (local 2.1.233
qualifies). Delivery: "The receiving Claude reads the message between tool calls during
an active turn, so a running tool is never interrupted. When the receiving session is
idle, Claude Code starts a new turn with the message." Identity: "it appears in the
conversation under the sender's session name" — session names are user-set and can
collide, so **attribution is display-level, not authenticated**. Cross-machine messages
can arrive with no reply address.

Limitations for this protocol: it is Claude-to-Claude (the controller would have to run a
Claude session of its own to speak it); pi workers are unreachable; whether discovery
crosses distinct `CLAUDE_CONFIG_DIR` roots (the factory isolates workers under a
controller-owned root, `environment.mjs:72,178`) is **UNVERIFIED**; and an unsolicited
inbound message is untrusted text injected into a worker's context — the exact channel
the prompt's untrusted-block discipline exists to fence (`prompt.mjs:326-350`).

### 3.6 MCP: no push into a working agent (VERIFIED, docs)

https://code.claude.com/docs/en/mcp.md and
https://code.claude.com/docs/en/agent-sdk/mcp.md — transports stdio, HTTP, SSE (CLI also
WebSocket). The agent reaches an MCP server only by **making a tool call**; there is no
documented server-initiated injection of content into the agent's context mid-turn. MCP
elicitation surfaces in Claude Code as an `Elicitation` *hook* (hooks.md), i.e. it does
not interrupt the model. So an MCP "message bus" server is a **pull** seam: identical
timing semantics to a file inbox, plus network and per-worker-credential options
(§6 below). This kills the strong form of the "Claude uses sockets, so the controller
can push" hypothesis: the sockets exist (MCP transports, the SDK), but nothing pushes
into a running turn; the closest push-like behaviors are hook-injected context (§3.2)
and queued steering/messages read at action boundaries (§3.1, §3.5).

### 3.7 Interrupt and crash (VERIFIED, docs + repo measurements)

- Esc cancels the in-flight tool call, session stays alive
  (how-claude-code-works.md) — this is what `AGENT_STOP_KEYS` leads with
  (`herdr-control.mjs:98`).
- Headless: "If you stop a `claude -p` run with SIGTERM … Claude Code aborts the
  in-progress turn, terminates the process tree of any running Bash command, runs
  `SessionEnd` hooks, and exits with code 143"
  (https://code.claude.com/docs/en/headless.md). SIGKILL behavior is undocumented.
- Transcripts are "saved continuously" as JSONL at
  `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`
  (https://code.claude.com/docs/en/sessions.md) — under the factory's isolation this
  lands beneath the controller-owned `CLAUDE_CONFIG_DIR` root (INFERRED from
  `environment.mjs:72`). `--resume <session-id>` restores conversation history, model,
  and permission mode; a killed process's transcript survives and is resumable. The
  factory deliberately never resumes ("every resume is a fresh attempt",
  `attempt.mjs:163-177`), so resume-after-kill is available capability the current
  design refuses on principle, not for lack of mechanism.

---

## 4. Surface: pi as a worker

Local binary: **pi 0.84.2**, `@earendil-works/pi-coding-agent` (symlink from
`~/.local/bin/pi`). Docs cited from the installed package,
`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/`.

### 4.1 TUI steering: mid-turn text delivery exists natively (VERIFIED, docs)

`docs/usage.md:64-68`: "You can submit messages while the agent is still working: —
**Enter** queues a steering message, delivered after the current assistant turn finishes
executing its tool calls. — **Alt+Enter** queues a follow-up message … — **Escape**
aborts and restores queued messages to the editor." Delivery mode configurable via
`steeringMode` (`"all"` / `"one-at-a-time"`, default one-at-a-time,
`docs/settings.md:171`).

**Composition with Herdr (INFERRED, both halves verified):** `herdr agent prompt` into a
*working* pi TUI queues a steering message delivered before the next LLM call. Same
uptake-confirmation caveat as §3.1. This is the pi twin of the Claude steering seam and
makes `agent prompt` a runtime-neutral delivery primitive.

### 4.2 RPC mode: a full control protocol, but only if launched that way (VERIFIED, docs)

`docs/rpc.md` — `pi --mode rpc` speaks JSONL over stdin/stdout: `prompt` (with
`streamingBehavior: "steer" | "followUp"` required while streaming), dedicated `steer`
and `follow_up` commands, `abort`, `new_session`, `get_state`, `get_messages`,
`get_commands`, `bash`, session switching/forking, and a streamed event vocabulary
(`agent_start/agent_end/agent_settled`, `turn_start/turn_end`, `tool_execution_*`,
`queue_update`, …). The factory's preflight already runs a disposable RPC session
(`factory/lib/worker/pi.mjs:27,37,282-320`).

**There is no attach path**: no socket, control port, or IPC to a *running* TUI session
exists anywhere in pi's docs (grep across `docs/*.md` for socket/IPC/port finds only
provider endpoints). RPC is an at-launch mode, mutually exclusive with the interactive
pane the factory runs workers in. Driving workers in RPC mode would be the same
headless redesign as Claude's stream-json (§3.3) — it would also bypass Herdr's
agent-status detection entirely.

### 4.3 Extensions: the in-process push seam (VERIFIED, docs; nothing built yet)

`docs/extensions.md` — extensions are TypeScript modules loaded in-process with full
Node capability. The relevant API:

- `pi.sendUserMessage(content, {deliverAs: "steer" | "followUp"})` — inject a user
  message into a running session (`extensions.md:1412-1443`); `pi.sendMessage(...,
  {deliverAs: "steer" | "followUp" | "nextTurn", triggerTurn: true})` — inject a custom
  message that participates in LLM context, and `triggerTurn: true` starts a turn if the
  agent is idle (`extensions.md:1389-1410`).
- `pi.on(event)` over the whole lifecycle; `ctx.isIdle()`, `ctx.abort()`,
  `ctx.hasPendingMessages()` (`extensions.md:1017-1019`).
- Extensions may open sockets/HTTP servers (precedent: `@ifi/pi-web-remote` runs an HTTP
  + WebSocket server from an extension — observation-surfaces survey §6), with the
  documented constraint that background resources must start at `session_start`, not in
  the factory function (`extensions.md:220-226`).
- No hooks system exists apart from this; and pi has **no command-level permission
  system** — the deny floor for pi is "prompt plus withheld tools plus §7's
  controller-only integration gate — not an enforced rule" (`permissions.mjs:117-120`).

The factory already has the delivery channel for such an extension: **declared pi
extension promotion** — `worker.piExtensions` config, resolved, digested, recorded in the
run manifest, passed as `--extension <path>` on every pi worker session
(`environment.mjs:33-37,185-193,349-373`). A controller-authored "coordination extension"
(connects to a controller socket at `session_start`, injects `deliverAs: "steer"`
messages, reports events back) is therefore structurally supported today but does not
exist. Note §6.8's boundary: a promoted extension may add tools and providers, never
skills (`pi.mjs:168-174`).

### 4.4 MCP in pi (VERIFIED)

MCP is not built into pi; it arrives via the `pi-mcp-adapter` extension package
(operator's `~/.pi/agent/settings.json` lists `npm:pi-mcp-adapter`; the package ships
`sampling-handler.ts`, `elicitation-handler.ts`, `unix-socket-transport.ts`). The worker
environment's `settings.json` is written as `{}` (`environment.mjs:126`), so **workers
have no MCP unless the adapter is promoted as a declared extension**. Even then, MCP
remains a pull seam for the model (tool calls), with server-initiated
sampling/elicitation handled by the adapter in-process.

### 4.5 Sessions, resume, crash (VERIFIED, docs)

Sessions auto-save as append-style JSONL under the agent dir, organized by working
directory (`docs/sessions.md:7`; for workers that dir is the controller-owned
`PI_CODING_AGENT_DIR`, `environment.mjs:72`). `-c/--continue`, `-r/--resume`,
`--session <path|id>`, `--session-id <id>` (create-if-missing), `--fork`,
`--no-session` (`pi --help`). A killed process leaves its JSONL; the session is
resumable. Because pi keys session paths on cwd and both factory roles share a worktree,
the *pointer* (which JSONL is which pane's) is only knowable from Herdr's
`agent_session` fact — computed paths cannot disambiguate (`herdr-control.mjs:288-299`).
Non-interactive modes never show a trust prompt; trust comes from the saved decision the
factory pre-writes (`docs/security.md:29`, `environment.mjs:149-155`).

### 4.6 Hypothesis 3 verdict — "pi has something socket/RPC-like to push through"

**Partly true, wrong half.** pi has a real steer/inject vocabulary (RPC `steer`, extension
`sendUserMessage`), richer than Claude's documented surface — but no attachable socket on
a running TUI session. The push seam must be *pre-installed* (declared extension) or the
worker must be *launched* in RPC mode. For the current interactive-pane design, the only
zero-build pi delivery path is TUI steering via Herdr `agent prompt` (§4.1).

---

## 5. File-based seams

- **Outbox generalization (worker → controller).** The outbox pattern — atomic write,
  schema-versioned, identity echo, controller-designated path outside the worktree —
  already exists and is proven (`outbox.mjs`). A protocol can add sibling files (e.g.
  `signal-<n>.json`) under the same attempt directory with the same validation; the
  controller's 1 s outbox poll cadence (`lifecycle.mjs:90`) is the latency floor.
- **Inbox (controller → worker).** No convention exists (§1.4). A controller-written
  inbox file is durable and journal-attestable (digest in an event, like the prompt
  digest), but its **timing limitation is absolute: the agent reads it only when it
  chooses to**. The current prompt gives workers no reason to poll anything.
  What makes a worker actually look (each VERIFIED individually, composition INFERRED):
  1. a standing prompt obligation ("check `$FACTORY_INBOX` before every commit / between
     tasks") — cheapest, least reliable, burns attention every check;
  2. a steering nudge via `agent prompt` ("read your inbox") — converts the inbox's
     unbounded staleness into turn-boundary latency, and keeps large/structured payloads
     out of pane scrollback;
  3. Claude only: a `PostToolUse`/`UserPromptSubmit` hook that reads the inbox and
     returns `additionalContext` (§3.2) — no worker cooperation needed, tool-call cadence;
  4. pi only: a promoted extension that watches the inbox and injects
     `deliverAs: "steer"` (§4.3).
- **Enforcement honesty.** Everything runs as one OS user. A worker *can* write another
  attempt's outbox or read another attempt's inbox — the prompt forbids it
  (`prompt.mjs:35`) and validation catches accidental crossings (`foreign`), but
  filesystem permissions do not separate attempts. Identity on file seams is
  attestable-after (digests, tuple echo), not spoof-proof.

---

## 6. Hypothesis 2: a controller-owned message bus (MCP server or plain HTTP)

Assessed as a seam, not endorsed as a design.

- **Reachability (VERIFIED premises).** Builders and reviewers keep `Bash`, `WebFetch`,
  `WebSearch` (`permissions.mjs:58-83`), and §6.8 has "no broad network denies in v1"
  (`permissions.mjs:38-44`) — a worker can `curl` a local controller service today. As an
  MCP server it reaches Claude natively (stdio/HTTP, §3.6) and pi only via a promoted
  adapter (§4.4).
- **Direction (VERIFIED).** Pull-only on the worker side: MCP has no push into a running
  turn (§3.6), and HTTP polling is polling. The last hop is identical to the file inbox —
  the worker sees a message when it asks — so the bus changes *transport and audit*, not
  *timing*. The same wake-up mechanisms as §5 apply and are the real latency bound.
- **Identity (mixed).** Per-worker bearer tokens are mintable per attempt (the tuple
  already exists). But every delivery channel for a secret is same-user-readable:
  `exportIdentity` types exports into the pane, so values land in scrollback and in
  `pane read` (`herdr-control.mjs:186-199` — the module itself notes ambient values in
  scrollback as the hazard); `/proc/<pid>/environ` is same-user readable; and the Herdr
  socket is same-user (§2.1). So bus identity **authenticates attempts against the
  outside world and against accidents, not against a malicious co-worker** — the same
  honesty level as the outbox tuple. Record this in the protocol as an accepted bound,
  or move workers to separate users/containers (out of scope here; cf. pi's own guidance
  `docs/security.md:39-45`).
- **Durability (design requirement, not a property).** A bus that holds state in memory
  fails #135's "durable". The controller already owns the durable substrate — the
  journal with holds, fencing, and idempotent effects (`§4`,
  `factory/lib/state/`, `effects/records.mjs` used throughout `lifecycle.mjs`) — so bus
  messages must be journal events first, wire second; redelivery after a worker crash is
  then a replay of unacknowledged events at next poll. A crashed *bus* with a journal
  behind it loses nothing; a crashed worker mid-exchange re-reads on its next wake-up,
  and its unfinished sends are simply absent (same as an unwritten outbox: absence is a
  typed outcome, `outbox.mjs:20-23`).
- **Protocol constraint from #135 (recorded, per the map):** direct worker-to-worker
  channels — including two workers meeting in a shared bus channel without the
  controller gating what is relayed — conflict with the pinned constraint that
  coordination is **controller-mediated and durable**, with the controller alone
  gating/serializing/escalating. A bus is admissible only as spokes to a hub that reads,
  journals, filters (the untrusted-block discipline of `prompt.mjs:326-350` applies to
  relayed worker text), and re-delivers.

---

## 7. Cross-cutting limitations the protocol must respect

**Timing.**
- Submission ≠ delivery ≠ uptake. `agent prompt` exit 0 proves paste, not acceptance
  (`lifecycle.mjs:80-86`); Herdr's own help documents `agent_prompt_stalled`. Every
  delivery needs an uptake signal (status transition, sentinel output, or ack file) and
  bounded re-send, exactly like `submitFirstPrompt` (`lifecycle.mjs:914-940`).
- Steering is turn/action-boundary delivery: pi "after the current assistant turn
  finishes executing its tool calls" (`docs/rpc.md` steer; `docs/usage.md:66`), Claude
  "as soon as the current action completes" (how-claude-code-works.md), cross-session
  messages "between tool calls" (cross-session-messaging.md). A worker in one long tool
  call or long inference receives nothing until it surfaces. Hooks share this cadence.
- File/bus seams add unbounded staleness on top: the worker reads when it chooses.
- Observation cadences bound the controller's own reaction time: outbox poll 1 s, output
  sample 5 s, degraded status poll 2 s (`lifecycle.mjs:90-93`,
  `herdr-events.mjs:35`).

**Interruption.**
- The only interrupt is keystrokes: Esc aborts the current turn in both runtimes
  (docs cited above; `AGENT_STOP_KEYS`, `herdr-control.mjs:84-98`). There is no
  "pause"; an abort discards in-flight inference, and pi's Escape restores queued
  messages *to the editor* (not to the model) (`docs/usage.md:67`).
- A mid-turn interrupt has no measured latency bound — #114 measured only idle-case stop
  (729/418 ms); the backoff is sized past its evidence deliberately
  (`lifecycle.mjs:117-135`). An agent that ignores its quit keys is an accepted wedge,
  not an error (§13.B).
- Interrupt-then-redirect (Esc, then new prompt) is possible mechanically but destroys
  the turn in progress; steering is the non-destructive alternative and cannot preempt.

**Identity.**
- Attribution primitives that exist: the minted tuple in pane env + pane token + prompt
  (`lifecycle.mjs:851-895`), outbox tuple echo with `foreign` detection
  (`outbox.mjs:300-318`), deterministic derived names (`attempt.mjs:9-26`), journal
  provenance (`observation.recorded` with constructed foreign ids,
  `lifecycle.mjs:1168-1199`).
- Attribution that does not exist: OS-level separation between workers (one user, one
  Herdr socket, world-of-one filesystem — §2.1, §5, §6); authenticated sender identity in
  Claude cross-session messaging (session *names*, cross-session-messaging.md); any
  authority for a worker's own claims (worker-writable status set is closed precisely so
  workers cannot claim controller-derived outcomes, `outbox.mjs:112-148`).
- Therefore: every inbound worker message must be treated as *evidence attributed to an
  attempt*, validated like the outbox, and fenced like the untrusted block when relayed
  onward (`prompt.mjs:225-243,326-350`).

**Crash.**
- Herdr never says how anything ended (no exit codes — §2.2); worker death is inferred
  from `pane_exited` / `released` / token disappearance, and the outbox-absent × gone row
  is `dead-worker` (automation budget), distinct from settled-silent `no-result` (worker
  budget) (`lifecycle.mjs:686-748`).
- Controller crash: re-entry converges — mints are idempotent, an uncorrelated launch is
  finished (prompt re-sent), a live worker is adopted with its original deadline, and the
  no-progress window reopens because the controller "cannot know what the worker did
  while it was down" (`lifecycle.mjs:286-295,524-534`). A coordination seam must journal
  every delivery (as an effect or event) the same way, or a crashed controller will
  re-deliver or lose messages silently.
- Both runtimes leave durable transcripts (Claude JSONL under `CLAUDE_CONFIG_DIR`,
  sessions.md; pi JSONL under `PI_CODING_AGENT_DIR`, `docs/sessions.md:7`) that survive
  kills; both support resume, which the factory's §5.5 policy refuses (fresh attempt) —
  any protocol relying on resume is a spec change, not a mechanism gap.
- Herdr server restart drops subscriptions (degraded polling takes over, loudly —
  `herdr-events.mjs:138-143`); pane ids survive, pane screen buffer does not
  (observation-surfaces survey §4.3). `pane.output_matched` signals emitted during a
  socket outage are lost — sentinel signals need a polled fallback (`pane read`) exactly
  as status does.

---

## 8. Conclusions — viable seams, ranked by reliability

Ranked by how much of the seam is already verified working under the factory's real
constraints (interactive panes, no worker Herdr control by policy, no tracker
credentials, controller-mediated + durable):

1. **Controller-designated files, generalized from the outbox** (worker → controller;
   both runtimes). Proven pattern, atomic, schema-validated, identity-echoed, outside
   the worktree, survives every crash the journal survives. Latency: worker-chosen
   (write) / 1 s poll (read). The weakest link — making the worker *read* an inbox — is
   the next seam's job.
2. **Herdr `agent prompt` as mid-flight steering** (controller → worker; both runtimes).
   The delivery primitive already used at launch; both runtimes document queued-steering
   semantics for text typed while working (pi `usage.md:66`, Claude
   how-claude-code-works.md). Needs the launch's uptake-confirmation loop. Live-probed
   same day for both runtimes — see §9: delivery is tool-boundary (better than
   turn-boundary), at-least-once on pi. Non-destructive; payload lands in scrollback, so
   point at files rather than embedding content.
3. **`pane.output_matched` sentinel subscription** (worker → controller; both runtimes).
   Push-latency signals over the already-open socket, correlated by pane token; small,
   screen-safe payloads only; needs the polled fallback the status watch already has.
   Schema-verified; subscription accepted live on this host (prior survey); not yet
   exercised by factory code.
4. **Claude hooks with `additionalContext`** (controller → Claude worker only).
   Docs-verified injection at tool-call cadence, deliverable through the
   controller-owned settings file with zero operator-config contamination. Un-probed in
   this factory; Claude-only, so it can be an accelerator, never the protocol.
5. **Promoted pi coordination extension** (both directions; pi only). The richest pi
   seam (`sendUserMessage` steer + full event stream + own socket), with the promotion,
   digesting, and manifest channel already built (`environment.mjs`). Must be written and
   maintained; runs in-process with the worker, so its outbound claims are worker-side
   evidence, not controller observations.
6. **Controller-owned message bus (HTTP/MCP)** (both directions, pull-only last hop).
   Admissible only as journal-backed spokes-to-hub (§6); adds transport/audit/credential
   structure but no timing improvement over files; per-worker identity is
   accident-proof, not co-worker-spoof-proof, on this single-user host.
7. **Headless control protocols — Claude stream-json stdin, pi RPC mode** (both
   directions, strongest semantics: true steer/abort/ack). Binary-verified (Claude
   2.1.233 "realtime streaming input"; pi `docs/rpc.md`), but publicly undocumented on
   the Claude side and incompatible with the current interactive-pane architecture
   (§6.4) and with Herdr's status detection. This is the redesign option, not a seam in
   the current design.
8. **Claude cross-session messaging (`SendMessage`/`ListAgents`)** — documented and
   version-satisfied, but Claude-to-Claude only, name-based attribution, unverified
   across isolated `CLAUDE_CONFIG_DIR` roots, and it injects unauthenticated text
   straight into a worker's context. Ranked last for this protocol.

**Not verified / open items.**
- ~~The steering compositions (Herdr `agent prompt` → working Claude / working pi) are
  doc-backed but not live-probed here~~ — probed same day, both runtimes; results in §9.
  Still open from that probe: ordering across multiple queued steers, and whether pi's
  duplicate delivery is deterministic.
- Whether Claude cross-session discovery crosses `CLAUDE_CONFIG_DIR` boundaries.
- SIGKILL semantics for Claude Code (undocumented); mid-turn (vs idle) stop latency for
  both runtimes (#114 has no data point).
- `pane.output_matched` end-to-end from a factory worker pane (subscription verified,
  factory-side consumption never built).

---

## 9. Addendum (2026-08-17, same day): live probe of the steering seam

Run after the survey above was written, in two throwaway panes created and closed for the
probe (this supersedes the Method note that no new model session was started — the two
probe sessions were scratch sessions in
`…/scratchpad/steer-probe`, never a pane running real work). Findings were also posted to
#140. Everything below is **VERIFIED** by direct observation.

**Protocol, per runtime.** `herdr pane split` → `herdr agent start` in a scratchpad cwd →
first prompt: a 4-step task (echo, `sleep 15`, `sleep 15`, echo), each step required to be
its own tool call → while the agent was *inside* a `sleep 15` tool call, one steering
message via `herdr agent prompt`, instructing an immediate `echo STEER-ACK-<token>` →
transcript read back after settle; panes closed.

**Claude Code 2.1.233.**
- The TUI visibly queued the steer mid-turn ("Press up to edit queued messages").
- Delivery at the **next tool boundary**, not the end of the turn: the transcript
  re-segments as 2 tool calls → steer as a user message → ack + remaining steps, and the
  agent's own summary states the ack was "inserted after step 2 when your mid-turn
  message arrived".
- Delivered exactly once. Send→settle 28.7 s for a turn containing two 15 s sleeps;
  effective delivery latency ≈ the remainder of the in-flight tool call (~11 s).

**pi 0.84.2** (session model: `qwen/qwen3.8-max` via openrouter — delivery mechanics are
the runtime's; compliance behavior is partly the model's).
- Same **tool-boundary delivery**: the steer lands as a user message immediately after
  the in-flight `sleep 15` returns; the ack runs before step 3.
- **At-least-once delivery observed**: the model saw the steer text a second time after
  acking and explicitly dismissed it as "a duplicate of the first". Whether duplication
  is deterministic is unprobed; the protocol must assume at-least-once.
- **Injection suspicion**: the model openly deliberated whether the steer was "a
  legitimate user steer or a prompt injection" before complying — steer text arrives as
  unauthenticated user prose with no envelope.

**Consequences for the protocol (feeding #140/#141).**
- Delivery latency is bounded by the worker's *longest tool call*, not the turn — an
  improvement on §7's turn-boundary assumption, but still unbounded in principle (a long
  build delays delivery arbitrarily).
- Records need stable IDs and receiver-side dedup; uptake confirmation must key on a
  record-ID echo in the worker's outbox, never on text appearing in scrollback.
- The files-as-medium design doubles as authentication: the steer carries no authority,
  only a pointer to a record in the controller-owned inbox. Workers briefed at launch
  that legitimate coordination always resolves to such a record turn pi's healthy
  suspicion into a verification rule — a steer that resolves to no record fails closed.

**Still open after this probe:** ordering and coalescing across multiple queued steers;
determinism of pi's duplicate delivery; the same probe under a *long* single tool call
(does queue depth or TUI state change behavior); steering into a `blocked`
(permission-prompt) agent.
