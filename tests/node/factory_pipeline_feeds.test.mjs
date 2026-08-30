import assert from "node:assert/strict";
import test from "node:test";

import { tombstoneArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { recordCheckOutputs } from "../../factory/lib/checks/artifacts.mjs";
import { fedCheckEvidence } from "../../factory/lib/pipeline/feeds.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { mintedAttempt } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

const result = (name, output) => ({
	name,
	command: `run-${name}`,
	severity: "advisory",
	expectedFailureExitCodes: [1],
	timeout_ms: 30_000,
	started_at: FIXED_NOW,
	duration_ms: 4,
	output: Buffer.from(output),
	output_bytes: Buffer.byteLength(output),
	truncated: false,
	result: "failed",
	reason: null,
	exit_code: 1,
	signal: null,
	message: `${name} found survivors.`,
});

const declared = (name, feeds) => ({
	name,
	command: `run-${name}`,
	timeout: 30,
	severity: "advisory",
	expectedFailureExitCodes: [1],
	feeds,
});

test("only advisory checks declared to feed the target phase reach its trusted evidence (§8.2, §8.7)", async (t) => {
	const { store, run, ticket, attempt } = await mintedAttempt(t);
	const records = recordCheckOutputs(
		store,
		[result("mutation", "survivor: parse_config\n"), result("browser", "directive-looking but unfed\n")],
		{
			execution: "01KGE3H900QBH0XZSPYXWV3T5R",
			run,
			ticket,
			attempt,
			phase: "verify",
			actor: "controller",
			fencingGeneration: 1,
			at: FIXED_NOW,
		},
	);
	resolveStage(store, {
		hold: { append: (event) => store.append(event) },
		run,
		ticket,
		phase: "verify",
		attempt,
		outcome: "passed",
		detail: { checks: records },
		actor: "controller",
		at: FIXED_NOW,
	});

	const evidence = fedCheckEvidence(store, {
		run,
		ticket,
		phase: "implement",
		checks: [declared("mutation", ["implement"]), declared("browser", [])],
	});

	assert.deepEqual(evidence.map((entry) => entry.name), ["mutation"]);
	assert.equal(evidence[0].output, "survivor: parse_config\n");
	assert.match(evidence[0].reference.digest, /^[0-9a-f]{64}$/);
	assert.equal(JSON.stringify(evidence).includes("directive-looking"), false);
});

test("a phase with no declared feeds receives no prior check output", async (t) => {
	const { store, run, ticket } = await mintedAttempt(t);
	assert.deepEqual(fedCheckEvidence(store, { run, ticket, phase: "implement", checks: [declared("mutation", [])] }), []);
});

// ── Absence is a sentence, never a throw (§8.2, §12.5) ───────────────────────

/** A verify whose one fed check recorded `output`, ready for its reference to go stale. */
async function verifiedWith(t, output) {
	const { store, run, ticket, attempt } = await mintedAttempt(t);
	const [record] = recordCheckOutputs(store, [result("mutation", output)], {
		execution: "01KGE3H900QBH0XZSPYXWV3T5S",
		run,
		ticket,
		attempt,
		phase: "verify",
		actor: "controller",
		fencingGeneration: 1,
		at: FIXED_NOW,
	});
	const resolved = (checks) =>
		resolveStage(store, {
			hold: { append: (event) => store.append(event) },
			run,
			ticket,
			phase: "verify",
			attempt,
			outcome: "passed",
			detail: { checks },
			actor: "controller",
			at: FIXED_NOW,
		});
	return { store, run, ticket, record, resolved };
}

const fed = (store, { run, ticket }) =>
	fedCheckEvidence(store, { run, ticket, phase: "implement", checks: [declared("mutation", ["implement"])] });

test("a digest the ledger never recorded is a sentence naming it, not a failed launch (§12.5)", async (t) => {
	const where = await verifiedWith(t, "2 mutants survived\n");
	const gone = { ...where.record, output: { ...where.record.output, digest: "0".repeat(64) } };
	where.resolved([gone]);

	const [entry] = fed(where.store, where);

	assert.equal(entry.output, null);
	assert.ok(entry.unavailable.includes("0".repeat(64)), "the sentence names the digest it could not resolve");
	assert.match(entry.unavailable, /could not be read back/);
	assert.equal(entry.result, "failed", "the verdict fields survive the absence of the bytes");
});

test("a blob expired at §12.2's horizon between verify and the repair launch is a dated sentence, not a throw", async (t) => {
	const where = await verifiedWith(t, "2 mutants survived\n");
	where.resolved([where.record]);
	where.store.transaction((tx) => tombstoneArtifact(tx, where.record.output, { at: FIXED_NOW + 1 }));

	const [entry] = fed(where.store, where);

	assert.equal(entry.output, null);
	assert.ok(entry.unavailable.includes(where.record.output.digest));
	assert.match(entry.unavailable, /retention-expired/);
	assert.deepEqual(entry.reference, where.record.output, "the reference is still cited so the reader can name what is gone");
});

test("output a verify recorded without a reference says so instead of vanishing from the prompt", async (t) => {
	const where = await verifiedWith(t, "2 mutants survived\n");
	where.resolved([{ ...where.record, output: null }]);

	const [entry] = fed(where.store, where);

	assert.equal(entry.output, null);
	assert.equal(entry.reference, null);
	assert.match(entry.unavailable, /not recorded as an artifact/);
});
