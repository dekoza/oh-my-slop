import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { doctorReport } from "../../factory/lib/doctor/report.mjs";
import { requestEffect } from "../../factory/lib/effects/records.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { openRepoStoreReadOnly, openStore, openStoreReadOnly } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import {
	attemptLaunched,
	corruptDatabaseFile,
	FIXED_NOW,
	makeAgentDir,
	refusalOfAsync,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §10.5's `doctor`: the same reconciliation, computed and printed, plus what an
 * operator asking "why did this stop" needs beside it.
 *
 * **Under both modes it appends nothing to the journal and writes no
 * projection** (§14.24) — every test here is written against a read-only handle
 * for exactly that reason.
 */

const AT = FIXED_NOW + 200_000;

/** A repository with a store, a live run, and a package to hand the handshake. */
async function diagnosable(t, { effects = true } = {}) {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openStore({ repoRoot, agentDir });
	const run = newUlid();
	store.append(runStarted(run));

	if (effects) {
		store.append(attemptLaunched(run, 92));
		requestEffect(store, {
			run,
			ticket: 92,
			phase: "implement",
			attempt: `${run}-t92-a1`,
			operation: "agent-start",
			actor: "controller",
			fencingGeneration: 1,
			payload: { role: "implement" },
			at: FIXED_NOW,
		});
	}
	store.close();

	const root = makePackage(t);
	const reader = await openReader(t, { repoRoot, agentDir });

	return {
		repoRoot,
		agentDir,
		run,
		reader,
		context: {
			repoRoot,
			agentDir,
			executable: join(root, "factory", "bin", "factory.mjs"),
			env: { PATH: onPath(t, join(root, "factory", "bin", "factory.mjs")) },
			at: AT,
		},
	};
}

async function openReader(t, { repoRoot, agentDir }) {
	const reader = await openRepoStoreReadOnly({ repoRoot, agentDir });
	t.after(() => reader?.close());
	return reader;
}

test("doctor computes the reconciliation and appends nothing to the journal (§14.24)", async (t) => {
	const { reader, context, repoRoot, agentDir } = await diagnosable(t);
	const probes = createProbeRegistry();
	probes.register("herdr.pane-list", () => ({
		matched: false,
		foreignSourceId: "herdr:pane-7",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
	}));
	const headBefore = reader.head();
	const projectionsBefore = reader.projectionHeads();

	const report = await doctorReport(reader, { ...context, probes });

	assert.equal(report.reconcile.mode, "report");
	assert.equal(report.reconcile.entities[0].conclusion, "declared-dead");
	assert.deepEqual(reader.head(), headBefore, "doctor appended to the journal");
	assert.deepEqual(reader.projectionHeads(), projectionsBefore, "doctor wrote a projection");

	// And the same seen from a second, independent handle on the same file.
	const witness = openStoreReadOnly({ dbPath: reader.dbPath });
	t.after(() => witness.close());
	assert.deepEqual(witness.head(), headBefore);
	assert.equal(existsSync(join(agentDir, "software-factory")), true);
	assert.ok(repoRoot.length > 0);
});

test("the baseline is reported as of when it last ran, saying plainly it was not re-run", async (t) => {
	const { reader, context } = await diagnosable(t);

	const report = await doctorReport(reader, context);

	assert.equal(report.baseline.rerun, false);
	assert.match(report.baseline.message, /not re-run/i);
	assert.ok("as_of" in report.baseline && "base_commit" in report.baseline);
});

test("per-ticket budget counters are reported, naming the subsystem that will fill them", async (t) => {
	const { reader, context, run } = await diagnosable(t);

	const report = await doctorReport(reader, context);

	const ticket = report.counters.tickets.find((entry) => entry.ticket === 92);
	assert.equal(ticket.run, run);
	assert.equal(ticket.attempts, 1);
	for (const counter of ["repair", "fresh_retry", "automation"]) {
		assert.equal(ticket[counter], null, `${counter} is not a number this package can honestly report`);
	}
	assert.match(report.counters.missing, /#11[01]/);
});

test("the package handshake runs in report mode, and its findings are data", async (t) => {
	const { reader, context } = await diagnosable(t);

	const report = await doctorReport(reader, context);

	assert.equal(report.package.ok, true);
	assert.deepEqual(report.package.findings, []);
	assert.match(report.package.tree.digest, /^[0-9a-f]{64}$/);
});

test("a package that cannot be anchored is a section, not the end of the diagnosis", async (t) => {
	const { reader, context } = await diagnosable(t);

	const report = await doctorReport(reader, {
		...context,
		executable: join(makeAgentDir(t), "nowhere", "factory.mjs"),
	});

	assert.equal(report.package.ok, false);
	assert.equal(report.package.error.reason, "package-root-unresolvable");
	assert.ok(report.alarms.some((alarm) => alarm.reason === "package-unanchored"));
	assert.equal(report.reconcile.mode, "report", "one unreadable section took the whole diagnosis down");
	assert.equal(report.store.present, true);
});

test("monitor config health is advisory-only: a broken monitor never fails the factory", async (t) => {
	const { reader, context, repoRoot } = await diagnosable(t);
	writeFileSync(join(repoRoot, ".pi", "factory-monitor.json"), "{ not json", "utf8");
	chmodSync(join(repoRoot, ".pi", "factory-monitor.json"), 0o644);

	const report = await doctorReport(reader, context);

	assert.equal(report.monitor.present, true);
	assert.equal(report.monitor.readable, false);
	assert.equal(report.monitor.advisory, true);
	assert.deepEqual(
		report.alarms.filter((alarm) => alarm.reason.includes("monitor")),
		[],
		"a missing or broken monitor is never an alarm (§10.5)",
	);
});

test("legacy run artifacts are reported, and nothing is deleted", async (t) => {
	const { reader, context, repoRoot, agentDir } = await diagnosable(t);
	const worktree = join(repoRoot, ".worktrees", "factory-2026-01-01-ticket-1");
	mkdirSync(worktree, { recursive: true });
	const legacyRuns = join(agentDir, "software-factory", "runs");
	mkdirSync(legacyRuns, { recursive: true });
	writeFileSync(join(legacyRuns, "factory-1.json"), "{}", "utf8");

	const report = await doctorReport(reader, context);

	assert.deepEqual(report.legacy.worktrees, [worktree]);
	assert.equal(report.legacy.state_dirs.find((entry) => entry.path === legacyRuns).entries, 1);
	assert.ok(existsSync(worktree) && existsSync(legacyRuns), "doctor deleted a legacy artifact");
});

test("a run pinned by an effect nothing can settle is what doctor shouts about (§12.4)", async (t) => {
	const { reader, context, run } = await diagnosable(t);

	const report = await doctorReport(reader, context);

	const pin = report.pins.find((entry) => entry.run === run);
	assert.equal(pin.unresolved, 1);
	assert.equal(pin.unsettleable, 1, "no probe implements the read, so nothing can settle it");
	assert.equal(pin.oldest_requested_at, FIXED_NOW);
	assert.ok(report.alarms.some((alarm) => alarm.reason === "unresolved-effect-pin"));
	assert.equal(report.ok, false);
});

test("a quarantined journal stays loud in doctor, however many times it restarts (§4.7)", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openStore({ repoRoot, agentDir });
	store.append(runStarted(newUlid()));
	const dbPath = store.dbPath;
	store.close();
	corruptDatabaseFile(dbPath);

	// §4.7 refuses to start exactly once: this open quarantines the damaged file
	// and leaves a fresh store carrying the record. Every later open succeeds.
	await refusalOfAsync(() => openStore({ repoRoot, agentDir }));
	const reopened = await openStore({ repoRoot, agentDir });
	reopened.close();

	const root = makePackage(t);
	const reader = await openReader(t, { repoRoot, agentDir });
	const report = await doctorReport(reader, {
		repoRoot,
		agentDir,
		executable: join(root, "factory", "bin", "factory.mjs"),
		env: { PATH: onPath(t, join(root, "factory", "bin", "factory.mjs")) },
		at: AT,
	});

	assert.equal(report.integrity.failures.length, 1);
	assert.match(report.integrity.failures[0].quarantine_path, /quarantine/);
	assert.ok(report.alarms.some((entry) => entry.reason === "journal-integrity-failed"));
	assert.equal(report.ok, false);
});

test("a repository the factory has never run in still gets an answer", async (t) => {
	const repoRoot = makeRepo(t);
	const agentDir = makeAgentDir(t);
	const root = makePackage(t);

	const report = await doctorReport(null, {
		repoRoot,
		agentDir,
		executable: join(root, "factory", "bin", "factory.mjs"),
		env: { PATH: onPath(t, join(root, "factory", "bin", "factory.mjs")) },
		at: AT,
	});

	assert.equal(report.store.present, false);
	assert.equal(report.reconcile, null);
	assert.equal(report.package.ok, true, "the package is diagnosable without any run history");
	assert.equal(report.ok, true);
});
