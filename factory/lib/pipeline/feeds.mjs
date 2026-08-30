import { FactoryArtifactError } from "../artifacts/errors.mjs";
import { readArtifact } from "../artifacts/ledger.mjs";
import { checkEvidence } from "../checks/evidence.mjs";
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
 * **Absence is a sentence, never a throw.** A fed check whose verify record
 * carries no reference, or whose blob the ledger can no longer answer — expired
 * at §12.2's horizon on a long-idle run, tombstoned, missing, or failing its
 * re-hash — still reaches the prompt, with `output: null` and an `unavailable`
 * sentence naming the digest and the reason. Evidence that is absent is not a
 * production failure, so `FactoryArtifactError` stays out of the lane's
 * failure set and nothing here escapes a repair launch (§12.5).
 *
 * @param {object} store an open store
 * @param {object} where
 * @param {string} where.run
 * @param {number} where.ticket
 * @param {string} where.phase the agent-borne phase whose prompt is being built
 * @param {ReadonlyArray<object>} where.checks the validated check declarations
 * @returns {ReadonlyArray<Readonly<import("../checks/evidence.mjs").CheckEvidence>>}
 *   captured controller facts, in declaration order, with output bytes decoded
 *   as the declared text media type
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
			if (check === undefined) return [];
			return [checkEvidence(check, outputOf(store, check))];
		}),
	);
}

/** The bytes, or the reason there are none — in the prompt's own voice. */
function outputOf(store, check) {
	if (check.output === null || check.output === undefined) {
		return {
			output: null,
			unavailable: "This check's output was not recorded as an artifact, so there is nothing to quote here.",
		};
	}

	try {
		return { output: readArtifact(store, check.output).toString("utf8"), unavailable: null };
	} catch (error) {
		// Only the ledger's own answers — unknown, expired, missing, re-hash failed
		// — are absence. An I/O or store failure underneath is a host fault, and a
		// sentence in a prompt would hide it.
		if (!(error instanceof FactoryArtifactError)) throw error;
		return {
			output: null,
			unavailable: `The recorded output ${check.output.digest} could not be read back: ${error.message}`,
		};
	}
}
