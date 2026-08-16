import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { packageHandshake, recordPackageHandshake } from "../../factory/lib/package/handshake.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { attemptRecheck } from "../../factory/lib/worker/recheck.mjs";
import { makePackage } from "./helpers/factory-package.mjs";
import { attemptLaunched, FIXED_NOW, openCapacityPool } from "./helpers/factory-store.mjs";

/**
 * §6.2's layer 3: a cheap static recheck per attempt, no fresh probe, citing
 * the run's pinned handshake digest — a different digest is a failure, not a
 * new pin — and §11.7's model discipline: the observed resolved id is
 * persisted per attempt and may never change within a run.
 */

const TICKET = 90;

async function pinnedRun(t) {
	const { store, run, hold } = await openCapacityPool(t);
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	const pinned = recordPackageHandshake(store, packageHandshake({ executable, env: {} }), {
		run,
		actor: "controller",
		fencingGeneration: hold.fence().generation,
		at: FIXED_NOW,
	});

	store.append(attemptLaunched(run, TICKET, 1));
	return { store, run, hold, root, executable, pinned };
}

function recheck(context, overrides = {}) {
	return attemptRecheck(context.store, {
		hold: context.hold,
		run: context.run,
		ticket: TICKET,
		attempt: `${context.run}-t${TICKET}-a1`,
		phase: "implement",
		profile: "builder",
		declaredModel: "opus",
		observedModel: "claude-opus-5-test",
		executable: context.executable,
		env: {},
		actor: "controller",
		at: FIXED_NOW + 1_000,
		...overrides,
	});
}

test("an unchanged package rechecks green, citing the run's own pinned digest", async (t) => {
	const context = await pinnedRun(t);

	const cited = recheck(context);

	assert.equal(cited.outcome, "already-written");
	assert.equal(cited.digest, context.pinned.reference.digest);

	const [event] = context.store.readEvents({ stream: runStream(context.run), kind: "attempt.rechecked" });
	assert.equal(event.attempt, `${context.run}-t${TICKET}-a1`);
	assert.equal(event.payload.handshake_digest, context.pinned.reference.digest);
	assert.deepEqual(
		{ declared: event.payload.declared_model, resolved: event.payload.resolved_model },
		{ declared: "opus", resolved: "claude-opus-5-test" },
	);
});

test("a package that changed under the run is handshake drift — a failure, not a new pin", async (t) => {
	const context = await pinnedRun(t);
	writeFileSync(join(context.root, "skills", "practice", "tdd", "SKILL.md"), "---\nname: tdd\ndescription: edited\n---\n");

	assert.throws(
		() => recheck(context),
		(error) => {
			assert.ok(error instanceof FactoryWorkerError);
			assert.equal(error.reason, "handshake-drift");
			assert.match(error.message, /not a new pin/);
			return true;
		},
	);

	// No recheck event, and the pin is still the original: nothing re-pinned.
	assert.deepEqual(context.store.readEvents({ stream: runStream(context.run), kind: "attempt.rechecked" }), []);
});

test("a recheck against a run that never pinned is an ordering failure, with its observation recorded", async (t) => {
	const { store, run, hold } = await openCapacityPool(t);
	const root = makePackage(t);
	store.append(attemptLaunched(run, TICKET, 1));

	assert.throws(
		() =>
			recheck({ store, run, hold, executable: join(root, "factory", "bin", "factory.mjs") }),
		(error) => {
			assert.equal(error.reason, "handshake-unpinned");
			assert.match(error.details.digest, /^[0-9a-f]{64}$/);
			return true;
		},
	);
});

test("the observed resolved id changing between attempts within one run is model drift", async (t) => {
	const context = await pinnedRun(t);
	context.store.append(attemptLaunched(context.run, TICKET, 2));

	recheck(context);

	assert.throws(
		() =>
			recheck(context, {
				attempt: `${context.run}-t${TICKET}-a2`,
				observedModel: "claude-opus-6-surprise",
			}),
		(error) => {
			assert.ok(error instanceof FactoryWorkerError);
			assert.equal(error.reason, "model-drift");
			assert.match(error.message, /claude-opus-5-test/);
			assert.match(error.message, /claude-opus-6-surprise/);
			assert.equal(error.details.prior_attempt, `${context.run}-t${TICKET}-a1`);
			return true;
		},
	);
});

test("different declared models resolving differently is routine, not drift", async (t) => {
	const context = await pinnedRun(t);
	context.store.append(attemptLaunched(context.run, TICKET, 2));

	recheck(context);
	const second = recheck(context, {
		attempt: `${context.run}-t${TICKET}-a2`,
		profile: "reader",
		declaredModel: "sonnet",
		observedModel: "claude-sonnet-5-test",
	});

	assert.equal(second.outcome, "already-written");
	assert.equal(
		context.store.readEvents({ stream: runStream(context.run), kind: "attempt.rechecked" }).length,
		2,
	);
});

test("an attempt whose launch observed no model yet records null and asserts nothing", async (t) => {
	const context = await pinnedRun(t);
	context.store.append(attemptLaunched(context.run, TICKET, 2));

	recheck(context, { observedModel: null });
	// A later attempt with a real observation must not read the null as drift.
	recheck(context, { attempt: `${context.run}-t${TICKET}-a2`, observedModel: "claude-opus-5-test" });

	const events = context.store.readEvents({ stream: runStream(context.run), kind: "attempt.rechecked" });
	assert.deepEqual(
		events.map((event) => event.payload.resolved_model),
		[null, "claude-opus-5-test"],
	);
});
