import test from "node:test";
import assert from "node:assert/strict";

import { CONTROLLER_STREAM } from "../../factory/lib/state/events.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import {
	classAvailability,
	DEFAULT_EXHAUSTION_MEMO_MS,
	exhaustionLedger,
	INCONCLUSIVE_EXHAUSTION_MEMO_MS,
	matchRefusal,
	recordAdmission,
	recordExhaustion,
} from "../../factory/lib/capacity/exhaustion.mjs";
import { FIXED_NOW, manualTimers, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * #154: **a provider that refuses for quota reasons is remembered as a
 * time-boxed unavailability of its resource class.**
 *
 * The memo is durable state in §9's capacity model — recorded as journal
 * events on the `controller` stream, so it outlives the run that observed the
 * refusal and is consulted by the next one — and its expiry re-admits the
 * class only by probe (§5.2), which the scheduler slice exercises.
 */

// ── The refusal signatures (§6.6's detection vocabulary) ─────────────────────

test("the signatures catch the quota and rate-limit wordings providers actually print", () => {
	for (const text of [
		"Error: insufficient_quota — you exceeded your current quota",
		"API Error: 429 rate_limit_error: Rate limit reached for model",
		"HTTP 429: Too Many Requests",
		"GoUsageLimitError: Monthly usage limit reached",
		"FreeUsageLimitError: please enable available balance",
		"provider error: quota exceeded for this project",
		"out of budget; top up to continue",
		"Error: daily limit reached, resets at midnight UTC",
		'{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your limit"}}',
		"You are being rate limited; retry in 30s",
	]) {
		const match = matchRefusal(`some earlier output\n${text}\n`);
		assert.notEqual(match, null, `expected a refusal in: ${text}`);
		assert.ok(match.signatures.length > 0, "the match names the signature that hit");
		assert.ok(typeof match.excerpt === "string" && match.excerpt.length > 0, "and carries a short excerpt");
	}
});

test("ordinary worker output is not a refusal", () => {
	for (const text of [
		"Running pytest... 42 passed",
		"git commit -m 'fix: handle error codes'",
		"the server returned 500 internal error", // transient server fault, not quota
		"connection refused while fetching",
		"compiled with -O2",
	]) {
		assert.equal(matchRefusal(text), null, `not a refusal: ${text}`);
	}
});

test("a signature word embedded in ordinary prose is not a refusal", () => {
	// The line that ended run 01M0ZD1G52EC2CD946Y3B1AFQ8's attempt: a README
	// the worker was writing, shown with a line number by its own editor.
	// "quotations" carries "quota"; a bare substring match read it as the
	// provider's refusal and stopped a working worker.
	for (const text of [
		" 10  Two names in them are guesses rather than quotations, and they are the ones to",
		"the quotas table is keyed by tenant",
		"docs/quotations.md updated",
		"accurately rated: limited-edition pressing",
		"add the rate-limiting middleware to the API",
	]) {
		assert.equal(matchRefusal(text), null, `not a refusal: ${text}`);
	}
});

test("the match reads only the tail of the pane output", () => {
	// A ticket body that happens to say "rate limit" sits at the top of the
	// pane; two hundred lines of real work later it must not decide anything.
	const tail = "worker output\n".repeat(120) + "done, outbox written\n";
	const text = "please fix the rate limit handling\n" + tail;
	assert.equal(matchRefusal(text), null);

	// …while the same word in the final lines is exactly the fact it is.
	assert.notEqual(matchRefusal(tail + "Error: rate limit exceeded\n"), null);
});

// ── The memo ledger (§9: a class unavailable until T) ────────────────────────

async function openedRun(t) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const opened = runStarted();
	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(opened.run);
	return { store, hold, run: opened.run };
}

test("a recorded exhaustion blocks the class until its expiry", async (t) => {
	const { store, hold } = await openedRun(t);
	const until = FIXED_NOW + DEFAULT_EXHAUSTION_MEMO_MS;

	recordExhaustion(hold, {
		class: "local",
		until,
		at: FIXED_NOW,
		evidence: { run: "01JRUN0000000000000000000A", attempt: "a1", pane: "p1", signatures: ["rate limit"] },
	});

	assert.equal(classAvailability(exhaustionLedger(store, { at: FIXED_NOW + 1_000 }), "local"), "exhausted");
	assert.equal(
		classAvailability(exhaustionLedger(store, { at: until - 1 }), "local"),
		"exhausted",
		"still blocked the instant before the expiry",
	);
	assert.equal(
		classAvailability(exhaustionLedger(store, { at: until }), "local"),
		"probe-due",
		"past the expiry the class is neither blocked nor available — a probe must answer (§5.2)",
	);
	assert.equal(
		classAvailability(exhaustionLedger(store, { at: FIXED_NOW }), "other-class"),
		"available",
		"a class nothing ever refused is untouched",
	);
});

test("the memo rides the controller stream and survives the run that observed it", async (t) => {
	const { store, hold, run } = await openedRun(t);

	recordExhaustion(hold, {
		class: "local",
		until: FIXED_NOW + 60_000,
		at: FIXED_NOW,
		evidence: { run, attempt: "a1", signatures: ["quota"] },
	});

	const records = store.readEvents({ stream: CONTROLLER_STREAM, kind: "capacity.exhausted" });
	assert.equal(records.length, 1);
	assert.equal(records[0].run, null, "the memo names no run in its envelope — it belongs to no run");
	assert.equal(records[0].payload.class, "local");
	assert.equal(records[0].payload.until, FIXED_NOW + 60_000);
	assert.equal(records[0].payload.evidence.run, run, "the observation it came from rides the payload");

	// A later invocation — a different run, or none at all — reads the same fact.
	assert.equal(classAvailability(exhaustionLedger(store, { at: FIXED_NOW + 1_000 }), "local"), "exhausted");
});

test("an admission after an exhaustion re-admits the class", async (t) => {
	const { store, hold } = await openedRun(t);

	recordExhaustion(hold, { class: "local", until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });
	recordAdmission(hold, {
		class: "local",
		at: FIXED_NOW + 70_000,
		evidence: { probe: "print-probe", profile: "builder" },
	});

	assert.equal(
		classAvailability(exhaustionLedger(store, { at: FIXED_NOW + 80_000 }), "local"),
		"available",
		"the probe's admission, not the passing of time, is what opened the class",
	);
});

test("a later exhaustion after an admission blocks again — the latest record decides", async (t) => {
	const { store, hold } = await openedRun(t);

	recordExhaustion(hold, { class: "local", until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });
	recordAdmission(hold, { class: "local", at: FIXED_NOW + 70_000, evidence: {} });
	recordExhaustion(hold, { class: "local", until: FIXED_NOW + 140_000, at: FIXED_NOW + 90_000, evidence: {} });

	assert.equal(classAvailability(exhaustionLedger(store, { at: FIXED_NOW + 100_000 }), "local"), "exhausted");
	assert.equal(classAvailability(exhaustionLedger(store, { at: FIXED_NOW + 150_000 }), "local"), "probe-due");
});

test("the ledger reports one entry per class for the saturation surface (§9.7)", async (t) => {
	const { store, hold } = await openedRun(t);

	recordExhaustion(hold, { class: "local", until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const ledger = exhaustionLedger(store, { at: FIXED_NOW + 1_000 });
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].class, "local");
	assert.equal(ledger[0].status, "exhausted");
	assert.equal(ledger[0].until, FIXED_NOW + 60_000);
});

// ── The capacity pool's dispatch gate (§9) ───────────────────────────────────

import { openCapacityPool as openPool } from "./helpers/factory-store.mjs";

test("the gate answers available for a class nothing refused", async (t) => {
	const { capacity } = await openPool(t);
	const gate = await capacity.exhaustion.settle("local", { at: FIXED_NOW });
	assert.deepEqual(gate, { state: "available", until: null });
});

test("the gate blocks on a live memo without spending a probe", async (t) => {
	const probed = [];
	const { capacity } = await openPool(t, {
		probeClass: async (className) => {
			probed.push(className);
			return { verdict: "admitted", evidence: {} };
		},
	});
	capacity.exhaustion.record("local", { until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const gate = await capacity.exhaustion.settle("local", { at: FIXED_NOW + 1_000 });
	assert.equal(gate.state, "blocked");
	assert.equal(gate.until, FIXED_NOW + 60_000);
	assert.deepEqual(probed, [], "a live memo is an answer already — no probe is spent on it");
});

test("an expiry is settled by probe, never by the clock: admission opens the class (§5.2)", async (t) => {
	const { store, capacity } = await openPool(t, {
		probeClass: async () => ({ verdict: "admitted", evidence: { probe: "print" } }),
	});
	capacity.exhaustion.record("local", { until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const gate = await capacity.exhaustion.settle("local", { at: FIXED_NOW + 70_000 });
	assert.equal(gate.state, "available");

	const admissions = store.readEvents({ stream: CONTROLLER_STREAM, kind: "capacity.admitted" });
	assert.equal(admissions.length, 1, "the admission is a durable record, not a memory of this call");
	assert.equal(admissions[0].payload.class, "local");
});

test("a probe that is refused again renews the memo for the full window", async (t) => {
	const { capacity } = await openPool(t, {
		probeClass: async () => ({ verdict: "refused", evidence: { excerpt: "insufficient_quota" } }),
	});
	capacity.exhaustion.record("local", { until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const at = FIXED_NOW + 70_000;
	const gate = await capacity.exhaustion.settle("local", { at });
	assert.equal(gate.state, "blocked");
	assert.equal(gate.until, at + DEFAULT_EXHAUSTION_MEMO_MS, "the renewal is anchored at the probe, not the old expiry");
});

test("a probe that cannot answer holds the class on the short window — opening on it would be the assumption", async (t) => {
	const { capacity } = await openPool(t, {
		probeClass: async () => ({ verdict: "inconclusive", evidence: { exit_code: 1 } }),
	});
	capacity.exhaustion.record("local", { until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const at = FIXED_NOW + 70_000;
	const gate = await capacity.exhaustion.settle("local", { at });
	assert.equal(gate.state, "blocked");
	assert.equal(gate.until, at + INCONCLUSIVE_EXHAUSTION_MEMO_MS);
});

test("an expired memo with no probe wired stays blocked and says what is missing (§12.4's shape)", async (t) => {
	const { capacity } = await openPool(t);
	capacity.exhaustion.record("local", { until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const gate = await capacity.exhaustion.settle("local", { at: FIXED_NOW + 70_000 });
	assert.equal(gate.state, "blocked");
	assert.equal(gate.until, null, "no renewal was observed, so no expiry is invented");
	assert.match(gate.missing, /probe/);
});

test("the saturation snapshot carries the memo per class (§9.7)", async (t) => {
	const { capacity } = await openPool(t);
	capacity.exhaustion.record("local", { until: FIXED_NOW + 60_000, at: FIXED_NOW, evidence: {} });

	const snapshot = capacity.snapshot({ at: FIXED_NOW + 1_000 });
	const local = snapshot.classes.find((entry) => entry.class === "local");
	assert.equal(local.exhaustion.status, "exhausted");
	assert.equal(local.exhaustion.until, FIXED_NOW + 60_000);
});
