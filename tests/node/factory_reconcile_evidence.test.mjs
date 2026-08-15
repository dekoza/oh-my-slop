import test from "node:test";
import assert from "node:assert/strict";

import {
	evidenceEntry,
	EVIDENCE_SOURCES,
	JOURNAL_INTENT,
	RECONCILE_CONCLUSIONS,
	reconcileConclusion,
} from "../../factory/lib/reconcile/conclusions.mjs";
import { FactoryReconcileError } from "../../factory/lib/reconcile/errors.mjs";
import { refusalOf } from "./helpers/factory-store.mjs";

/**
 * §5.4's output value: a conclusion from the closed four-member set, and an
 * ordered, non-empty evidence basis whose first entry is the source that
 * decided.
 */

const tracker = evidenceEntry({
	source: "tracker",
	call: "issue.labels",
	effectKey: "R/92/preflight/-/label-add/in-progress",
	matched: true,
	foreignSourceId: "gitea:4711",
	occurredAtRaw: "2026-08-15T09:00:00+02:00",
});

const gitLocal = evidenceEntry({ source: "git-local", call: "git.rev-parse", matched: false });

test("a conclusion carries its evidence in order, deciding source first", () => {
	const concluded = reconcileConclusion("adopted", [tracker, gitLocal]);

	assert.equal(concluded.conclusion, "adopted");
	assert.deepEqual(
		concluded.evidence.map((entry) => entry.source),
		["tracker", "git-local"],
		"the operator's question is which source decided, so the order is the answer",
	);
	assert.equal(concluded.evidence[0].foreign_source_id, "gitea:4711");
});

test("an empty evidence basis is refused at construction (§14.2)", () => {
	const refusal = refusalOf(() => reconcileConclusion("unchanged", []));

	assert.ok(refusal instanceof FactoryReconcileError);
	assert.equal(refusal.reason, "evidence-empty");
});

test("journal-intent is never a member of an evidence basis (§14.2)", () => {
	const refusal = refusalOf(() =>
		reconcileConclusion("adopted", [evidenceEntry({ source: JOURNAL_INTENT, matched: true })]),
	);

	assert.equal(refusal.reason, "evidence-journal-intent");
	assert.ok(!EVIDENCE_SOURCES.includes(JOURNAL_INTENT), "the journal is not an evidence source");
});

test("the conclusion set is §5.4's closed four, and nothing else concludes", () => {
	assert.deepEqual(RECONCILE_CONCLUSIONS, ["adopted", "released", "declared-dead", "unchanged"]);

	const refusal = refusalOf(() => reconcileConclusion("resumed", [tracker]));
	assert.equal(refusal.reason, "conclusion-unknown");
});

test("an evidence entry is JSON-safe, so the record it rides can be hashed", () => {
	const entry = evidenceEntry({ source: "harness", call: "herdr.pane-list", matched: false });

	assert.deepEqual(entry, {
		source: "harness",
		call: "herdr.pane-list",
		effect_key: null,
		matched: false,
		foreign_source_id: null,
		occurred_at_raw: null,
		detail: {},
	});
});
