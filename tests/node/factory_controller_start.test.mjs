import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import {
	EXIT_LEASE_LOST,
	EXIT_OK,
	EXIT_REFUSED,
	EXIT_USAGE,
	exitCodeForEndReason,
	OUTCOME_EXIT_CODES,
} from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { ENTRY_MODES } from "../../factory/lib/controller/entry.mjs";
import { HERDR_REMEDIES } from "../../factory/lib/controller/herdr.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { writeRunManifest } from "../../factory/lib/controller/manifest.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { runStop } from "../../factory/lib/controller/stop.mjs";
import {
	CONTROLLER_EXIT_LEASE_LOST,
	RUN_LIFECYCLES,
	RUN_TERMINAL_REASONS,
} from "../../factory/lib/domain/vocabulary.mjs";
import { isUlid, newUlid } from "../../factory/lib/identity/ulid.mjs";
import { HEARTBEAT_STREAM, runStream } from "../../factory/lib/state/events.mjs";
import { CONTROLLER_LEASE_TTL_MS, openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { cloneValidConfig, factorySources, makeRemote, makeRepo } from "./helpers/factory-repo.mjs";
import {
	FIXED_NOW,
	attemptLaunched,
	herdrAnswering,
	leaseIdentity,
	makeAgentDir,
	makeHome,
	manualTimers,
} from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";

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
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr,
		// §6.2's runtime probes are live reads of the operator's harnesses, so
		// they are injected exactly as the Herdr probe is; the worker suites
		// drive every verdict through the same seam.
		workerTransports: workerTransportsAnswering(root),
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

test("§10.3's table maps the six run end reasons plus the one controller exit outcome, and only those", () => {
	assert.deepEqual(
		Object.keys(OUTCOME_EXIT_CODES).sort(),
		[...RUN_TERMINAL_REASONS, CONTROLLER_EXIT_LEASE_LOST].sort(),
	);
	assert.deepEqual(OUTCOME_EXIT_CODES, {
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
	assert.equal(OUTCOME_EXIT_CODES["controller-lost"], null);
	assert.throws(() => exitCodeForEndReason("controller-lost"), /never self-asserted/);
});

test("lease-lost is the controller's exit outcome, never a reason a run ends with", () => {
	// The code is real — a caller can receive it — but it is not an answer to
	// "why did this run end", so the end-reason mapping refuses to give it out.
	assert.equal(EXIT_LEASE_LOST, 6);
	assert.throws(() => exitCodeForEndReason(CONTROLLER_EXIT_LEASE_LOST), /exit outcome/);
});

test("no run end reason exits 1, which belongs to usage and config alone", () => {
	for (const reason of RUN_TERMINAL_REASONS.filter((candidate) => candidate !== "controller-lost")) {
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

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], invocation(t, { config }));

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.reason, "unknown-key");
});

// ── The lifecycle (§10.3) ────────────────────────────────────────────────────

test("a start drains, ends with a reason, and exits with that reason's code", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.end_reason, "drained");
	assert.equal(value.report.exit_code, exitCodeForEndReason("drained"));
	assert.equal(value.report.lifecycle, "ended");
	assert.equal(value.report.execution.claimed, 0);
	// §9.7's green-looking run that did nothing has to be impossible to mistake
	// for a run that did the work. The reader can answer what is claimable and the
	// claim can take it, but §3.3 forbids claiming work that cannot start — so a
	// run with no pipeline above the claim reads no frontier at all, and the
	// sentence names that half rather than reporting a scope that drained.
	assert.match(value.report.execution.missing, /#108/);
	assert.deepEqual(value.report.execution.members, []);
	assert.deepEqual(value.report.execution.counts, {
		closed: 0,
		"needs-human": 0,
		"awaiting-merge-dependency": 0,
		"blocked-external": 0,
		"human-owned": 0,
		failed: 0,
	});
});

test("the lifecycle is preflight, running, draining, ended — in that order", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

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

	const one = (await runCli(["start", "--foreground", "42"], first)).value.report.run;
	const two = (await runCli(["start", "--foreground", "42"], second)).value.report.run;

	assert.ok(isUlid(one), one);
	assert.ok(isUlid(two), two);
	assert.ok(one < two, "ULIDs minted in order do not sort in order");
});

test("a run that ends is durable across a controller restart, id and all", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);
	const store = await storeOf(t, context);

	assert.equal(store.readRunDigest(value.report.run).end_reason, "drained");
	assert.deepEqual(store.readUnendedRuns(), [], "an ended run stayed re-enterable");
});

// ── Preflight (§9.7, §10.3) ──────────────────────────────────────────────────

test("preflight is observable per check and per probe, and runs after the run exists", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const names = value.report.preflight.checks.map((check) => check.check);
	// §9.7's order, with §6.8's three obligations in the cheap section: the
	// environment is built before the manifest that records what it promoted, and
	// trust is proven before anything is claimed.
	assert.deepEqual(names, [
		"package-handshake",
		"worker-isolation",
		"run-manifest",
		"worker-permissions",
		"worker-trust",
		"skill-closure",
		"herdr-available",
		"git-isolation",
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

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const store = await storeOf(t, context);
	const checks = store.readEvents({ stream: runStream(value.report.run) }).filter((e) => e.kind === "preflight.checked");

	assert.ok(checks.every((event) => event.ticket === null && event.phase === "preflight"));
	assert.deepEqual(store.readTicketExecutions(value.report.run), [], "a run-scoped stage created a ticket execution");
});

test("a run never reads or writes the operator's checkout — protection is topological (§7.1)", async (t) => {
	const context = invocation(t);
	const snapshot = () => ({
		status: execFileSync("git", ["-C", context.cwd, "status", "--porcelain"], { encoding: "utf8" }),
		refs: execFileSync("git", ["-C", context.cwd, "for-each-ref"], { encoding: "utf8" }),
	});
	const before = snapshot();

	const { exitCode } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.deepEqual(snapshot(), before, "the run touched the operator's checkout");
});

test("a repo with submodules or LFS ends the run baseline-red at git-isolation (§7.8)", async (t) => {
	const remote = makeRemote(t, { files: { ".gitmodules": '[submodule "lib"]\n\tpath = lib\n\turl = ../lib.git\n' } });
	const context = invocation(t);
	context.cwd = makeRepo(t, { remotes: { gitea: remote } });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	assert.match(
		value.report.preflight.checks.find((check) => check.check === "git-isolation").message,
		/\.gitmodules/,
	);

	// The baseline is red too, and not as an echo: with no base pinned there was
	// nothing to run the required set *at*, and §14.14 is a never — a run must
	// not start on a baseline nobody ran. It names the check that owes it.
	assert.deepEqual(value.report.preflight.red, ["git-isolation", "baseline"]);
	const baseline = value.report.preflight.checks.find((check) => check.check === "baseline");
	assert.equal(baseline.result, "failed");
	assert.deepEqual(baseline.detail, { reason: "base-unavailable", because: "git-isolation" });
});

test("an unanchorable package is a recorded red check, not an unhandled exception", async (t) => {
	const context = invocation(t);
	context.executable = "/definitely/not/a/package/factory.mjs";

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	// The two §6.2 checks answer from the handshake's pin, so a package nothing
	// could anchor fails them too — each citing the handshake as the cause
	// rather than inventing a second diagnosis.
	assert.deepEqual(value.report.preflight.red, ["package-handshake", "skill-closure", "runtime-probe"]);
	assert.equal(value.report.preflight.checks.find((check) => check.check === "package-handshake").result, "failed");
	for (const dependent of ["skill-closure", "runtime-probe"]) {
		assert.equal(
			value.report.preflight.checks.find((check) => check.check === dependent).detail.cause,
			"package-handshake",
		);
	}
	assert.ok(value.report.manifest, "the failed handshake prevented the remaining static evidence from being recorded");
});

test("a red preflight check ends the run baseline-red, naming the check, exiting 2", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

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
	const red = await runCli(["start", "--foreground", "42"], invocation(t, { herdr: UNAVAILABLE }));
	const green = await runCli(["start", "--foreground", "42"], invocation(t));

	// §10.3's warning is about `factory start && next-thing`; the same misreading
	// is available to anything branching on `ok`, so `ok` tracks the exit code.
	assert.deepEqual([red.value.ok, red.value.exit_code], [false, 2]);
	assert.deepEqual([green.value.ok, green.value.exit_code], [true, 0]);
	assert.equal(red.value.error, undefined, "a failed run is a report, not a refusal");
	assert.match(red.value.message, /baseline-red/, "a failed run still prints its report");
});

test("a run that fails preflight never reaches running", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE });

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const store = await storeOf(t, context);
	const moved = store
		.readEvents({ stream: runStream(value.report.run) })
		.filter((event) => event.kind === "run.lifecycle-changed");

	assert.deepEqual(moved, [], "a red preflight let the run start executing");
});

test("Herdr availability is a named check that fails closed with the exact command", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE });

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const check = value.report.preflight.checks.find((candidate) => candidate.check === "herdr-available");
	assert.equal(check.class, "probe");
	assert.equal(check.result, "failed");
	assert.equal(check.detail.command, "herdr");
	assert.match(check.message, /herdr/);
});

test("every preflight check is built: a green run reports no unbuilt result anywhere", async (t) => {
	// `unbuilt` stays in PREFLIGHT_RESULTS — it is a published value old
	// journals carry and doctor filters on — but with #104's baseline and
	// #105's worker checks landed, nothing in this package can produce it.
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

	assert.deepEqual(
		value.report.preflight.checks.map((check) => check.result),
		value.report.preflight.checks.map(() => "passed"),
	);
	assert.equal(value.report.end_reason, "drained");
});

// ── The baseline gate (§8.3, §14.14) ─────────────────────────────────────────

test("the baseline runs the declared required set at the pinned base, output referenced by digest", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const baseline = value.report.preflight.checks.find((check) => check.check === "baseline");
	assert.equal(baseline.result, "passed");
	assert.equal(baseline.detail.base_commit.length, 40);
	assert.deepEqual(
		baseline.detail.checks.map((check) => [check.name, check.result, check.exit_code]),
		[["unit", "passed", 0]],
	);
	assert.equal(baseline.detail.differential.implemented, false, "v1 never grew a no-new-failures diff (§8.3)");

	// §8.7, §12.1: the record names the output by digest and never carries it.
	const store = await storeOf(t, context);
	const [output] = baseline.detail.checks.map((check) => check.output);
	assert.match(output.digest, /^[0-9a-f]{64}$/);
	assert.equal(output.media_type, "text/plain");
	assert.match(readArtifact(store, output).toString("utf8"), new RegExp(baseline.detail.base_commit));
});

test("a red required check at the base ends the run baseline-red, naming that check, exiting 2", async (t) => {
	const config = cloneValidConfig();
	config.checks = [
		{ name: "unit", command: "exit 0", timeout: 30, severity: "required", expectedFailureExitCodes: [1] },
		{ name: "lint", command: "exit 1", timeout: 30, severity: "required", expectedFailureExitCodes: [1] },
	];
	const context = invocation(t, { config });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	// §8.3 asks for the specific red check, and "baseline" is not it.
	assert.deepEqual(value.report.preflight.red, ["lint"]);
	assert.match(value.message, /lint/);

	const store = await storeOf(t, context);
	assert.deepEqual(
		store.readEvents({ stream: runStream(value.report.run) }).find((e) => e.kind === "run.ended").payload,
		{ end_reason: "baseline-red", red_checks: ["lint"] },
	);
});

test("a required check nobody could run is unrunnable — an automation failure, and still no run (§8.2)", async (t) => {
	const config = cloneValidConfig();
	config.checks = [
		{
			name: "unit",
			command: "definitely-not-a-command",
			timeout: 30,
			severity: "required",
			expectedFailureExitCodes: [1],
		},
	];
	const context = invocation(t, { config });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, 2);
	const baseline = value.report.preflight.checks.find((check) => check.check === "baseline");
	assert.equal(baseline.detail.checks[0].result, "unrunnable");
	assert.equal(baseline.detail.checks[0].reason, "exec-not-found");
});

test("an advisory check never gates the baseline, and is not run at the base at all (§8.3)", async (t) => {
	const config = cloneValidConfig();
	config.checks.push({
		name: "e2e",
		command: "exit 1",
		timeout: 30,
		severity: "advisory",
		expectedFailureExitCodes: [1],
	});
	const context = invocation(t, { config });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	const baseline = value.report.preflight.checks.find((check) => check.check === "baseline");
	assert.deepEqual(baseline.detail.skipped, ["e2e"]);
});

test("a green baseline leaves no worktree behind, and a red one is kept to cd into (§12.7)", async (t) => {
	const greenReport = (await runCli(["start", "--foreground", "42"], invocation(t))).value;

	const config = cloneValidConfig();
	config.checks = [{ name: "unit", command: "exit 1", timeout: 30, severity: "required", expectedFailureExitCodes: [1] }];
	const red = invocation(t, { config });
	const redReport = (await runCli(["start", "--foreground", "42"], red)).value;

	const worktreeOf = (report) =>
		report.report.preflight.checks.find((check) => check.check === "baseline").detail.worktree;

	assert.equal(worktreeOf(greenReport).retained, false);
	assert.equal(existsSync(worktreeOf(greenReport).path), false);
	assert.equal(worktreeOf(redReport).retained, true);
	assert.equal(existsSync(worktreeOf(redReport).path), true);
});

// ── Liveness (§4.8, §5.1) ────────────────────────────────────────────────────

test("the heartbeat is diagnostic, on its own front-truncatable stream, naming its run", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

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

	await runCli(["start", "--foreground"], context);

	const store = await storeOf(t, context);
	const [beat] = store.readEvents({ stream: HEARTBEAT_STREAM });

	// #99 has not started a Herdr observer, so it watches zero panes. An
	// unfinished attempt is a desired observation target, not proof of a live
	// subscription; conflating them makes stopped-watching look healthy.
	assert.equal(beat.payload.watching, 0);
});

test("the report publishes the two §4.8 intervals it is renewing and beating at", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(value.report.liveness.lease_renewal_ms, 10_000);
	assert.equal(value.report.liveness.heartbeat_interval_ms, 60_000);
});

test("the controller lease is released when the run ends", async (t) => {
	const context = invocation(t);

	await runCli(["start", "--foreground", "42"], context);

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
		workerTransports: context.workerTransports,
		args: ["42"],
		flags: new Set([FOREGROUND_FLAG]),
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
	assert.equal(answered.report.controller_exit_outcome, "lease-lost");
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

test("a controller that has not yet noticed the theft still moves no run its successor owns", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const timers = manualTimers();

	const answered = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		args: ["42"],
		flags: new Set([FOREGROUND_FLAG]),
		timers: timers.api,
		now: () => FIXED_NOW,
		// The same theft as above, with the renewal deliberately **not** fired:
		// a successor adopts a lapsed row without asking anyone, so a holder
		// learns it is stale at its next compare-and-swap and not one moment
		// sooner. Everything between the lapse and that discovery is written by a
		// process that no longer owns the run.
		herdr: async () => {
			const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
			openLeases(store, { now: () => FIXED_NOW + CONTROLLER_LEASE_TTL_MS + 1 }).acquire({
				name: "controller",
				identity: leaseIdentity({ pid: 5151, pane: "w1:p9" }),
			});
			store.close();
			return AVAILABLE();
		},
	});

	assert.equal(answered.exitCode, 6);
	assert.equal(answered.report.end_reason, null);

	const store = await storeOf(t, context);
	const events = store.readEvents({ stream: runStream(answered.report.run) });

	// A green preflight would have moved this run to `running` and then to
	// `draining`. Neither is this process's to write once the row is gone, and
	// parking a successor's run at `draining` while it preflights is exactly the
	// state §10.4's re-entry reads to decide what happened.
	assert.deepEqual(
		events.filter((event) => event.kind === "run.lifecycle-changed").map((event) => event.payload.lifecycle),
		[],
	);
	assert.equal(events.some((event) => event.kind === "run.ended"), false);
	assert.equal(store.readRun(answered.report.run).lifecycle, "preflight");
});

test("a lease stolen before the run exists reports no phantom run and still exits 6", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const timers = manualTimers();

	// A second connection to the same store, standing by to adopt the lapsed row.
	const thief = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	t.after(() => thief.close());

	// The theft lands between the acquisition and `run.started`: the first now()
	// call stamps the acquisition, the second is the run loop's own start-of-run
	// stamp, taken before the entry is decided — so no run record exists yet when
	// this controller next proves its ownership. The assertions below hold the
	// timing honest: no `run.started` may have been written.
	let calls = 0;
	const answered = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		args: ["42"],
		flags: new Set([FOREGROUND_FLAG]),
		timers: timers.api,
		now: () => {
			calls += 1;
			if (calls === 2) {
				openLeases(thief, { now: () => FIXED_NOW + CONTROLLER_LEASE_TTL_MS + 1 }).acquire({
					name: "controller",
					identity: leaseIdentity({ pid: 5151, pane: "w1:p9" }),
				});
			}
			return FIXED_NOW;
		},
		herdr: AVAILABLE,
	});

	assert.equal(answered.exitCode, 6);
	assert.equal(answered.report.run, null, "the report named a run whose run.started was never written");
	assert.equal(answered.report.lifecycle, null);
	assert.equal(answered.report.end_reason, null);

	const store = await storeOf(t, context);
	assert.equal(store.readEvents({ kind: "run.started" }).length, 0, "the theft landed too late to exercise the case");
	const losses = store.readEvents({ kind: "controller.lease-lost" });
	assert.equal(losses.length, 1);
	assert.equal(losses[0].run, null, "the loss event named a phantom run");
});

// ── Recovery and re-entry (§10.4) ────────────────────────────────────────────

test("a restart re-enters an orphaned run, keeping its run id and its scope", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context, { tickets: [42] });

	const { exitCode, value } = await runCli(["start", "--foreground"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, orphan, "re-entry minted a second run id for one delivery");
	assert.equal(value.report.entry.mode, ENTRY_MODES.adopted);
	assert.deepEqual(value.report.scope.tickets, [42]);
});

test("a re-entered run preflights again before it runs", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context);

	await runCli(["start", "--foreground"], context);

	const store = await storeOf(t, context);
	const [first] = store.readEvents({ stream: runStream(orphan) }).filter((e) => e.kind === "run.lifecycle-changed");
	assert.equal(first.payload.lifecycle, "preflight");
});

test("--new-run opens a fresh run and ends the abandoned one as controller-lost", async (t) => {
	const context = invocation(t);
	const orphan = await orphanRun(context);

	const { exitCode, value } = await runCli(["start", "--foreground", "--new-run", "43"], context);

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

	const { exitCode, value } = await runCli(["start", "--foreground", "--new-run", "43"], context);

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

	const { exitCode, value } = await runCli(["start", "--foreground", "43"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "scope-immutable");
	assert.equal(value.error.run, orphan);
	assert.match(value.error.message, /--new-run/);
});

test("a start with no scope and nothing to re-enter refuses as usage", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "--foreground"], context);

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "scope-required");
});

test("a scope argument that is not an issue number refuses before anything opens", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "--foreground", "the-auth-work"], context);

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

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, live);
	assert.equal(value.report.queued, false, "start queued behind a live run");
	assert.match(value.message, /already in scope/);
	assert.match(value.message, /frontier/);
});

test("a ticket outside the live run's scope refuses, naming the live run and its pane", async (t) => {
	const context = invocation(t);
	const live = await liveRun(t, context, { scope: { kind: "direct-ticket", tickets: [40] } });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "run-out-of-scope");
	assert.equal(value.error.run, live);
	assert.equal(value.error.pane, "w1:p3");
});

test("a live run does not open a second one, whatever the answer was", async (t) => {
	const context = invocation(t);
	await liveRun(t, context, { scope: { kind: "direct-ticket", tickets: [40] } });

	await runCli(["start", "--foreground", "42"], context);
	await runCli(["start", "--foreground", "40"], context);

	const store = await storeOf(t, context);
	assert.equal(store.readUnendedRuns().length, 1);
});

test("membership the tracker alone could decide refuses rather than promising a frontier", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(t, context, { scope: { kind: "parent-scoped", parent: 75 } });

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "scope-unresolvable");
	assert.match(value.error.missing, /#100/);
});

test("a parent-scoped start against the same live parent is in scope", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(t, context, { scope: { kind: "parent-scoped", parent: 75 } });

	const { exitCode, value } = await runCli(["start", "--foreground", "--parent", "75"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, runId);
});

// ── The run manifest (§6.8) ──────────────────────────────────────────────────

test("the run manifest records the declared per-run overrides as evidence", async (t) => {
	const config = cloneValidConfig();
	config.budgets = { repair: 2 };
	const context = invocation(t, { config });

	const { value } = await runCli(["start", "--foreground", "42"], context);

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

	// §6.8's other channels, as the worker config environment promoted them. A
	// config declaring none records none — an empty declaration, which is a
	// different fact from the environment failing to build.
	assert.deepEqual(manifest.overrides.extra_denies, { declared: [] });
	assert.deepEqual(manifest.overrides.pi_extensions, { declared: [] });
	assert.deepEqual(manifest.overrides.worker_context_file, { declared: null, digest: null, installed_as: [] });

	// Where the workers ran is evidence of isolation, not an override, and sits
	// beside them rather than among them.
	assert.match(manifest.worker_environment.claude, /worker-config\/claude$/);
});

test("a declared worker-context file and extra denies reach the manifest as evidence", async (t) => {
	const config = cloneValidConfig();
	config.worker = { denies: ["Bash(curl:*)"], contextFile: "docs/worker-context.md" };
	const context = invocation(t, { config });
	mkdirSync(join(context.cwd, "docs"), { recursive: true });
	writeFileSync(join(context.cwd, "docs", "worker-context.md"), "capture whole output with tee\n");

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const store = await storeOf(t, context);
	const manifest = JSON.parse(readArtifact(store, value.report.manifest).toString("utf8"));

	assert.deepEqual(manifest.overrides.extra_denies, { declared: ["Bash(curl:*)"] });
	assert.equal(manifest.overrides.worker_context_file.declared, "docs/worker-context.md");
	assert.match(manifest.overrides.worker_context_file.digest, /^[0-9a-f]{64}$/);
});

test("a declared worker-context file that is not there fails preflight rather than reaching nobody", async (t) => {
	const config = cloneValidConfig();
	config.worker = { contextFile: "docs/absent.md" };
	const context = invocation(t, { config });

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const isolation = value.report.preflight.checks.find((check) => check.check === "worker-isolation");
	assert.equal(isolation.result, "failed");
	assert.equal(isolation.detail.reason, "config-environment-invalid");
	assert.ok(value.report.preflight.red.includes("worker-isolation"));
});

test("a config that declares no budgets records no budget override", async (t) => {
	const config = cloneValidConfig();
	delete config.budgets;
	const context = invocation(t, { config });

	const { value } = await runCli(["start", "--foreground", "42"], context);

	const store = await storeOf(t, context);
	const manifest = JSON.parse(readArtifact(store, value.report.manifest).toString("utf8"));

	assert.deepEqual(manifest.overrides.budgets, {});
});

test("the manifest is keyed by the run, so one run has exactly one set of declared inputs", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

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

	const { exitCode, value } = await runCli(["start", "--foreground"], context);

	assert.equal(value.report.run, orphan, "the run was not re-entered at all");
	assert.equal(exitCode, 2);
	assert.equal(value.report.end_reason, "baseline-red");
	assert.deepEqual(value.report.preflight.red, ["run-manifest"]);

	const check = value.report.preflight.checks.find((candidate) => candidate.check === "run-manifest");
	assert.equal(check.detail.reason, "effect-payload-conflict");
	assert.match(check.message, /--new-run/);
});

// ── §9's capacity and the scheduler loop, from the run's own side ─────────────

test("the run reports the declared ceiling and the effective concurrency beside its execution", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(value.report.capacity.declared_ceiling, 1);
	assert.equal(value.report.capacity.effective_concurrency, 1);
	assert.deepEqual(value.report.capacity.classes, [
		{ class: "local", size: 1, held: 0, waiting: 0, superseded: 0 },
	]);
	assert.deepEqual(value.report.capacity.holders, [], "§15 case 5: no capacity row survives the run");
});

test("a run claims its frontier in ascending order and leaves no slot held", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const executed = [];

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		herdr: context.herdr,
		args: ["42"],
		flags: new Set([FOREGROUND_FLAG]),
		frontier: async () => ({
			claimable: [42, 91],
			members: [
				{ ticket: 42, labels: ["workflow:implement"] },
				{ ticket: 91, labels: ["workflow:implement"] },
			],
		}),
		execute: ({ ticket, slots }) => {
			executed.push({ ticket, ticketSlot: slots.ticket.name, modelSlot: slots.model.name });
			return { disposition: "published" };
		},
	});

	assert.deepEqual(
		executed.map((lane) => lane.ticket),
		[42, 91],
		"§3.2's ascending issue number, and nothing else",
	);
	assert.deepEqual(executed[0], {
		ticket: 42,
		ticketSlot: "capacity:ticket:0",
		modelSlot: "capacity:model:local:0",
	});
	assert.equal(answer.report.execution.claimed, 2);
	assert.deepEqual(
		answer.report.execution.members.map((member) => [member.ticket, member.disposition]),
		[
			[42, "published"],
			[91, "published"],
		],
	);
	assert.deepEqual(answer.report.capacity.holders, [], "§15 case 5, through the whole run");
});

test("a stop honoured at a ticket boundary stops the loop claiming, and the run still ends with one reason", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const executed = [];

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		herdr: context.herdr,
		args: ["42"],
		flags: new Set([FOREGROUND_FLAG]),
		frontier: async () => ({
			claimable: [42, 91],
			members: [
				{ ticket: 42, labels: [] },
				{ ticket: 91, labels: [] },
			],
		}),
		execute: async ({ ticket }) => {
			executed.push(ticket);
			// The operator asks, from another terminal, while this lane runs.
			await runStop({ repoRoot: context.cwd, agentDir: context.agentDir });
			return { disposition: "published" };
		},
	});

	assert.deepEqual(executed, [42], "§9.6: draining is not claiming, and the in-flight lane still finished");
	assert.equal(answer.report.end_reason, "stopped-by-operator");
	assert.equal(answer.exitCode, exitCodeForEndReason("stopped-by-operator"));
	assert.equal(answer.report.execution.claimed, 1);
	assert.deepEqual(answer.report.capacity.holders, []);
});

/**
 * A lane that commits its disposition durably, as `ticketExecution` does — which
 * is what §8.6's terminal-commit order is an order *of*. An injected `execute`
 * stands in for the whole ticket execution, so it owes the same record.
 */
function committing(context, dispositions) {
	const executed = [];

	return {
		executed,
		execute: async ({ ticket }) => {
			executed.push(ticket);
			const settlement = dispositions.get(ticket);
			const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
			try {
				const run = store.readUnendedRuns().at(0).run_id;
				store.append(attemptLaunched(run, ticket, 1));
				store.append({
					kind: "ticket.disposition-changed",
					source: "controller",
					run,
					ticket,
					occurredAt: FIXED_NOW,
					observedAt: FIXED_NOW,
					payload: settlement,
				});
			} finally {
				store.close();
			}
			return { disposition: settlement.disposition };
		},
	};
}

const AUTOMATION_FAILURE = Object.freeze({
	disposition: "failed",
	reason_class: "automation-budget-exhausted",
	fault: "automation",
});

test("§8.6: two consecutive automation failures stop new claims and end the run at exit 5", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const lane = committing(
		context,
		new Map([
			[42, AUTOMATION_FAILURE],
			[91, AUTOMATION_FAILURE],
			[77, AUTOMATION_FAILURE],
		]),
	);

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		herdr: context.herdr,
		args: ["42", "91", "77"],
		flags: new Set([FOREGROUND_FLAG]),
		frontier: async () => ({
			claimable: [42, 91, 77],
			members: [42, 91, 77].map((ticket) => ({ ticket, labels: [] })),
		}),
		execute: lane.execute,
	});

	assert.deepEqual(lane.executed, [42, 91], "the third ticket is never claimed: five dying in preflight is not five tries");
	assert.equal(answer.report.end_reason, "circuit-breaker");
	assert.equal(answer.exitCode, 5);
	assert.equal(answer.exitCode, exitCodeForEndReason("circuit-breaker"));
	assert.deepEqual({ ...answer.report.circuit_breaker }, {
		tripped: true,
		consecutive: 2,
		threshold: 2,
		ticket: 91,
		unclassifiable: 0,
	});
	assert.equal(answer.report.lifecycle, "ended");
	assert.deepEqual(answer.report.capacity.holders, [], "§15 case 5 holds through a breaker exit too");

	// §10.3: draining covers an operator's stop and the breaker **identically**,
	// so the breaker exits through §3.5's report exactly as a stop does — one
	// report, one end reason, and the ticket it never reached still classified
	// rather than quietly absent.
	assert.equal(answer.report.execution.drained, false, "a scope with work left on it never reports as drained");
	assert.equal(answer.report.execution.claimed, 2);
	assert.deepEqual(
		answer.report.execution.members.map((member) => member.ticket).toSorted((left, right) => left - right),
		[42, 77, 91],
	);
});

test("§11.6: a declared `budgets.circuitBreaker` is the N the run actually trips at", async (t) => {
	const config = cloneValidConfig();
	config.budgets = { ...config.budgets, circuitBreaker: 1 };
	const context = invocation(t, { config });
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const lane = committing(context, new Map([[42, AUTOMATION_FAILURE], [91, AUTOMATION_FAILURE]]));

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		herdr: context.herdr,
		args: ["42", "91"],
		flags: new Set([FOREGROUND_FLAG]),
		frontier: async () => ({ claimable: [42, 91], members: [42, 91].map((ticket) => ({ ticket, labels: [] })) }),
		execute: lane.execute,
	});

	assert.deepEqual(lane.executed, [42], "an operator who declared no tolerance gets none");
	assert.equal(answer.report.end_reason, "circuit-breaker");
	assert.equal(answer.report.circuit_breaker.threshold, 1);
	assert.equal(answer.report.circuit_breaker.consecutive, 1);
});

test("§8.6: product-level failures interleaved among automation failures leave the run claiming", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const lane = committing(
		context,
		new Map([
			[42, AUTOMATION_FAILURE],
			// A worker that could not make the tests pass. §8.6: a verdict about the
			// work, and five of those is a productive run.
			[91, { disposition: "failed", reason_class: "repair-budget-exhausted", fault: "repair" }],
			[77, AUTOMATION_FAILURE],
		]),
	);

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		herdr: context.herdr,
		args: ["42", "91", "77"],
		flags: new Set([FOREGROUND_FLAG]),
		frontier: async () => ({
			claimable: [42, 91, 77],
			members: [42, 91, 77].map((ticket) => ({ ticket, labels: [] })),
		}),
		execute: lane.execute,
	});

	assert.deepEqual(lane.executed, [42, 91, 77], "§15 case 13: the scope drained, every ticket tried");
	assert.equal(answer.report.end_reason, "drained");
	assert.equal(answer.exitCode, 0);
	assert.equal(answer.report.circuit_breaker.tripped, false);
	assert.equal(answer.report.circuit_breaker.consecutive, 1);
});

test("§10.3: a run stopped by an operator says so, even with the breaker tripped underneath it", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });
	const lane = committing(context, new Map([[42, AUTOMATION_FAILURE], [91, AUTOMATION_FAILURE]]));

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		workerTransports: context.workerTransports,
		herdr: context.herdr,
		args: ["42", "91"],
		flags: new Set([FOREGROUND_FLAG]),
		frontier: async () => ({ claimable: [42, 91], members: [42, 91].map((ticket) => ({ ticket, labels: [] })) }),
		execute: async (request) => {
			const answered = await lane.execute(request);
			if (request.ticket === 91) await runStop({ repoRoot: context.cwd, agentDir: context.agentDir });
			return answered;
		},
	});

	// Both drain identically (§10.3); the reason carries the difference, and the
	// human who typed `stop` is told their stop was honoured.
	assert.equal(answer.report.end_reason, "stopped-by-operator");
	assert.equal(answer.report.circuit_breaker.tripped, true, "and the machine's own verdict is still on the report");
});
