import assert from "node:assert/strict";
import test from "node:test";

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
