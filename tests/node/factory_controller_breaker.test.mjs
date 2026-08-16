import test from "node:test";
import assert from "node:assert/strict";

import { circuitBreaker as breakerVerdict } from "../../factory/lib/controller/breaker.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import {
	FIXED_NOW,
	appendLegacyEvent,
	attemptLaunched,
	manualTimers,
	openTestStore,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §8.6's run-level circuit breaker: **N consecutive automation failures in
 * terminal-commit order.**
 *
 * The order is the durable one in which ticket executions commit their
 * disposition — the journal's own sequence (§14.37) — and never wall-clock
 * interleaving, which would make the verdict depend on scheduling accidents. At
 * capacity 1 the two coincide; above it they do not, and only one of them is
 * reproducible.
 *
 * §8.6's other half is what the tests below spend most of their weight on:
 * **product-level outcomes never trip it.** Five tickets each needing a human is
 * a productive run; five tickets each dying in preflight is a broken host
 * burning tokens on a verdict it has already reached.
 */

async function running(t) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const opened = runStarted();

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(opened.run);

	const run = opened.run;
	let ticket = 100;

	return {
		store,
		run,
		hold,
		/** One ticket execution committing its disposition, in the order called. */
		commit: (disposition, { reasonClass = null, fault = null, at = FIXED_NOW } = {}) => {
			const on = (ticket += 1);
			store.append(attemptLaunched(run, on, 1));
			hold.append({
				kind: "ticket.disposition-changed",
				source: "controller",
				run,
				ticket: on,
				occurredAt: at,
				observedAt: at,
				payload: { disposition, reason_class: reasonClass, fault },
			});
			return on;
		},
	};
}

/** §8.8's two shapes of a failure the automation owns. */
const AUTOMATION = Object.freeze({ reasonClass: "automation-budget-exhausted", fault: "automation" });
/** §8.6's counter-example: the product budget ran out, which is a verdict about the work. */
const PRODUCT = Object.freeze({ reasonClass: "repair-budget-exhausted", fault: "repair" });

/**
 * §11.6's `budgets.circuitBreaker` at the default the loader supplies, so a test
 * about *which failures count* does not have to restate the threshold. The tests
 * that are about N declare it.
 *
 * The module itself takes no default — the value has one home, §11.6's block —
 * which is why this stands in for the config rather than for a fallback.
 */
const circuitBreaker = (store, { run, threshold = 2 }) => breakerVerdict(store, { run, threshold });

test("N has no default here: a threshold that never came from the config refuses", async (t) => {
	const { store, run } = await running(t);

	assert.throws(
		() => breakerVerdict(store, { run }),
		(error) => error.reason === "invalid-value" && error.details.at === "budgets.circuitBreaker",
	);
});

test("a run that has settled nothing has not tripped the breaker", async (t) => {
	const { store, run } = await running(t);

	assert.deepEqual({ ...circuitBreaker(store, { run }) }, {
		tripped: false,
		consecutive: 0,
		threshold: 2,
		ticket: null,
		unclassifiable: 0,
	});
});

test("one automation failure is not two", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);

	const verdict = circuitBreaker(store, { run });
	assert.equal(verdict.tripped, false);
	assert.equal(verdict.consecutive, 1);
});

test("§8.6: two consecutive automation failures trip it, and name the ticket that did", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);
	const second = commit("failed", AUTOMATION);

	assert.deepEqual({ ...circuitBreaker(store, { run }) }, {
		tripped: true,
		consecutive: 2,
		threshold: 2,
		ticket: second,
		unclassifiable: 0,
	});
});

test("§15 case 13: a product-level failure interleaved among automation failures does not trip it", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);
	commit("failed", PRODUCT);
	commit("failed", AUTOMATION);

	const verdict = circuitBreaker(store, { run });
	assert.equal(verdict.tripped, false, "consecutive means adjacent in terminal-commit order");
	assert.equal(verdict.consecutive, 1);
});

test("§8.6: five tickets each needing a human is a productive run, not a broken host", async (t) => {
	const { store, run, commit } = await running(t);

	for (let each = 0; each < 5; each += 1) commit("paused", { reasonClass: "product-ambiguity" });

	assert.equal(circuitBreaker(store, { run }).tripped, false);
});

test("a published ticket between two automation failures resets the streak", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);
	commit("published");
	commit("failed", AUTOMATION);

	assert.equal(circuitBreaker(store, { run }).tripped, false);
});

test("a released ticket resets the streak: an operator stop is not the automation failing", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);
	commit("released");
	commit("failed", AUTOMATION);

	assert.equal(circuitBreaker(store, { run }).tripped, false);
});

test("§14.19: a review mutation is the reviewer breaking its contract, not the automation failing", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);
	commit("failed", { reasonClass: "review-mutation" });
	commit("failed", AUTOMATION);

	assert.equal(circuitBreaker(store, { run }).tripped, false);
});

test("§8.10's classless `failed` / automation rows are automation failures", async (t) => {
	const { store, run, commit } = await running(t);

	// "integrate × predicate-failed ⇒ failed / automation" names no class at all,
	// and §8.8 answers it by the rule: an automation fault is controller-derived.
	commit("failed", { fault: "automation" });
	commit("failed", { fault: "automation" });

	assert.equal(circuitBreaker(store, { run }).tripped, true);
});

test("§8.6: once tripped it stays tripped, whatever the in-flight lanes go on to settle as", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);
	commit("failed", AUTOMATION);
	// The lanes that were already running when new claims stopped reach their own
	// terminal dispositions (§3.5). A verdict that un-tripped here would let the
	// run's own draining erase the reason it is draining.
	commit("published");
	commit("published");

	assert.equal(circuitBreaker(store, { run }).tripped, true);
});

test("§14.37: the order is the journal's sequence, never the clock", async (t) => {
	const { store, run, commit } = await running(t);

	// Two lanes settling at once. In **terminal-commit order** this run is
	// automation, product, automation — one failure short of the threshold. On
	// the wall clock the product lane finished last, so a reader that sorted by
	// `occurred_at` would see automation, automation, product and stop a run that
	// §8.6 says is still working.
	commit("failed", { ...AUTOMATION, at: FIXED_NOW + 1 });
	commit("failed", { ...PRODUCT, at: FIXED_NOW + 3 });
	commit("failed", { ...AUTOMATION, at: FIXED_NOW + 2 });

	const byClock = store
		.readEvents({ kind: "ticket.disposition-changed" })
		.toSorted((left, right) => left.occurred_at - right.occurred_at)
		.map((record) => record.payload.fault);
	assert.deepEqual(byClock, ["automation", "automation", "repair"], "the clock tells the other story");

	assert.equal(circuitBreaker(store, { run }).tripped, false);
});

test("§4.3: a disposition written before the fault was recorded is counted, never guessed at", async (t) => {
	const { store, run, hold, commit } = await running(t);

	commit("failed", AUTOMATION);
	// What a store written by a build before #111 holds: the disposition alone.
	// Reading its missing fault as "not the automation's" is the silent wrong
	// answer the version bump exists to make visible. The current write path
	// cannot produce one, which is why this is a forgery.
	appendLegacyEvent(store, {
		kind: "ticket.disposition-changed",
		run,
		ticket: 999,
		payload: { disposition: "failed" },
	});
	commit("failed", AUTOMATION);

	const verdict = circuitBreaker(store, { run });
	assert.equal(verdict.tripped, false, "a record it cannot read breaks the streak rather than joining it");
	assert.equal(verdict.consecutive, 1);
	assert.equal(verdict.unclassifiable, 1, "and the verdict says it could not read one, rather than reading as complete");
});

test("a threshold of one trips on the first automation failure", async (t) => {
	const { store, run, commit } = await running(t);

	commit("failed", AUTOMATION);

	assert.equal(circuitBreaker(store, { run, threshold: 1 }).tripped, true);
});

test("another run's failures are not this run's", async (t) => {
	const { store, run, commit } = await running(t);
	commit("failed", AUTOMATION);
	commit("failed", AUTOMATION);

	const other = runStarted();
	store.append(other);

	assert.equal(circuitBreaker(store, { run: other.run }).tripped, false);
});
