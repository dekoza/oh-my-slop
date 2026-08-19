import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { probeArtifactBlob, writeArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import { executeCleanup } from "../../factory/lib/cleanup/execute.mjs";
import { planCleanup } from "../../factory/lib/cleanup/plan.mjs";
import { CLEANUP_KINDS, DEFAULT_CLEANUP_KINDS } from "../../factory/lib/cleanup/targets.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { runGit } from "../../factory/lib/git/clone.mjs";
import { CONTROLLER_STREAM } from "../../factory/lib/state/events.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { workedAttempt } from "./helpers/factory-git.mjs";
import { FIXED_NOW, manualTimers, refusalOf, runEnded } from "./helpers/factory-store.mjs";

/**
 * §12.8's execute half, and §14.25's two nevers: **never without the controller
 * lease, and never on a plan whose re-derived digest differs.**
 */

const AT = FIXED_NOW + 1_000_000;
const SCOPE = Object.freeze({ run: null, kinds: DEFAULT_CLEANUP_KINDS });

/** Herdr, answering with exactly the panes a test says exist, and recording closes. */
function herdrWith(panes) {
	const closed = [];
	const control = {
		panes: async () => Object.freeze({ ok: true, panes: Object.freeze([...panes]) }),
		panesTokened: async ({ token, value }) =>
			Object.freeze({ ok: true, panes: [...panes].filter((pane) => pane.tokens?.[token] === value) }),
	};
	const reclaimer = {
		close: async (pane) => {
			closed.push(pane);
			const index = panes.findIndex((entry) => entry.pane_id === pane);
			if (index !== -1) panes.splice(index, 1);
			return Object.freeze({ ok: true, pane });
		},
	};
	return { control, reclaimer, closed, panes };
}

/** A store whose controller holds the lease and has reconciled. */
function held(store) {
	const leases = openLeases(store, { now: () => AT });
	const hold = holdControllerLease({ store, leases, timers: manualTimers().api });
	hold.recordStartupReconcile();
	return hold;
}

/** An attempt that finished, in a run that ended: the state cleanup is about. */
function settle(fixture, { outcome = "completed" } = {}) {
	fixture.store.append({
		kind: "attempt.ended",
		source: "controller",
		run: fixture.run,
		ticket: fixture.ticket,
		phase: "implement",
		attempt: fixture.attempt,
		occurredAt: FIXED_NOW + 10,
		observedAt: FIXED_NOW + 10,
		payload: { outcome },
	});
	fixture.store.append(runEnded(fixture.run, { at: FIXED_NOW + 20 }));
	return fixture;
}

test("the plan's targets are deleted, and each deletion is a §4.5 pair on the controller stream", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const herdr = herdrWith([{ pane_id: "w1:p1", tokens: { FACTORY_ATTEMPT: fixture.attempt } }]);
	const hold = held(fixture.store);

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdr.control, at: AT });
	const report = await executeCleanup(fixture.store, {
		hold,
		scope: SCOPE,
		digest: plan.digest,
		herdr: herdr.control,
		panes: herdr.reclaimer,
		at: AT,
	});

	assert.deepEqual(new Set(report.performed.map((entry) => entry.kind)), new Set(["attempt-worktree", "attempt-branch", "worker-pane"]));
	assert.equal(existsSync(fixture.worktreePath), false, "the worktree survived");
	assert.deepEqual(herdr.closed, ["w1:p1"]);
	assert.equal(
		execFileSync("git", ["-C", fixture.clone.dir, "branch", "--list", fixture.branch], { encoding: "utf8" }).trim(),
		"",
	);

	// §12.8: cleanup's own actions land on the controller stream, so they outlive
	// the expiry of the very runs whose reclamation they document.
	const records = fixture.store
		.readEvents({ stream: CONTROLLER_STREAM })
		.filter((event) => event.kind.startsWith("effect."));
	assert.equal(records.length, 6, "three targets, requested and resolved");
	assert.ok(records.every((event) => event.run === null && event.phase === "cleanup"));
	assert.ok(records.every((event) => event.source === "operator"));
	assert.deepEqual(unresolvedEffects(fixture.store), []);
});

test("a plan whose digest no longer matches deletes nothing (§14.25, §10.5)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const hold = held(fixture.store);
	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]).control, at: AT });

	// The operator's own work, arriving between reviewing the plan and running it
	// — which is the entire window this comparison exists to cover.
	writeFileSync(join(fixture.worktreePath, "half-a-thought.md"), "mine\n", "utf8");

	const error = await refusalOfAsync(() =>
		executeCleanup(fixture.store, {
			hold,
			scope: SCOPE,
			digest: plan.digest,
			herdr: herdrWith([]).control,
			at: AT,
		}),
	);

	assert.equal(error.reason, "cleanup-plan-stale");
	assert.equal(error.details.expected, plan.digest);
	assert.match(error.message, /Nothing was deleted/);
	assert.ok(existsSync(fixture.worktreePath), "the worktree was deleted on a stale plan");
	assert.equal(fixture.store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM effect WHERE phase = 'cleanup'").get().n), 0);
});

test("the worktree deletion is issued without `--force`, so git applies the guard again (§14.26)", async (t) => {
	// The plan's untracked-work guard and `git worktree remove`'s own are the
	// same guard at two moments, and the second one covers the window the digest
	// comparison is measured across: work arriving after the re-derivation and
	// before the deletion. It only covers it while the command carries no force,
	// which is a property of the argv rather than of any behaviour a green
	// deletion can show.
	const fixture = settle(await workedAttempt(t));
	const hold = held(fixture.store);
	const scope = { run: null, kinds: [CLEANUP_KINDS.attemptWorktree] };
	const plan = await planCleanup(fixture.store, { scope, herdr: herdrWith([]).control, at: AT });

	const issued = [];
	const watched = async (args, options) => {
		issued.push(args);
		return runGit(args, options);
	};

	await executeCleanup(fixture.store, { hold, scope, digest: plan.digest, herdr: herdrWith([]).control, git: watched, at: AT });

	const removal = issued.find((args) => args[0] === "worktree" && args[1] === "remove");
	assert.deepEqual(removal, ["worktree", "remove", fixture.worktreePath]);
	assert.equal(issued.flat().includes("--force"), false);
	assert.equal(existsSync(fixture.worktreePath), false);
});

test("a worktree that grew work after the re-derivation is refused by git, and reported (§14.26)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const hold = held(fixture.store);
	const scope = { run: null, kinds: [CLEANUP_KINDS.attemptWorktree] };
	const plan = await planCleanup(fixture.store, { scope, herdr: herdrWith([]).control, at: AT });

	// The file lands after the plan is re-derived and before the deletion runs —
	// the window nothing but git's own refusal can cover.
	const racing = async (args, options) => {
		if (args[0] === "worktree" && args[1] === "remove") {
			writeFileSync(join(fixture.worktreePath, "arrived.md"), "an operator's half-thought\n", "utf8");
		}
		return runGit(args, options);
	};

	const report = await executeCleanup(fixture.store, {
		hold,
		scope,
		digest: plan.digest,
		herdr: herdrWith([]).control,
		git: racing,
		at: AT,
	});

	assert.deepEqual(report.performed, []);
	assert.equal(report.refused[0].kind, CLEANUP_KINDS.attemptWorktree);
	assert.match(report.refused[0].message, /was not reclaimed/);
	assert.ok(existsSync(join(fixture.worktreePath, "arrived.md")), "the operator's file was deleted");
	assert.deepEqual(
		unresolvedEffects(fixture.store).map((effect) => effect.operation),
		["worktree-delete"],
	);
});

test("a lost lease stops the execution before it reads anything (§14.6, §14.25)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const hold = held(fixture.store);
	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]).control, at: AT });

	// A second controller adopts the repository, exactly as a lapsed lease is
	// adopted in production.
	fixture.store.read((db) => db.prepare("UPDATE lease SET holder_token = 'somebody-else' WHERE name = 'controller'").run());
	hold.renew();

	const error = await refusalOfAsync(() =>
		executeCleanup(fixture.store, { hold, scope: SCOPE, digest: plan.digest, herdr: herdrWith([]).control, at: AT }),
	);

	assert.equal(error.reason, "lease-lost");
	assert.ok(existsSync(fixture.worktreePath));
});

test("a pane id recycled during the execution is not closed — the close is keyed on the token (§12.8, §14.27)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const herdr = herdrWith([{ pane_id: "w1:p1", tokens: { FACTORY_ATTEMPT: fixture.attempt } }]);
	const hold = held(fixture.store);
	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdr.control, at: AT });

	// Herdr reuses pane ids. Between the plan's re-derivation and this pane being
	// closed lies the execution of every earlier target — a window the digest
	// comparison cannot cover — and in it `w1:p1` became somebody else's. The
	// close asks *which panes carry this token*, never *is `w1:p1` still ours*,
	// so the pane the factory did not stamp is not something it can reach.
	const report = await executeCleanup(fixture.store, {
		hold,
		scope: SCOPE,
		digest: plan.digest,
		herdr: {
			// The re-derivation sees the pane list unchanged, so the digest matches
			// and the execution proceeds to the close.
			panes: herdr.control.panes,
			panesTokened: async () => Object.freeze({ ok: true, panes: [] }),
		},
		panes: herdr.reclaimer,
		at: AT,
	});

	assert.deepEqual(herdr.closed, [], "a pane carrying somebody else's work was closed");

	// The pane the plan named is gone as far as the token is concerned, which is
	// what `pane-delete`'s `absent` probe asks — so the effect resolves rather
	// than pinning its run forever, and the rest of the plan ran.
	const pane = report.performed.find((entry) => entry.kind === CLEANUP_KINDS.workerPane);
	assert.equal(pane.result.present, false);
	assert.equal(pane.result.closed, false);
	assert.ok(report.performed.some((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree));
	assert.deepEqual(unresolvedEffects(fixture.store), []);
});

test("a multiplexer that will not answer refuses the close and leaves the effect for reconcile (§5.2)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const herdr = herdrWith([{ pane_id: "w1:p1", tokens: { FACTORY_ATTEMPT: fixture.attempt } }]);
	const hold = held(fixture.store);
	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdr.control, at: AT });

	const report = await executeCleanup(fixture.store, {
		hold,
		scope: SCOPE,
		digest: plan.digest,
		herdr: {
			panes: herdr.control.panes,
			// "Unanswerable" is not "absent" (§12.4): a pane whose fate this process
			// could not read must not be recorded as reclaimed.
			panesTokened: async () => Object.freeze({ ok: false, message: "Herdr refused `pane list` (exit 1)." }),
		},
		panes: herdr.reclaimer,
		at: AT,
	});

	assert.deepEqual(herdr.closed, []);
	assert.equal(report.refused[0].kind, CLEANUP_KINDS.workerPane);
	assert.match(report.refused[0].message, /Herdr refused/);
	assert.ok(report.performed.some((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree), "the rest of the plan was abandoned");

	// The refused target's effect stays `requested`, which is exactly the state
	// the next reconcile re-probes — no resume logic anywhere (§12.8).
	assert.deepEqual(
		unresolvedEffects(fixture.store).map((effect) => effect.operation),
		["pane-delete"],
	);
});

test("an orphaned blob is unlinked and its deletion recorded as an effect (§12.8)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const orphan = writeArtifactBlob(fixture.store.storeDir, "bytes a crash left behind");
	const hold = held(fixture.store);

	const scope = { run: null, kinds: [CLEANUP_KINDS.orphanedBlob] };
	const plan = await planCleanup(fixture.store, { scope, herdr: herdrWith([]).control, at: AT });
	const report = await executeCleanup(fixture.store, {
		hold,
		scope,
		digest: plan.digest,
		herdr: herdrWith([]).control,
		at: AT,
	});

	assert.deepEqual(report.performed.map((entry) => entry.kind), [CLEANUP_KINDS.orphanedBlob]);
	assert.equal(report.reclaimed_bytes, orphan.bytes);
	assert.equal(probeArtifactBlob(fixture.store.storeDir, orphan).present, false);

	const [record] = cleanupRequests(fixture.store);
	assert.equal(record.payload.effect_key, `-/-/cleanup/-/artifact-delete/sha256/${orphan.digest}`);
	assert.equal(record.payload.actor, "operator:cleanup-execute");
});

test("re-executing a settled plan performs nothing twice — the pair is the idempotency (§4.5)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const orphan = writeArtifactBlob(fixture.store.storeDir, "bytes a crash left behind");
	const hold = held(fixture.store);
	const scope = { run: null, kinds: [CLEANUP_KINDS.orphanedBlob] };

	const plan = await planCleanup(fixture.store, { scope, herdr: herdrWith([]).control, at: AT });
	await executeCleanup(fixture.store, { hold, scope, digest: plan.digest, herdr: herdrWith([]).control, at: AT });

	// The blob is gone, so the re-derived plan is empty and the digest differs —
	// a settled plan is not a plan any more, which is the honest answer.
	const again = await planCleanup(fixture.store, { scope, herdr: herdrWith([]).control, at: AT });
	assert.deepEqual(again.targets, []);
	assert.notEqual(again.digest, plan.digest);

	// And executing the *empty* plan is a no-op rather than a second deletion.
	const report = await executeCleanup(fixture.store, { hold, scope, digest: again.digest, herdr: herdrWith([]).control, at: AT });
	assert.deepEqual(report.performed, []);
	assert.equal(cleanupRequests(fixture.store).length, 1);
	assert.equal(orphan.written, true);
});

/** Only cleanup's own effect requests; the fixture's attempt made several of its own. */
function cleanupRequests(store) {
	return store
		.readEvents({ kind: "effect.requested" })
		.filter((event) => event.phase === "cleanup");
}

/** The refusal an async call was expected to make. */
async function refusalOfAsync(body) {
	try {
		await body();
	} catch (error) {
		return error;
	}
	return refusalOf(() => {
		throw new Error("expected a refusal");
	});
}
