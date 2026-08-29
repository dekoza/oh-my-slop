import { nativeInvocation } from "../worker/prompt.mjs";
import { PROOF_ENTRY_SKILL, expectedReceipt, judgeTranscript } from "./receipt.mjs";

/**
 * §6.7's acceptance matrix: the one-time, by-hand proof — per (harness version ×
 * model × package revision) — that the models **load and follow** a skill body,
 * rather than merely registering its name.
 *
 * This module is the plan, the run loop, the claim assessment, and the document.
 * It starts no session: the runner hands it one `session(cell)` function, so the
 * paid half of the proof is the only half that is not exercised by tests.
 *
 * **The matrix is not preflight.** §6.2's probe runs per revision, at zero model
 * cost, before every run; this costs real turns and is re-run when one of the
 * three axes moves. §15 carries it as an acceptance obligation, and the artifact
 * this renders is what discharges it.
 */

/**
 * The three cells per model.
 *
 * The first two are the survey's own split — "Direct invocation and
 * natural-language auto-triggering are separate test cases; success in one does
 * not prove the other". The third is a **control**, on #163's pattern: a cell
 * that deliberately reads the body off disk, so the other two cells' toolless
 * traces are evidence of native loading rather than an untested assumption. A
 * proof that could not have observed the failure it rules out is not a proof.
 */
export const PROOF_CASES = Object.freeze(["direct-invocation", "model-invocation", "trace-control"]);

/** The one case that is a control rather than an invocation; every other cell is invoked. */
export const CONTROL_CASE = "trace-control";

/**
 * The still-unverified claims from `docs/surveys/software-factory-foundations-2026-08-13.md`
 * §7, quoted, each with the evidence that would discharge it.
 *
 * They are data rather than prose in the document because a claim's status has
 * to be **derived from the cells that ran** (§6.7): a matrix that narrated its
 * own conclusions would keep claiming what a red cell had just withdrawn.
 *
 * **A claim is evidence about every axis its own sentence names, or about
 * nothing.** `covers` is that list, and a claim naming an axis this matrix did
 * not vary stays unverified however green its cells are. Without it a green run
 * discharges a sentence about models it never ran, or about an interactive
 * worker it never launched, with the untested half demoted to a footnote — a
 * silent wrong answer rather than a red cell, which is the class §15 calls
 * load-bearing. What the matrix *did* establish toward such a claim is said in
 * `established`, so honesty costs the reader no evidence.
 */
export const SURVEY_CLAIMS = Object.freeze([
	Object.freeze({
		id: "loads-and-follows",
		claim: "Opus and Fable actually load and follow the named skills from the proposed plugin artifact.",
		covers: Object.freeze({ models: Object.freeze(["opus", "fable"]) }),
		needs: Object.freeze({ kind: "case-verdict", case: "direct-invocation", verdict: "followed" }),
		established: null,
	}),
	Object.freeze({
		id: "documented-command",
		claim:
			"Successful execution of the documented `/plugin-name:skill-name` command from a session-local plugin in " +
			"interactive versus headless Claude workers.",
		// The claim's own axis is the surface, and a scripted cell can only run
		// one end of it: the cell binding is the worker binding **plus** the
		// probe-only stream-json IO flags, which is a `--print` session. §6.4
		// runs every real worker attempt in an interactive pane, so the half this
		// matrix cannot reach is the load-bearing half.
		covers: Object.freeze({ surfaces: Object.freeze(["headless", "interactive"]) }),
		needs: Object.freeze({ kind: "case-verdict", case: "direct-invocation", verdict: "followed" }),
		established:
			"The headless half is proven: every `direct-invocation` cell executed the documented " +
			"`<plugin>:<skill>` command from a session-local plugin and followed the body it loaded.",
	}),
	Object.freeze({
		id: "alias-resolution",
		claim:
			"Account entitlement and actual resolution of the `opus` and `fable` aliases; CLI help proves accepted " +
			"syntax, not access.",
		covers: Object.freeze({ models: Object.freeze(["opus", "fable"]) }),
		needs: Object.freeze({ kind: "resolved-model" }),
		established: null,
	}),
	Object.freeze({
		id: "trigger-consistency",
		claim: "Skill-trigger consistency across Claude Code versions and between Opus and Fable.",
		// One matrix records one harness version, so this claim is unreachable
		// from a single document **by construction** — it is discharged, if ever,
		// by comparing two of them.
		covers: Object.freeze({ models: Object.freeze(["opus", "fable"]), harnessVersions: 2 }),
		needs: Object.freeze({ kind: "case-verdict", case: "model-invocation", verdict: "followed" }),
		established:
			"Between the models: every `model-invocation` cell triggered on the description alone, naming no skill.",
	}),
	Object.freeze({
		id: "trace-distinguishes-loading",
		claim:
			"Whether traces expose enough evidence to distinguish native Skill loading from a model merely reading a " +
			"path.",
		covers: Object.freeze({}),
		needs: Object.freeze({ kind: "trace-distinguishes" }),
		established: null,
	}),
	Object.freeze({
		id: "role-closure",
		claim: "The complete transitive skill set needed by each factory role under arbitrary consumer instructions.",
		covers: Object.freeze({}),
		needs: Object.freeze({ kind: "not-addressed" }),
		established: null,
	}),
]);

/**
 * The cartesian plan, model-major so a document reads down one model at a time.
 *
 * The cases are `PROOF_CASES` rather than a parameter: the three are what §6.7
 * requires of a cell, not a selection a caller makes, and a matrix run with a
 * subset would silently discharge less than its document claims.
 *
 * @param {ReadonlyArray<object>} models
 * @returns {ReadonlyArray<Readonly<{ model: object, case: string }>>}
 */
export function planCells(models) {
	return Object.freeze(
		models.flatMap((model) => PROOF_CASES.map((name) => Object.freeze({ model, case: name }))),
	);
}

/**
 * One cell's prompt.
 *
 * **No prompt carries the token, the rule, or the answer.** That is the whole
 * mechanism: everything the receipt needs lives in the body, so a session that
 * produces one read the body. A prompt that leaked any of the three would be
 * asking for the echo §6.7 says a runtime probe already gets.
 *
 * @param {{ case: string, nonce: string, plugin: { name: string, dir: string }, kind: string }} cell
 * @returns {string}
 */
export function renderCellPrompt({ case: name, nonce, plugin, kind }) {
	const nonceLine = `Proof nonce: ${nonce}`;

	if (name === "direct-invocation") {
		return `${nativeInvocation({ kind, skill: PROOF_ENTRY_SKILL, plugin: plugin.name })}\n\n${nonceLine}\n`;
	}
	if (name === "model-invocation") {
		// Natural language, naming no skill and no command: what has to do the
		// work here is the description, which is the half a direct invocation
		// never exercises.
		return `I need the skill-loading receipt for a proof nonce.\n\n${nonceLine}\n`;
	}
	if (name === "trace-control") {
		return (
			`Read the file at ${proofSkillPath(plugin)} and do exactly what it says.\n\n${nonceLine}\n`
		);
	}
	throw new TypeError(`"${name}" is not one of §6.7's cases (${PROOF_CASES.join(", ")}).`);
}

/** Where the §6.3 generator puts the proof skill — depth 1, as the loader requires. */
function proofSkillPath(plugin) {
	return `${plugin.dir}/skills/${PROOF_ENTRY_SKILL}/SKILL.md`;
}

/**
 * Run the plan and assemble the record.
 *
 * @param {object} input
 * @param {Readonly<{ runtime: string, binary: string, version: string }>} input.harness
 * @param {Readonly<{ algorithm: string, digest: string, files: number }>} input.packageRev
 * @param {Readonly<{ commit: string | null, dirty: boolean | null }>} input.checkout §11.7's
 *   metadata: recorded, never authoritative, and both null off a repository root
 * @param {string} input.surface which end of §6.4's surface axis the cells ran on
 * @param {Readonly<{ name: string, dir: string }>} input.plugin
 * @param {Readonly<{ marker: string, token: string, rule: string }>} input.contract
 * @param {ReadonlyArray<{ declared: string, profile: object }>} input.models
 * @param {(cell: object) => string} input.mintNonce
 * @param {(cell: object) => Promise<object>} input.session runs one cell, answering
 *   with `{ answered, text, toolUses, resolvedModel, sessionId, said }`
 * @param {string} input.at ISO timestamp the document is stamped with
 * @returns {Promise<Readonly<object>>}
 */
export async function runMatrix({
	harness,
	packageRev,
	checkout,
	surface,
	plugin,
	contract,
	models,
	mintNonce,
	session,
	at,
}) {
	const cells = [];

	for (const planned of planCells(models)) {
		const nonce = mintNonce(planned);
		const prompt = renderCellPrompt({ case: planned.case, nonce, plugin, kind: harness.runtime });
		const transcript = await session({ ...planned, nonce, prompt });
		const judged = judgeTranscript({ contract, nonce, transcript });

		cells.push(
			Object.freeze({
				case: planned.case,
				model: Object.freeze({
					declared: planned.model.declared,
					profile: planned.model.profile.name,
					resolved: transcript.resolvedModel ?? null,
				}),
				nonce,
				expected: expectedReceipt(contract, nonce),
				sessionId: transcript.sessionId ?? null,
				...judged,
			}),
		);
	}

	return Object.freeze({
		at,
		harness,
		packageRev,
		checkout,
		surface,
		plugin,
		contract,
		cells: Object.freeze(cells),
	});
}

/**
 * Each survey claim's status, derived from the cells that ran.
 *
 * @param {Readonly<object>} record
 * @returns {ReadonlyArray<Readonly<object>>}
 */
export function assessClaims(record) {
	return Object.freeze(SURVEY_CLAIMS.map((claim) => Object.freeze({ ...claim, ...assess(claim, record) })));
}

/**
 * A claim's status: the axes its sentence names, then the cells' own evidence.
 *
 * Coverage is checked **first and separately**, because the two answer different
 * questions. "Did the cells pass?" is meaningless about an axis nothing varied,
 * and running the two together is how a green haiku matrix came to discharge a
 * sentence about Opus and Fable.
 */
function assess(claim, record) {
	const gap = uncovered(claim.covers, record);
	return gap === null ? evidence(claim.needs, record) : { status: "unverified", because: gap };
}

/** The first axis the claim names that this matrix did not vary, said in full. */
function uncovered(covers, record) {
	const models = (covers.models ?? []).filter((model) => !record.cells.some((cell) => cell.model.declared === model));
	if (models.length > 0) {
		return `The claim is about ${covers.models.join(", ")}, and this matrix ran no cell for ${models.join(", ")}.`;
	}

	const surfaces = (covers.surfaces ?? []).filter((surface) => surface !== record.surface);
	if (surfaces.length > 0) {
		return (
			`The claim is about ${covers.surfaces.join(" and ")} workers, and every cell here ran ${record.surface}: ` +
			`the cell binding is the worker binding **plus** the probe-only stream-json IO flags, which is a \`--print\` ` +
			`session. §6.4 runs every real worker attempt in an interactive pane, so ${surfaces.join(", ")} is the half ` +
			`this matrix cannot reach — and the load-bearing one.`
		);
	}

	if ((covers.harnessVersions ?? 1) > 1) {
		return (
			`The claim is about consistency across harness versions, and one matrix records one: ` +
			`${record.harness.version}. It is discharged, if ever, by comparing this document with the next one — ` +
			`never from inside either.`
		);
	}

	return null;
}

function evidence(needs, record) {
	if (needs.kind === "not-addressed") {
		return { status: "unverified", because: "No cell in this matrix speaks to it." };
	}

	if (needs.kind === "case-verdict") {
		const cells = record.cells.filter((cell) => cell.case === needs.case);
		const off = cells.filter((cell) => cell.verdict !== needs.verdict);
		if (cells.length === 0) return { status: "unverified", because: `No \`${needs.case}\` cell was run.` };
		if (off.length > 0) {
			return { status: "unverified", because: `${describe(off)} — expected \`${needs.verdict}\`.` };
		}
		return { status: "discharged", because: `${count(cells.length, `\`${needs.case}\` cell`)}, all \`${needs.verdict}\`.` };
	}

	if (needs.kind === "resolved-model") {
		const blind = record.cells.filter((cell) => cell.model.resolved === null);
		if (blind.length > 0) {
			return {
				status: "unverified",
				because: `${blind.length} of ${record.cells.length} cells recorded no resolved model id.`,
			};
		}
		const resolved = [...new Set(record.cells.map((cell) => `${cell.model.declared} → ${cell.model.resolved}`))];
		return { status: "discharged", because: `Every cell answered under a resolved id: ${resolved.join(", ")}.` };
	}

	if (needs.kind === "trace-distinguishes") {
		// Both sides, or neither counts (#163): the control has to *show* a read,
		// and the invoked cells have to show none. A trace that carried no read
		// even when the model was told to read is a trace that proves nothing
		// about the cells where none appeared.
		const control = record.cells.filter((cell) => cell.case === CONTROL_CASE);
		const saw = control.filter((cell) => cell.filesystemTools.length > 0);
		// Every cell that is not the control is *invoked* — a `model-invocation`
		// cell no less than a directly invoked one. Weighing only the latter
		// rendered "all 2 invoked cells show none" for a run of four, and left a
		// model-invoked read out of the claim's derivation entirely.
		const invoked = record.cells.filter((cell) => cell.case !== CONTROL_CASE);
		const noisy = invoked.filter((cell) => cell.filesystemTools.length > 0);

		if (saw.length === 0) {
			return {
				status: "unverified",
				because:
					`No \`${CONTROL_CASE}\` cell showed a tool that could fetch the body, so the trace was never shown to ` +
					`carry one — the invoked cells' silence is not evidence.`,
			};
		}
		if (noisy.length > 0) {
			return {
				status: "unverified",
				because: `${count(noisy.length, "invoked cell")} read the body off disk rather than being handed it.`,
			};
		}
		return {
			status: "discharged",
			because:
				`${count(saw.length, "control cell")} show the read in the trace (${[...new Set(saw.flatMap((cell) => cell.filesystemTools))].join(", ")}), ` +
				`and all ${count(invoked.length, "invoked cell")} show none.`,
		};
	}

	throw new TypeError(`"${needs.kind}" is not an evidence kind this matrix can assess.`);
}

function describe(cells) {
	return cells.map((cell) => `\`${cell.model.declared}\` answered \`${cell.verdict}\``).join("; ");
}

function count(n, noun) {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The durable artifact (§11.7): what was proven, against exactly which harness
 * version, resolved model id and package tree digest, and how to take it again.
 *
 * @param {Readonly<object>} record
 * @returns {string}
 */
export function renderMatrixDocument(record) {
	const rev = `${record.packageRev.algorithm}:${record.packageRev.digest}`;
	const claims = assessClaims(record);
	const discharged = claims.filter((claim) => claim.status === "discharged");
	const unverified = claims.filter((claim) => claim.status === "unverified");

	return [
		`# Skill-loading acceptance matrix — ${record.harness.runtime} ${record.harness.version}, \`${record.packageRev.digest.slice(0, 12)}\``,
		"",
		`Taken ${record.at}. This is §6.7's one-time deep proof for one point on its three axes:`,
		"**harness version × model × package revision**. It is not preflight — §6.2's probe proves registration and",
		"invocation echo at zero model cost before every run, and this proves *following*, at the cost of real turns.",
		"",
		"## What it was proven against",
		"",
		"| | |",
		"|---|---|",
		`| harness | \`${record.harness.binary}\`, version **${record.harness.version}** |`,
		`| package revision | \`${rev}\` (${record.packageRev.files} files) |`,
		`| checkout | ${checkoutMetadata(record.checkout)} |`,
		`| session surface | ${record.surface} |`,
		`| plugin | \`${record.plugin.name}\`, built by the package's own generator from the revision above |`,
		`| contract | marker \`${record.contract.marker}\`, token \`${record.contract.token}\`, rule \`${record.contract.rule}\` |`,
		"",
		"The contract is read out of the shipped `skills/meta/skill-loading-proof/SKILL.md` — the same bytes the tree",
		"digest above covers and the model was given. No prompt in this matrix carries the token, the rule, or the",
		"answer; a receipt line is therefore a body that reached the model, and a correct one is a body it followed.",
		"",
		"The digest is the working tree as it stood when the cells ran, which is **before this document existed**.",
		"Committing the document moves the tree on by one file; that is the ordinary revision drift the three axes",
		"describe, and not a mismatch.",
		"",
		"## The matrix",
		"",
		"| model | resolved id | case | verdict | tools in trace |",
		"|---|---|---|---|---|",
		...record.cells.map(
			(cell) =>
				`| \`${cell.model.declared}\` | \`${cell.model.resolved ?? "—"}\` | ${cell.case} | **${cell.verdict}** | ` +
				`${cell.filesystemTools.length === 0 ? "none" : cell.filesystemTools.join(", ")} |`,
		),
		"",
		"`followed` is the receipt, exact, with no filesystem tool in the trace. `read-not-loaded` is the same receipt",
		"reached by reading the file — the outcome the `trace-control` cells are *supposed* to reach, and the reason the",
		"other cells' empty trace column is evidence rather than an assumption.",
		"",
		"## Survey claims discharged",
		"",
		...(discharged.length === 0 ? ["None."] : discharged.flatMap((claim) => claimLines(claim))),
		"",
		"## Still unverified",
		"",
		...(unverified.length === 0 ? ["None."] : unverified.flatMap((claim) => claimLines(claim))),
		"",
		"## Re-running it",
		"",
		"Any of the three axes moving — a new harness version, a different model, a changed package revision — makes",
		"this document a statement about a point nothing runs at any more. Take it again:",
		"",
		"```sh",
		"node tests/live/prove-skill-loading.mjs --out docs/proofs/",
		"```",
		"",
		"The runner builds the §6.3 plugin from the working tree, resolves the tree digest, and runs every cell under",
		"the **worker** binding — the argv a worker pane receives, plus the probe-only stream-json IO flags and nothing",
		"else (§6.2's composed-binding rule, amendment row #160). It writes one document per (version × revision), so",
		"an earlier matrix is never overwritten by a later one.",
		"",
		"**It spends model tokens** — one short turn per cell — which is why it is a script run by hand and not a check",
		"in any suite.",
		"",
	].join("\n");
}

/**
 * §11.7's checkout metadata, or its honest absence.
 *
 * The digest is authoritative and this is not — but a digest of a working tree
 * that no longer exists is unreconstructable without it, and this document says
 * outright that it digested a tree predating its own existence.
 */
function checkoutMetadata(checkout) {
	if (checkout?.commit == null) {
		return "not a repository root — no commit or dirty flag to record (§11.7)";
	}
	return `commit \`${checkout.commit}\`, worktree **${checkout.dirty ? "dirty" : "clean"}** (metadata only, §11.7)`;
}

function claimLines(claim) {
	return [
		`- **${claim.claim}**`,
		`  - ${claim.because}`,
		...(claim.established === null || claim.status === "discharged"
			? []
			: [`  - *What this matrix did establish:* ${claim.established}`]),
	];
}
