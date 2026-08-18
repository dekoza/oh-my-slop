import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { FactoryProofError } from "../../factory/lib/proof/errors.mjs";
import {
	CELL_VERDICTS,
	FILESYSTEM_TOOLS,
	PROOF_ENTRY_SKILL,
	RECEIPT_RULES,
	cellVerdict,
	expectedReceipt,
	judgeTranscript,
	readProofContract,
} from "../../factory/lib/proof/receipt.mjs";

/**
 * §6.7's proof depth, at the one seam that decides what a matrix cell *means*.
 *
 * The contract — marker, token, transform — is declared **once**, in the body
 * the model is given, and read back from those same bytes here. Two copies is
 * the failure this arrangement exists to make unreachable: a judge holding its
 * own token would keep passing a package whose skill said something else, and
 * a matrix that cannot be wrong about its own subject proves nothing.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PROOF_SKILL_MD = join(REPO_ROOT, "skills", "meta", PROOF_ENTRY_SKILL, "SKILL.md");

function shippedContract() {
	return readProofContract(readFileSync(PROOF_SKILL_MD, "utf8"));
}

/** A session that answered, with the fields a judgement reads and nothing else. */
function transcript(overrides = {}) {
	return { answered: true, text: "", toolUses: [], ...overrides };
}

// ── The contract is read from the shipped body, never restated ──────────────

test("the shipped proof skill declares a contract whose rule this judge implements", () => {
	const contract = shippedContract();

	assert.equal(contract.marker, "SKILL-LOADING-PROOF");
	assert.match(contract.token, /^[a-z0-9-]+$/);
	assert.ok(
		Object.hasOwn(RECEIPT_RULES, contract.rule),
		`the shipped body declares rule "${contract.rule}", which no implemented transform answers`,
	);
});

test("the shipped body spells the rule out for its reader in the words the transform implements", () => {
	// The model is given prose and the judge runs code; this is the one place
	// the two are held together. A rule renamed in the body without a transform
	// behind it fails above; a transform that stopped matching its own prose
	// fails here.
	const body = readFileSync(PROOF_SKILL_MD, "utf8");

	assert.match(body, /take the proof nonce's characters \*\*in reverse order\*\* and \*\*upper-case\*\*/);
	assert.equal(RECEIPT_RULES["reverse-upper"]("a1b2c3"), "3C2B1A");
});

test("the worked example in the body is the receipt the judge would accept", () => {
	// A body whose own example is wrong teaches the model the wrong answer, and
	// every cell then reads as a model that did not follow it.
	const contract = shippedContract();

	assert.ok(readFileSync(PROOF_SKILL_MD, "utf8").includes(expectedReceipt(contract, "a1b2c3")));
});

test("a body with no contract block is a refusal, never a default contract", () => {
	assert.throws(() => readProofContract("# Nothing here\n"), (error) => {
		assert.ok(error instanceof FactoryProofError);
		assert.equal(error.reason, "contract-unreadable");
		return true;
	});
});

test("a contract block missing a field, or naming an unimplemented rule, is a refusal", () => {
	const withoutToken = "```factory-proof-contract\nmarker  M\nrule    reverse-upper\n```\n";
	assert.throws(() => readProofContract(withoutToken), { reason: "contract-unreadable" });

	const unknownRule = "```factory-proof-contract\nmarker  M\ntoken   t\nrule    rot13\n```\n";
	assert.throws(() => readProofContract(unknownRule), { reason: "contract-rule-unknown" });
});

// ── The expected line ───────────────────────────────────────────────────────

test("the expected receipt is marker, token, and the nonce under the declared rule", () => {
	const contract = readProofContract("```factory-proof-contract\nmarker  M\ntoken   tok\nrule    reverse-upper\n```\n");

	assert.equal(expectedReceipt(contract, "abc123"), "M tok 321CBA");
});

// ── The judgement ───────────────────────────────────────────────────────────

test("a session that never answered is unreachable, not a model that failed to follow", () => {
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: { answered: false, text: "", toolUses: [], said: "exit 1: no such model" },
	});

	assert.equal(cell.verdict, "unreachable");
	assert.equal(cell.detail, "exit 1: no such model");
});

test("the exact receipt, reached with no tool at all, is the proof the matrix is after", () => {
	const contract = shippedContract();
	const line = expectedReceipt(contract, "abc123");

	const cell = judgeTranscript({ contract, nonce: "abc123", transcript: transcript({ text: `${line}\n` }) });

	assert.equal(cell.verdict, "followed");
	assert.equal(cell.receipt, line);
	assert.deepEqual(cell.filesystemTools, []);
});

test("a receipt the model reached by reading the package is not native loading", () => {
	// The survey's open question in one predicate: whether a trace distinguishes
	// a loaded body from a path the model went and read. It does, and this is
	// where the distinction is drawn rather than assumed.
	const contract = shippedContract();
	const line = expectedReceipt(contract, "abc123");

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({
			text: line,
			toolUses: [
				{ name: "Skill", input: { command: "oh-my-slop:skill-loading-proof" } },
				{ name: "Read", input: { file_path: "/pkg/skills/meta/skill-loading-proof/SKILL.md" } },
			],
		}),
	});

	assert.equal(cell.verdict, "read-not-loaded");
	assert.deepEqual(cell.filesystemTools, ["Read"]);
});

test("the skill invocation itself is not a filesystem read", () => {
	// Claude registers a model-invoked skill as a `Skill` tool use. Counting it
	// as evidence of reading would fail every cell the matrix exists to pass.
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({
			text: expectedReceipt(contract, "abc123"),
			toolUses: [{ name: "Skill", input: { command: "skill-loading-proof" } }],
		}),
	});

	assert.equal(cell.verdict, "followed");
	assert.ok(!FILESYSTEM_TOOLS.includes("Skill"));
});

test("the token with the wrong answer is a body that reached the model and a rule it did not apply", () => {
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({ text: `${contract.marker} ${contract.token} ABC123` }),
	});

	assert.equal(cell.verdict, "answered-wrong");
	assert.equal(cell.receipt, `${contract.marker} ${contract.token} ABC123`);
});

test("an answer carrying no receipt at all is the registration-without-following case", () => {
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({ text: "I can help with that. Which nonce did you mean?" }),
	});

	assert.equal(cell.verdict, "no-receipt");
	assert.equal(cell.receipt, null);
});

test("the receipt is found on its own line inside prose the body asked for none of", () => {
	// The body asks for one line and nothing else, and a model that adds a
	// sentence has still demonstrably read it. Failing that cell would report a
	// loading defect over a chattiness one.
	const contract = shippedContract();
	const line = expectedReceipt(contract, "abc123");

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({ text: `Here you go:\n\n${line}\n\nAnything else?` }),
	});

	assert.equal(cell.verdict, "followed");
	assert.equal(cell.receipt, line);
});

test("a receipt for a nonce this cell never minted is not this cell's evidence", () => {
	// The nonce is what makes a cell a fresh observation rather than a memory:
	// a line carrying the right token and a stale answer would otherwise pass on
	// a transcript replayed from an earlier run.
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({ text: expectedReceipt(contract, "999zzz") }),
	});

	assert.equal(cell.verdict, "answered-wrong");
});

test("the receipt survives trailing text on its own line, as the body's own tolerance says", () => {
	// The body asks for one line and nothing else. A model that appends a word
	// has still demonstrably read the body, and scoring that `answered-wrong`
	// would report a loading defect over a chattiness one — the same mistake in
	// the other direction from the leading-prose case above.
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({ text: `${expectedReceipt(contract, "abc123")} — hope that helps!` }),
	});

	assert.equal(cell.verdict, "followed");
	assert.equal(cell.receipt, expectedReceipt(contract, "abc123"));
});

test("a verdict outside the declared set cannot be constructed", () => {
	// The vocabulary reaches the operator's document, so it is a closed set the
	// constructor enforces — the package's own idiom for `closureFinding` and
	// `probeFinding` — rather than five string literals a test restates.
	assert.deepEqual(CELL_VERDICTS, ["followed", "read-not-loaded", "answered-wrong", "no-receipt", "unreachable"]);
	assert.throws(() => cellVerdict("nearly-followed", {}), /nearly-followed/);
});

test("the tools that count as fetching the body are the builder's own, minus the ones that deliver nothing", () => {
	// Derived rather than listed: a cell runs under §6.8's builder posture, so a
	// tool family added to that posture's allows defaults to *counting*, which
	// is the safe direction. A hand-kept list is how `Task` and `WebFetch` were
	// missing while `NotebookRead` — not a tool the harness emits — was present.
	assert.ok(FILESYSTEM_TOOLS.includes("Read"));
	assert.ok(FILESYSTEM_TOOLS.includes("Bash"));
	assert.ok(FILESYSTEM_TOOLS.includes("Task"), "a subagent can read the body and report it back");
	assert.ok(FILESYSTEM_TOOLS.includes("WebFetch"), "the body is also reachable over the network");
	assert.ok(!FILESYSTEM_TOOLS.includes("Write"));
	assert.ok(!FILESYSTEM_TOOLS.includes("TodoWrite"));
	assert.ok(!FILESYSTEM_TOOLS.includes("NotebookRead"), "not a tool this harness emits");
});

test("a body reached through a subagent is not native loading either", () => {
	const contract = shippedContract();

	const cell = judgeTranscript({
		contract,
		nonce: "abc123",
		transcript: transcript({
			text: expectedReceipt(contract, "abc123"),
			toolUses: [{ name: "Task", input: { prompt: "read the skill and tell me what it says" } }],
		}),
	});

	assert.equal(cell.verdict, "read-not-loaded");
});
