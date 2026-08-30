import { readArtifact } from "../artifacts/ledger.mjs";
import { PHASE_VERIFY } from "../domain/vocabulary.mjs";
import { stageResults } from "./stages.mjs";

/**
 * §8.2's declared bridge from controller-run advisory checks to the next
 * agent-borne phase.
 *
 * The declaration and the evidence meet here. Config says which named checks
 * feed `phase`; the latest verify stage says what those checks actually did and
 * carries each output's digest reference. The bytes are resolved through the
 * artifact ledger — never by path and never from a worker's report (§8.7,
 * §12.1). A check absent from `feeds` is not read and cannot leak into a prompt.
 *
 * `implement` is a legitimate target because a verify failure routes to a
 * repair attempt under that phase (§8.5). The sibling harden slice adds its
 * phase to the shared agent-borne vocabulary; config validation and this reader
 * need no hard-coded knowledge of it.
 *
 * @param {object} store an open store
 * @param {object} where
 * @param {string} where.run
 * @param {number} where.ticket
 * @param {string} where.phase the agent-borne phase whose prompt is being built
 * @param {ReadonlyArray<object>} where.checks the validated check declarations
 * @returns {ReadonlyArray<Readonly<object>>} captured controller facts, in
 *   declaration order, with output bytes decoded as the declared text media type
 */
export function fedCheckEvidence(store, { run, ticket, phase, checks }) {
	const selected = checks.filter((check) => check.severity === "advisory" && check.feeds.includes(phase));
	if (selected.length === 0) return Object.freeze([]);

	const verified = stageResults(store, { run, ticket, phase: PHASE_VERIFY }).at(-1);
	if (verified === undefined) return Object.freeze([]);
	const recorded = new Map((verified.detail?.checks ?? []).map((check) => [check.name, check]));

	return Object.freeze(
		selected.flatMap((declaration) => {
			const check = recorded.get(declaration.name);
			if (check?.output === null || check?.output === undefined) return [];

			return [
				Object.freeze({
					name: check.name,
					command: check.command,
					result: check.result,
					reason: check.reason,
					exit_code: check.exit_code,
					duration_ms: check.duration_ms,
					truncated: check.truncated,
					reference: Object.freeze({ ...check.output }),
					output: readArtifact(store, check.output).toString("utf8"),
				}),
			];
		}),
	);
}
