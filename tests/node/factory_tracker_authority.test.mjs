import assert from "node:assert/strict";
import test from "node:test";

import {
	ABSENCE_MEANINGS,
	AUTHORITY_TABLE,
	authorityFor,
	FACT_CLASSES,
	FACT_STRENGTHS,
	requireAuthority,
} from "../../factory/lib/tracker/authority.mjs";
import { refusalOf } from "./helpers/factory-store.mjs";

/**
 * §5.2: **authority is per fact class**, because a global ranking always ends up
 * asserting something the winning source does not know.
 */

test("every row of §5.2's table is present, with the sources it names", () => {
	assert.deepEqual(
		AUTHORITY_TABLE.map((row) => row.source),
		["gitea", "git-remote", "herdr", "outbox", "journal"],
	);

	const gitea = AUTHORITY_TABLE.find((row) => row.source === "gitea");
	assert.deepEqual([...gitea.authoritativeFor].sort(), [
		"pr.existence",
		"ticket.assignee",
		"ticket.content-version",
		"ticket.dependencies",
		"ticket.labels",
		"ticket.state",
	]);
});

test("Gitea is authoritative for ticket state, labels, assignee, and PR existence", () => {
	for (const fact of ["ticket.state", "ticket.labels", "ticket.assignee", "pr.existence"]) {
		assert.equal(authorityFor(fact).source, "gitea");
		assert.equal(authorityFor(fact).strength, FACT_STRENGTHS.proof);
		assert.equal(requireAuthority(fact, "gitea"), "gitea");
	}
});

test("Herdr is authoritative for liveness, the pane output it holds, and the refusal read off that output (§5.2, #150, #154)", () => {
	const herdr = AUTHORITY_TABLE.find((row) => row.source === "herdr");
	assert.deepEqual(herdr.authoritativeFor, ["worker.alive", "worker.output", "provider.refusal"]);
});

test("the outbox is evidence and the journal is intent, never proof", () => {
	assert.equal(authorityFor("phase.outcome").source, "outbox");
	assert.equal(authorityFor("phase.outcome").strength, FACT_STRENGTHS.evidence);

	const journal = AUTHORITY_TABLE.find((row) => row.source === "journal");
	assert.equal(journal.strength, FACT_STRENGTHS.intent);
	assert.deepEqual(journal.authoritativeFor, []);
});

test("comment text is authoritative for nothing", () => {
	const authority = authorityFor("comment.text");
	assert.equal(authority.source, null);
	assert.equal(authority.strength, FACT_STRENGTHS.none);

	// Not even from the tracker that stores it: bodies are silently editable.
	const refusal = refusalOf(() => requireAuthority("comment.text", "gitea"));
	assert.equal(refusal.reason, "fact-source-unauthoritative");
	assert.match(refusal.message, /comment text/i);
});

test("a missing comment means possibly-deleted, never never-posted", () => {
	assert.equal(authorityFor("comment.observed").absence, ABSENCE_MEANINGS.possiblyDeleted);
	assert.equal(authorityFor("timeline.entry").absence, ABSENCE_MEANINGS.possiblyDeleted);

	// The contrast that makes the value mean something: a label that is not on
	// the issue really is not on the issue.
	assert.equal(authorityFor("ticket.labels").absence, ABSENCE_MEANINGS.absent);
});

test("a fact outside §5.2's closed set is refused rather than defaulted", () => {
	const refusal = refusalOf(() => authorityFor("ticket.vibes"));
	assert.equal(refusal.reason, "fact-class-unknown");
	assert.match(refusal.message, /ticket\.vibes/);
});

test("asserting a tracker fact from the wrong source is refused", () => {
	const refusal = refusalOf(() => requireAuthority("worker.alive", "gitea"));
	assert.equal(refusal.reason, "fact-source-unauthoritative");
	assert.equal(refusal.details.expected, "herdr");
	assert.equal(refusal.details.found, "gitea");
});

test("every declared fact class resolves, and every table row answers for its own", () => {
	for (const fact of FACT_CLASSES) {
		const authority = authorityFor(fact);
		assert.equal(authority.fact, fact);
		assert.ok(Object.values(FACT_STRENGTHS).includes(authority.strength), fact);
		assert.ok(Object.values(ABSENCE_MEANINGS).includes(authority.absence), fact);
	}

	for (const row of AUTHORITY_TABLE) {
		for (const fact of row.authoritativeFor) {
			assert.equal(authorityFor(fact).source, row.source, fact);
			assert.equal(authorityFor(fact).strength, row.strength, fact);
		}
	}
});
