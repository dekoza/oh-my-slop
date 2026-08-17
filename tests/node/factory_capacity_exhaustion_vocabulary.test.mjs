import test from "node:test";
import assert from "node:assert/strict";

import { exitCodeForEndReason, OUTCOME_EXIT_CODES } from "../../factory/lib/cli/exit-codes.mjs";
import {
	ATTEMPT_OUTCOMES,
	CONTROLLER_DERIVED_OUTCOMES,
	END_REASON_CAPACITY_EXHAUSTED,
	RUN_TERMINAL_REASONS,
	WORKER_WRITABLE_OUTCOMES,
} from "../../factory/lib/domain/vocabulary.mjs";
import { requireAuthority } from "../../factory/lib/tracker/authority.mjs";

/**
 * #154's words, before the behaviour that uses them: the refusal is a typed
 * outcome of its own, the run that cannot spend any class has an end reason
 * that says so, and the observation the detection reads has an owner in §5.2's
 * table.
 */

test("provider-refused is a controller-derived attempt outcome, never worker-writable (§6.6, §8.8)", () => {
	assert.ok(ATTEMPT_OUTCOMES.includes("provider-refused"));
	assert.ok(CONTROLLER_DERIVED_OUTCOMES.includes("provider-refused"));
	assert.ok(!WORKER_WRITABLE_OUTCOMES.includes("provider-refused"));
});

test("capacity-exhausted is a run end reason with its own published exit code (§10.3)", () => {
	assert.ok(RUN_TERMINAL_REASONS.includes(END_REASON_CAPACITY_EXHAUSTED));
	assert.equal(END_REASON_CAPACITY_EXHAUSTED, "capacity-exhausted");

	const code = exitCodeForEndReason("capacity-exhausted");
	assert.equal(typeof code, "number");
	assert.notEqual(code, 0, "a run that stopped on an exhausted class is not success");
	assert.equal(OUTCOME_EXIT_CODES["capacity-exhausted"], code);

	// The verb-level markers stay outside the end-reason range.
	assert.notEqual(code, 7);
	assert.notEqual(code, 8);
});

test("the refusal observation is owned by herdr — it is read off pane output (§5.2)", () => {
	assert.equal(requireAuthority("provider.refusal", "herdr"), "herdr");
	assert.throws(() => requireAuthority("provider.refusal", "gitea"));
});
