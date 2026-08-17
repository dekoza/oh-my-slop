import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
	AGENT_STOP_KEYS,
	agentAlive,
	createHerdrControl,
	FACTORY_ATTEMPT_TOKEN,
	herdrResult,
	transcriptPointerOf,
} from "../../factory/lib/controller/herdr-control.mjs";
import {
	DEGRADED_POLL_INTERVAL_MS,
	fromFrame,
	fromPane,
	SUBSCRIBED_EVENTS,
	subscribeRequest,
	UNRECOGNISED,
	watchPane,
} from "../../factory/lib/controller/herdr-events.mjs";
import { manualTimers } from "./helpers/factory-store.mjs";

/**
 * The factory's two surfaces onto Herdr: the CLI commands the attempt path
 * issues, and §5.1's socket subscription the CLI does not expose.
 *
 * Every shape here was read off the installed Herdr (protocol 19) rather than
 * assumed, which is the point of the suite: the frames and the JSON envelope
 * are somebody else's contract, and a change in them must fail here rather
 * than in a run.
 */

function runner(answers = {}) {
	const calls = [];
	return {
		calls,
		run: async (args) => {
			calls.push(args);
			const key = args.slice(0, 2).join(" ");
			return answers[key] ?? { exitCode: 0, stdout: JSON.stringify({ id: "cli:test", result: {} }), stderr: "" };
		},
	};
}

// ── The JSON envelope ────────────────────────────────────────────────────────

test("a Herdr answer is `{id, result}`, and an unreadable one is not a result", () => {
	assert.deepEqual(herdrResult('{"id":"cli:pane:list","result":{"panes":[]}}'), { panes: [] });
	assert.equal(herdrResult("not json"), null);
	assert.equal(herdrResult('{"id":"x"}'), null);
});

// ── The commands (§6.4, §5.5, §13.B) ─────────────────────────────────────────

test("the run's workspace is one `workspace create`, labelled for the operator's list", async () => {
	const io = runner({
		"workspace create": {
			exitCode: 0,
			stdout: JSON.stringify({
				result: { workspace: { workspace_id: "w7" }, tab: { tab_id: "w7:t1" }, root_pane: { pane_id: "w7:p1" } },
			}),
			stderr: "",
		},
	});

	const opened = await createHerdrControl({ run: io.run }).openWorkspace({ cwd: "/state", label: "factory-run-R" });

	// The id and the label: nothing runs in the workspace's own root tab, so its
	// pane is not something a caller is given or a readable answer must carry.
	assert.deepEqual({ ...opened }, { ok: true, workspace: "w7", label: "factory-run-R" });
	assert.deepEqual(io.calls[0], ["workspace", "create", "--cwd", "/state", "--label", "factory-run-R", "--no-focus"]);
});

test("exit 0 with no readable result is its own failure, and it names it", async () => {
	const io = runner({ "workspace create": { exitCode: 0, stdout: "{}", stderr: "" } });

	const opened = await createHerdrControl({ run: io.run }).openWorkspace({ cwd: "/w", label: "l" });

	assert.equal(opened.ok, false);
	assert.match(opened.message, /learned nothing/);
	assert.match(opened.message, /closes anything/, "and it says what it did not do");
});

test("an attempt gets a tab in the run's workspace, never a workspace of its own (#156)", async () => {
	// The shape is the installed Herdr's (0.8.0), read off a live `tab create`:
	// `tab` and `root_pane`, and no `workspace` — the tab is in one already.
	const io = runner({
		"tab create": {
			exitCode: 0,
			stdout: JSON.stringify({
				result: { type: "tab_created", tab: { tab_id: "w7:t2" }, root_pane: { pane_id: "w7:p2" } },
			}),
			stderr: "",
		},
	});

	const opened = await createHerdrControl({ run: io.run }).openTab({
		workspace: "w7",
		cwd: "/state/worktrees/a",
		label: "factory-a",
	});

	assert.deepEqual({ ...opened }, { ok: true, workspace: "w7", tab: "w7:t2", pane: "w7:p2", label: "factory-a" });
	assert.deepEqual(io.calls[0], [
		"tab",
		"create",
		"--workspace",
		"w7",
		"--cwd",
		"/state/worktrees/a",
		"--label",
		"factory-a",
		"--no-focus",
	]);
	assert.equal(
		io.calls.some((args) => args[0] === "workspace"),
		false,
		"a second workspace per attempt is exactly what #156 removed",
	);
});

test("the attempt's environment is declared on the tab, never typed into its shell (#157)", async () => {
	const io = runner({
		"tab create": {
			exitCode: 0,
			stdout: JSON.stringify({ result: { tab: { tab_id: "w7:t2" }, root_pane: { pane_id: "w7:p2" } } }),
			stderr: "",
		},
	});

	await createHerdrControl({ run: io.run }).openTab({
		workspace: "w7",
		cwd: "/state/worktrees/a",
		label: "factory-a",
		env: {
			FACTORY_ATTEMPT: "R-t42-a1",
			// A path with a space and an apostrophe: the CLI takes the value as one
			// argv element, so the factory's own POSIX quoting is not merely
			// unnecessary here — it would embed the quotes in the value.
			FACTORY_WORKTREE: "/state/my worktrees/it's",
			FACTORY_TICKET: 42,
		},
	});

	assert.deepEqual(io.calls[0], [
		"tab",
		"create",
		"--workspace",
		"w7",
		"--cwd",
		"/state/worktrees/a",
		"--label",
		"factory-a",
		"--env",
		"FACTORY_ATTEMPT=R-t42-a1",
		"--env",
		"FACTORY_WORKTREE=/state/my worktrees/it's",
		"--env",
		"FACTORY_TICKET=42",
		"--no-focus",
	]);
});

test("a tab in a workspace Herdr no longer has is a typed failure naming the command", async () => {
	// Live: `herdr tab create --workspace w99` exits 1 with `workspace_not_found`.
	// That is the operator having closed the run's workspace, and it is the lane's
	// failure to report rather than a second workspace to open behind their back.
	const io = runner({
		"tab create": { exitCode: 1, stdout: "", stderr: `{"error":{"code":"workspace_not_found"}}` },
	});

	const opened = await createHerdrControl({ run: io.run }).openTab({ workspace: "w99", cwd: "/w", label: "l" });

	assert.equal(opened.ok, false);
	assert.equal(opened.command, "tab create");
	assert.match(opened.message, /workspace_not_found/);
});

test("the run's workspace is found by its label, and a closed one is an answer rather than a failure", async () => {
	const workspaces = [
		{ workspace_id: "w1", label: "oh-my-slop" },
		{ workspace_id: "w7", label: "factory-run-R" },
	];
	const io = runner({
		"workspace list": { exitCode: 0, stdout: JSON.stringify({ result: { workspaces } }), stderr: "" },
	});
	const herdr = createHerdrControl({ run: io.run });

	assert.equal((await herdr.workspaceLabelled("factory-run-R")).workspace.workspace_id, "w7");
	const missing = await herdr.workspaceLabelled("factory-run-GONE");
	assert.equal(missing.ok, true);
	assert.equal(missing.workspace, null, "an absent workspace is an answer, not a failure");
	assert.deepEqual(io.calls[0], ["workspace", "list"]);
});

test("the stamp is one metadata call carrying the token and the derived title", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).stamp("w1:p1", { attempt: "R-t42-a1", title: "factory R-t42-a1" });

	assert.deepEqual(io.calls[0], [
		"pane",
		"report-metadata",
		"w1:p1",
		"--source",
		"software-factory",
		"--token",
		`${FACTORY_ATTEMPT_TOKEN}=R-t42-a1`,
		"--title",
		"factory R-t42-a1",
	]);
});

test("a tab with nothing declared asks for no environment at all (#157)", async () => {
	const io = runner({
		"tab create": {
			exitCode: 0,
			stdout: JSON.stringify({ result: { tab: { tab_id: "w7:t2" }, root_pane: { pane_id: "w7:p2" } } }),
			stderr: "",
		},
	});

	// The bare pane a probe opens: no `--env` at all rather than an empty one,
	// so the command Herdr is asked for says exactly what was declared.
	await createHerdrControl({ run: io.run }).openTab({ workspace: "w7", cwd: "/w", label: "l" });

	assert.equal(io.calls[0].includes("--env"), false);
});

test("the agent starts in an existing pane, with the session flags after `--`", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).startAgent({
		name: "fabcdt42a1",
		kind: "claude",
		pane: "w1:p1",
		args: ["--settings", "/state/settings.json"],
	});

	assert.deepEqual(io.calls[0], [
		"agent",
		"start",
		"fabcdt42a1",
		"--kind",
		"claude",
		"--pane",
		"w1:p1",
		"--",
		"--settings",
		"/state/settings.json",
	]);
});

test("the prompt is submitted through the agent surface, and never waits", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).prompt({ target: "fabcdt42a1", text: "/skill:implement\n\ncontext" });

	assert.deepEqual(io.calls[0], ["agent", "prompt", "fabcdt42a1", "/skill:implement\n\ncontext"]);
});

test("stopping an agent sends its own quit keys and closes nothing (§13.B)", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).stopAgent("fabcdt42a1");

	// Verified against the installed Herdr: there is no `agent stop` in the CLI
	// and no `agent.stop` in the socket API, so the escalation §13.B supersedes
	// is not even reachable — what exists is send-keys.
	assert.deepEqual(io.calls[0], ["agent", "send-keys", "fabcdt42a1", ...AGENT_STOP_KEYS]);
	assert.equal(AGENT_STOP_KEYS[0], "esc", "interrupt the turn before asking the harness to exit");
	assert.equal(io.calls.some((args) => args.includes("close")), false);
});

test("a pane is found by its token, and a pane that is gone is null rather than an error", async () => {
	const panes = [
		{ pane_id: "w1:p1", tokens: {} },
		{ pane_id: "w1:p2", tokens: { [FACTORY_ATTEMPT_TOKEN]: "R-t42-a1" }, agent: "pi", agent_status: "working" },
	];
	const io = runner({ "pane list": { exitCode: 0, stdout: JSON.stringify({ result: { panes } }), stderr: "" } });
	const herdr = createHerdrControl({ run: io.run });

	assert.equal((await herdr.paneForAttempt("R-t42-a1")).pane.pane_id, "w1:p2");
	const missing = await herdr.paneForAttempt("R-t42-a2");
	assert.equal(missing.ok, true);
	assert.equal(missing.pane, null, "an absent pane is an answer, not a failure");
});

test("liveness is Herdr's one fact, read off the pane", () => {
	assert.equal(agentAlive({ agent: "claude", agent_status: "working" }), true);
	assert.equal(agentAlive({ agent: "claude", agent_status: "unknown" }), true, "unknown does not prove completion");
	assert.equal(agentAlive({ agent_status: "unknown" }), false, "a pane back at its shell hosts no agent");
	assert.equal(agentAlive(null), false);
});

test("pane output is read raw and bounded, as §6.6's progress sample (#150)", async () => {
	const io = runner({
		"pane read": { exitCode: 0, stdout: "line one\nline two", stderr: "" },
	});

	const output = await createHerdrControl({ run: io.run }).readPaneOutput("w1:p1");

	assert.deepEqual({ ...output }, { ok: true, text: "line one\nline two", bytes: 17 });
	assert.deepEqual(io.calls[0], ["pane", "read", "w1:p1", "--raw", "--lines", "200"]);
});

test("the transcript pointer is whatever Herdr persisted, or nothing", () => {
	assert.deepEqual(
		{ ...transcriptPointerOf({ agent_session: { agent: "claude", source: "herdr:claude", kind: "id", value: "d956" } }) },
		{ kind: "id", value: "d956" },
	);
	assert.deepEqual({ ...transcriptPointerOf({ agent_session: { kind: "path", value: "/s.jsonl" } }) }, {
		kind: "path",
		value: "/s.jsonl",
	});
	assert.equal(transcriptPointerOf({ agent_session: null }), null);
	assert.equal(transcriptPointerOf({}), null);
	assert.equal(transcriptPointerOf({ agent_session: { kind: "id", value: "" } }), null);
});

// ── §5.1's subscription ──────────────────────────────────────────────────────

test("the subscription filters the status stream by pane and takes the other two whole", () => {
	const request = subscribeRequest("w1:p2");

	assert.equal(request.method, "events.subscribe");
	assert.deepEqual(request.params.subscriptions, [
		// Verified live: `pane.agent_status_changed` is refused without a
		// `pane_id`, and the other two are server-wide.
		{ type: "pane.agent_status_changed", pane_id: "w1:p2" },
		{ type: "pane.exited" },
		{ type: "pane.agent_detected" },
	]);
	assert.deepEqual(SUBSCRIBED_EVENTS, ["pane.agent_status_changed", "pane.exited", "pane.agent_detected"]);
});

test("a frame becomes an observation only when it is this pane's, under the wire name it actually carries (#149)", () => {
	// Captured verbatim off the socket (tests/live/herdr-subscription-frames.mjs):
	// `pane.agent_status_changed` arrives **dotted**, and its data is
	// `{pane_id, workspace_id, agent_status, agent}` — no `type` field.
	const status = JSON.parse(
		'{"data":{"agent":"claude","agent_status":"blocked","pane_id":"w1:p2","workspace_id":"w1"},"event":"pane.agent_status_changed"}',
	);

	assert.deepEqual({ ...fromFrame(status, "w1:p2") }, {
		status: "blocked",
		agent: "claude",
		alive: true,
		source: "subscribe",
		event: "pane.agent_status_changed",
	});
	assert.equal(fromFrame(status, "w1:p9"), null, "the two server-wide subscriptions carry everyone's panes");
	assert.equal(fromFrame({ id: "x", result: { type: "subscription_started" } }, "w1:p2"), null);
});

test("both spellings of each subscribed event are accepted, so a server that changes one is not a second outage (#149)", () => {
	const pane = "w1:p2";
	const cases = [
		// [wire event, data, expected status]
		["pane.agent_status_changed", { agent_status: "working", agent: "pi", pane_id: pane }, "working"],
		["pane_agent_status_changed", { agent_status: "working", agent: "pi", pane_id: pane }, "working"],
		["pane.agent_detected", { agent: "claude", pane_id: pane }, "unknown"],
		["pane_agent_detected", { agent: "claude", pane_id: pane }, "unknown"],
		["pane.exited", { pane_id: pane }, "exited"],
		["pane_exited", { pane_id: pane }, "exited"],
	];

	for (const [event, data, status] of cases) {
		const observed = fromFrame({ event, data }, pane);
		assert.equal(observed.status, status, `${event} was not recognised`);
		assert.equal(observed.event, event, "the wire spelling is preserved, not normalised away");
	}
});

test("a frame for this pane that matches no known event is UNRECOGNISED, never the null of a filter (#149)", () => {
	const pane = "w1:p2";

	assert.equal(fromFrame({ event: "pane.something_new", data: { pane_id: pane, agent: "pi" } }, pane), UNRECOGNISED);
	// The silent cases stay silent: another pane's frame, and an acknowledgement.
	assert.equal(fromFrame({ event: "pane.something_new", data: { pane_id: "w1:p9" } }, pane), null);
});

test("an exited pane and a released agent are both the worker being gone", () => {
	const exited = fromFrame({ event: "pane_exited", data: { pane_id: "w1:p2", workspace_id: "w1" } }, "w1:p2");
	assert.equal(exited.status, "exited");
	assert.equal(exited.alive, false);

	const released = fromFrame(
		{
			event: "pane_agent_detected",
			data: { pane_id: "w1:p2", workspace_id: "w1", agent: "claude", released: true, final_status: "idle" },
		},
		"w1:p2",
	);
	assert.equal(released.status, "released");
	assert.equal(released.alive, false);
});

test("a sampled pane reads the same way a frame does", () => {
	assert.deepEqual({ ...fromPane({ agent: "pi", agent_status: "working" }) }, {
		status: "working",
		agent: "pi",
		alive: true,
		source: "poll",
		event: null,
	});
	assert.equal(fromPane(null).status, "exited", "a pane that left the list is a worker that is gone");
});

// ── Degradation is loud (§5.1) ───────────────────────────────────────────────

test("a socket that will not open degrades to polling and says so", async () => {
	const timers = manualTimers();
	const degraded = [];
	const transitions = [];
	let sampled = 0;

	const watcher = watchPane({
		pane: "w1:p2",
		socket: "/nonexistent/herdr.sock",
		connect: () => {
			throw new Error("ENOENT");
		},
		poll: async () => {
			sampled += 1;
			return { ok: true, pane: { agent: "pi", agent_status: sampled === 1 ? "working" : "done" } };
		},
		onTransition: (transition) => transitions.push(transition),
		onDegraded: (degradation) => degraded.push(degradation),
		timers: timers.api,
	});

	assert.equal(watcher.degraded(), true);
	assert.deepEqual({ ...degraded[0] }, {
		source: "herdr",
		reason: "socket-unavailable",
		detail: "ENOENT",
		fallback: "polling",
		interval_ms: DEGRADED_POLL_INTERVAL_MS,
	});
	assert.equal(degraded.length, 1, "silent degradation is indistinguishable from a well-behaved worker");

	timers.tick(DEGRADED_POLL_INTERVAL_MS);
	timers.tick(DEGRADED_POLL_INTERVAL_MS);
	await new Promise((resolve) => setImmediate(resolve));

	// Two samples, one transition: a confirmation of no change emits nothing.
	assert.equal(sampled, 2);
	assert.deepEqual(transitions.map((transition) => transition.status), ["working", "done"]);
	watcher.close();
});

test("frames arrive line by line, and a refusal degrades rather than going quiet", async () => {
	const stream = Object.assign(new EventEmitter(), {
		written: [],
		write(line) {
			this.written.push(line);
		},
		setTimeout() {},
		destroy() {},
	});
	const transitions = [];
	const degraded = [];

	const watcher = watchPane({
		pane: "w1:p2",
		socket: "/run/herdr.sock",
		connect: () => stream,
		onTransition: (transition) => transitions.push(transition),
		onDegraded: (degradation) => degraded.push(degradation),
		timers: manualTimers().api,
	});

	stream.emit("connect");
	assert.equal(JSON.parse(stream.written[0]).method, "events.subscribe");

	// Two frames split across one chunk boundary, exactly as a socket delivers.
	stream.emit("data", '{"id":"factory-watch-w1:p2","result":{"type":"subscription_started"}}\n{"event":"pane_agent');
	stream.emit(
		"data",
		'_status_changed","data":{"type":"pane_agent_status_changed","pane_id":"w1:p2","workspace_id":"w1","agent_status":"working","agent":"pi"}}\n',
	);
	assert.deepEqual(transitions.map((transition) => transition.status), ["working"]);

	stream.emit("data", '{"error":{"code":"invalid_request","message":"missing field `pane_id`"}}\n');
	assert.equal(degraded[0].reason, "subscription-refused");
	assert.match(degraded[0].detail, /pane_id/);
	watcher.close();
});

test("a quiet socket at subscribe time is a calm worker, not degradation (§5.1)", () => {
	// node's socket timeout can fire *before* `connect` when the event loop is
	// blocked — #149's probe blocked it with the `agent start` spawnSync, and the
	// old guard degraded a healthy socket 80 ms before its first frame. The watch
	// must arm no such timeout: after subscribing, silence is the thing it keeps
	// watching for.
	const stream = Object.assign(new EventEmitter(), {
		written: [],
		timeoutCallback: null,
		write(line) {
			this.written.push(line);
		},
		setTimeout(ms, callback) {
			this.timeoutCallback = ms > 0 ? callback : null;
		},
		destroy() {},
	});
	const degraded = [];

	const watcher = watchPane({
		pane: "w1:p2",
		socket: "/run/herdr.sock",
		connect: () => stream,
		onTransition: () => {},
		onDegraded: (degradation) => degraded.push(degradation),
		timers: manualTimers().api,
	});

	// The old guard armed an inactivity timeout that node could fire before
	// `connect`. Triggering whatever is armed (nothing, now) must be a no-op.
	stream.timeoutCallback?.();
	stream.emit("connect");
	assert.equal(JSON.parse(stream.written[0]).method, "events.subscribe");

	assert.equal(stream.timeoutCallback, null, "the watch arms no socket timeout");
	assert.equal(degraded.length, 0);
	assert.equal(watcher.degraded(), false);
	watcher.close();
});

test("an unrecognised frame for this pane is loud through onUnrecognised, not silent", () => {
	const stream = Object.assign(new EventEmitter(), {
		written: [],
		write(line) {
			this.written.push(line);
		},
		destroy() {},
	});
	const unrecognised = [];
	const transitions = [];

	const watcher = watchPane({
		pane: "w1:p2",
		socket: "/run/herdr.sock",
		connect: () => stream,
		onTransition: (transition) => transitions.push(transition),
		onUnrecognised: (frame) => unrecognised.push(frame),
		onDegraded: () => {},
		timers: manualTimers().api,
	});

	stream.emit("connect");
	stream.emit("data", '{"event":"pane.new_event","data":{"pane_id":"w1:p2","agent":"pi"}}\n');

	assert.deepEqual(unrecognised, [{ pane: "w1:p2", event: "pane.new_event" }]);
	assert.deepEqual(transitions, [], "an unknown event is not a transition");
	watcher.close();
});
