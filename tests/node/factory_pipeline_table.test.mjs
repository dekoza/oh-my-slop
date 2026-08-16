import test from "node:test";
import assert from "node:assert/strict";

import { PHASE_OUTCOME_DOMAINS, PIPELINE_PHASES } from "../../factory/lib/domain/vocabulary.mjs";
import { OUTCOME_TABLE, TABLE_WIDE, TABLE_WIDE_OUTCOMES, routeOutcome } from "../../factory/lib/pipeline/table.mjs";

/**
 * §8.10's mapping table, as **one declared data structure**.
 *
 * The table is declared whole — including the review and integrate rows whose
 * behaviour lands in later slices — so it has a single owner from the start
 * rather than emerging from five tickets, each adding the rows it happened to
 * need. What a later slice adds is the *wiring*, never a row.
 */

test("the table routes a completed implement attempt on to harvest (§8.10)", () => {
	const row = routeOutcome("implement", "completed");

	assert.equal(row.action, "advance");
	assert.equal(row.to, "harvest");
	assert.equal(row.budget, null);
	assert.ok(OUTCOME_TABLE.includes(row), "routing answers with the declared row itself, never a copy");
});

test("the table is total over (phase × outcome), with exactly one row per pair (§8.10)", () => {
	const pairs = PIPELINE_PHASES.flatMap((phase) =>
		PHASE_OUTCOME_DOMAINS[phase].map((outcome) => [phase, outcome]),
	).concat(TABLE_WIDE_OUTCOMES.map((outcome) => [TABLE_WIDE, outcome]));

	for (const [phase, outcome] of pairs) {
		assert.ok(routeOutcome(phase, outcome), `${phase} × ${outcome} is routed`);
	}

	assert.equal(
		OUTCOME_TABLE.length,
		pairs.length,
		"and nothing beyond them: a row for a pair no phase can produce is a rule nobody can reach",
	);
});

test("a pair the table does not map is a typed refusal, never a fallthrough (§8.10)", () => {
	assert.throws(
		() => routeOutcome("verify", "approved"),
		(error) => {
			assert.equal(error.name, "FactoryPipelineError");
			assert.equal(error.reason, "outcome-unmapped");
			assert.deepEqual(error.details.domain, ["passed", "failed", "unrunnable"]);
			return true;
		},
	);
});
