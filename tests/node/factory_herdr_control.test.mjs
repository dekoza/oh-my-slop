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

test("a pane is opened as its own workspace at the attempt's worktree", async () => {
	const io = runner({
		"workspace create": {
			exitCode: 0,
			stdout: JSON.stringify({
				result: { workspace: { workspace_id: "w7" }, tab: { tab_id: "w7:t1" }, root_pane: { pane_id: "w7:p1" } },
			}),
			stderr: "",
		},
	});

	const opened = await createHerdrControl({ run: io.run }).openPane({ cwd: "/state/worktrees/a", label: "factory-a" });

	assert.deepEqual({ ...opened }, { ok: true, workspace: "w7", tab: "w7:t1", pane: "w7:p1", label: "factory-a" });
	assert.deepEqual(io.calls[0], [
		"workspace",
		"create",
		"--cwd",
		"/state/worktrees/a",
		"--label",
		"factory-a",
		"--no-focus",
	]);
});

test("exit 0 with no readable result is its own failure, and it names it", async () => {
	const io = runner({ "workspace create": { exitCode: 0, stdout: "{}", stderr: "" } });

	const opened = await createHerdrControl({ run: io.run }).openPane({ cwd: "/w", label: "l" });

	assert.equal(opened.ok, false);
	assert.match(opened.message, /learned nothing/);
	assert.match(opened.message, /closes anything/, "and it says what it did not do");
});

test("the stamp is one metadata call carrying the token and the derived title", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).stamp("w1:p1", { attempt: "R-t42-a1", title: "factory R-t42-a1" });

	assert.deepEqual(io.calls[0], [
		"pane",
		"report-metadata",
		"--source",
		"software-factory",
		"--token",
		`${FACTORY_ATTEMPT_TOKEN}=R-t42-a1`,
		"--title",
		"factory R-t42-a1",
		"w1:p1",
	]);
});

test("identity is exported into the pane's own shell, quoted so a path with a space survives", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).exportIdentity("w1:p1", {
		FACTORY_ATTEMPT: "R-t42-a1",
		FACTORY_WORKTREE: "/state/my worktrees/R-t42-a1",
		FACTORY_TICKET: 42,
	});

	// Neither `workspace create` nor `agent start` takes an environment, so the
	// exports are typed into the shell before the agent occupies the pane —
	// which is also what puts them in front of everything the worker starts.
	assert.deepEqual(io.calls[0], [
		"pane",
		"run",
		"w1:p1",
		"export FACTORY_ATTEMPT='R-t42-a1' FACTORY_WORKTREE='/state/my worktrees/R-t42-a1' FACTORY_TICKET='42'",
	]);
});

test("a single quote in a value is escaped rather than closing the quoting", async () => {
	const io = runner();

	await createHerdrControl({ run: io.run }).exportIdentity("w1:p1", { FACTORY_WORKTREE: "/state/it's/here" });

	assert.equal(io.calls[0][3], `export FACTORY_WORKTREE='/state/it'\\''s/here'`);
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

test("a frame becomes an observation only when it is this pane's", () => {
	const status = {
		event: "pane_agent_status_changed",
		data: { type: "pane_agent_status_changed", pane_id: "w1:p2", workspace_id: "w1", agent_status: "blocked", agent: "pi" },
	};

	assert.deepEqual({ ...fromFrame(status, "w1:p2") }, {
		status: "blocked",
		agent: "pi",
		alive: true,
		source: "subscribe",
		event: "pane_agent_status_changed",
	});
	assert.equal(fromFrame(status, "w1:p9"), null, "the two server-wide subscriptions carry everyone's panes");
	assert.equal(fromFrame({ id: "x", result: { type: "subscription_started" } }, "w1:p2"), null);
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
