import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FACTORY_ATTEMPT_TOKEN, METADATA_SOURCE } from "../../factory/lib/controller/herdr-control.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { validateRole } from "../../factory/lib/worker/adapter.mjs";
import { attemptManifestPath, attemptOutboxPath, attemptPromptPath, herdrAgentName } from "../../factory/lib/worker/attempt.mjs";
import { closureFinding } from "../../factory/lib/worker/closure.mjs";
import { launchWorker } from "../../factory/lib/worker/lifecycle.mjs";
import { PIPELINE_ROLES } from "../../factory/lib/worker/roles.mjs";
import { fakeHerdr } from "./helpers/factory-worker.mjs";
import { FIXED_NOW, manualTimers, openTestStore, refusalOfAsync, runStarted } from "./helpers/factory-store.mjs";

/**
 * §6.4–§6.5: **all worker attempts run as interactive panes**, correlated by a
 * tuple minted before launch, and every derived name recomputable from it.
 *
 * The order of the launch is what these hold. Each step sits where it does
 * because of a crash it makes survivable, and a suite that only checked the
 * happy path would let any of them move.
 */

const ROLE = validateRole({ ...PIPELINE_ROLES[0], closure: ["implement", "tdd"] });
const PROFILE = Object.freeze({ name: "builder", model: "local/qwen3" });
const PACKAGE_REV = "e".repeat(64);

const SNAPSHOT = Object.freeze({
	snapshot_version: 1,
	number: 42,
	title: "Make the thing work",
	body: "It should work.",
	state: "open",
	labels: Object.freeze([]),
	assignees: Object.freeze([]),
	updated_at_raw: "2026-08-15T09:00:00+02:00",
	content_version: 1,
	snapshot_at: FIXED_NOW,
	snapshot_at_raw: "2026-02-12T02:40:00.000Z",
	comments: Object.freeze([]),
});

/** A store with a run open and a controller holding the lease. */
async function launchable(t, { herdr = fakeHerdr() } = {}) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const opened = runStarted();

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(opened.run);

	const rechecked = [];
	return {
		store,
		hold,
		herdr,
		rechecked,
		run: opened.run,
		attempt: `${opened.run}-t42-a1`,
		launch: (overrides = {}) =>
			launchWorker(store, {
				hold,
				identity: { run: opened.run, ticket: 42, phase: "implement", attempt: `${opened.run}-t42-a1` },
				role: ROLE,
				runtime: "pi",
				agentKind: "pi",
				profile: PROFILE,
				observedModel: "qwen3-30b",
				packageRev: PACKAGE_REV,
				worktreePath: "/state/worktrees/attempt",
				branch: "factory/t42/a1",
				ticketSnapshot: SNAPSHOT,
				sessionArgs: ["--exclude-tools", "edit,write"],
				herdr: herdr.control,
				// `commandsBefore` rather than `at`: the recheck's own context carries
				// an `at`, and a spread that clobbered it would make this assert nothing.
				recheck: (_store, context) => rechecked.push({ ...context, commandsBefore: herdr.commands().length }),
				actor: "controller",
				now: () => FIXED_NOW,
				sleep: async () => {},
				...overrides,
			}),
	};
}

// ── The launch, in order (§6.4, §6.5) ────────────────────────────────────────

test("a launch opens an interactive pane, stamps it, starts the agent, then prompts", async (t) => {
	const context = await launchable(t);

	const launched = await context.launch();

	assert.deepEqual(context.herdr.commands(), [
		"workspace create",
		"pane report-metadata",
		"pane run",
		"agent start",
		"pane list",
		"agent prompt",
	]);
	assert.equal(launched.pane, "w1:p1");
	assert.equal(launched.agent, herdrAgentName(context.attempt));
});

test("identity reaches the worker through the environment as well as the prompt (§6.5)", async (t) => {
	const context = await launchable(t);

	await context.launch();

	// Two channels, deliberately: a worker that lost track of the prompt can
	// still read `$FACTORY_ATTEMPT`, and so can anything it starts.
	const exported = context.herdr.panes[0].exported;
	assert.match(exported, /^export /);
	for (const [name, value] of [
		["FACTORY_RUN", context.run],
		["FACTORY_TICKET", "42"],
		["FACTORY_PHASE", "implement"],
		["FACTORY_ATTEMPT", context.attempt],
		["FACTORY_OUTBOX", attemptOutboxPath(context.store.storeDir, context.attempt)],
		["FACTORY_WORKTREE", "/state/worktrees/attempt"],
	]) {
		assert.ok(exported.includes(`${name}='${value}'`), `${name} is not in the worker's environment: ${exported}`);
	}

	// Into the shell **before** the agent occupies the pane, or the harness
	// process never sees them.
	const commands = context.herdr.commands();
	assert.ok(commands.indexOf("pane run") < commands.indexOf("agent start"));
});

test("the pane is stamped with FACTORY_ATTEMPT before the agent starts (§5.5)", async (t) => {
	const context = await launchable(t);

	await context.launch();

	const stamp = context.herdr.calls.find((args) => args[1] === "report-metadata");
	const start = context.herdr.calls.findIndex((args) => args[1] === "start");
	assert.ok(context.herdr.calls.indexOf(stamp) < start, "a crash in between must leave a recognisable pane");
	assert.deepEqual(stamp.slice(0, 6), [
		"pane",
		"report-metadata",
		"--source",
		METADATA_SOURCE,
		"--token",
		`${FACTORY_ATTEMPT_TOKEN}=${context.attempt}`,
	]);
	assert.equal(context.herdr.panes[0].tokens[FACTORY_ATTEMPT_TOKEN], context.attempt);
});

test("headless is never reached: the session is a pane running the agent (§6.4)", async (t) => {
	const context = await launchable(t);

	await context.launch();

	const start = context.herdr.calls.find((args) => args[1] === "start");
	assert.ok(start.includes("--pane"), "the agent starts in a pane that already exists");
	assert.deepEqual(start.slice(start.indexOf("--") + 1), ["--exclude-tools", "edit,write"], "§6.8's binding rides it");
	for (const args of context.herdr.calls) {
		assert.ok(!args.includes("--print"), "a headless flag is reserved for disposable probes");
	}
});

test("the first prompt is the rendered template, and the pane cwd is the worktree", async (t) => {
	const context = await launchable(t);

	await context.launch();

	const created = context.herdr.calls.find((args) => args[1] === "create");
	assert.deepEqual(created.slice(2, 4), ["--cwd", "/state/worktrees/attempt"]);
	assert.ok(created.includes("--no-focus"), "the operator is watching something else");

	const prompted = context.herdr.calls.find((args) => args[1] === "prompt");
	assert.equal(prompted[2], herdrAgentName(context.attempt));
	assert.match(prompted[3], /^\/skill:implement/);
	assert.ok(prompted[3].includes(attemptOutboxPath(context.store.storeDir, context.attempt)));
	assert.ok(!prompted.includes("--wait"), "§6.6's wait is first-signal-wins, not the harness's idea of settled");
});

// ── The record (§6.5) ────────────────────────────────────────────────────────

test("the mint is recorded before any attempt-scoped effect (§6.5)", async (t) => {
	const context = await launchable(t);

	await context.launch();

	// The projections refuse an attempt-scoped record for a tuple nothing
	// minted, which is exactly why the order is this one and not the reverse.
	const kinds = context.store
		.readEvents({ stream: runStream(context.run) })
		.map((event) => event.kind)
		.filter((kind) => kind.startsWith("attempt.") || kind.startsWith("effect."));
	assert.deepEqual(kinds, ["attempt.launched", "effect.requested", "effect.resolved", "attempt.correlated"]);

	const [event] = context.store.readEvents({ kind: "attempt.launched" });
	assert.equal(event.attempt, context.attempt);
	assert.equal(event.payload.runtime, "pi");
	assert.equal(event.payload.role, "implement");
	assert.equal(event.payload.profile, "builder");
	assert.equal(event.payload.declared_model, "local/qwen3");
	assert.equal(event.payload.package_rev, PACKAGE_REV);
	assert.equal(event.payload.worktree, "/state/worktrees/attempt");
	assert.equal(event.payload.outbox, attemptOutboxPath(context.store.storeDir, context.attempt));
});

test("attempt.correlated carries what only the harness could say (§6.5)", async (t) => {
	const context = await launchable(t);

	await context.launch();

	const [event] = context.store.readEvents({ kind: "attempt.correlated" });
	assert.deepEqual(event.payload.herdr, {
		workspace: "w1",
		tab: "w1:t1",
		pane: "w1:p1",
		agent: herdrAgentName(context.attempt),
	});
	assert.equal(event.payload.resolved_model, "qwen3-30b", "§11.7's observed id, per attempt");
	assert.equal(event.payload.package_rev, PACKAGE_REV);
	assert.equal(event.payload.skill_source, "implement");
});

test("a mint the claim already wrote is not written twice", async (t) => {
	const context = await launchable(t);

	// §7.3's branch and worktree are created at claim time under this same
	// tuple, so the mint is often already there when the launch runs.
	context.store.append({
		kind: "attempt.launched",
		source: "controller",
		run: context.run,
		ticket: 42,
		phase: "implement",
		attempt: context.attempt,
		occurredAt: FIXED_NOW,
		observedAt: FIXED_NOW,
		payload: { role: "implement" },
	});

	await context.launch();

	assert.equal(context.store.readEvents({ kind: "attempt.launched" }).length, 1);
	assert.equal(context.store.readEvents({ kind: "attempt.correlated" }).length, 1);
});

test("the attempt manifest and the prompt are written where the controller owns them", async (t) => {
	const context = await launchable(t);

	const launched = await context.launch();

	const manifest = JSON.parse(readFileSync(attemptManifestPath(context.store.storeDir, context.attempt), "utf8"));
	assert.equal(manifest.attempt, context.attempt);
	assert.equal(manifest.package_rev, PACKAGE_REV);
	assert.deepEqual(manifest.ticket_snapshot.comments, []);
	assert.equal(manifest.ticket_snapshot.number, 42, "the worker's evidence is recorded, not just referenced");

	// The journal cites the manifest by digest, so the record says *which*
	// manifest and the manifest says what the worker was launched with.
	const [event] = context.store.readEvents({ kind: "attempt.launched" });
	assert.equal(event.payload.manifest_digest, launched.manifest.digest);
	assert.equal(
		event.payload.prompt_digest,
		launched.manifest.promptDigest,
		"the prompt's digest is the evidence of exactly what the worker saw",
	);
	assert.match(readFileSync(attemptPromptPath(context.store.storeDir, context.attempt), "utf8"), /^\/skill:implement/);
});

// ── The transcript pointer (§6.5) ────────────────────────────────────────────

test("the transcript pointer is captured from Herdr, never computed", async (t) => {
	const context = await launchable(t, {
		herdr: fakeHerdr({ session: { agent: "pi", kind: "path", value: "/home/f/.pi/sessions/abc.jsonl" } }),
	});

	const launched = await context.launch();

	assert.deepEqual({ ...launched.transcript }, {
		kind: "path",
		value: "/home/f/.pi/sessions/abc.jsonl",
		captured_at: FIXED_NOW,
	});
	const [event] = context.store.readEvents({ kind: "attempt.correlated" });
	assert.equal(event.payload.transcript.value, "/home/f/.pi/sessions/abc.jsonl");

	// §12.3: permanent, in the tier-2 digest — the run stream expires and this
	// must not go with it.
	assert.deepEqual(context.store.readRunDigest(context.run).transcripts[context.attempt], {
		worker_kind: "pi",
		transcript_kind: "path",
		transcript_value: "/home/f/.pi/sessions/abc.jsonl",
		captured_at: FIXED_NOW,
	});
});

test("a pointer that never arrives records no-transcript-pointer rather than nothing", async (t) => {
	const context = await launchable(t, { herdr: fakeHerdr({ session: null }) });

	const launched = await context.launch();

	assert.equal(launched.transcript, null);
	const [event] = context.store.readEvents({ kind: "attempt.correlated" });
	assert.equal(event.payload.transcript, null);
	assert.deepEqual(context.store.readRunDigest(context.run).transcripts[context.attempt], {
		worker_kind: "pi",
		missing: "no-transcript-pointer",
	});
});

// ── The layer-3 recheck (§6.2, #105's wiring obligation) ─────────────────────

test("the recheck runs after attempt.launched exists and before the prompt is sent", async (t) => {
	const context = await launchable(t);

	await context.launch();

	assert.equal(context.rechecked.length, 1);
	const [recheck] = context.rechecked;
	assert.equal(recheck.attempt, context.attempt);
	assert.equal(recheck.observedModel, "qwen3-30b", "the recheck compares the id the launch observed");
	assert.equal(recheck.profile, "builder");

	// It fired with the pane open, the agent started and its pointer read — and
	// with the prompt still unsent, because the prompt is what spends.
	assert.deepEqual(context.herdr.commands().slice(0, recheck.commandsBefore), [
		"workspace create",
		"pane report-metadata",
		"pane run",
		"agent start",
		"pane list",
	]);
	assert.equal(context.herdr.commands()[recheck.commandsBefore], "agent prompt");
	assert.equal(
		context.store.readEvents({ kind: "attempt.launched" }).length,
		1,
		"#105's contract: the recheck's event needs the mint's row to already exist",
	);
});

test("package drift stops the attempt before it spends anything", async (t) => {
	const context = await launchable(t);

	await assert.rejects(
		() =>
			context.launch({
				recheck: () => {
					throw new Error("handshake drift");
				},
			}),
		/handshake drift/,
	);

	assert.deepEqual(context.herdr.commands(), [
		"workspace create",
		"pane report-metadata",
		"pane run",
		"agent start",
		"pane list",
	]);
	assert.equal(context.herdr.commands().includes("agent prompt"), false, "no prompt, so no tokens spent");
});

// ── The effect (§4.5) ────────────────────────────────────────────────────────

test("the launch is one agent-start effect, resolved with the session ids", async (t) => {
	const context = await launchable(t);

	await context.launch();

	const [requested] = context.store.readEvents({ kind: "effect.requested" });
	assert.equal(requested.payload.operation, "agent-start");
	assert.equal(requested.payload.effect_key, `${context.run}/42/implement/${context.attempt}/agent-start`);
	assert.equal(requested.payload.effect_payload.outbox, attemptOutboxPath(context.store.storeDir, context.attempt));

	const [resolved] = context.store.readEvents({ kind: "effect.resolved" });
	assert.equal(resolved.payload.result.pane, "w1:p1");
	assert.deepEqual(unresolvedEffects(context.store), [], "a launched attempt leaves nothing for reconcile to settle");
});

test("a multiplexer refusal leaves the effect unresolved for reconcile, and closes nothing", async (t) => {
	const context = await launchable(t, { herdr: fakeHerdr({ refuse: { "agent start": { exitCode: 1, stderr: "pane busy" } } }) });

	const error = await refusalOfAsync(() => context.launch());

	assert.equal(error.reason, "worker-launch-failed");
	assert.match(error.message, /pane busy/);
	assert.equal(unresolvedEffects(context.store).length, 1, "§5.3 settles it by re-probing, not by reasoning");
	assert.equal(context.herdr.commands().includes("workspace close"), false);
	assert.equal(
		context.store.readEvents({ kind: "attempt.correlated" }).length,
		0,
		"a launch that did not finish leaves no correlation, so a re-entry finishes it",
	);
});

test("a re-entry after a mid-launch crash finishes the launch rather than refusing it", async (t) => {
	// The world after a controller died between `agent start` and the prompt:
	// the effect is resolved, the pane is live, and nothing correlated it.
	const context = await launchable(t);
	let crash = true;
	await refusalOfAsync(() =>
		context.launch({
			recheck: () => {
				if (crash) throw new Error("the controller died here");
			},
		}),
	);
	assert.equal(context.store.readEvents({ kind: "attempt.correlated" }).length, 0);

	crash = false;
	const launched = await context.launch();

	assert.equal(launched.pane, "w1:p1", "the committed effect answered; no second pane was opened");
	assert.equal(context.herdr.commands().filter((command) => command === "workspace create").length, 1);
	assert.equal(context.store.readEvents({ kind: "attempt.correlated" }).length, 1);
});

// ── The refusals (§5.5, §6.8) ────────────────────────────────────────────────

test("an attempt is never launched twice", async (t) => {
	const context = await launchable(t);
	await context.launch();

	const error = await refusalOfAsync(() => context.launch());

	assert.equal(error.reason, "attempt-already-launched");
	assert.match(error.message, /#114/, "a live worker is adopted, not restarted");
});

test("a layer-1 or layer-2 finding is the typed automation failure, before a pane exists", async (t) => {
	const context = await launchable(t);

	const error = await refusalOfAsync(() =>
		context.launch({
			closureFindings: [closureFinding("skill-missing", 'Skill "tdd" is required and no skills root ships it.')],
		}),
	);

	assert.equal(error.reason, "skill-conflict");
	assert.deepEqual(context.herdr.commands(), [], "nothing was started for a worker that could not have worked");
});
