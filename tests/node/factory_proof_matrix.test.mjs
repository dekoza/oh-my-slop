import assert from "node:assert/strict";
import test from "node:test";

import {
	PROOF_CASES,
	SURVEY_CLAIMS,
	assessClaims,
	planCells,
	renderCellPrompt,
	renderMatrixDocument,
	runMatrix,
} from "../../factory/lib/proof/matrix.mjs";
import { expectedReceipt, readProofContract } from "../../factory/lib/proof/receipt.mjs";

/**
 * §6.7's matrix as a *plan*, a *run*, and a *record* — the three things that
 * separate a repeatable acceptance obligation from a transcript somebody kept.
 *
 * Nothing here starts a session. The runner hands `runMatrix` one function that
 * turns a cell into a transcript, so every judgement, every claim assessment and
 * the whole document are exercised against fakes, and the paid part of the
 * proof is the only part that is not.
 */

const CONTRACT = readProofContract(
	"```factory-proof-contract\nmarker  SKILL-LOADING-PROOF\ntoken   tok\nrule    reverse-upper\n```\n",
);

const WHERE = Object.freeze({
	harness: Object.freeze({ runtime: "claude", binary: "/usr/bin/claude", version: "2.1.233" }),
	packageRev: Object.freeze({ algorithm: "sha256", digest: "deadbeef", files: 400 }),
	// §11.7: metadata only, never authoritative — but recorded, because a digest
	// of a tree that no longer exists is otherwise unreconstructable.
	checkout: Object.freeze({ commit: "c0ffee1234567890", dirty: true }),
	plugin: Object.freeze({ name: "oh-my-slop", dir: "/store/plugins/deadbeef" }),
	// The one surface a scripted turn can run on, and the reason the claim that
	// names "interactive versus headless" cannot be discharged here.
	surface: "headless",
});

const MODELS = Object.freeze([
	Object.freeze({ declared: "opus", profile: Object.freeze({ name: "opus-builder", kind: "claude", model: "opus" }) }),
	Object.freeze({ declared: "fable", profile: Object.freeze({ name: "fable-builder", kind: "claude", model: "fable" }) }),
]);

/** A session function answering every cell with whatever the case deserves. */
function answering(byCase) {
	return async (cell) => byCase[cell.case](cell);
}

function followed(cell) {
	return {
		answered: true,
		text: expectedReceipt(CONTRACT, cell.nonce),
		toolUses: [{ name: "Skill", input: {} }],
		resolvedModel: `claude-${cell.model.declared}-5`,
		sessionId: `session-${cell.case}-${cell.model.declared}`,
	};
}

function readItInstead(cell) {
	return {
		...followed(cell),
		toolUses: [{ name: "Read", input: { file_path: "/store/plugins/deadbeef/skills/skill-loading-proof/SKILL.md" } }],
	};
}

const ALL_GREEN = Object.freeze({
	"direct-invocation": followed,
	"model-invocation": followed,
	"trace-control": readItInstead,
});

async function record(byCase = ALL_GREEN, options = {}) {
	return runMatrix({
		...WHERE,
		contract: CONTRACT,
		models: MODELS,
		mintNonce: (cell) => `n${cell.case.length}${cell.model.declared}`,
		session: answering(byCase),
		at: "2026-08-18T00:00:00.000Z",
		...options,
	});
}

// ── The plan ────────────────────────────────────────────────────────────────

test("the matrix is every declared model against every case, and nothing else", () => {
	const cells = planCells(MODELS);

	assert.equal(cells.length, MODELS.length * PROOF_CASES.length);
	assert.deepEqual(
		cells.map((cell) => `${cell.model.declared}/${cell.case}`),
		[
			"opus/direct-invocation",
			"opus/model-invocation",
			"opus/trace-control",
			"fable/direct-invocation",
			"fable/model-invocation",
			"fable/trace-control",
		],
	);
});

test("the three cases are the survey's own split, plus the control that makes the trace readable", () => {
	// The survey names direct invocation and natural-language triggering as
	// separate cases — "success in one does not prove the other" — and asks
	// separately whether a trace distinguishes loading from reading. A control
	// cell that *does* read the file is what makes the other two cells' silence
	// evidence rather than an untested assumption (#163's pattern).
	assert.deepEqual(PROOF_CASES, ["direct-invocation", "model-invocation", "trace-control"]);
});

// ── The prompts ─────────────────────────────────────────────────────────────

test("the direct-invocation prompt is the native invocation the factory's own workers are given", () => {
	const prompt = renderCellPrompt({
		case: "direct-invocation",
		nonce: "abc123",
		plugin: WHERE.plugin,
		kind: "claude",
	});

	assert.ok(prompt.startsWith("/oh-my-slop:skill-loading-proof"));
	assert.ok(prompt.includes("abc123"));
});

test("the model-invocation prompt names no skill — the description has to do the work", () => {
	const prompt = renderCellPrompt({ case: "model-invocation", nonce: "abc123", plugin: WHERE.plugin, kind: "claude" });

	assert.ok(!prompt.includes("skill-loading-proof"));
	assert.ok(!prompt.includes("/oh-my-slop:"));
	assert.ok(prompt.includes("abc123"));
});

test("the trace-control prompt names the path, because reading it is the point", () => {
	const prompt = renderCellPrompt({ case: "trace-control", nonce: "abc123", plugin: WHERE.plugin, kind: "claude" });

	assert.ok(prompt.includes("/store/plugins/deadbeef/skills/skill-loading-proof/SKILL.md"));
	assert.ok(!prompt.includes("/oh-my-slop:"));
});

test("no prompt ever carries the token, the rule, or the answer", async () => {
	// The whole proof rests on this: a prompt that leaked any of the three would
	// be asking the model to echo, which is precisely what §6.7 says a runtime
	// probe already does and this matrix is for going past.
	for (const name of PROOF_CASES) {
		const prompt = renderCellPrompt({ case: name, nonce: "abc123", plugin: WHERE.plugin, kind: "claude" });

		assert.ok(!prompt.includes(CONTRACT.token), `${name} leaks the token`);
		assert.ok(!prompt.includes("reverse"), `${name} leaks the rule`);
		assert.ok(!prompt.toUpperCase().includes("321CBA"), `${name} leaks the answer`);
	}
});

// ── The run ─────────────────────────────────────────────────────────────────

test("a cell records what it was proven against, not merely whether it passed", async () => {
	const result = await record();
	const cell = result.cells[0];

	assert.equal(cell.verdict, "followed");
	assert.equal(cell.model.declared, "opus");
	assert.equal(cell.model.resolved, "claude-opus-5");
	assert.equal(cell.sessionId, "session-direct-invocation-opus");
	assert.equal(result.harness.version, "2.1.233");
	assert.equal(result.packageRev.digest, "deadbeef");
});

test("each cell's own nonce reaches its own prompt, so none can be answered from another's memory", async () => {
	// The wiring, not the fake: a matrix that minted six nonces and put one of
	// them in every prompt would pass a check on the minted values alone.
	const prompts = new Map();
	const result = await record(ALL_GREEN, {
		session: async (cell) => {
			prompts.set(cell.nonce, cell.prompt);
			return followed(cell);
		},
	});

	assert.equal(prompts.size, result.cells.length);
	for (const cell of result.cells) {
		assert.ok(prompts.get(cell.nonce).includes(cell.nonce), `${cell.case}/${cell.model.declared} lost its nonce`);
	}
});

test("a session that never answered is recorded as unreachable and does not stop the matrix", async () => {
	const result = await record({
		...ALL_GREEN,
		"model-invocation": () => ({ answered: false, text: "", toolUses: [], said: "exit 1: unknown model" }),
	});

	assert.equal(result.cells.length, 6);
	assert.deepEqual(
		result.cells.filter((cell) => cell.case === "model-invocation").map((cell) => cell.verdict),
		["unreachable", "unreachable"],
	);
});

// ── The claims ──────────────────────────────────────────────────────────────

test("every survey claim the matrix speaks to is assessed, discharged or not", async () => {
	const assessed = assessClaims(await record());

	assert.equal(assessed.length, SURVEY_CLAIMS.length);
	for (const claim of assessed) {
		assert.ok(["discharged", "unverified"].includes(claim.status));
		assert.ok(claim.because.length > 0);
		assert.ok(claim.claim.length > 0);
	}
});

test("an all-green matrix discharges the claims whose every named axis it varied", async () => {
	const byId = Object.fromEntries(assessClaims(await record()).map((claim) => [claim.id, claim]));

	assert.equal(byId["loads-and-follows"].status, "discharged");
	assert.equal(byId["alias-resolution"].status, "discharged");
	assert.equal(byId["trace-distinguishes-loading"].status, "discharged");
});

test("a claim naming an axis this matrix cannot vary stays unverified, however green the cells are", async () => {
	// The models axis had this guard; the two axes the *claims' own sentences*
	// name — the interactive/headless surface and the harness version — did not,
	// and both were reported discharged with the untested half demoted to a
	// footnote. §6.7's rule is that a status is derived from the cells that ran,
	// never narrated, and a caveat on a green claim is narration.
	const byId = Object.fromEntries(assessClaims(await record()).map((claim) => [claim.id, claim]));

	assert.equal(byId["documented-command"].status, "unverified");
	assert.match(byId["documented-command"].because, /interactive/);

	assert.equal(byId["trigger-consistency"].status, "unverified");
	assert.match(byId["trigger-consistency"].because, /2\.1\.233/);
});

test("an unverified claim still says what the matrix did establish toward it", async () => {
	// Otherwise the honest status costs the reader the evidence: "headless is
	// proven, interactive is not" is a more useful sentence than either half.
	const byId = Object.fromEntries(assessClaims(await record()).map((claim) => [claim.id, claim]));

	assert.match(byId["documented-command"].established, /headless/i);
	assert.match(byId["trigger-consistency"].established, /between the models/i);
	assert.equal(byId["loads-and-follows"].established, null);
});

test("a claim naming Opus and Fable is not discharged by a matrix that ran neither", async () => {
	// The first shape of this assessment counted verdicts and not *whose*: a
	// green haiku-only run reported "Opus and Fable actually load and follow the
	// named skills" as discharged, which is a silent wrong answer of exactly the
	// class §15 calls load-bearing. A claim that names models is evidence about
	// those models or about nothing.
	const result = await record(ALL_GREEN, {
		models: [{ declared: "haiku", profile: { name: "haiku-builder", kind: "claude", model: "haiku" } }],
	});
	const byId = Object.fromEntries(assessClaims(result).map((claim) => [claim.id, claim]));

	assert.equal(byId["loads-and-follows"].status, "unverified");
	assert.match(byId["loads-and-follows"].because, /opus, fable/);
	assert.equal(byId["alias-resolution"].status, "unverified");
	assert.equal(byId["trigger-consistency"].status, "unverified");

	// The model-independent claim is untouched: it is about the trace, not about
	// which model produced it.
	assert.equal(byId["trace-distinguishes-loading"].status, "discharged");
});

test("a claim this matrix does not address stays unverified however green the cells are", async () => {
	const byId = Object.fromEntries(assessClaims(await record()).map((claim) => [claim.id, claim]));

	assert.equal(byId["role-closure"].status, "unverified");
});

test("one red cell withdraws the claim it was the evidence for", async () => {
	const result = await record({ ...ALL_GREEN, "direct-invocation": (cell) => ({ ...followed(cell), text: "sorry?" }) });
	const byId = Object.fromEntries(assessClaims(result).map((claim) => [claim.id, claim]));

	assert.equal(byId["loads-and-follows"].status, "unverified");
	assert.match(byId["loads-and-follows"].because, /no-receipt/);
	// A claim is withdrawn by its own evidence: the alias resolution the same
	// cells recorded is untouched by what the model then said.
	assert.equal(byId["alias-resolution"].status, "discharged");
});

test("the trace claim weighs every invoked cell, not just the directly invoked ones", async () => {
	// A `model-invocation` cell is invoked too — the control is the only cell
	// that is not. Counting half of them rendered "all 2 invoked cells show
	// none" for a run of four, and left a model-invoked read unexamined.
	const result = await record({
		...ALL_GREEN,
		"model-invocation": readItInstead,
	});
	const byId = Object.fromEntries(assessClaims(result).map((claim) => [claim.id, claim]));

	assert.equal(byId["trace-distinguishes-loading"].status, "unverified");
	assert.match(byId["trace-distinguishes-loading"].because, /read the body off disk/);
});

test("the trace claim counts all four invoked cells when they are quiet", async () => {
	const byId = Object.fromEntries(assessClaims(await record()).map((claim) => [claim.id, claim]));

	assert.match(byId["trace-distinguishes-loading"].because, /all 4 invoked cells/);
});

test("a control cell that read nothing leaves the trace question open", async () => {
	// The converse check. If the deliberately-reading cell shows no read, the
	// trace did not carry one, and the silent cells prove nothing about loading.
	const result = await record({ ...ALL_GREEN, "trace-control": followed });
	const byId = Object.fromEntries(assessClaims(result).map((claim) => [claim.id, claim]));

	assert.equal(byId["trace-distinguishes-loading"].status, "unverified");
});

// ── The document ────────────────────────────────────────────────────────────

test("the document cites the harness version, the resolved model ids and the tree digest", async () => {
	const document = renderMatrixDocument(await record());

	assert.ok(document.includes("2.1.233"));
	assert.ok(document.includes("claude-opus-5"));
	assert.ok(document.includes("claude-fable-5"));
	assert.ok(document.includes("sha256:deadbeef"));
});

test("the document records §11.7's checkout metadata beside the digest", async () => {
	// §11.7 keeps the digest authoritative and the commit plus dirty flag as
	// metadata. The document already admits it digested a tree that predates
	// its own existence, so without the commit the point it names cannot be
	// reconstructed from history at all.
	const document = renderMatrixDocument(await record());

	assert.ok(document.includes("c0ffee1234567890"));
	assert.match(document, /dirty/i);
});

test("a checkout that is not a repository root says so rather than inventing a commit", async () => {
	const document = renderMatrixDocument(await record(ALL_GREEN, { checkout: { commit: null, dirty: null } }));

	assert.ok(!document.includes("c0ffee"));
	assert.match(document, /not a repository root/i);
});

test("the document records the plugin by name and revision, never by its run-scoped path", async () => {
	// §6.3 builds the plugin into an immutable *run-scoped* directory, so the
	// path is a fact about a temporary directory that no longer exists by the
	// time anyone reads this. Printing it invites a reader to check something
	// that cannot be checked; the name and the revision are the durable facts.
	const document = renderMatrixDocument(await record());

	assert.ok(document.includes("`oh-my-slop`"));
	assert.ok(!document.includes("/store/plugins/deadbeef"));
});

test("the document states every claim's status in its own words", async () => {
	const document = renderMatrixDocument(await record());

	for (const claim of SURVEY_CLAIMS) assert.ok(document.includes(claim.claim), `missing claim ${claim.id}`);
	assert.ok(document.includes("Still unverified"));
});

test("the document tells the next operator how to re-run it", async () => {
	// The obligation is a repeatable procedure, so the artifact carries the
	// command that regenerates it — a transcript that cannot be re-taken is the
	// thing §6.7 asks for instead of.
	const document = renderMatrixDocument(await record());

	assert.ok(document.includes("tests/live/prove-skill-loading.mjs"));
});

test("the document renders one row per cell", async () => {
	const document = renderMatrixDocument(await record());
	const rows = document.split("\n").filter((line) => line.startsWith("| `opus`") || line.startsWith("| `fable`"));

	assert.equal(rows.length, 6);
});
