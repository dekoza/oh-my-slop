import test from "node:test";
import assert from "node:assert/strict";

import { PROBE_SOURCES, READ_OPERATIONS } from "../../factory/lib/effects/catalogue.mjs";
import { FactoryEffectError } from "../../factory/lib/effects/errors.mjs";
import { createEffectRegistry, EFFECT_REGISTRY } from "../../factory/lib/effects/registry.mjs";

/**
 * §4.5's registry: every effect kind declares its probe **as data**, and a kind
 * with no probe cannot be registered. That construction check is the structural
 * guarantee behind §5.3's reconciliation invariant — without it the invariant is
 * a code-review convention (§14.3).
 */

test("a registered effect kind answers with its probe, declared as data", () => {
	// §4.5's catalogue row: comment post is probed by reading the issue's
	// comments and matching the effect key embedded in a body.
	assert.deepEqual(EFFECT_REGISTRY.probeFor("comment-post"), {
		source: "tracker",
		call: "issue.comments",
		match: "embedded-key",
	});
});

test("an effect kind with no probe cannot be registered, and the refusal is at construction", () => {
	// Not at request time: a fire-and-forget effect that only fails when it is
	// first *used* is one that ships. The registry is constructed at import, so
	// the mistake cannot leave the developer's machine.
	assert.throws(
		() => createEffectRegistry({ "pr-merge": {} }),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-kind-without-probe",
	);

	assert.throws(
		() => createEffectRegistry({ "pr-merge": { probe: null } }),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-kind-without-probe",
	);

	// A probe naming a source, call, or match nothing implements is no probe
	// either — it is a declaration that would fail the first time reconcile ran.
	for (const probe of [
		{ source: "vibes", call: "issue.labels", match: "present" },
		{ source: "tracker", call: "issue.guess", match: "present" },
		{ source: "tracker", call: "issue.labels", match: "probably" },
	]) {
		assert.throws(
			() => createEffectRegistry({ "pr-merge": { probe } }),
			(error) => error instanceof FactoryEffectError && error.reason === "effect-kind-without-probe",
			`${JSON.stringify(probe)} was accepted as a probe`,
		);
	}
});

test("every kind in the shipped catalogue has a probe, and the catalogue is §4.5's inventory", () => {
	// §4.5's opening list of mutations outside the database, spelled as the
	// operations that perform them.
	for (const operation of [
		"issue-assign",
		"issue-unassign",
		"label-add",
		"label-remove",
		"issue-close",
		"comment-post",
		"pr-create",
		"pr-body-update",
		"branch-create",
		"push",
		"evidence-ref",
		"worktree-create",
		"worktree-delete",
		"agent-start",
		"agent-stop",
		"artifact-write",
		"attestation-write",
	]) {
		assert.ok(EFFECT_REGISTRY.has(operation), `${operation} is not a registered effect kind`);
	}

	// Deletions, one row per class of thing deleted — which is the granularity at
	// which the probe differs (§12.8's six plan target kinds are the planner's
	// vocabulary, not the probe's).
	for (const operation of ["worktree-delete", "branch-delete", "pane-delete", "artifact-delete"]) {
		assert.ok(EFFECT_REGISTRY.has(operation), `${operation} is not a registered effect kind`);
	}

	// One mutation, one operation: a worktree deleted eagerly after integration
	// (§12.7) and one reclaimed by the cleanup planner (§12.8) are the same
	// mutation with the same probe, told apart by the key's phase segment.
	assert.equal(EFFECT_REGISTRY.operations.filter((operation) => operation.endsWith("worktree-delete")).length, 1);

	for (const operation of EFFECT_REGISTRY.operations) {
		const probe = EFFECT_REGISTRY.probeFor(operation);
		assert.ok(PROBE_SOURCES.includes(probe.source), `${operation}'s probe has no evidence source`);
	}
});

test("an unregistered operation is a refusal, never a silent fire-and-forget", () => {
	assert.throws(
		() => EFFECT_REGISTRY.probeFor("pr-merge"),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-kind-unknown",
	);
});

test("a read cannot be registered as an effect — reads get observation cursors", () => {
	// §4.5's own words. The reads appear in this catalogue only as a probe's
	// `call`, so registering one as an operation is the mistake being caught.
	for (const read of READ_OPERATIONS) {
		assert.equal(EFFECT_REGISTRY.has(read), false, `${read} is registered as an effect`);
		assert.throws(
			() => createEffectRegistry({ [read]: { probe: { source: "tracker", call: "issue.labels", match: "present" } } }),
			(error) => error instanceof FactoryEffectError && error.reason === "read-is-not-an-effect",
			`${read} was accepted as an effect kind`,
		);
	}

	// The realistic accident is a read arriving in the operation slot spelled the
	// way operations are spelled, so the guard matches that form too.
	assert.throws(
		() =>
			createEffectRegistry({
				"issue-comments": { probe: { source: "tracker", call: "issue.comments", match: "present" } },
			}),
		(error) => error instanceof FactoryEffectError && error.reason === "read-is-not-an-effect",
	);
});
