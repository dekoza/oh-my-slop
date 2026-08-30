import { CHECK_RESULTS } from "../domain/vocabulary.mjs";
import { CHECK_SELECTIONS, checkRecord, runChecks } from "../checks/run.mjs";
import { assessHarvest } from "../git/harvest.mjs";

/**
 * §8.1's controller phases, **with no model in them**.
 *
 * `harvest` and `verify` are where §7.4's git predicates and §8.2's check
 * results become §8.10's outcomes. Both underlying modules stop deliberately
 * short of that mapping — a predicate answers `harvestable: false, reason:
 * "worktree-dirty"`, and a check answers `passed | failed | unrunnable` per
 * check — because a verdict and an outcome are different things and the second
 * is the pipeline's vocabulary, not theirs.
 *
 * Putting a model in either would add a failure mode and buy nothing: there is
 * no judgement here, only a fact and the word §8.8 has for it.
 */

/**
 * §7.4's harvest-side predicates, as §8.10's `harvest` row.
 *
 * The two `false` reasons collapse into one outcome on purpose. §8.10 routes
 * both to repair on the repair budget, and splitting them into two outcomes
 * would put a distinction in the taxonomy that nothing downstream reads — while
 * the distinction that *is* read, which fault it was, is §7.4's split between
 * harvest-side and integration-side predicates and is already carried by which
 * phase answered.
 *
 * @param {object} clone the private clone's handle (`git/clone.mjs`)
 * @param {{ worktreePath: string, branch: string, baseCommit: string, onto?: string | null }} attempt
 *   `baseCommit` is the attempt's own base, which for a repair is the prior
 *   attempt's tip rather than the run's pin (§7.3, §8.5); `onto` is the base a
 *   rebase-repair was told to rebase onto, read off its mint, and the boundary
 *   §7.4 counts against under that tier (#194)
 * @returns {Promise<Readonly<{ outcome: string, detail: Readonly<object> }>>}
 */
export async function harvestPhase(clone, { worktreePath, branch, baseCommit, onto = null }) {
	const verdict = await assessHarvest(clone, { worktreePath, branch, baseCommit, onto });

	if (verdict.harvestable) {
		return Object.freeze({
			outcome: "passed",
			detail: Object.freeze({ head: verdict.head, commits_ahead: verdict.commitsAhead }),
		});
	}

	return Object.freeze({
		outcome: "predicate-failed",
		detail: Object.freeze({
			reason: verdict.reason,
			leftovers: Object.freeze([...(verdict.leftovers ?? [])]),
			commits_ahead: verdict.commitsAhead ?? null,
		}),
	});
}

/**
 * §8.2's required set, rerun by the controller, as §8.10's `verify` row.
 *
 * **`unrunnable` outranks `failed`.** A set in which one required check never
 * ran did not establish the mechanical verdict at all, and §14.16 makes that
 * rerun the *only* attestation boundary — so calling the phase `failed` would
 * attest a verdict from an incomplete run, and charge the worker's repair budget
 * for a broken host. Routing to §8.10's `unrunnable` row instead re-runs the
 * whole set on the automation budget; a genuine failure that survives the retry
 * reports itself then, and nothing is lost by hearing about it one phase later.
 *
 * The full required set runs every time (§8.2) — per-surface targeting is
 * exactly the inference that goes wrong silently, so this function never takes a
 * caller's subset. It selects **all** of them, because §8.2's "advisory checks
 * record evidence and never block" has nowhere else to happen: §8.3's baseline
 * runs the required set alone, and §8.7's attestation carries *every* check with
 * its required flag. Advisory results are therefore in the evidence and out of
 * the verdict, which is what "never block" means.
 *
 * @param {ReadonlyArray<object>} declared the validated `checks` block (§11.6)
 * @param {{ cwd: string, env?: object, now?: () => number,
 *   record?: (results: ReadonlyArray<object>) => ReadonlyArray<object> }} where the
 *   controller-owned verification worktree the set runs in. `record` is the
 *   controller's artifact writer; tests and read-only callers may omit it.
 * @returns {Promise<Readonly<{ outcome: string, detail: Readonly<object> }>>}
 */
export async function verifyPhase(declared, { cwd, env, now, record = (results) => results.map((result) => checkRecord(result)) }) {
	const run = await runChecks(declared, {
		select: CHECK_SELECTIONS.all,
		cwd,
		...(env === undefined ? {} : { env }),
		...(now === undefined ? {} : { now }),
	});

	const records = await record(run.results);
	const required = run.results.filter((result) => result.severity === "required");
	const unrunnable = required.filter((result) => result.result === CHECK_RESULTS.unrunnable);
	const failed = required.filter((result) => result.result === CHECK_RESULTS.failed);

	const outcome =
		unrunnable.length > 0 ? CHECK_RESULTS.unrunnable : failed.length > 0 ? CHECK_RESULTS.failed : CHECK_RESULTS.passed;

	return Object.freeze({
		outcome,
		// `checkRecord` and never the bytes: large output belongs in the artifact
		// store, referenced by digest (§8.7, §12.1), and this detail rides into an
		// event payload.
		detail: Object.freeze({
			checks: Object.freeze([...records]),
			red: Object.freeze([...run.red]),
			unrunnable: Object.freeze(unrunnable.map((result) => result.name)),
			skipped: Object.freeze([...run.skipped]),
		}),
	});
}
