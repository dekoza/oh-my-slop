import test from "node:test";
import assert from "node:assert/strict";

import {
	AGENT_BORNE_PHASES,
	ATTEMPT_OUTCOMES,
	CONTROLLER_DERIVED_OUTCOMES,
	CONTROLLER_PHASES,
	PHASE_OUTCOME_DOMAINS,
	PHASE_RESULTS,
	PIPELINE_PHASES,
	TICKET_DISPOSITIONS,
	WORKER_WRITABLE_OUTCOMES,
} from "../../factory/lib/domain/vocabulary.mjs";
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

test("§8.10's stated properties are carried as fields, not as prose (§8.10)", () => {
	// "mutation-detected is the only outcome with no retry at all."
	assert.deepEqual(
		OUTCOME_TABLE.filter((row) => !row.retryable).map((row) => row.outcome),
		["mutation-detected"],
	);
	// "A rebase-conflict consumes a fresh-retry, not a repair … a second conflict
	// is failed / rebase-conflict."
	const conflict = routeOutcome("integrate", "rebase-conflict");
	assert.equal(conflict.action, "fresh-retry");
	assert.equal(conflict.budget, "repair");
	assert.deepEqual(conflict.exhausted, { reasonClass: "rebase-conflict" });
	// "unrunnable → retry; exhausted ⇒ failed / check-unrunnable."
	assert.deepEqual(routeOutcome("verify", "unrunnable").exhausted, { reasonClass: "check-unrunnable" });
	// §8.5's trust framing: controller-produced evidence as fact, worker-authored
	// text in the untrusted block.
	assert.equal(routeOutcome("verify", "failed").evidence, "fact");
	assert.equal(routeOutcome("review", "rejected").evidence, "untrusted");
	assert.equal(routeOutcome("implement", "worker-failed").evidence, "untrusted");
});

test("wrote-but-hung is an anomaly on an ordinary row, never a failure (§8.10)", () => {
	assert.deepEqual(
		OUTCOME_TABLE.filter((row) => row.anomaly !== null).map((row) => [row.phase, row.action, row.budget]),
		[
			["implement", "advance", null],
			["review", "verdict", null],
		],
	);
});

// ── §8.8's three levels, and §8.1's two agent-borne phases ───────────────────

test("exactly two phases are agent-borne; the other three have no model in them (§8.1)", () => {
	assert.deepEqual([...AGENT_BORNE_PHASES], ["implement", "review"]);
	assert.deepEqual([...CONTROLLER_PHASES], ["harvest", "verify", "integrate"]);
	assert.deepEqual(
		[...AGENT_BORNE_PHASES, ...CONTROLLER_PHASES].sort(),
		[...PIPELINE_PHASES].sort(),
		"every pipeline phase is one or the other, and none is both",
	);
});

test("implement has no phase result of its own — its result is its attempt's outcome (§8.1)", () => {
	assert.equal(PHASE_RESULTS.implement, undefined);
	assert.deepEqual(PHASE_OUTCOME_DOMAINS.implement, ATTEMPT_OUTCOMES);
});

test("the three levels are distinct types, and a value never travels without its level (§8.8)", () => {
	const results = [...new Set(Object.values(PHASE_RESULTS).flat())];

	// No attempt outcome is also a phase result: `verify` and `integrate` have no
	// worker, so forcing their results into the attempt enum would conflate them.
	assert.deepEqual(
		results.filter((result) => ATTEMPT_OUTCOMES.includes(result)),
		[],
	);
	// `failed` is a `verify` result **and** a ticket disposition, which is exactly
	// why the levels are three types rather than one enum: the word alone does not
	// say which level it belongs to, and only the phase it arrived with does.
	assert.ok(PHASE_RESULTS.verify.includes("failed") && TICKET_DISPOSITIONS.includes("failed"));
	assert.equal(routeOutcome("verify", "failed").action, "repair");
	assert.throws(() => routeOutcome(TABLE_WIDE, "failed"), /maps no outcome/);
});

test("controller-derived outcomes are the complement of the worker-writable set (§6.6, §8.8)", () => {
	assert.deepEqual(
		[...WORKER_WRITABLE_OUTCOMES, ...CONTROLLER_DERIVED_OUTCOMES].sort(),
		[...ATTEMPT_OUTCOMES].sort(),
	);
	assert.deepEqual(
		CONTROLLER_DERIVED_OUTCOMES.filter((outcome) => WORKER_WRITABLE_OUTCOMES.includes(outcome)),
		[],
		"a second hand-kept list could name one in both, and the outbox validator and the table would disagree",
	);
});

test("a pair the table does not map is a typed refusal, never a fallthrough (§8.10)", () => {
	assert.throws(
		() => routeOutcome("verify", "approved"),
		(error) => {
			assert.equal(error.name, "FactoryPipelineError");
			assert.equal(error.reason, "outcome-unmapped");
			assert.deepEqual(error.details.domain, ["passed", "failed", "unrunnable", "rebase-conflict"]);
			return true;
		},
	);
});

test("provider-refused reroutes, budgetlessly, for a builder and for a reviewer (§8.10, #154, #155)", () => {
	for (const phase of ["implement", "review"]) {
		const row = routeOutcome(phase, "provider-refused");
		assert.equal(row.action, "reroute", `${phase}: the same work goes to the next routable profile, not to a disposition`);
		assert.equal(row.budget, null, `${phase}: no budget is charged for the provider's fault`);
		assert.equal(row.disposition, null, `${phase}: nothing settles here — the attempt it replaces did nothing wrong`);
	}
});

test("routes-exhausted is a budgetless release of its own, distinguishable from a worker that failed (§8.10, #155)", () => {
	const row = routeOutcome(TABLE_WIDE, "routes-exhausted");

	assert.equal(row.action, "dispose", "the run has nowhere to send this work");
	assert.equal(row.disposition, "released", "the ticket goes back untouched; no provider was available, and no label is owed");
	assert.equal(row.budget, null, "no budget is charged for the providers' caps");
	assert.equal(row.reasonClass, null, "no reason class — released carries none (§8.9)");
	assert.notEqual(
		row.outcome,
		routeOutcome("implement", "worker-failed").outcome,
		"a worker that failed and a run out of routes are different facts",
	);
});

test("routes-exhausted names no phase, because no attempt ever had it as an outcome (§8.8, #155)", () => {
	// §11.5's fresh-retry is routed and `verify` and `integrate` both route to it,
	// so the row has to be reachable from phases that have no worker at all — and
	// an attempt-level outcome there would be an outcome with nothing to belong to.
	assert.ok(TABLE_WIDE_OUTCOMES.includes("routes-exhausted"));
	for (const phase of Object.keys(PHASE_OUTCOME_DOMAINS)) {
		assert.ok(
			!PHASE_OUTCOME_DOMAINS[phase].includes("routes-exhausted"),
			`${phase} claims an outcome no attempt of it ever had`,
		);
	}
});
