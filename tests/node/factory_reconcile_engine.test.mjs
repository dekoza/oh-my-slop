import test from "node:test";
import assert from "node:assert/strict";

import { requestEffect, unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { reconcile, RECONCILE_MODES } from "../../factory/lib/reconcile/engine.mjs";
import { FactoryReconcileError } from "../../factory/lib/reconcile/errors.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { openStoreReadOnly } from "../../factory/lib/state/store.mjs";
import {
	attemptLaunched,
	FIXED_NOW,
	openTestStore,
	refusalOfAsync,
	runEnded,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §5.4's engine: what reconcile looks at, what it settles, and what it refuses
 * to settle.
 *
 * Reconcile runs at controller startup before the lease is used for any effect,
 * and on the operator's explicit `reconcile`; `doctor` runs the identical code
 * with a read-only flag. So every test here is a statement about both verbs.
 */

const AT = FIXED_NOW + 100_000;

/** A store with one live run and one run that ended. */
async function storeWithRuns(t) {
	const store = await openTestStore(t);
	const live = newUlid();
	const ended = newUlid();

	store.append(runStarted(live));
	store.append(runStarted(ended, { at: FIXED_NOW - 1000 }));
	store.append(runEnded(ended));

	return { store, live, ended };
}

function labelAdd(store, { run, ticket = null, operand = "in-progress" }) {
	return requestEffect(store, {
		run,
		ticket,
		phase: "preflight",
		operation: "label-add",
		operand,
		actor: "controller",
		fencingGeneration: 1,
		payload: { label: operand },
		at: FIXED_NOW,
	});
}

test("scope is every unended run, plus any ticket execution holding an unresolved effect", async (t) => {
	const { store, live, ended } = await storeWithRuns(t);
	labelAdd(store, { run: ended, ticket: 92 });

	const report = await reconcile(store, { probes: createProbeRegistry(), fencingGeneration: 1, at: AT });

	assert.deepEqual(report.scope.runs, [live], "an ended run holding nothing is nobody's business");
	assert.deepEqual(report.scope.ticket_executions, [{ run: ended, ticket: 92 }]);
});

test("a probe that finds the mutation landed settles the effect and records what decided it", async (t) => {
	const { store, live } = await storeWithRuns(t);
	const effect = labelAdd(store, { run: live, ticket: 92 });
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => ({
		matched: true,
		result: { labels: ["in-progress"] },
		foreignSourceId: "gitea:4711",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
	}));

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.settled, 1);
	assert.deepEqual(unresolvedEffects(store), [], "the world said the label is there; the effect is settled");

	const concluded = store.readEvents({}).filter((event) => event.kind === "reconcile.concluded");
	assert.equal(concluded.length, 1, "one reconcile.concluded per affected entity");
	assert.deepEqual(concluded[0].payload.entity, { kind: "ticket-execution", run: live, ticket: 92 });
	assert.equal(concluded[0].payload.conclusion, "adopted");
	assert.equal(concluded[0].payload.evidence[0].source, "tracker");
	assert.equal(concluded[0].payload.evidence[0].effect_key, effect.key);

	// §5.3: the probe is itself written as an observation event carrying its source.
	const observed = store.readEvents({}).filter((event) => event.kind === "observation.recorded");
	assert.equal(observed.length, 1);
	assert.equal(observed[0].source, "gitea");
	assert.equal(observed[0].foreign_source_id, "gitea:4711");
	assert.equal(observed[0].payload.occurred_at_raw, "2026-08-15T09:00:00+02:00");

	const resolved = store.readEvents({}).filter((event) => event.kind === "effect.resolved");
	assert.deepEqual(resolved[0].payload.result, { labels: ["in-progress"] });
});

test("a probe that finds the mutation absent leaves the intent standing, and concludes unchanged", async (t) => {
	const { store, live } = await storeWithRuns(t);
	const effect = labelAdd(store, { run: live, ticket: 92 });
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => ({
		matched: false,
		foreignSourceId: "gitea:4712",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
	}));

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.settled, 0);
	assert.equal(unresolvedEffects(store)[0].effect_key, effect.key, "the label was never added; the intent stands");
	assert.equal(report.entities[0].conclusion, "unchanged");
	assert.equal(report.entities[0].evidence[0].matched, false);
	assert.equal(
		store.readEvents({}).filter((event) => event.kind === "observation.recorded").length,
		1,
		"the probe is recorded whatever it found",
	);
});

test("a confirmed absence is the entity giving something up, and concludes released", async (t) => {
	const { store, live } = await storeWithRuns(t);
	requestEffect(store, {
		run: live,
		ticket: 92,
		phase: "cleanup",
		operation: "label-remove",
		operand: "in-progress",
		actor: "controller",
		fencingGeneration: 1,
		payload: { label: "in-progress" },
		at: FIXED_NOW,
	});
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => ({
		matched: true,
		foreignSourceId: "gitea:4713",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
	}));

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.entities[0].conclusion, "released");
});

test("a harness probe that cannot match the attempt's token declares the worker dead (§5.5)", async (t) => {
	const { store, live } = await storeWithRuns(t);
	store.append(attemptLaunched(live, 92));
	requestEffect(store, {
		run: live,
		ticket: 92,
		phase: "implement",
		attempt: `${live}-t92-a1`,
		operation: "agent-start",
		actor: "controller",
		fencingGeneration: 1,
		payload: { role: "implement" },
		at: FIXED_NOW,
	});
	const probes = createProbeRegistry();
	probes.register("herdr.pane-list", () => ({
		matched: false,
		foreignSourceId: "herdr:pane-7",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
		detail: { pane: "herdr:pane-7" },
	}));

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.entities[0].conclusion, "declared-dead");
	assert.equal(report.entities[0].evidence[0].source, "harness");
	assert.equal(unresolvedEffects(store).length, 1, "declaring the worker dead is not settling the effect");
});

test("an effect no probe implements is left alone and reported, never concluded about (§14.1)", async (t) => {
	const { store, live } = await storeWithRuns(t);
	const effect = labelAdd(store, { run: live, ticket: 92 });
	const headBefore = store.head();

	const report = await reconcile(store, { probes: createProbeRegistry(), fencingGeneration: 1, at: AT });

	assert.deepEqual(report.entities, [], "no probe ran, so there is no evidence and nothing to conclude");
	assert.equal(report.unsettled[0].effect_key, effect.key);
	assert.equal(report.unsettled[0].reason, "probe-unavailable");
	assert.deepEqual(store.head(), headBefore, "an unprobed effect writes nothing at all");
});

test("a probe that fails is an effect nothing settled, not an effect that failed", async (t) => {
	const { store, live } = await storeWithRuns(t);
	labelAdd(store, { run: live, ticket: 92 });
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => {
		throw new Error("gitea unreachable");
	});

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.unsettled[0].reason, "probe-failed");
	assert.match(report.unsettled[0].message, /gitea unreachable/);
	assert.equal(unresolvedEffects(store).length, 1);
});

// ── The read-only flag: doctor is this code, not a second opinion (§14.24) ───

test("report mode reaches the same conclusion and appends nothing to the journal", async (t) => {
	const { store, live } = await storeWithRuns(t);
	labelAdd(store, { run: live, ticket: 92 });
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => ({
		matched: true,
		foreignSourceId: "gitea:4714",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
	}));
	const headBefore = store.head();
	const projectionsBefore = store.projectionHeads();

	const reported = await reconcile(store, { probes, mode: RECONCILE_MODES.report, at: AT });

	assert.deepEqual(store.head(), headBefore, "doctor appended to the journal");
	assert.deepEqual(store.projectionHeads(), projectionsBefore, "doctor moved a projection head");
	assert.equal(unresolvedEffects(store).length, 1, "doctor settled an effect");

	const settled = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.deepEqual(
		reported.entities.map((entity) => [entity.entity.ticket, entity.conclusion, entity.evidence[0].source]),
		settled.entities.map((entity) => [entity.entity.ticket, entity.conclusion, entity.evidence[0].source]),
	);
	assert.equal(reported.settleable, settled.settleable, "the two modes disagree about what the world said");
	assert.equal(reported.settled, 0, "report mode claimed to have settled something it never wrote");
	assert.equal(settled.settled, 1);
});

test("a read-only handle can report and can never settle", async (t) => {
	const { store, live } = await storeWithRuns(t);
	labelAdd(store, { run: live, ticket: 92 });
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => ({
		matched: true,
		foreignSourceId: "gitea:4715",
		occurredAtRaw: "2026-08-15T09:00:00+02:00",
	}));
	const reader = openStoreReadOnly({ dbPath: store.dbPath });
	t.after(() => reader.close());

	const reported = await reconcile(reader, { probes, mode: RECONCILE_MODES.report, at: AT });
	assert.equal(reported.entities[0].conclusion, "adopted");

	const refusal = await refusalOfAsync(() => reconcile(reader, { probes, fencingGeneration: 1, at: AT }));
	assert.ok(refusal instanceof FactoryReconcileError);
	assert.equal(refusal.reason, "reconcile-read-only");
});

test("settling with no fencing generation is the caller's bug, and says so", async (t) => {
	const { store } = await storeWithRuns(t);

	const refusal = await refusalOfAsync(() => reconcile(store, { probes: createProbeRegistry(), at: AT }));

	assert.equal(refusal.reason, "reconcile-generation-required");
});

test("an unresolved effect no entity in scope holds is still visible, whoever holds it", async (t) => {
	const { store, ended } = await storeWithRuns(t);
	// A ticket-less effect of a run that has already ended: §5.4's scope reaches
	// neither the run (it ended) nor a ticket execution (there is no ticket), so
	// nothing will ever probe it — which is exactly what must not go unreported.
	const orphan = labelAdd(store, { run: ended, operand: "drained" });

	const report = await reconcile(store, { probes: createProbeRegistry(), fencingGeneration: 1, at: AT });

	assert.deepEqual(
		report.out_of_scope.map((entry) => entry.effect_key),
		[orphan.key],
	);
	assert.equal(unresolvedEffects(store).length, 1, "an out-of-scope effect is left exactly as it was");
});

test("a repo-scoped unresolved effect is reported rather than settled outside §5.4's scope", async (t) => {
	const { store } = await storeWithRuns(t);
	labelAdd(store, { run: null, ticket: null, operand: "repo-wide" });

	const report = await reconcile(store, { probes: createProbeRegistry(), fencingGeneration: 1, at: AT });

	assert.equal(report.out_of_scope.length, 1);
	assert.equal(report.out_of_scope[0].operation, "label-add");
	assert.equal(unresolvedEffects(store).length, 1, "an out-of-scope effect is left exactly as it was");
});
