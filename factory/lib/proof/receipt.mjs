import { BUILDER_ALLOWED_TOOLS } from "../worker/permissions.mjs";
import { FactoryProofError } from "./errors.mjs";

/**
 * §6.7's proof depth, reduced to a decidable question.
 *
 * Runtime verification proves **registration and invocation echo**: the skill's
 * name is in the session's command records, and the session answered. Neither
 * says the model was given the body, and nothing in a command record could.
 * What separates the two is a fact the body alone carries and the prompt does
 * not: a **token** nobody could guess, applied to a **nonce** minted for this
 * cell, under a **rule** stated only on the page. A line carrying all three is
 * a model that read the body and acted on it; a session missing it is not.
 *
 * **The contract is declared once, in the body the model is given.** This
 * module reads it back out of the same bytes the package ships and the tree
 * digest covers, so there is no second copy to drift: a judge holding its own
 * token would go on passing a package whose skill said something else.
 */

/** The shipped skill whose body is the subject of the proof (§6.3 flattens it to this name). */
export const PROOF_ENTRY_SKILL = "skill-loading-proof";

/** The fenced block's info string — the contract's only machine-readable home. */
export const CONTRACT_FENCE = "factory-proof-contract";

/** The fields a contract must carry; absence of any one is a refusal, not a default. */
const CONTRACT_FIELDS = Object.freeze(["marker", "token", "rule"]);

/**
 * The transforms a body may name. A closed set, because the point of the nonce
 * is that the judge and the model compute the *same* answer — a rule the judge
 * cannot run is a cell nothing could decide.
 */
export const RECEIPT_RULES = Object.freeze({
	/** The nonce's characters in reverse order, upper-cased. Nothing else. */
	"reverse-upper": (nonce) => [...nonce].reverse().join("").toUpperCase(),
});

/**
 * The families that cannot deliver the body's content to the model: they write
 * or they bookkeep, and none of them answers with bytes from anywhere.
 */
const DELIVERS_NOTHING = Object.freeze(["Edit", "Write", "NotebookEdit", "TodoWrite"]);

/**
 * The tools whose use means the model went and *fetched* the body rather than
 * being handed it.
 *
 * **Derived from the posture a cell actually runs under**, not listed. A cell is
 * a §6.8 builder session, so every family that posture allows is a channel the
 * body could arrive through, and one added to the allows later defaults to
 * *counting* — the safe direction. A hand-kept list is how `Task` (a subagent
 * that reads the file and reports back) and `WebFetch` came to be missing while
 * `NotebookRead`, which this harness does not emit, was present.
 *
 * Claude registers a skill invocation as a `Skill` tool use. It is not a builder
 * allow — it is the loading itself — so it is absent by construction rather than
 * by an exception anyone maintains.
 */
export const FILESYSTEM_TOOLS = Object.freeze(
	BUILDER_ALLOWED_TOOLS.filter((tool) => !DELIVERS_NOTHING.includes(tool)),
);

/**
 * What one cell can conclude, most-proven first. `read-not-loaded` sits second
 * because it is a *correct* receipt reached the wrong way — the survey's open
 * question about whether traces distinguish native loading from a path read,
 * answered as its own outcome rather than folded into either neighbour.
 */
export const CELL_VERDICTS = Object.freeze([
	/** The receipt, exact, with no filesystem tool in the trace. */
	"followed",
	/** The receipt, exact, but the trace shows the body being read off disk. */
	"read-not-loaded",
	/** Marker and token present — the body reached the model — with the wrong answer. */
	"answered-wrong",
	/** The session answered and produced no receipt at all. */
	"no-receipt",
	/** The session never answered: an unreachable runtime, not a model verdict. */
	"unreachable",
]);

/**
 * Read the contract out of a proof skill's body.
 *
 * @param {string} markdown the SKILL.md as shipped
 * @returns {Readonly<{ marker: string, token: string, rule: string }>}
 * @throws {FactoryProofError} `contract-unreadable`, `contract-rule-unknown`
 */
export function readProofContract(markdown) {
	const block = new RegExp("^```" + CONTRACT_FENCE + "\\s*$([\\s\\S]*?)^```\\s*$", "m").exec(markdown);
	if (block === null) {
		throw new FactoryProofError(
			"contract-unreadable",
			`The proof skill's body carries no \`${CONTRACT_FENCE}\` block, so there is no token, nonce rule, or ` +
				`receipt shape to judge a cell against. §6.7's matrix reads its contract from the body the model is ` +
				`given; without one it would be judging against its own copy, which proves nothing.`,
			{ at: CONTRACT_FENCE },
		);
	}

	const fields = {};
	for (const line of block[1].split("\n")) {
		const entry = /^\s*([a-z]+)\s+(\S.*?)\s*$/.exec(line);
		if (entry !== null) fields[entry[1]] = entry[2];
	}

	const missing = CONTRACT_FIELDS.filter((field) => fields[field] === undefined);
	if (missing.length > 0) {
		throw new FactoryProofError(
			"contract-unreadable",
			`The proof skill's \`${CONTRACT_FENCE}\` block declares no ${missing.join(", ")}. All of ` +
				`${CONTRACT_FIELDS.join(", ")} are read from it, and a missing one cannot be defaulted — the judge would ` +
				`then be asserting something the model was never told.`,
			{ at: CONTRACT_FENCE, missing },
		);
	}

	if (!Object.hasOwn(RECEIPT_RULES, fields.rule)) {
		throw new FactoryProofError(
			"contract-rule-unknown",
			`The proof skill declares rule "${fields.rule}", which no implemented transform answers. The rule is how ` +
				`the judge computes the same value the body asked the model for, so an unimplemented one leaves every ` +
				`cell undecidable. Implemented: ${Object.keys(RECEIPT_RULES).join(", ")}.`,
			{ at: "rule", found: fields.rule, expected: Object.keys(RECEIPT_RULES) },
		);
	}

	return Object.freeze({ marker: fields.marker, token: fields.token, rule: fields.rule });
}

/**
 * The one line a followed body produces for this nonce.
 *
 * @param {Readonly<{ marker: string, token: string, rule: string }>} contract
 * @param {string} nonce
 * @returns {string}
 */
export function expectedReceipt(contract, nonce) {
	return `${contract.marker} ${contract.token} ${RECEIPT_RULES[contract.rule](nonce)}`;
}

/**
 * Judge one cell from what its session produced.
 *
 * @param {object} input
 * @param {Readonly<{ marker: string, token: string, rule: string }>} input.contract
 * @param {string} input.nonce the nonce this cell minted and put in its prompt
 * @param {Readonly<{ answered: boolean, text: string,
 *   toolUses: ReadonlyArray<{ name: string }>, said?: string }>} input.transcript
 * @returns {Readonly<{ verdict: string, receipt: string | null, detail: string | null,
 *   filesystemTools: ReadonlyArray<string> }>}
 */
export function judgeTranscript({ contract, nonce, transcript }) {
	const filesystemTools = Object.freeze([
		...new Set(transcript.toolUses.map((use) => use.name).filter((name) => FILESYSTEM_TOOLS.includes(name))),
	]);

	if (!transcript.answered) {
		return cellVerdict("unreachable", { detail: transcript.said ?? null, filesystemTools });
	}

	const receipt = receiptLine(transcript.text, contract);
	if (receipt === null) return cellVerdict("no-receipt", { filesystemTools });
	if (receipt !== expectedReceipt(contract, nonce)) return cellVerdict("answered-wrong", { receipt, filesystemTools });

	// A correct receipt says the body's content reached the model. Only the
	// trace says *how*, and the two are reported separately for exactly that
	// reason (§6.7 — "proves following", and the survey's trace question).
	return cellVerdict(filesystemTools.length === 0 ? "followed" : "read-not-loaded", { receipt, filesystemTools });
}

/**
 * The receipt the answer carries, or null.
 *
 * **Prose on either side of it is tolerated, and that is deliberate.** The body
 * asks for one line and nothing else, but a model that wraps the line in a
 * sentence has still demonstrably read the body; scoring that as a loading
 * failure would report the wrong defect. So the marker and token locate the
 * receipt anywhere on a line, and the answer is the **one whitespace-delimited
 * word** after them — leaving anything further along the line, exactly as the
 * leading half is left.
 *
 * What is *not* tolerated is a wrong answer: it is found and returned rather
 * than silently unmatched, so `answered-wrong` can say the body reached the
 * model and the rule did not.
 */
function receiptLine(text, contract) {
	const shape = new RegExp(`${escapeRegExp(contract.marker)}\\s+${escapeRegExp(contract.token)}\\s+(\\S+)`);
	for (const line of text.split("\n")) {
		const found = shape.exec(line);
		if (found !== null) return `${contract.marker} ${contract.token} ${found[1]}`;
	}
	return null;
}

function escapeRegExp(literal) {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One judged cell.
 *
 * The verdict is checked against `CELL_VERDICTS` here rather than trusted,
 * because it reaches the operator's document: the package's own idiom for
 * `closureFinding` and `probeFinding`, and what keeps the exported vocabulary
 * from being a list nothing consults.
 *
 * @param {string} verdict one of CELL_VERDICTS
 * @param {{ receipt?: string | null, detail?: string | null,
 *   filesystemTools: ReadonlyArray<string> }} evidence
 * @returns {Readonly<object>}
 */
export function cellVerdict(verdict, { receipt = null, detail = null, filesystemTools = [] }) {
	if (!CELL_VERDICTS.includes(verdict)) {
		throw new Error(`Unknown cell verdict "${verdict}".`);
	}
	return Object.freeze({ verdict, receipt, detail, filesystemTools: Object.freeze([...filesystemTools]) });
}
