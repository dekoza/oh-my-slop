import { writeArtifact } from "../artifacts/writes.mjs";
import { checkRecord } from "./run.mjs";

/**
 * §8.7 and §12.1: **check output lands in the artifact store and is referenced
 * by digest, never embedded.**
 *
 * `software-factory` merely demanded a `"tests":["command: result"]` array it
 * never re-ran; what the controller now has is the bytes its own rerun produced.
 * They can be megabytes, so they go in as content and come back as §6.6's
 * reference — digest, media type, byte count, producer, class — which is what
 * reaches an event payload, the attestation, the PR body, and the operator's
 * screen. The bytes themselves reach none of them.
 *
 * **Running a check is not an effect; recording its output is.** The write is a
 * mutation outside the database with a probe that re-hashes the blob (§4.5), and
 * that is the whole reason this is a separate module from `run.mjs`: `doctor`
 * runs the same checks under a handle that may not write (§14.24), and a runner
 * that recorded as it ran could not be shared with it.
 */

/** Check output is bytes a human reads; nothing parses it (§8.3's v1 answer). */
const CHECK_OUTPUT_MEDIA_TYPE = "text/plain";

/**
 * Record each result's captured output and answer the records that name them.
 *
 * **The artifact name carries the execution, not just the check.** A check's
 * name alone would key every rerun of `unit` in a run to one effect, and the
 * second execution's different bytes would arrive as §4.5's payload conflict —
 * turning a perfectly ordinary re-entry (§10.4 preflights again) into a refusal.
 * Two executions of a suite are two mutations, and they are keyed as two.
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {ReadonlyArray<object>} results the runner's results, with their bytes
 * @param {object} context
 * @param {string} context.execution the id of this run of the set — a baseline's
 *   id, later an attempt's verification
 * @param {string | null} [context.run]
 * @param {number | null} [context.ticket]
 * @param {string | null} [context.attempt]
 * @param {string} context.phase §2.2's phase this set serves
 * @param {string} context.actor `controller`, or `operator:<verb>`
 * @param {number} context.fencingGeneration the generation the writer holds (§4.6)
 * @param {number} context.at
 * @returns {ReadonlyArray<object>} one record per result, each naming its artifact
 */
export function recordCheckOutputs(store, results, { execution, run = null, ticket = null, attempt = null, phase, actor, fencingGeneration, at }) {
	return Object.freeze(
		results.map((result) => {
			const written = writeArtifact(store, {
				content: result.output,
				mediaType: CHECK_OUTPUT_MEDIA_TYPE,
				role: "check-output",
				name: `${result.name}-${execution}`,
				run,
				ticket,
				attempt,
				phase,
				actor,
				fencingGeneration,
				at,
			});

			return Object.freeze(checkRecord(result, written.reference));
		}),
	);
}
