import { EXIT_USAGE } from "./exit-codes.mjs";

/**
 * The answer a repository-less invocation gets, as one value (#217).
 *
 * Two paths refuse this way and they are deliberately **not** one error class:
 * `config/discover.mjs` throws a `FactoryConfigError` when the load cannot find
 * a repository root, and `controller/stop.mjs` — exempt from that load (§10.5)
 * and so walking up itself (§11.1) — returns a `FactoryStopError` for a verb
 * that no longer does a load at all. The situations differ, the error types
 * differ, and the operator prose differs with them.
 *
 * What must not differ is **what a `--json` consumer sees**: §10.5 states the
 * two carry the same wire answer, and before this module that agreement was
 * prose. Rename the reason on one side, reshape the detail, or move either exit
 * code, and every test still passed while a script branching on the refusal —
 * exactly the script an operator writes after #205 cost them their escape hatch
 * — started getting two answers from one verb set. The three things a consumer
 * reads therefore live here, and both sites read them from here.
 *
 * `exitCode` is not a third opinion about §10.3's table: it names the class this
 * reason belongs to, which is the usage class `EXIT_USAGE` publishes and the one
 * the config-load path already carries wholesale for every reason it refuses
 * with. The verb-level table in `controller/stop.mjs` reads it rather than
 * choosing again, because that verb's other refusals are about a run and this
 * one is about the operator's line.
 *
 * The binding is mechanical in three directions. Each closed reason set still
 * spells the wire string out — a published set is worth reading straight off
 * the page, the way `exit-codes.mjs` argues — and an import-time check in each
 * set's module refuses a set this contract's reason has fallen out of, so a
 * one-sided rename fails when the binary loads rather than when an operator
 * runs it. What no import-time check can see is the two answers side by side;
 * `tests/node/factory_controller_stop.test.mjs` drives both invocations and
 * compares them.
 */
export const NO_REPO_ROOT = Object.freeze({
	/** The wire string both refusals report. */
	reason: "no-repo-root",

	/** §10.3's exit 1: the operator's line is wrong, and no run was reached. */
	exitCode: EXIT_USAGE,

	/**
	 * The structured detail both refusals carry: the directory walked up from,
	 * which is the only fact either has to give — there is no repository to name.
	 *
	 * @param {string} cwd the invocation directory
	 * @returns {{ from: string }}
	 */
	details: (cwd) => ({ from: cwd }),
});
