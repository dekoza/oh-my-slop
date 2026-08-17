import assert from "node:assert/strict";
import test from "node:test";

import { NULL_SEGMENT } from "../../factory/lib/effects/keys.mjs";
import { effectByKey, unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { herdrWorkspaceListProbe } from "../../factory/lib/worker/probes.mjs";
import { openRunWorkspace, runWorkspaceKey, runWorkspaceLabel } from "../../factory/lib/worker/workspace.mjs";
import { fakeHerdr } from "./helpers/factory-worker.mjs";
import { FIXED_NOW, manualTimers, openTestStore, refusalOfAsync, runStarted } from "./helpers/factory-store.mjs";

/**
 * #156: **one workspace per run, and every attempt a tab inside it.**
 *
 * The workspace list is the operator's top-level navigation, so a workspace per
 * attempt spent the one resource this topology is supposed to conserve. What
 * makes the run's workspace exactly one is §4.5's key: it names the run and
 * nothing below it, so the second attempt to ask, and every controller that
 * re-enters the run afterwards, is handed the committed answer instead of
 * opening a second one.
 */

/** A store with a run open and a controller holding the lease. */
async function opened(t, { herdr = fakeHerdr() } = {}) {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: manualTimers().api });
	const started = runStarted();

	store.append(started);
	hold.recordStartupReconcile();
	hold.adopt(started.run);

	return {
		store,
		hold,
		herdr,
		run: started.run,
		open: () =>
			openRunWorkspace(store, {
				hold,
				run: started.run,
				herdr: herdr.control,
				cwd: store.storeDir,
				actor: "controller",
				at: FIXED_NOW,
			}),
	};
}

test("a run opens exactly one workspace, however many attempts ask for it", async (t) => {
	const context = await opened(t);

	const first = await context.open();
	const second = await context.open();

	assert.equal(second.workspace, first.workspace);
	assert.equal(
		context.herdr.commands().filter((command) => command === "workspace create").length,
		1,
		"the committed effect answers the second asker; Herdr is never asked twice",
	);
	assert.equal(second.outcome, "already-resolved");
});

test("a resumed controller re-enters its run's workspace rather than opening a second one (§5.5, §10.4)", async (t) => {
	const context = await opened(t);
	const first = await context.open();

	// The next controller invocation: this one gave the lease up, and its
	// successor acquires under a generation above the one that opened the
	// workspace.
	context.hold.release();
	const successor = holdControllerLease({
		store: context.store,
		leases: openLeases(context.store, { now: () => FIXED_NOW + 1 }),
		timers: manualTimers().api,
	});
	successor.recordStartupReconcile();
	successor.adopt(context.run);

	const resumed = await openRunWorkspace(context.store, {
		hold: successor,
		run: context.run,
		herdr: context.herdr.control,
		cwd: context.store.storeDir,
		actor: "controller",
		at: FIXED_NOW + 1,
	});

	assert.equal(resumed.workspace, first.workspace);
	assert.equal(context.herdr.commands().filter((command) => command === "workspace create").length, 1);
});

test("the run's workspace asks nothing of the controller's own terminal (§10.1)", async (t) => {
	const context = await opened(t);

	await context.open();

	const created = context.herdr.calls.find((args) => args.slice(0, 2).join(" ") === "workspace create");
	// A `--foreground` start may run in a terminal that is not a Herdr pane at
	// all, so the run's workspace names no pane to split and no tab to attach to.
	for (const argument of ["--pane", "--tab", "--parent", "--split"]) {
		assert.equal(created.includes(argument), false, `${argument} would tie the topology to the controller's terminal`);
	}
});

test("the workspace effect is keyed by the run alone, with no ticket and no attempt", async (t) => {
	const context = await opened(t);

	const answer = await context.open();

	assert.equal(answer.key, runWorkspaceKey(context.run));
	assert.deepEqual(answer.key.split("/").slice(0, 5), [
		context.run,
		NULL_SEGMENT,
		"preflight",
		NULL_SEGMENT,
		"workspace-open",
	]);
	const row = effectByKey(context.store, answer.key);
	assert.equal(row.state, "resolved");
	assert.deepEqual(row.result, { workspace: answer.workspace, label: runWorkspaceLabel(context.run) });
});

test("the label is derived from the run, which is the only handle a probe has on it", async (t) => {
	const context = await opened(t);

	const answer = await context.open();

	assert.equal(answer.label, runWorkspaceLabel(context.run));
	assert.match(runWorkspaceLabel(context.run), new RegExp(`${context.run}$`));
	assert.notEqual(runWorkspaceLabel(context.run), runWorkspaceLabel("01OTHERRUN"));
});

test("a Herdr that refuses the workspace is a typed automation failure, and nothing is recorded as done", async (t) => {
	const context = await opened(t, {
		herdr: fakeHerdr({ refuse: { "workspace create": { exitCode: 1, stderr: "no server" } } }),
	});

	const refusal = await refusalOfAsync(() => context.open());

	assert.ok(refusal instanceof FactoryWorkerError);
	assert.equal(refusal.reason, "worker-launch-failed");
	assert.match(refusal.message, /no server/);
	assert.deepEqual(
		unresolvedEffects(context.store, { run: context.run }).map((effect) => effect.operation),
		["workspace-open"],
		"the intent stands unresolved for reconcile to settle, never as a silent nothing",
	);
});

test("reconcile settles an unresolved open by the run's label, recovering the id nobody recorded", async (t) => {
	const herdr = fakeHerdr();
	const context = await opened(t, { herdr });

	// The crash §5.3 exists for: the workspace was created and the resolution
	// never committed, so the id is only in Herdr's own list.
	const created = await herdr.control.openWorkspace({
		cwd: "/state",
		label: runWorkspaceLabel(context.run),
	});
	const answer = await herdrWorkspaceListProbe({ herdr: herdr.control })({
		effect: { effect_key: runWorkspaceKey(context.run), run_id: context.run },
		probe: { match: "present" },
	});

	assert.equal(answer.matched, true);
	assert.deepEqual(answer.result, { workspace: created.workspace, label: runWorkspaceLabel(context.run) });
	assert.match(answer.foreignSourceId, new RegExp(created.workspace));
});

test("a workspace the operator closed is answered `absent`, not invented", async (t) => {
	const herdr = fakeHerdr();
	const context = await opened(t);

	const answer = await herdrWorkspaceListProbe({ herdr: herdr.control })({
		effect: { effect_key: runWorkspaceKey(context.run), run_id: context.run },
		probe: { match: "present" },
	});

	assert.equal(answer.matched, false);
	assert.equal(answer.result, null);
});
