import test from "node:test";
import assert from "node:assert/strict";

import { PROBE_CALLS } from "../../factory/lib/effects/catalogue.mjs";
import { createProbeRegistry, PROBES } from "../../factory/lib/reconcile/probes.mjs";
import { refusalOf } from "./helpers/factory-store.mjs";

/**
 * §5.3's probe seam. The engine ships here; **each effect kind's probe ships
 * with the subsystem that introduces that effect kind**, so this file owns the
 * contract between them and nothing else.
 */

test("an implementation is looked up by the read the catalogue declares for the effect", () => {
	const probes = createProbeRegistry();
	const labels = () => ({ matched: true });

	probes.register("issue.labels", labels);

	assert.equal(probes.implementationFor("issue.labels"), labels);
	assert.equal(probes.implementationFor("git.ls-remote"), null, "an unimplemented read has no probe yet");
	assert.deepEqual(probes.calls, ["issue.labels"]);
});

test("a probe registered against a read §4.5 does not declare is refused", () => {
	const probes = createProbeRegistry();

	const refusal = refusalOf(() => probes.register("issue.reactions", () => ({ matched: true })));

	assert.equal(refusal.reason, "probe-call-unknown");
	assert.equal(probes.calls.length, 0);
});

test("a second implementation for one read is refused rather than silently winning", () => {
	const probes = createProbeRegistry();
	probes.register("issue.labels", () => ({ matched: true }));

	const refusal = refusalOf(() => probes.register("issue.labels", () => ({ matched: false })));

	assert.equal(refusal.reason, "probe-already-registered");
});

test("the shipped registry only ever holds reads the catalogue declares", () => {
	for (const call of PROBES.calls) {
		assert.ok(PROBE_CALLS.includes(call), `${call} is not one of §4.5's probe calls`);
	}
});
