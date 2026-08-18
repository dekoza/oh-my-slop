import test from "node:test";
import assert from "node:assert/strict";

import { DAY_MS, tierOneHorizon } from "../../factory/lib/retention/horizon.mjs";

/**
 * §12.3's tier-1 horizon: **the more generous of the last 20 runs or 30 days**.
 *
 * The two numbers are §12.10's whole configuration surface, and "more generous"
 * is a union rather than a choice — a run inside either one is tier 1.
 */

const AT = 1_770_000_000_000;
const RETENTION = Object.freeze({ fullDetailRuns: 20, fullDetailDays: 30 });

/** A digest row as the permanent projection holds it. */
function digest(runId, { startedAt, endedAt = null }) {
	return { run_id: runId, started_at: startedAt, ended_at: endedAt };
}

test("a run inside the day horizon is tier 1 and one outside it is not (§12.3)", () => {
	// One run of count budget, so the day half is what decides the second run.
	const horizon = tierOneHorizon(
		[digest("recent", { startedAt: AT - 29 * DAY_MS }), digest("ancient", { startedAt: AT - 31 * DAY_MS })],
		{ ...RETENTION, fullDetailRuns: 1 },
		{ at: AT },
	);

	assert.equal(horizon.members.has("recent"), true);
	assert.equal(horizon.members.has("ancient"), false);
});

test("the count half keeps the newest N even when every one of them is older than the day half", () => {
	const digests = Array.from({ length: 25 }, (unused, index) =>
		digest(`run-${String(index).padStart(2, "0")}`, { startedAt: AT - (100 + index) * DAY_MS }),
	);

	const horizon = tierOneHorizon(digests, RETENTION, { at: AT });

	assert.equal(horizon.members.size, 20);
	assert.equal(horizon.members.has("run-19"), true, "the twentieth-newest run left tier 1");
	assert.equal(horizon.members.has("run-20"), false, "the twenty-first-newest run stayed in tier 1");
	assert.equal(horizon.count_boundary, "run-19");
});

test("the day half keeps a run the count half already dropped — the two are a union (§12.3)", () => {
	const digests = Array.from({ length: 25 }, (unused, index) =>
		digest(`run-${String(index).padStart(2, "0")}`, { startedAt: AT - index * DAY_MS }),
	);

	const horizon = tierOneHorizon(digests, RETENTION, { at: AT });

	// 25 runs, one a day: the count half keeps 20, and the day half keeps the
	// first 31 — so every run survives on the more generous of the two.
	assert.equal(horizon.members.size, 25);
	assert.equal(horizon.members.has("run-24"), true);
});

test("a run ages from when it ended, not from when it started (§12.3)", () => {
	// The count half is spent on the newer run — `fullDetailRuns` has a floor of
	// 1 at load (§12.10), so a test that set it to 0 would be asserting against a
	// configuration the loader refuses.
	const horizon = tierOneHorizon(
		[
			digest("newest", { startedAt: AT - 2 * DAY_MS, endedAt: AT - 2 * DAY_MS }),
			digest("long", { startedAt: AT - 40 * DAY_MS, endedAt: AT - 3 * DAY_MS }),
			digest("stale", { startedAt: AT - 40 * DAY_MS, endedAt: AT - 39 * DAY_MS }),
		],
		{ ...RETENTION, fullDetailRuns: 1 },
		{ at: AT },
	);

	assert.equal(horizon.members.has("long"), true, "a run that ended three days ago was dated by its start");
	assert.equal(horizon.members.has("stale"), false, "a run that started and ended long ago was kept");
});
