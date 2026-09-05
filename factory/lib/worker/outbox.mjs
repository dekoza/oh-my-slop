import { readFileSync, statSync } from "node:fs";

import {
	FINDING_SEVERITIES,
	REVIEW_VERDICTS,
	WORKER_WRITABLE_OUTCOMES,
	WORKER_WRITABLE_REASON_CLASSES,
} from "../domain/vocabulary.mjs";

/**
 * §6.6's attempt outbox: **schema-versioned JSON at a controller-designated
 * path outside the worktree, and the authoritative *domain* result.**
 *
 * This module is the reader and the judge, never the writer — the worker writes
 * the file, atomically, exactly once. What the controller owns is the verdict,
 * and the verdict is a closed set of states rather than a boolean:
 *
 * - `absent` — nothing there. Paired with liveness it becomes silent-completion
 *   or a timeout, and those are different outcomes (§6.6's state table).
 * - `unreadable` / `invalid` — **present but not schema-valid is
 *   `invalid-result`**, which §6.6 makes distinct from no-file-at-turn-end. A
 *   worker that wrote something we cannot read did *something*, and conflating
 *   that with silence would route it to the wrong retry tier (§8.10).
 * - `foreign` — schema-valid but echoing a different identity tuple. §6.5 makes
 *   that an **automation failure**: two attempts' results have crossed, and
 *   nothing downstream may treat either as evidence.
 * - `valid` — the record, with its worker-writable status.
 *
 * **First schema-valid content wins.** The caller keeps the first valid record
 * it read and re-reads nothing for state afterwards; post-harvest writes are
 * evidence, never state, and a late outbox after a cancellation is ignored
 * outright.
 */

/**
 * **A problem sentence never embeds what the worker wrote.** The problems this
 * reader names ride `attempt.ended`, the implement stage's detail, and — on
 * §8.10's `implement × invalid-result` row, whose evidence is marked fact — the
 * fresh attempt's "controller-verified facts" (§8.5). A sentence quoting a
 * refused `status` would carry whatever the worker typed there into that block
 * under the controller's own name. So every sentence names the field and the
 * closed set it missed, and the value stays in the file it came from.
 */

/** The outbox's own shape version, carried by every record (§6.6). */
export const OUTBOX_SCHEMA_VERSION = 1;

/**
 * Whether a trace was written at all: a non-empty list (#189). The one
 * predicate the three readers of a trace — the role's owed-ness, the fan-out's
 * read, the template's refusal — share, so "written" has one spelling.
 *
 * @param {unknown} trace
 * @returns {boolean}
 */
export function traceWritten(trace) {
	return Array.isArray(trace) && trace.length > 0;
}

/** The states this reader answers in. Closed, so a caller can branch exhaustively. */
export const OUTBOX_STATES = Object.freeze(["absent", "unreadable", "invalid", "foreign", "valid"]);

/**
 * A ceiling on what the controller will read back. §6.6 sends large output to
 * artifacts and keeps references in the outbox, so a megabyte-scale file is a
 * worker ignoring that rule rather than a big result — and reading it into the
 * controller is how one attempt's stdout becomes an event payload.
 */
export const MAX_OUTBOX_BYTES = 256 * 1024;

/**
 * §6.6's reference shape, as the outbox may carry it: **digest, media type,
 * byte count, producer, retention class** — never bytes and never a path.
 */
const REFERENCE_KEYS = Object.freeze(["algorithm", "digest", "media_type", "bytes"]);

/**
 * Read the outbox and judge it against the identity the controller minted.
 *
 * @param {string} path the controller-designated outbox path
 * @param {{ run: string, ticket: number, phase: string, attempt: string }} identity
 * @returns {Readonly<{ state: string, record: object | null, problems: ReadonlyArray<string>, bytes: number | null }>}
 */
export function readOutbox(path, identity) {
	let bytes;
	try {
		bytes = statSync(path).size;
	} catch {
		return answer("absent", { problems: [] });
	}

	if (bytes > MAX_OUTBOX_BYTES) {
		return answer("invalid", {
			bytes,
			problems: [
				`the outbox is ${bytes} bytes, over the ${MAX_OUTBOX_BYTES}-byte ceiling; large output belongs in ` +
					`artifacts, referenced by digest (§6.6, §12.1)`,
			],
		});
	}

	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		return answer("unreadable", { bytes, problems: [`the outbox could not be read: ${error.code ?? error.message}`] });
	}

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		// A partial file is the expected shape of this failure when a worker
		// writes in place instead of temp-and-rename — which is exactly the
		// mistake §6.6's "written atomically" exists to make visible.
		return answer("invalid", { bytes, problems: [`the outbox is not JSON: ${error.message}`] });
	}

	const problems = shapeProblems(parsed);
	if (problems.length > 0) return answer("invalid", { bytes, problems });

	const mismatched = identityProblems(parsed, identity);
	if (mismatched.length > 0) {
		return answer("foreign", { bytes, problems: mismatched, record: normalise(parsed) });
	}

	return answer("valid", { bytes, record: normalise(parsed) });
}

/**
 * §6.6's schema, checked field by field so the diagnosis names what is wrong.
 *
 * The status set is `WORKER_WRITABLE_OUTCOMES` and nothing else: a worker
 * writing `timeout` or `automation-failure` would be claiming a
 * controller-derived outcome about a state it cannot see, and §8.8 keeps those
 * two vocabularies apart precisely so it cannot.
 */
function shapeProblems(parsed) {
	const problems = [];

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return [`the outbox is a ${Array.isArray(parsed) ? "list" : typeof parsed}, not a §6.6 record object`];
	}

	if (parsed.schema_version !== OUTBOX_SCHEMA_VERSION) {
		problems.push(
			`schema_version is ${absentOr(parsed.schema_version, `not ${OUTBOX_SCHEMA_VERSION}`)}; this controller ` +
				`reads ${OUTBOX_SCHEMA_VERSION} (§6.6)`,
		);
	}
	if (!WORKER_WRITABLE_OUTCOMES.includes(parsed.status)) {
		problems.push(
			`status is ${absentOr(parsed.status, "not one of the worker-writable set")}; the worker-writable set is ` +
				`exactly ${WORKER_WRITABLE_OUTCOMES.join(", ")} — every other outcome is controller-derived (§6.6, §8.8)`,
		);
	}
	for (const field of ["run", "phase", "attempt"]) {
		if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
			problems.push(`${field} is missing; every status carries the full identity tuple (§6.6)`);
		}
	}
	if (!Number.isSafeInteger(parsed.ticket)) {
		problems.push("ticket is missing; every status carries the full identity tuple (§6.6)");
	}

	problems.push(...statusProblems(parsed));
	problems.push(...verdictProblems(parsed));
	problems.push(...traceProblems(parsed));
	problems.push(...referenceProblems(parsed));

	return problems;
}

/**
 * #189's requirement trace, held to its shape wherever one appears: a
 * non-empty list of `{requirement, evidence}` rows, both non-empty text, with
 * an optional `note` beside them.
 *
 * **The judgement is structural and never semantic.** Whether `requirement`
 * really quotes a line of the ticket, and whether `evidence` names a path the
 * diff touched, are review-spec's questions (§8.4) — the reviewer is the judge
 * of truth, and a controller that checked a row against the snapshot would be a
 * third reviewer with no verdict slot to write in. What the controller can hold
 * is that the rows *exist* to be checked: an empty list is a trace in name only
 * and is refused as one, because a reviewer briefed with it has nothing to
 * check against and would pass the ticket's coverage question back to the diff
 * alone, which is the state this block exists to end.
 *
 * **Whether a trace is *owed* is role knowledge and lives elsewhere** — with
 * the builder's phase executor, the way whether a verdict is owed lives with
 * the fan-out. This reader has never known which roles exist, and a reviewer's
 * record legitimately carries none.
 */
function traceProblems(parsed) {
	const trace = parsed.trace;
	if (trace === undefined || trace === null) return [];
	if (!Array.isArray(trace)) {
		return [`trace is a ${typeof trace}, not a list of {requirement, evidence} rows (§6.6)`];
	}
	if (trace.length === 0) {
		return ["trace is an empty list; a trace carries one row per requirement the attempt was briefed with (§6.6)"];
	}

	const problems = [];
	for (const [index, row] of trace.entries()) {
		if (row === null || typeof row !== "object" || Array.isArray(row)) {
			problems.push(`trace[${index}] is not a {requirement, evidence} row (§6.6)`);
			continue;
		}
		for (const field of ["requirement", "evidence"]) {
			if (nonEmptyText(row[field])) continue;
			problems.push(
				`trace[${index}] carries no ${field}; every row quotes a ticket line and names the path and test that answer it (§6.6)`,
			);
		}
		if (row.note !== undefined && row.note !== null && typeof row.note !== "string") {
			problems.push(`trace[${index}].note is not text (§6.6)`);
		}
	}
	return problems;
}

/**
 * §8.4's verdict, held to its shape wherever one appears.
 *
 * **Whether a verdict is *owed* is role knowledge and lives in
 * `pipeline/review.mjs`** — this module judges §6.6's schema and has never known
 * which roles exist. What it does judge is that a verdict, once written, is one
 * the union rule can act on: a word from the closed pair, a findings list, every
 * finding carrying a severity from the closed pair and a **mandatory citation**,
 * and the word agreeing with its own findings.
 *
 * The agreement check is the one that earns its place. §8.4 decides the phase
 * mechanically — one or more `blocking` findings on either axis ⇒ reject — so a
 * reviewer writing `reject` with nothing blocking, or `approve` over a blocking
 * finding, has produced a record where its own word and the rule that reads it
 * disagree. Picking a winner there would be the controller reranking an axis it
 * was told never to rerank; refusing it as `invalid-result` sends the axis back
 * through §8.10's retry row, which is the outcome that asks for another reading.
 */
function verdictProblems(parsed) {
	const hasVerdict = parsed.verdict !== undefined && parsed.verdict !== null;
	const hasFindings = parsed.findings !== undefined && parsed.findings !== null;
	if (!hasVerdict && !hasFindings) return [];

	const problems = [];
	if (!REVIEW_VERDICTS.includes(parsed.verdict)) {
		problems.push(
			`verdict is ${absentOr(parsed.verdict, "not one of the closed pair")}; §8.4's verdict is one of ` +
				`${REVIEW_VERDICTS.join(", ")}`,
		);
	}

	if (!Array.isArray(parsed.findings)) {
		return [...problems, "a verdict carries a findings list, written out even when it is empty (§8.4)"];
	}

	for (const [index, finding] of parsed.findings.entries()) {
		problems.push(...findingProblems(finding, index));
	}
	if (problems.length > 0) return problems;

	const blocking = parsed.findings.filter((finding) => finding.severity === FINDING_SEVERITIES.blocking).length;
	if (parsed.verdict === "reject" && blocking === 0) {
		problems.push(
			"the verdict is reject and no finding is blocking; §8.4 decides the phase from the blocking set, so this " +
				"record's own word and the rule that reads it disagree (§8.4)",
		);
	}
	if (parsed.verdict === "approve" && blocking > 0) {
		problems.push(
			`the verdict is approve over ${blocking} blocking finding(s); one or more on either axis is a rejection (§8.4)`,
		);
	}

	return problems;
}

/**
 * One finding: a severity from the closed pair, a **mandatory citation**, and
 * the statement it supports.
 *
 * §8.4 makes the citation mandatory because a finding with nothing to cite is an
 * opinion, and an opinion that cannot be checked is not reviewable — the same
 * sentence both axis skills carry. It is free text rather than a typed reference
 * because the two axes cite different things: a spec line on one, a documented
 * standard on the other. What the controller can hold is that there **is** one.
 */
function findingProblems(finding, index) {
	if (finding === null || typeof finding !== "object" || Array.isArray(finding)) {
		return [`findings[${index}] is not a §8.4 finding object`];
	}

	const problems = [];
	if (!Object.values(FINDING_SEVERITIES).includes(finding.severity)) {
		problems.push(
			`findings[${index}].severity is ${absentOr(finding.severity, "not one of the closed pair")}; the set is ` +
				`exactly ${Object.values(FINDING_SEVERITIES).join(", ")} (§8.4)`,
		);
	}
	for (const field of ["citation", "statement"]) {
		if (nonEmptyText(finding[field])) continue;
		problems.push(`findings[${index}] carries no ${field}; every finding carries a mandatory citation (§8.4)`);
	}

	return problems;
}

/** What each worker-writable status must say beyond the tuple (§6.6, §8.8). */
function statusProblems(parsed) {
	if (parsed.status === "needs-human") {
		const problems = [];
		if (typeof parsed.reason_class !== "string" || parsed.reason_class.length === 0) {
			problems.push("needs-human carries a reason class (§8.8)");
		} else if (!WORKER_WRITABLE_REASON_CLASSES.includes(parsed.reason_class)) {
			// §14.18 routes a worker-writable class to `paused` and a
			// controller-derived one to `failed`, so a worker allowed to name the
			// second kind could file its own ticket as an infrastructure failure —
			// or claim a budget it cannot see has run out (§6.6, §8.8).
			problems.push(
				`reason_class is not one of the worker-writable set, which is exactly ` +
					`${WORKER_WRITABLE_REASON_CLASSES.join(", ")} — every other class is controller-derived (§6.6, §8.8)`,
			);
		}
		if (!nonEmptyText(parsed.question)) {
			// "the exact question", not a summary: the human's reply is what
			// resumes the ticket, and a vague pause costs a round trip.
			problems.push("needs-human carries the exact question a human must answer (§6.6)");
		}
		return problems;
	}

	if (parsed.status === "worker-failed") {
		return nonEmptyText(parsed.explanation) ? [] : ["worker-failed carries a classification and an explanation (§6.6)"];
	}

	if (parsed.status === "completed") {
		return Array.isArray(parsed.commits) && parsed.commits.every((sha) => /^[0-9a-f]{7,64}$/i.test(sha))
			? []
			: ["completed carries the commit SHAs it produced, as a list (§6.6)"];
	}

	return [];
}

/**
 * Evidence references, held to §6.6's shape: an artifact is named by digest and
 * never by path (§14.28), and its bytes never ride in the record.
 */
function referenceProblems(parsed) {
	const references = parsed.evidence;
	if (references === undefined || references === null) return [];
	if (!Array.isArray(references)) return ["evidence is a list of §6.6 artifact references"];

	const problems = [];
	for (const [index, reference] of references.entries()) {
		if (reference === null || typeof reference !== "object") {
			problems.push(`evidence[${index}] is not an artifact reference`);
			continue;
		}
		for (const key of REFERENCE_KEYS) {
			if (reference[key] === undefined) problems.push(`evidence[${index}] has no ${key} (§6.6, §12.1)`);
		}
		if (typeof reference.path === "string") {
			problems.push(`evidence[${index}] names a path; an artifact is referenced by digest alone (§14.28)`);
		}
	}
	return problems;
}

/**
 * §6.5: **the outbox result must echo the full tuple.** A mismatch is not a
 * validation quibble — it means the file at this attempt's path was written by
 * something else, and the only safe reading is that the automation crossed two
 * attempts.
 */
function identityProblems(parsed, identity) {
	const problems = [];
	// The four §6.5 slots by name, never every key the caller's identity object
	// happens to carry: the minted tuple travels with derived fields beside it,
	// and comparing one of those against an outbox would fail every record.
	for (const field of ["run", "ticket", "phase", "attempt"]) {
		if (parsed[field] === identity[field]) continue;
		// The minted value is the controller's own and may be named; the value the
		// file echoes is somebody else's and stays in the file. (An absent slot
		// never reaches here — `shapeProblems` refused it first.)
		problems.push(
			`${field} echoes a value other than what the controller minted, ${JSON.stringify(identity[field] ?? null)}`,
		);
	}
	return problems;
}

/** A field that says something: text with at least one non-blank character. */
function nonEmptyText(value) {
	return typeof value === "string" && value.trim().length > 0;
}

/** "absent", or the caller's description of a value that is present and wrong — never the value. */
function absentOr(value, otherwise) {
	return value === undefined || value === null ? "absent" : otherwise;
}

/**
 * The record as the controller carries it onward: the schema's own fields, with
 * everything else dropped.
 *
 * Dropping is deliberate. Whatever a worker adds is unreviewed text on its way
 * into an event payload and a monitor screen, and §6.6 already says worker-
 * reported evidence is context only.
 */
function normalise(parsed) {
	return Object.freeze({
		schema_version: parsed.schema_version,
		status: parsed.status,
		run: parsed.run,
		ticket: parsed.ticket,
		phase: parsed.phase,
		attempt: parsed.attempt,
		summary: typeof parsed.summary === "string" ? parsed.summary : null,
		commits: Object.freeze(Array.isArray(parsed.commits) ? [...parsed.commits] : []),
		reason_class: typeof parsed.reason_class === "string" ? parsed.reason_class : null,
		question: typeof parsed.question === "string" ? parsed.question : null,
		classification: typeof parsed.classification === "string" ? parsed.classification : null,
		explanation: typeof parsed.explanation === "string" ? parsed.explanation : null,
		verdict: typeof parsed.verdict === "string" ? parsed.verdict : null,
		// The findings come through **as written and in the order written**: §8.4's
		// union never merges or reranks, and a normaliser that sorted them here
		// would rerank one axis before the union ever saw it.
		findings: Object.freeze(Array.isArray(parsed.findings) ? parsed.findings.map(finding) : []),
		// Worker-reported test evidence is **context only** (§6.6, §14.16): the
		// controller's own rerun is the attestation boundary, so this rides as a
		// string and is never parsed into a pass/fail anything acts on.
		test_evidence: typeof parsed.test_evidence === "string" ? parsed.test_evidence : null,
		// #189's trace rides **as written and in the order written**, for the same
		// reason the findings do: review-spec checks it row by row against the
		// ticket, and a reader that sorted or merged rows would be editing the
		// object under review. Absent is carried as `null`, never as an empty
		// list — the two are different answers to "was one written".
		trace: Array.isArray(parsed.trace) ? Object.freeze(parsed.trace.map(traceRow)) : null,
		evidence: Object.freeze(Array.isArray(parsed.evidence) ? parsed.evidence.map(reference) : []),
	});
}

/** One trace row's three fields (§6.6), and nothing a worker added beside them. */
function traceRow(entry) {
	return Object.freeze({
		requirement: entry.requirement,
		evidence: entry.evidence,
		note: typeof entry.note === "string" ? entry.note : null,
	});
}

function reference(entry) {
	return Object.freeze(Object.fromEntries(REFERENCE_KEYS.map((key) => [key, entry[key]])));
}

/** §8.4's three finding fields, and nothing a reviewer added beside them. */
function finding(entry) {
	return Object.freeze({ severity: entry.severity, citation: entry.citation, statement: entry.statement });
}

function answer(state, { record = null, problems = [], bytes = null }) {
	return Object.freeze({ state, record, problems: Object.freeze([...problems]), bytes });
}
