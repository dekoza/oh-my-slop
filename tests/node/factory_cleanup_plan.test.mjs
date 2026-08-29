import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import { recordArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { CLEANUP_KINDS, DEFAULT_CLEANUP_KINDS, PRIVATE_CLONE_KIND } from "../../factory/lib/cleanup/targets.mjs";
import { planCleanup } from "../../factory/lib/cleanup/plan.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { workedAttempt } from "./helpers/factory-git.mjs";
import { FIXED_NOW, runEnded } from "./helpers/factory-store.mjs";

/**
 * §12.8's derivation, exercised against a real clone, real worktrees, and real
 * refs — the guards it applies are statements about git and a filesystem, and
 * none of them is observable through a stub.
 */

const AT = FIXED_NOW + 1_000_000;
const SCOPE = Object.freeze({ run: null, kinds: DEFAULT_CLEANUP_KINDS });

/** Herdr, answering with exactly the panes a test says exist. */
function herdrWith(panes) {
	return {
		panes: async () => Object.freeze({ ok: true, panes: Object.freeze(panes) }),
		panesTokened: async ({ token, value }) =>
			Object.freeze({ ok: true, panes: panes.filter((pane) => pane.tokens?.[token] === value) }),
	};
}

/** A multiplexer that will not answer — which is not a multiplexer with no panes. */
const HERDR_SILENT = {
	panes: async () => Object.freeze({ ok: false, message: "Herdr refused `pane list` (exit 1)." }),
};

/** An attempt that finished, in a run that ended: the state cleanup is about. */
function settle(fixture, { outcome = "completed", endReason = "drained" } = {}) {
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
	fixture.store.append(runEnded(fixture.run, { at: FIXED_NOW + 20, endReason }));
	return fixture;
}

/**
 * The tracker's last word on a member ticket — §12.4's label pin reads it, and
 * only Gitea's issue snapshot establishes the `ticket.labels` fact class (§5.2).
 * Both halves of a real poll, because the pins read one of each.
 */
function observeLabels(fixture, labels) {
	const at = FIXED_NOW + 30;
	const { store, ticket } = fixture;

	store.transaction(({ db }) =>
		db
			.prepare(
				`INSERT INTO observed_issue(ticket, content_version, state, updated_at, observed_at, last_seq)
				 VALUES (?, NULL, 'open', ?, ?, 0)
				 ON CONFLICT(ticket) DO UPDATE SET updated_at = excluded.updated_at`,
			)
			.run(ticket, at, at),
	);
	store.append({
		kind: "observation.recorded",
		source: "gitea",
		run: fixture.run,
		ticket,
		occurredAt: at,
		observedAt: at,
		foreignSourceId: `gitea:issue:${ticket}@${at}`,
		payload: {
			fact_classes: ["ticket.state", "ticket.labels"],
			kind: "issue",
			foreign_id: `gitea:issue:${ticket}@${at}`,
			occurred_at_raw: new Date(at).toISOString(),
			observed: { ticket, state: "open", labels },
		},
	});
}

// ── The whitelist ────────────────────────────────────────────────────────────

test("a terminal attempt in an ended, unpinned run puts its worktree and branch in the plan (§12.8)", async (t) => {
	const fixture = settle(await workedAttempt(t));

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	const worktree = plan.targets.find((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree);
	assert.equal(worktree.subject, fixture.attempt);
	assert.equal(worktree.path, fixture.worktreePath);
	assert.equal(worktree.operation, "worktree-delete");
	assert.ok(worktree.bytes > 0, "the plan reports the bytes it would reclaim (§12.10)");

	const branch = plan.targets.find((entry) => entry.kind === CLEANUP_KINDS.attemptBranch);
	assert.equal(branch.subject, fixture.branch);
	assert.equal(branch.operation, "branch-delete");
});

test("nothing outside the factory's own namespaces is ever a candidate (§12.8, §14.11)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	// A branch an operator made in the private clone, and a worktree of it. The
	// planner never sees either: it enumerates `factory/` refs and the two
	// worktree roots, so a name outside them has no entry to be filtered out of.
	execFileSync("git", ["-C", fixture.clone.dir, "branch", "operators-own", fixture.head]);

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	assert.equal(
		plan.targets.some((entry) => String(entry.subject).includes("operators-own")),
		false,
	);
	assert.ok(plan.targets.every((entry) => entry.kind !== CLEANUP_KINDS.attemptBranch || entry.subject.startsWith("factory/")));
});

// ── The untracked-work guard (§14.26) ────────────────────────────────────────

test("a worktree with untracked files never enters the plan, and the skip names the counts (§14.26)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	writeFileSync(join(fixture.worktreePath, "notes.md"), "half a thought\n", "utf8");
	writeFileSync(join(fixture.worktreePath, "scratch.txt"), "another\n", "utf8");

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	assert.equal(
		plan.targets.some((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree),
		false,
		"the worktree entered the plan",
	);

	const skip = plan.skips.find((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree);
	assert.equal(skip.reason, "retained-uncommitted-work");
	assert.equal(skip.untracked, 2);
	assert.equal(skip.modified, 0);
	assert.match(skip.message, /^retained: .* — 2 untracked, 0 modified files$/);
});

test("a worktree with modified tracked files is retained, counted apart from untracked ones", async (t) => {
	const fixture = settle(await workedAttempt(t));
	writeFileSync(join(fixture.worktreePath, "worker.txt"), "changed after the attempt ended\n", "utf8");

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });
	const skip = plan.skips.find((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree);

	assert.equal(skip.untracked, 0);
	assert.equal(skip.modified, 1);
});

test("a branch whose worktree is retained is retained with it, for the worktree's reason", async (t) => {
	// Planning it would be planning a refusal — git will not delete a branch that
	// is checked out — and the honest reason is the worktree's, not git's.
	const fixture = settle(await workedAttempt(t));
	writeFileSync(join(fixture.worktreePath, "notes.md"), "half a thought\n", "utf8");

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });
	const skip = plan.skips.find((entry) => entry.kind === CLEANUP_KINDS.attemptBranch);

	assert.equal(skip.reason, "worktree-retained");
	assert.equal(
		plan.targets.some((entry) => entry.kind === CLEANUP_KINDS.attemptBranch),
		false,
	);
});

// ── Terminality, and the pins (§12.4, §12.8) ─────────────────────────────────

test("an attempt with no recorded outcome is never a target, however its pane looks (§12.8)", async (t) => {
	// The run ended without the attempt ending — the shape §9.6's abandon leaves.
	const fixture = await workedAttempt(t);
	fixture.store.append(runEnded(fixture.run, { at: FIXED_NOW + 20, endReason: "abandoned" }));

	const plan = await planCleanup(fixture.store, {
		scope: SCOPE,
		// A pane that is *gone* must not make an unfinished attempt reclaimable:
		// entries derive from terminality, never from pane liveness.
		herdr: herdrWith([]),
		at: AT,
	});

	assert.deepEqual(plan.targets.map((entry) => entry.kind), []);
	assert.ok(plan.skips.every((entry) => entry.reason === "live-attempt"));
});

test("a run that has not ended holds every one of its resources (§12.6)", async (t) => {
	const fixture = await workedAttempt(t);

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	assert.deepEqual(plan.targets, []);
	assert.deepEqual(plan.held, [{ run: fixture.run, reason: "live-run", pins: [] }]);
});

test("cleanup obeys expiry's pins: a `factory:failed` ticket holds the attempt's worktree (§12.4)", async (t) => {
	const fixture = settle(await workedAttempt(t), { outcome: "worker-failed", endReason: "drained" });
	observeLabels(fixture, [FACTORY_LABELS.failed]);

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	assert.deepEqual(plan.targets, []);
	assert.equal(plan.held.length, 1);
	assert.equal(plan.held[0].reason, "pinned");
	assert.deepEqual(plan.held[0].pins.map((pin) => pin.pin), ["attention-label"]);

	const skip = plan.skips.find((entry) => entry.kind === CLEANUP_KINDS.attemptWorktree);
	assert.equal(skip.reason, "pinned");
	assert.match(skip.message, /pinned by attention-label/);
});

// ── Panes (§14.27) ───────────────────────────────────────────────────────────

test("a pane carrying no factory token is never a target, under any circumstance (§14.27)", async (t) => {
	const fixture = settle(await workedAttempt(t));

	const plan = await planCleanup(fixture.store, {
		scope: SCOPE,
		herdr: herdrWith([
			{ pane_id: "w1:p1", tokens: {} },
			{ pane_id: "w1:p2", tokens: { SOMETHING_ELSE: fixture.attempt } },
			{ pane_id: "w1:p3" },
		]),
		at: AT,
	});

	assert.equal(
		plan.targets.some((entry) => entry.kind === CLEANUP_KINDS.workerPane || entry.kind === CLEANUP_KINDS.controllerPane),
		false,
	);
});

test("a worker pane is found by its FACTORY_ATTEMPT token and a controller pane by FACTORY_RUN", async (t) => {
	const fixture = settle(await workedAttempt(t));

	const plan = await planCleanup(fixture.store, {
		scope: SCOPE,
		herdr: herdrWith([
			{ pane_id: "w1:p1", tokens: { FACTORY_ATTEMPT: fixture.attempt } },
			{ pane_id: "w2:p1", tokens: { FACTORY_RUN: fixture.run } },
		]),
		at: AT,
	});

	const worker = plan.targets.find((entry) => entry.kind === CLEANUP_KINDS.workerPane);
	assert.equal(worker.pane, "w1:p1");
	assert.equal(worker.operand, `attempt/${fixture.attempt}`);

	const controller = plan.targets.find((entry) => entry.kind === CLEANUP_KINDS.controllerPane);
	assert.equal(controller.pane, "w2:p1");
	assert.equal(controller.operand, `run/${fixture.run}`);
});

test("a multiplexer that will not answer makes the pane kinds unanswerable, never empty (§12.4)", async (t) => {
	const fixture = settle(await workedAttempt(t));

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: HERDR_SILENT, at: AT });

	assert.deepEqual(plan.unanswerable.map((entry) => entry.kind), [
		CLEANUP_KINDS.workerPane,
		CLEANUP_KINDS.controllerPane,
	]);
	assert.equal(
		plan.targets.some((entry) => entry.kind === CLEANUP_KINDS.workerPane),
		false,
	);
});

// ── Orphaned blobs (§12.8) ───────────────────────────────────────────────────

test("a blob with no ledger row is an orphan; one with a row, tombstoned or not, is not", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const { store } = fixture;

	const orphan = writeArtifactBlob(store.storeDir, "bytes a crash left behind");
	const recorded = writeArtifactBlob(store.storeDir, "bytes the ledger knows");
	store.transaction((tx) =>
		recordArtifact(tx, { ...recorded, mediaType: "text/plain", run: fixture.run, ticket: fixture.ticket, at: AT }),
	);

	const plan = await planCleanup(store, { scope: SCOPE, herdr: herdrWith([]), at: AT });
	const blobs = plan.targets.filter((entry) => entry.kind === CLEANUP_KINDS.orphanedBlob);

	assert.deepEqual(blobs.map((entry) => entry.address.digest), [orphan.digest]);
	assert.equal(blobs[0].bytes, orphan.bytes);
	assert.equal(blobs[0].operand, `sha256/${orphan.digest}`);
});

// ── Baseline worktrees (§12.7) ───────────────────────────────────────────────

test("a clean throwaway baseline worktree is reclaimable; a red one's leftovers retain it", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const clean = join(fixture.store.storeDir, "baselines", "01JCLEANBASELINE0000000000");
	const dirty = join(fixture.store.storeDir, "baselines", "01JDIRTYBASELINE0000000000");

	await fixture.clone.addDetachedWorktree({ path: clean, at: fixture.base.commit });
	await fixture.clone.addDetachedWorktree({ path: dirty, at: fixture.base.commit });
	writeFileSync(join(dirty, "pytest.log"), "the failing output an operator cd's in for\n", "utf8");

	const plan = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	assert.deepEqual(
		plan.targets.filter((entry) => entry.kind === CLEANUP_KINDS.baselineWorktree).map((entry) => entry.subject),
		["01JCLEANBASELINE0000000000"],
	);
	assert.equal(
		plan.skips.find((entry) => entry.kind === CLEANUP_KINDS.baselineWorktree).subject,
		"01JDIRTYBASELINE0000000000",
	);
});

// ── Scope (§12.8) ────────────────────────────────────────────────────────────

test("the default plan is the whole eligible set; `--kind` narrows it to one", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const herdr = herdrWith([{ pane_id: "w1:p1", tokens: { FACTORY_ATTEMPT: fixture.attempt } }]);

	const everything = await planCleanup(fixture.store, { scope: SCOPE, herdr, at: AT });
	assert.deepEqual(new Set(everything.targets.map((entry) => entry.kind)), new Set(["attempt-worktree", "attempt-branch", "worker-pane"]));

	const narrowed = await planCleanup(fixture.store, {
		scope: { run: null, kinds: [CLEANUP_KINDS.workerPane] },
		herdr,
		at: AT,
	});
	assert.deepEqual(narrowed.targets.map((entry) => entry.kind), ["worker-pane"]);
	assert.notEqual(narrowed.digest, everything.digest, "a narrowed plan is a plan of its own (§12.8)");
});

test("`--run` narrows to one run's resources and excludes what belongs to none", async (t) => {
	const fixture = settle(await workedAttempt(t));
	writeArtifactBlob(fixture.store.storeDir, "an orphan belonging to no run");

	const scoped = await planCleanup(fixture.store, {
		scope: { run: "01JSOMEOTHERRUN00000000000", kinds: DEFAULT_CLEANUP_KINDS },
		herdr: herdrWith([]),
		at: AT,
	});
	assert.deepEqual(scoped.targets, []);

	const mine = await planCleanup(fixture.store, {
		scope: { run: fixture.run, kinds: DEFAULT_CLEANUP_KINDS },
		herdr: herdrWith([]),
		at: AT,
	});
	assert.ok(mine.targets.length > 0);
	assert.equal(
		mine.targets.some((entry) => entry.kind === CLEANUP_KINDS.orphanedBlob),
		false,
		"an orphan has no producer, so no run narrowing can claim it",
	);
});

// ── The private clone (§12.8) ────────────────────────────────────────────────

test("the private clone is never in a default plan and is refused while anything lives in it", async (t) => {
	const fixture = settle(await workedAttempt(t));

	const byDefault = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });
	assert.equal(
		byDefault.targets.some((entry) => entry.kind === PRIVATE_CLONE_KIND),
		false,
	);

	const asked = await planCleanup(fixture.store, {
		scope: { run: null, kinds: [PRIVATE_CLONE_KIND] },
		herdr: herdrWith([]),
		at: AT,
	});
	assert.deepEqual(asked.targets, []);
	assert.equal(asked.skips[0].reason, "clone-in-use");
	assert.match(asked.skips[0].message, /worktree\(s\) registered/);
});

test("the private clone becomes a target once nothing is registered in it", async (t) => {
	const fixture = settle(await workedAttempt(t));
	await fixture.clone.removeWorktree({ path: fixture.worktreePath });

	const plan = await planCleanup(fixture.store, {
		scope: { run: null, kinds: [PRIVATE_CLONE_KIND] },
		herdr: herdrWith([]),
		at: AT,
	});

	assert.equal(plan.targets.length, 1);
	assert.equal(plan.targets[0].kind, PRIVATE_CLONE_KIND);
	assert.equal(plan.targets[0].path, fixture.clone.dir);
	assert.ok(existsSync(fixture.clone.dir));
});

// ── The digest (§10.5, §14.25) ───────────────────────────────────────────────

test("the digest covers what the plan contains and moves when a target becomes a skip", async (t) => {
	const fixture = settle(await workedAttempt(t));

	const before = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });
	const again = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT + 90_000 });
	assert.equal(again.digest, before.digest, "a clock moved the digest");

	writeFileSync(join(fixture.worktreePath, "arrived-after-the-review.md"), "work\n", "utf8");
	const after = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });
	assert.notEqual(after.digest, before.digest);
});

test("a measurement changing does not move the digest — only a decision does", async (t) => {
	// A build running inside a worktree that was already going to be retained
	// changes its byte count and its untracked tally. Neither is the operator's
	// decision changing under them, and a digest that moved on one would refuse a
	// plan that is still exactly correct.
	const fixture = settle(await workedAttempt(t));
	writeFileSync(join(fixture.worktreePath, "notes.md"), "one\n", "utf8");
	const before = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	mkdirSync(join(fixture.worktreePath, "build"), { recursive: true });
	writeFileSync(join(fixture.worktreePath, "build", "out.o"), "x".repeat(4096), "utf8");
	const after = await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([]), at: AT });

	assert.notEqual(after.skips[0].untracked, before.skips[0].untracked, "the tally did not change");
	assert.equal(after.digest, before.digest);
});

test("planning writes nothing: no event, no effect row (§10.5)", async (t) => {
	const fixture = settle(await workedAttempt(t));
	const before = fixture.store.readEvents({}).length;

	await planCleanup(fixture.store, { scope: SCOPE, herdr: herdrWith([{ pane_id: "w1:p1", tokens: { FACTORY_ATTEMPT: fixture.attempt } }]), at: AT });

	assert.equal(fixture.store.readEvents({}).length, before);
	assert.equal(fixture.store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM effect WHERE phase = 'cleanup'").get().n), 0);
});
