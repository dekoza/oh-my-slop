import { recordCheckOutputs } from "../checks/artifacts.mjs";
import { CHECK_SELECTIONS, runChecks, selectedChecks } from "../checks/run.mjs";
import { PHASE_INTEGRATE } from "../domain/vocabulary.mjs";
import { newUlid } from "../identity/ulid.mjs";
import { attestedDocument } from "./attestation.mjs";

/**
 * #211's publication boundary: **the advisory checks that feed nothing, run once
 * per published ticket rather than once per attempt.**
 *
 * `checks/run.mjs`'s `publication` selection decides membership and states why
 * the partition falls where it does. **What this module owns is the moment**:
 * after both review axes approve, after §7.4's integration-side predicates pass,
 * and before §8.7's attestation and §7.5's push — the last point at which the
 * evidence still lands on the artifact a human opens, and the first at which
 * there is exactly one commit it can be about.
 *
 * **Running a check is still not an effect** (§4.5, `checks/run.mjs`): what this
 * module makes durable is the *output*, through `checks/artifacts.mjs`, and the
 * results themselves through the attestation the caller writes from them.
 */

/**
 * Run the deferred advisory set at the candidate commit, or answer with what an
 * earlier pass already recorded for that exact commit.
 *
 * **Reuse is read off §8.7's own artifact, and that is the point.** The
 * attestation is written before the push and carries every declared check, so a
 * controller that died anywhere from that moment on — a refused push, a tracker
 * that would not answer, a lost host — re-enters `integrate` with the
 * publication set already measured. Re-running a ten-minute tier to rebuild a
 * document that has to be byte-identical anyway would be the retry paying the
 * bill this module exists to stop; worse, it could not *be* byte-identical —
 * §4.5 keys that write by content, and two runs of one check differ in a
 * duration — so a re-measure would meet a payload conflict instead of the
 * idempotent re-write a re-entry expects. That is why an attestation whose bytes
 * cannot be read back refuses by name rather than falling through to a run
 * (`attestedDocument`), and why this function needs no worktree on that path.
 *
 * **Invalidated by the commit, not by the attempt.** §9.5's compare-and-publish
 * loop can re-verify onto a base that moved, and the candidate commit changes
 * when it does; a document naming a different commit measured a different tree,
 * so its results are not this publication's evidence and the set runs again.
 *
 * The window this leaves is stated rather than papered over: a crash between the
 * run and the attestation write re-runs the set, because nothing durable
 * recorded it yet. Closing it would mean a second durable record of the same
 * facts — a §12.1 artifact role whose only reader is this function — and two
 * records of one measurement is the disagreement §8.7 exists to prevent.
 *
 * @param {object} store an open store
 * @param {object} what
 * @param {object} what.hold the controller's hold — §4.6's fencing generation
 * @param {string} what.run
 * @param {number} what.ticket
 * @param {string} what.attempt the builder attempt being published
 * @param {ReadonlyArray<object>} what.checks the validated `checks` block (§11.6)
 * @param {string} what.candidateCommit the exact commit about to be pushed
 * @param {string} what.cwd the controller-owned integration worktree, sitting at
 *   that commit
 * @param {Record<string, string | undefined>} [what.env]
 * @param {string} what.actor
 * @param {() => number} what.now
 * @returns {Promise<Readonly<{ records: ReadonlyArray<object>, reused: boolean,
 *   names: ReadonlyArray<string> }>>} one record per deferred advisory check, in
 *   declaration order
 */
export async function publicationChecks(
	store,
	{ hold, run, ticket, attempt, checks, candidateCommit, cwd, env, actor, now },
) {
	const deferred = selectedChecks(checks, CHECK_SELECTIONS.publication);
	const names = Object.freeze(deferred.map((check) => check.name));
	if (deferred.length === 0) return frozen({ records: [], reused: false, names });

	const already = recordedFor(store, { run, ticket, attempt, candidateCommit, names });
	if (already !== null) return frozen({ records: already, reused: true, names });

	const at = now();
	// The execution's id, exactly as §8.3's baseline and §8.1's verify mint one:
	// it names this one run of the set and keys its output artifacts, so a re-run
	// after a lost attestation is a second mutation rather than one key offered
	// two answers (§4.5).
	const execution = newUlid(at);
	const answer = await runChecks(checks, {
		select: CHECK_SELECTIONS.publication,
		cwd,
		...(env === undefined ? {} : { env }),
		now,
	});

	// Not guarded, deliberately. §8.7's evidence is the reason this set ran at
	// all, and an artifact write that fails is the automation failing — the
	// publication stops rather than proceeding to attest results it could not
	// record. Advisory means "never blocks on what the check *said*", never
	// "proceed without the evidence".
	const records = recordCheckOutputs(store, answer.results, {
		execution,
		run,
		ticket,
		attempt,
		phase: PHASE_INTEGRATE,
		actor,
		fencingGeneration: hold.fence().generation,
		at,
	});

	return frozen({ records, reused: false, names });
}

/**
 * The deferred set's results as an earlier pass at this same commit recorded
 * them, or `null` when there is no such record to stand on.
 *
 * A document that names the candidate commit but is short of a deferred check is
 * `null` too: the pair of them is one measurement, and reusing half of it would
 * hand the assembly an incomplete set to refuse one step later, with nothing
 * left to re-measure it from.
 */
function recordedFor(store, { run, ticket, attempt, candidateCommit, names }) {
	const document = attestedDocument(store, { run, ticket, attempt });
	if (document === null || document.published?.commit !== candidateCommit) return null;

	const byName = new Map((document.checks ?? []).map((check) => [check.name, check]));
	const reused = names.map((name) => byName.get(name));
	if (reused.some((record) => record === undefined)) return null;

	// Handed back in `checkRecord`'s own shape, with §8.7's derived `required`
	// flag stripped: this function answers what the *runner* would have answered,
	// and a record carrying a field only the document has would make a reused
	// answer distinguishable from a measured one by its shape alone.
	return Object.freeze(reused.map(asRecord));
}

function asRecord({ required, ...record }) {
	return Object.freeze(record);
}

function frozen({ records, reused, names }) {
	return Object.freeze({ records: Object.freeze([...records]), reused, names });
}
