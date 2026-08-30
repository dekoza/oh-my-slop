/**
 * §8.2's check-evidence record: **one shape, built here, consumed by the feed
 * reader and the prompt renderer.**
 *
 * `pipeline/feeds.mjs` builds it from a verify record and the bytes the ledger
 * answered; `worker/prompt.mjs` renders it under the trusted-evidence heading.
 * Before this module each spelled the fields on its own, so a field added to
 * one silently dropped out of the other. Now the constructor is the only place
 * the fields are named and `checkEvidenceMetadata` is the only place they are
 * selected for display.
 *
 * The bytes are optional and the reason for their absence is not: exactly one
 * of `output` and `unavailable` is a string. A missing reference, an expired
 * blob, a re-hash failure — each is a sentence in the prompt's own voice, never
 * an untyped throw out of a launch (§12.5). The verdict fields ride along
 * because a runner that exits 0 having tested nothing prints something that
 * reads like success, and `result` is the controller's own classification.
 *
 * @typedef {object} CheckEvidence
 * @property {string} name
 * @property {string} command
 * @property {string} result the controller's classification (§8.2)
 * @property {string | null} reason
 * @property {number | null} exit_code
 * @property {number | null} duration_ms
 * @property {boolean} truncated
 * @property {Readonly<{ algorithm: string, digest: string }> | null} reference
 *   the §6.6 artifact reference, or `null` when the verify recorded none
 * @property {string | null} output the decoded bytes, or `null` when unavailable
 * @property {string | null} unavailable why there are no bytes, or `null`
 */

/**
 * @param {object} record a check record off the verify stage's detail
 * @param {{ output: string | null, unavailable: string | null }} bytes
 * @returns {Readonly<CheckEvidence>}
 */
export function checkEvidence(record, { output, unavailable }) {
	if ((output === null) === (unavailable === null)) {
		throw new TypeError("check evidence carries either its output or the sentence saying why there is none");
	}

	return Object.freeze({
		name: record.name,
		command: record.command,
		result: record.result,
		reason: record.reason ?? null,
		exit_code: record.exit_code ?? null,
		duration_ms: record.duration_ms ?? null,
		truncated: record.truncated ?? false,
		reference: record.output === null || record.output === undefined ? null : Object.freeze({ ...record.output }),
		output,
		unavailable,
	});
}

/**
 * The fields a prompt shows beside the bytes: everything but the bytes and the
 * sentence that replaces them. `output` is the reference, so a reader can cite
 * and verify the controller fact by digest (§8.7).
 *
 * @param {CheckEvidence} evidence
 * @returns {object}
 */
export function checkEvidenceMetadata(evidence) {
	return {
		name: evidence.name,
		command: evidence.command,
		result: evidence.result,
		reason: evidence.reason,
		exit_code: evidence.exit_code,
		duration_ms: evidence.duration_ms,
		truncated: evidence.truncated,
		output: evidence.reference,
	};
}
