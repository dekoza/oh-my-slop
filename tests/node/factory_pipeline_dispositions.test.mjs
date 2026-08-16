import test from "node:test";
import assert from "node:assert/strict";

import {
	CONTROLLER_DERIVED_REASON_CLASSES,
	WORKER_WRITABLE_REASON_CLASSES,
} from "../../factory/lib/domain/vocabulary.mjs";
import { dispositionForReasonClass, dispositionOf } from "../../factory/lib/pipeline/dispositions.mjs";
import { OUTCOME_TABLE, routeOutcome } from "../../factory/lib/pipeline/table.mjs";

/**
 * §14.18, **as a rule rather than as a table property**: every worker-writable
 * reason class ⇒ `paused`, every controller-derived one ⇒ `failed`.
 *
 * A worker asking a question needs an answer; the controller giving up needs an
 * investigation. Written as a rule so a class added later cannot be filed to the
 * wrong disposition by a row that forgot to say — which is the failure a table
 * column would make silent and green.
 */

test("every worker-writable reason class pauses, and every controller-derived one fails (§14.18)", () => {
	for (const reasonClass of WORKER_WRITABLE_REASON_CLASSES) {
		assert.equal(dispositionForReasonClass(reasonClass), "paused", reasonClass);
	}
	for (const reasonClass of CONTROLLER_DERIVED_REASON_CLASSES) {
		assert.equal(dispositionForReasonClass(reasonClass), "failed", reasonClass);
	}
});

test("a reason class in neither list has no disposition to guess at (§14.18)", () => {
	assert.throws(
		() => dispositionForReasonClass("budget-ran-out"),
		(error) => {
			assert.equal(error.reason, "reason-class-unknown");
			return true;
		},
	);
});

test("no row files `paused` or `failed` itself — the rule does (§14.18)", () => {
	const named = OUTCOME_TABLE.map((row) => row.disposition).filter((disposition) => disposition !== null);

	assert.deepEqual(
		[...new Set(named)].sort(),
		["published", "released"],
		"only the two dispositions that carry no reason class are a row's own",
	);
});

test("a dispose row with an automation fault and no reason class still fails (§8.10)", () => {
	assert.deepEqual(dispositionOf(routeOutcome("integrate", "predicate-failed")), {
		disposition: "failed",
		reason_class: null,
		fault: "automation",
	});
});

test("a dispose row's reason class decides its disposition, and a settled one carries no fault (§8.9)", () => {
	assert.deepEqual(dispositionOf(routeOutcome("review", "mutation-detected")), {
		disposition: "failed",
		reason_class: "review-mutation",
		fault: null,
	});
	assert.deepEqual(dispositionOf(routeOutcome("integrate", "integrated")), {
		disposition: "published",
		reason_class: null,
		fault: null,
	});
});

test("a worker's own reason class is what settles a needs-human implement attempt (§8.10, §14.18)", () => {
	assert.deepEqual(dispositionOf(routeOutcome("implement", "needs-human"), { reasonClass: "product-ambiguity" }), {
		disposition: "paused",
		reason_class: "product-ambiguity",
		fault: null,
	});
});

test("a worker cannot pause a ticket under a class only the controller derives (§6.6, §8.8)", () => {
	assert.throws(
		() => dispositionOf(routeOutcome("implement", "needs-human"), { reasonClass: "repair-budget-exhausted" }),
		(error) => {
			assert.equal(error.reason, "reason-class-unknown");
			assert.match(error.message, /worker-writable/);
			return true;
		},
	);
});
