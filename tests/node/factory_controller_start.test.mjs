import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { readArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import {
	END_REASON_EXIT_CODES,
	EXIT_OK,
	EXIT_REFUSED,
	EXIT_USAGE,
	exitCodeForEndReason,
} from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { ENTRY_MODES } from "../../factory/lib/controller/entry.mjs";
import { HERDR_REMEDIES } from "../../factory/lib/controller/herdr.mjs";
import { writeRunManifest } from "../../factory/lib/controller/manifest.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { RUN_END_REASONS, RUN_LIFECYCLES } from "../../factory/lib/domain/vocabulary.mjs";
import { isUlid, newUlid } from "../../factory/lib/identity/ulid.mjs";
import { HEARTBEAT_STREAM, runStream } from "../../factory/lib/state/events.mjs";
import { CONTROLLER_LEASE_TTL_MS, openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { cloneValidConfig, factorySources, makeRepo } from "./helpers/factory-repo.mjs";
import { FIXED_NOW, herdrAnswering, leaseIdentity, makeAgentDir, manualTimers } from "./helpers/factory-store.mjs";

/**
 * §10.1, §10.3, §10.4: **one invocation, one run.**
 *
 * These drive the real binary's code path — a real git repository, a real
 * policy file, a real store on disk — because everything the run lifecycle
 * promises is a promise about durable records and an exit code, and neither is
 * observable through a mock.
 *
 * The one thing injected is the Herdr probe. It is a live read of the operator's
 * terminal multiplexer, and a suite that only passes on a machine running one
 * would be testing the machine.
 */

const AVAILABLE = herdrAnswering();
const UNAVAILABLE = herdrAnswering(false);

/** The process facts a start drives, rather than inheriting the test runner's. */
function invocation(t, { config, herdr = AVAILABLE } = {}) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		cwd: makeRepo(t, config === undefined ? {} : { config }),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HERDR_PANE_ID: "w1:p7" },
		herdr,
	};
}

async function storeOf(t, context) {
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	t.after(() => store.close());
	return store;
}

/** A run nobody ended and nobody holds — what a crashed controller leaves. */
async function orphanRun(context, { tickets = [42], at = 1_770_000_000_000, then = () => {} } = {}) {
	const runId = newUlid(at);
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	try {
		store.append({
			kind: "run.started",
			source: "controller",
			run: runId,
			occurredAt: at,
			observedAt: at,
			payload: { scope: { kind: "direct-ticket", tickets }, mode: ENTRY_MODES.started },
		});
		then(store, runId);
	} finally {
		store.close();
	}
	return runId;
}

// ── The published contract (§10.3, §13.A, §14.36) ────────────────────────────

test("every end reason has the exit code §10.3 tabulates, and only those", () => {
	assert.deepEqual(Object.keys(END_REASON_EXIT_CODES).sort(), [...RUN_END_REASONS].sort());
	assert.deepEqual(END_REASON_EXIT_CODES, {
		drained: 0,
		"baseline-red": 2,
		"stopped-by-operator": 3,
		abandoned: 4,
		"circuit-breaker": 5,
		"lease-lost": 6,
		"controller-lost": null,
	});
});

test("controller-lost carries no exit code, because it is never self-asserted", () => {
	assert.equal(END_REASON_EXIT_CODES["controller-lost"], null);
	assert.throws(() => exitCodeForEndReason("controller-lost"), /never self-asserted/);
});

test("no run end reason exits 1, which belongs to usage and config alone", () => {
	for (const reason of RUN_END_REASONS.filter((candidate) => candidate !== "controller-lost")) {
		assert.notEqual(exitCodeForEndReason(reason), EXIT_USAGE, reason);
	}
});

test("neither the exit-code table nor the output schema_version can be reached from config", () => {
	// §10.3 makes both published contract rather than configuration, and the
	// checkable form of that is structural: the two modules that carry them
	// import nothing from the loader, so there is no path along which a policy
	// file could reach either.
	const sources = new Map(factorySources());

	for (const module of ["lib/cli/exit-codes.mjs", "lib/cli/main.mjs"]) {
		assert.doesNotMatch(
			sources.get(module),
			/^import .*from "\.\.\/config\/(?!errors|load)/m,
			`${module} reads configuration to build a published contract`,
		);
	}
	// `main.mjs` loads config to hand it to a verb, and that is the only reason
	// it may name the loader at all. The table's own module names none of it.
	assert.match(sources.get("lib/cli/main.mjs"), /from "\.\.\/config\/load\.mjs"/);
	assert.doesNotMatch(sources.get("lib/cli/exit-codes.mjs"), /^import .*config/m);
});

test("a config naming the published contract is an unknown key, never an override", async (t) => {
	const config = cloneValidConfig();
	config.exitCodes = { drained: 9 };

	const { exitCode, value } = await runCli(["start", "42"], invocation(t, { config }));

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.reason, "unknown-key");
});

// ── The lifecycle (§10.3) ────────────────────────────────────────────────────

test("a start drains, ends with a reason, and exits with that reason's code", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.end_reason, "drained");
	assert.equal(value.report.exit_code, exitCodeForEndReason("drained"));
	assert.equal(value.report.lifecycle, "ended");
	assert.equal(value.report.execution.claimed, 0);
	// §9.7's green-looking run that did nothing has to be impossible to mistake
	// for a run that did the work.
	assert.match(value.report.execution.missing, /#100/);
});

test("the lifecycle is preflight, running, draining, ended — in that order", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const lifecycles = store
		.readEvents({ stream: runStream(value.report.run) })
		.filter((event) => ["run.started", "run.lifecycle-changed", "run.ended"].includes(event.kind))
		.map((event) => (event.kind === "run.started" ? "preflight" : (event.payload.lifecycle ?? "ended")));

	assert.deepEqual(lifecycles, RUN_LIFECYCLES);
	assert.equal(store.readRun(value.report.run).lifecycle, "ended");
	assert.equal(store.readRun(value.report.run).end_reason, "drained");
});

test("the run id is a ULID, and two runs sort by the time they started", async (t) => {
	const first = invocation(t);
	const second = invocation(t);

	const one = (await runCli(["start", "42"], first)).value.report.run;
	const two = (await runCli(["start", "42"], second)).value.report.run;

	assert.ok(isUlid(one), one);
	assert.ok(isUlid(two), two);
	assert.ok(one < two, "ULIDs minted in order do not sort in order");
});

test("a run that ends is durable across a controller restart, id and all", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);
	const store = await storeOf(t, context);

	assert.equal(store.readRunDigest(value.report.run).end_reason, "drained");
	assert.deepEqual(store.readUnendedRuns(), [], "an ended run stayed re-enterable");
});

// ── Preflight (§9.7, §10.3) ──────────────────────────────────────────────────

test("preflight is observable per check and per probe, and runs after the run exists", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	const names = value.report.preflight.checks.map((check) => check.check);
	assert.deepEqual(names, [
		"package-handshake",
		"run-manifest",
		"skill-closure",
		"herdr-available",
		"runtime-probe",
		"baseline",
	]);
	assert.deepEqual(
		[...new Set(value.report.preflight.checks.map((check) => check.class))].sort(),
		["probe", "static"],
	);

	const store = await storeOf(t, context);
	const events = store.readEvents({ stream: runStream(value.report.run) });
	const [started] = events.filter((event) => event.kind === "run.started");
	const checks = events.filter((event) => event.kind === "preflight.checked");

	assert.equal(checks.length, names.length, "a check reached the report without reaching the journal");
	assert.ok(checks.every((event) => event.seq > started.seq), "preflight ran before the run existed");
});

test("preflight stages hang off no tracker ticket", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const checks = store.readEvents({ stream: runStream(value.report.run) }).filter((e) => e.kind === "preflight.checked");

	assert.ok(checks.every((event) => event.ticket === null && event.phase === "preflight"));
	assert.deepEqual(store.readTicketExecutions(value.report.run), [], "a run-scoped stage created a ticket execution");
});

test("an unanchorable package is a recorded red check, not an unhandled exception", async (t) => {
	const context = invocation(t);
	context.executable = "/definitely/not/a/package/factory.mjs";

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	assert.deepEqual(value.report.preflight.red, ["package-handshake"]);
	assert.equal(value.report.preflight.checks.find((check) => check.check === "package-handshake").result, "failed");
	assert.ok(value.report.manifest, "the failed handshake prevented the remaining static evidence from being recorded");
});

test("a red preflight check ends the run baseline-red, naming the check, exiting 2", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	assert.deepEqual(value.report.preflight.red, ["herdr-available"]);
	assert.match(value.message, /herdr-available/);

	const store = await storeOf(t, context);
	assert.deepEqual(
		store.readEvents({ stream: runStream(value.report.run) }).find((e) => e.kind === "run.ended").payload,
		{ end_reason: "baseline-red", red_checks: ["herdr-available"] },
	);
});

test("a --json consumer cannot read a non-zero run as success", async (t) => {
	const red = await runCli(["start", "42"], invocation(t, { herdr: UNAVAILABLE }));
	const green = await runCli(["start", "42"], invocation(t));

	// §10.3's warning is about `factory start && next-thing`; the same misreading
	// is available to anything branching on `ok`, so `ok` tracks the exit code.
	assert.deepEqual([red.value.ok, red.value.exit_code], [false, 2]);
	assert.deepEqual([green.value.ok, green.value.exit_code], [true, 0]);
	assert.equal(red.value.error, undefined, "a failed run is a report, not a refusal");
	assert.match(red.value.message, /baseline-red/, "a failed run still prints its report");
});

test("a run that fails preflight never reaches running", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE });

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const moved = store
		.readEvents({ stream: runStream(value.report.run) })
		.filter((event) => event.kind === "run.lifecycle-changed");

	assert.deepEqual(moved, [], "a red preflight let the run start executing");
});

test("Herdr availability is a named check that fails closed with the exact command", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE });

	const { value } = await runCli(["start", "42"], context);

	const check = value.report.preflight.checks.find((candidate) => candidate.check === "herdr-available");
	assert.equal(check.class, "probe");
	assert.equal(check.result, "failed");
	assert.equal(check.detail.command, "herdr");
	assert.match(check.message, /herdr/);
});

test("an unbuilt check is neither passed nor failed, and names the ticket that owes it", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	const baseline = value.report.preflight.checks.find((check) => check.check === "baseline");
	assert.equal(baseline.result, "unbuilt");
	assert.match(baseline.detail.missing, /#104/);
	assert.equal(value.report.end_reason, "drained", "an unbuilt check coloured the phase");
});

// ── Liveness (§4.8, §5.1) ────────────────────────────────────────────────────

test("the heartbeat is diagnostic, on its own front-truncatable stream, naming its run", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const beats = store.readEvents({ stream: HEARTBEAT_STREAM });

	assert.ok(beats.length >= 1, "a run emitted no heartbeat at all");
	for (const beat of beats) {
		assert.equal(beat.kind, "controller.heartbeat");
		assert.equal(beat.visibility, "diagnostic");
		// §4.2: a record carrying a run slot belongs on that run's stream, so the
		// heartbeat names its run in the payload and stays compactable.
		assert.equal(beat.run, null);
		assert.equal(beat.payload.run, value.report.run);
		assert.equal(typeof beat.payload.lease_token, "string");
		assert.equal(beat.payload.fencing_generation, value.report.liveness.fencing_generation);
		assert.equal(typeof beat.payload.activity, "string");
	}
});

test("the heartbeat counts observer subscriptions, not unfinished attempts", async (t) => {
	const context = invocation(t);
	await orphanRun(context, {
		then: (store, runId) =>
			store.append({
				kind: "attempt.launched",
				source: "controller",
				run: runId,
				ticket: 42,
				phase: "implement",
				attempt: `${runId}-t42-a1`,
				occurredAt: 1_770_000_000_100,
				observedAt: 1_770_000_000_100,
				payload: { role: "implement" },
			}),
	});

	await runCli(["start"], context);

	const store = await storeOf(t, context);
	const [beat] = store.readEvents({ stream: HEARTBEAT_STREAM });

	// #99 has not started a Herdr observer, so it watches zero panes. An
	// unfinished attempt is a desired observation target, not proof of a live
	// subscription; conflating them makes stopped-watching look healthy.
	assert.equal(beat.payload.watching, 0);
});

test("the report publishes the two §4.8 intervals it is renewing and beating at", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	assert.equal(value.report.liveness.lease_renewal_ms, 10_000);
	assert.equal(value.report.liveness.heartbeat_interval_ms, 60_000);
});

test("the controller lease is released when the run ends", async (t) => {
	const context = invocation(t);

	await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	assert.equal(openLeases(store).inspect("controller"), null);
});

test("a controller that loses its lease exits 6 without closing the run its successor owns", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const timers = manualTimers();

	const answered = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		args: ["42"],
		flags: new Set(),
		timers: timers.api,
		now: () => FIXED_NOW,
		// The probe is where this run is standing when the lease goes: this
		// controller stopped renewing long enough for the row to lapse, a second
		// one adopted it (§10.4), and the renewal is what discovers that (§14.6).
		herdr: async () => {
			const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
			openLeases(store, { now: () => FIXED_NOW + CONTROLLER_LEASE_TTL_MS + 1 }).acquire({
				name: "controller",
				identity: leaseIdentity({ pid: 5151, pane: "w1:p9" }),
			});
			store.close();
			timers.tick();
			return AVAILABLE();
		},
	});

	assert.equal(answered.exitCode, 6);
	assert.equal(answered.report.controller_exit_reason, "lease-lost");
	assert.equal(answered.report.end_reason, null);

	const store = await storeOf(t, context);
	assert.equal(store.readRun(answered.report.run).end_reason, null);
	assert.equal(
		store.readEvents({ stream: runStream(answered.report.run) }).some((e) => e.kind === "run.ended"),
		false,
		"a stale controller closed the run its successor may already be driving",
	);
	assert.equal(
		store.readEvents({ stream: runStream(answered.report.run) }).some((e) => e.kind === "run.lifecycle-changed"),
		false,
		"a controller with no lease kept driving its run",
	);
});

// ── Recovery and re-entry (§10.4) ────────────────────────────────────────────

test("a restart re-enters an orphaned run, keeping its run id and its scope", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context, { tickets: [42] });

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, orphan, "re-entry minted a second run id for one delivery");
	assert.equal(value.report.entry.mode, ENTRY_MODES.adopted);
	assert.deepEqual(value.report.scope.tickets, [42]);
});

test("a re-entered run preflights again before it runs", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context);

	await runCli(["start"], context);

	const store = await storeOf(t, context);
	const [first] = store.readEvents({ stream: runStream(orphan) }).filter((e) => e.kind === "run.lifecycle-changed");
	assert.equal(first.payload.lifecycle, "preflight");
});

test("--new-run opens a fresh run and ends the abandoned one as controller-lost", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context);

	const { exitCode, value } = await runCli(["start", "--new-run", "43"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.notEqual(value.report.run, orphan);
	assert.equal(value.report.entry.mode, ENTRY_MODES.forced);
	assert.deepEqual(value.report.entry.ended_as_controller_lost, [orphan]);

	const store = await storeOf(t, context);
	const abandoned = store.readRun(orphan);
	assert.equal(abandoned.lifecycle, "ended");
	assert.equal(abandoned.end_reason, "controller-lost");
});

test("controller-lost is written by the observing controller, and never as an exit code", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context);

	const { exitCode, value } = await runCli(["start", "--new-run", "43"], context);

	// §14.36: the run that asserted it exited on its own reason, not on the one
	// it observed about somebody else.
	assert.equal(exitCode, exitCodeForEndReason("drained"));

	const store = await storeOf(t, context);
	const ended = store.readEvents({ stream: runStream(orphan) }).find((e) => e.kind === "run.ended");
	assert.equal(ended.payload.observed_by, value.report.run);
});

test("re-entry restating a different scope refuses: membership is immutable", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context, { tickets: [42] });

	const { exitCode, value } = await runCli(["start", "43"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "scope-immutable");
	assert.equal(value.error.run, orphan);
	assert.match(value.error.message, /--new-run/);
});

test("a start with no scope and nothing to re-enter refuses as usage", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "scope-required");
});

test("a scope argument that is not an issue number refuses before anything opens", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "the-auth-work"], context);

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "scope-invalid");
});

// ── Against a live lease-holder (§10.4) ──────────────────────────────────────

/**
 * A live run, holding the lease the way a controller mid-run does. `scope` is
 * the one thing that varies between these cases — §10.4 resolves against the
 * live *selector*, so the selector is the parameter.
 */
async function liveRun(t, context, { scope = { kind: "direct-ticket", tickets: [40, 42] } } = {}) {
	const runId = newUlid();
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	const at = Date.now();
	store.append({
		kind: "run.started",
		source: "controller",
		run: runId,
		occurredAt: at,
		observedAt: at,
		payload: { scope, mode: ENTRY_MODES.started },
	});
	openLeases(store).acquire({ name: "controller", identity: leaseIdentity({ run: runId, pane: "w1:p3" }) });
	store.close();
	return runId;
}

test("a ticket already in the live run's scope prints where it will be claimed, and exits 0", async (t) => {
	const context = invocation(t);
	const live = await liveRun(t, context, { scope: { kind: "direct-ticket", tickets: [40, 42] } });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, live);
	assert.equal(value.report.queued, false, "start queued behind a live run");
	assert.match(value.message, /already in scope/);
	assert.match(value.message, /frontier/);
});

test("a ticket outside the live run's scope refuses, naming the live run and its pane", async (t) => {
	const context = invocation(t);
	const live = await liveRun(t, context, { scope: { kind: "direct-ticket", tickets: [40] } });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "run-out-of-scope");
	assert.equal(value.error.run, live);
	assert.equal(value.error.pane, "w1:p3");
});

test("a live run does not open a second one, whatever the answer was", async (t) => {
	const context = invocation(t);
	await liveRun(t, context, { scope: { kind: "direct-ticket", tickets: [40] } });

	await runCli(["start", "42"], context);
	await runCli(["start", "40"], context);

	const store = await storeOf(t, context);
	assert.equal(store.readUnendedRuns().length, 1);
});

test("membership the tracker alone could decide refuses rather than promising a frontier", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(t, context, { scope: { kind: "parent-scoped", parent: 75 } });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "scope-unresolvable");
	assert.match(value.error.missing, /#100/);
});

test("a parent-scoped start against the same live parent is in scope", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(t, context, { scope: { kind: "parent-scoped", parent: 75 } });

	const { exitCode, value } = await runCli(["start", "--parent", "75"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, runId);
});

// ── The run manifest (§6.8) ──────────────────────────────────────────────────

test("the run manifest records the declared per-run overrides as evidence", async (t) => {
	const config = cloneValidConfig();
	config.budgets = { repair: 2 };
	const context = invocation(t, { config });

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const manifest = JSON.parse(readArtifact(store, value.report.manifest).toString("utf8"));

	// Declared, not effective: `freshRetry` and `automation` fell back to §8.6's
	// defaults, and recording those as overrides would put a decision in evidence
	// that no human made.
	assert.deepEqual(manifest.overrides.budgets, { repair: 2 });
	assert.deepEqual(manifest.overrides.models.roles.implement, {
		profile: "builder",
		kind: "pi",
		model: "local/qwen3",
	});
	assert.deepEqual(manifest.scope, { kind: "direct-ticket", tickets: [42] });
	assert.equal(manifest.overrides.extra_denies.declared, null, "an unbuilt channel reported as 'none declared'");
	assert.match(manifest.overrides.extra_denies.missing, /#106/);
});

test("a config that declares no budgets records no budget override", async (t) => {
	const config = cloneValidConfig();
	delete config.budgets;
	const context = invocation(t, { config });

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const manifest = JSON.parse(readArtifact(store, value.report.manifest).toString("utf8"));

	assert.deepEqual(manifest.overrides.budgets, {});
});

test("the manifest is keyed by the run, so one run has exactly one set of declared inputs", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42"], context);

	const store = await storeOf(t, context);
	const keys = store.read((db) =>
		db.prepare("SELECT effect_key FROM effect WHERE run_id = ? AND operand = 'run-manifest'").all(value.report.run),
	);

	assert.deepEqual(
		keys.map((row) => row.effect_key),
		[`${value.report.run}/-/preflight/-/artifact-write/run-manifest`],
	);
});

test("routing-rule changes conflict with the run manifest even when the rule count is unchanged", async (t) => {
	const config = cloneValidConfig();
	config.profiles.alternate = { kind: "pi", model: "local/other" };
	const context = invocation(t, { config });
	const run = await orphanRun(context);
	const store = await storeOf(t, context);
	const common = {
		run,
		scope: { kind: "direct-ticket", tickets: [42] },
		config,
		configPath: join(context.cwd, ".pi", "factory.json"),
		declared: { budgets: ["repair", "freshRetry", "automation"] },
		handshake: null,
		hold: { fence: () => ({ token: "pinned", generation: 1 }) },
		actor: "controller",
		at: 1_770_000_000_000,
	};

	writeRunManifest(store, {
		...common,
		activeRouting: {
			set: null,
			roles: config.routing.roles,
			rules: [{ labelsAny: ["risk:high"], role: "implement", profile: "alternate" }],
		},
	});

	assert.throws(
		() =>
			writeRunManifest(store, {
				...common,
				activeRouting: {
					set: null,
					roles: config.routing.roles,
					rules: [{ labelsAny: ["docs"], role: "implement", profile: "builder" }],
				},
			}),
		{ reason: "effect-payload-conflict" },
	);
});

test("re-entering a run whose declared inputs changed is a red check, not a silent second pin", async (t) => {
	const config = cloneValidConfig();
	config.budgets = { repair: 2 };
	const context = invocation(t, { config });

	// A crashed controller's run, already pinned to what the file said *then*.
	const orphan = await orphanRun(context, {
		tickets: [42],
		then: (store, runId) =>
			writeRunManifest(store, {
				run: runId,
				scope: { kind: "direct-ticket", tickets: [42] },
				config: { ...config, budgets: { repair: 1, freshRetry: 1, automation: 1 } },
				configPath: join(context.cwd, ".pi", "factory.json"),
				activeRouting: { set: null, roles: config.routing.roles, rules: [] },
				declared: { budgets: [] },
				handshake: null,
				hold: { fence: () => ({ token: "pinned", generation: 1 }) },
				actor: "controller",
				at: 1_770_000_000_000,
			}),
	});

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(value.report.run, orphan, "the run was not re-entered at all");
	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	assert.deepEqual(value.report.preflight.red, ["run-manifest"]);

	const check = value.report.preflight.checks.find((candidate) => candidate.check === "run-manifest");
	assert.equal(check.detail.reason, "effect-payload-conflict");
	assert.match(check.message, /--new-run/);
});
