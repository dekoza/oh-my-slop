import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { writeArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { CONTROLLER_LEASE } from "../../factory/lib/domain/vocabulary.mjs";
import { DAY_MS } from "../../factory/lib/retention/horizon.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { cloneValidConfig, makeRepo } from "./helpers/factory-repo.mjs";
import { attemptLaunched, FIXED_NOW, herdrAnswering, leaseIdentity, makeAgentDir, runEnded, runStarted } from "./helpers/factory-store.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";

/**
 * §12.8's pair on the operator's side: **`cleanup-plan` is read-only and always
 * permitted; `cleanup-execute` requires the controller lease** (§10.5, §14.25).
 */

/** Herdr, present but with nothing running in it. */
const NO_PANES = async () => ({ exitCode: 0, stdout: JSON.stringify({ result: { panes: [] } }), stderr: "" });

function invocation(t, { retention } = {}) {
	return {
		cwd: makeRepo(t, { config: retention === undefined ? undefined : { ...cloneValidConfig(), retention } }),
		agentDir: makeAgentDir(t),
		env: {},
		herdr: herdrAnswering(),
		runHerdr: NO_PANES,
	};
}

// ── The surface (§14.26) ─────────────────────────────────────────────────────

test("neither verb accepts a --force, and --help never offers one", async (t) => {
	const context = invocation(t);

	for (const verb of ["cleanup-plan", "cleanup-execute"]) {
		const { exitCode, value } = await runCli([verb, "--force"], context);
		assert.equal(exitCode, EXIT_USAGE, verb);
		assert.equal(value.error.flag, "--force");
	}

	const { value } = await runCli(["--help"], context);
	assert.deepEqual(value.usage.flags["cleanup-plan"], ["--run=<run id>", "--kind=<target kind>"]);
	assert.equal(JSON.stringify(value.usage).includes("force"), false);
});

test("a narrowing flag takes its value on the flag, and the bare form says so", async (t) => {
	const context = invocation(t);

	const bare = await runCli(["cleanup-plan", "--run"], context);
	assert.equal(bare.exitCode, EXIT_USAGE);
	assert.match(bare.value.error.message, /--run=<run id>/);

	// And a boolean flag given a value is the same mistake in the other
	// direction, refused rather than silently ignored.
	const valued = await runCli(["doctor", "--baseline=yes"], context);
	assert.equal(valued.exitCode, EXIT_USAGE);
	assert.match(valued.value.error.message, /takes no value/);
});

test("a kind outside §12.8's whitelist is a usage refusal that names the whitelist", async (t) => {
	const { exitCode, value } = await runCli(["cleanup-plan", "--kind=worktrees"], invocation(t));

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "cleanup-kind-unknown");
	assert.match(value.error.expected, /attempt-worktree\|/);
});

// ── cleanup-plan is a read (§10.5) ───────────────────────────────────────────

test("cleanup-plan answers in a repository nothing has run in, and prints a digest to execute", async (t) => {
	const context = invocation(t);
	const { exitCode, value } = await runCli(["cleanup-plan"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.deepEqual(value.report.targets, []);
	assert.match(value.message, /nothing has run in this repository/);
});

test("cleanup-plan is permitted against a live lease-holder, which cleanup-execute is not (§10.5, §14.25)", async (t) => {
	const context = invocation(t);
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	openLeases(store).acquire({
		name: CONTROLLER_LEASE,
		identity: leaseIdentity({ run: "01JLIVERUN00000000000000AB", pane: "w4:p2" }),
	});
	store.close();

	const planned = await runCli(["cleanup-plan"], context);
	assert.equal(planned.exitCode, EXIT_OK, "a lock-free read refused");

	const executed = await runCli(["cleanup-execute", planned.value.report.digest], context);
	assert.equal(executed.exitCode, EXIT_REFUSED);
	assert.equal(executed.value.error.kind, "cleanup-lease-held");
	assert.match(executed.value.error.message, /01JLIVERUN00000000000000AB/);
	assert.match(executed.value.error.message, /w4:p2/);
});

// ── cleanup-execute (§12.6, §14.25) ──────────────────────────────────────────

test("cleanup-execute without a digest refuses: a plan nobody read is a plan nobody reviewed", async (t) => {
	const { exitCode, value } = await runCli(["cleanup-execute"], invocation(t));

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "cleanup-digest-required");
});

test("cleanup-execute refuses a digest that no longer matches, and deletes nothing (§14.25)", async (t) => {
	const context = invocation(t);
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	const orphan = writeArtifactBlob(store.storeDir, "bytes a crash left behind");
	store.close();

	const { exitCode, value } = await runCli(["cleanup-execute", "0".repeat(64)], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "cleanup-plan-stale");
	assert.match(value.error.message, /Nothing was deleted/);

	const reopened = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	assert.ok(existsSync(reopened.storeDir), "the store went with the refusal");
	reopened.close();
	assert.equal(orphan.written, true);
});

test("cleanup-execute reclaims the plan it was handed, and folds in §12.6's expiry path", async (t) => {
	// One run of count budget, so a second run ages the first out of tier 1: the
	// horizon is a **union**, and with a single run in the repository the count
	// half keeps it however old it is.
	const context = invocation(t, { retention: { fullDetailRuns: 1, fullDetailDays: 30 } });
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });

	const orphan = writeArtifactBlob(store.storeDir, "bytes a crash left behind");

	// A run far past the tier-1 horizon, with nothing pinning it: §12.6 folds an
	// expiry pass into `cleanup-execute` so an operator with no run to start can
	// still reclaim.
	const ancient = newUlid(FIXED_NOW - 60 * DAY_MS);
	store.append(runStarted(ancient, { at: FIXED_NOW - 60 * DAY_MS }));
	store.append(attemptLaunched(ancient, 90, 1, { at: FIXED_NOW - 60 * DAY_MS + 1000 }));
	store.append(runEnded(ancient, { at: FIXED_NOW - 60 * DAY_MS + 2000 }));

	const recent = newUlid(FIXED_NOW - DAY_MS);
	store.append(runStarted(recent, { at: FIXED_NOW - DAY_MS }));
	store.append(runEnded(recent, { at: FIXED_NOW - DAY_MS + 2000 }));
	store.close();

	const planned = await runCli(["cleanup-plan"], context);
	assert.deepEqual(planned.value.report.targets.map((entry) => entry.kind), ["orphaned-blob"]);

	const { exitCode, value } = await runCli(["cleanup-execute", planned.value.report.digest], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.cleanup.performed.length, 1);
	assert.equal(value.report.cleanup.reclaimed_bytes, orphan.bytes);
	assert.deepEqual(value.report.expiry.expired.map((entry) => entry.run), [ancient]);
	assert.match(value.message, /cleanup reclaimed 1 target/);
	assert.match(value.message, /expiry removed 1 run/);

	const reopened = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	assert.deepEqual(reopened.readEvents({ stream: runStream(ancient) }), []);
	reopened.close();
});

test("a narrowed plan is executed under the same narrowing, and the headline says which", async (t) => {
	const context = invocation(t);
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	writeArtifactBlob(store.storeDir, "bytes a crash left behind");
	store.close();

	const planned = await runCli(["cleanup-plan", "--kind=orphaned-blob"], context);
	assert.match(planned.value.message, /--kind=orphaned-blob/);

	// The same digest under a *different* narrowing is a different plan, and
	// §14.25 refuses it rather than executing something the operator never read.
	const wrong = await runCli(["cleanup-execute", planned.value.report.digest], context);
	assert.equal(wrong.exitCode, EXIT_REFUSED);
	assert.equal(wrong.value.error.kind, "cleanup-plan-stale");

	const right = await runCli(["cleanup-execute", planned.value.report.digest, "--kind=orphaned-blob"], context);
	assert.equal(right.exitCode, EXIT_OK);
	assert.equal(right.value.report.cleanup.performed.length, 1);
});
