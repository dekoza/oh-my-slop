import { spawn } from "node:child_process";

import { CHECK_RESULTS } from "../domain/vocabulary.mjs";
import { createTurnstile } from "../state/turnstile.mjs";
import { FactoryCheckError } from "./errors.mjs";

/**
 * §8.2's mechanical checks, executed and classified.
 *
 * **Declared, never discovered.** Every command this module runs came out of
 * `.pi/factory.json`'s `checks` block (§11.6). Nothing here opens
 * `pyproject.toml`, `package.json`, or a Makefile, and **`AGENTS.md` prose is
 * never parsed at runtime** (§14.34) — the only input is the validated list the
 * caller was handed by the loader.
 *
 * **A selection names where a set is paid for, never which area a change
 * touched.** The selector is four closed values, so "which files did this
 * touch" is not a question this API can be asked; §8.2 names per-surface
 * targeting as exactly the inference that goes wrong silently. Within a
 * selection the whole of it runs — a selection is never narrowed by a diff —
 * and every selection that gates anything runs the **full required set**.
 *
 * **Fault attribution is the point of the classification** (§8.8's three words):
 * a required check exiting non-zero *within its declared expected-failure exit
 * codes* is the worker's failure and routes to repair; a timeout, a signal, an
 * exec that is not there, or any other exit code is `unrunnable` — an automation
 * failure, never a worker failure. Neither legacy system ran the project's own
 * checks at all; both trusted agent-reported evidence, which is why worker
 * reports stay context and this is the attestation boundary (§14.16).
 *
 * **Running a check is not an effect** (§4.5). An effect is a mutation of an
 * external system with a probe that can re-read it; a check is a computation
 * over a throwaway worktree whose *output* is the durable thing, and that output
 * enters the world as an artifact — which is an effect, written by
 * `artifacts.mjs`. There is nothing here for a probe to ask the world about.
 */

/**
 * §8.2's selections — **where a set is paid for**, and there is no fifth.
 *
 * `required` is §8.3's baseline set — the checks whose failure stops a run.
 * `all` adds the advisory ones and belongs to the operator's explicit
 * `doctor --baseline` diagnostic (§10.5), which is asked for by hand and
 * therefore runs everything it can be asked for.
 *
 * `verify` and `publication` **partition the declared list**, and that partition
 * is the whole of #211. An advisory check records evidence and never blocks, so
 * running every one of them on every verify pays for it once per *attempt* to
 * produce evidence that is read once per *published ticket* — a ten-minute
 * browser tier billed three times, on a ticket that takes two repair rounds, to
 * inform one publication. The line between the two halves is `feeds`, because
 * that is the repository's own declaration of where the output is read:
 *
 * - `verify` — the required set, plus every advisory check that **feeds** a
 *   later agent phase. A fed check's captured output reaches the next prompt
 *   (§8.2), so every run of it is read, and the attempt is where it must be paid
 *   for.
 * - `publication` — the advisory checks that feed nothing. Their only reader is
 *   the attestation on the commit that gets published (§8.7), so they run once,
 *   at §7.5's publication boundary, against the exact candidate commit.
 *
 * **Severity still says what a red result does; it never said what it costs.**
 * Neither half can block: `ok` is computed over the required results alone
 * wherever the selection came from.
 */
export const CHECK_SELECTIONS = Object.freeze({
	required: "required",
	all: "all",
	verify: "verify",
	publication: "publication",
});

/**
 * The one place a selection becomes a predicate — so the four cannot drift into
 * four call sites that happen to agree.
 *
 * `feeds` is read tolerantly: §11.6 turns an absent list into `[]` at load, and
 * a declaration that never went through the loader means the same thing by
 * leaving the key out.
 */
const SELECTED_BY = Object.freeze({
	[CHECK_SELECTIONS.required]: (check) => check.severity === "required",
	[CHECK_SELECTIONS.all]: () => true,
	[CHECK_SELECTIONS.verify]: (check) => check.severity === "required" || feedsOf(check).length > 0,
	// **`!== "required"`, not `=== "advisory"`**, so the two halves are a
	// partition rather than two overlapping filters: every declared check has
	// exactly one home, and §8.7's "every declared check exactly once" cannot be
	// lost to a severity nobody here thought about.
	[CHECK_SELECTIONS.publication]: (check) => check.severity !== "required" && feedsOf(check).length === 0,
});

function feedsOf(check) {
	return check.feeds ?? [];
}

/**
 * Which declared checks a selection names, without running any of them.
 *
 * §7.5's publication boundary has to know whether it owes a run at all before it
 * has a worktree to run one in, and #211's partition is only an invariant while
 * one function answers it. A caller re-deriving "the advisory ones that feed
 * nothing" is the second opinion this export exists to refuse.
 *
 * @param {ReadonlyArray<object>} declared the validated `checks` block (§11.6)
 * @param {string} select one of `CHECK_SELECTIONS`
 * @returns {ReadonlyArray<object>} in declaration order
 * @throws {FactoryCheckError} `check-selection-unknown`
 */
export function selectedChecks(declared, select) {
	requireSelection(select);
	return Object.freeze(declared.filter(SELECTED_BY[select]));
}

/**
 * Why a check could not be run, as opposed to having failed. Closed, because
 * each of these is a distinct thing an operator fixes, and "it did not work" is
 * the answer that sends them to read a log the factory already read.
 */
export const UNRUNNABLE_REASONS = Object.freeze({
	/** The check outran §11.6's mandatory timeout and its process group was killed. */
	timeout: "timeout",
	/** The process died on a signal nobody here sent. */
	signal: "signal",
	/** The shell could not find the command (exit 127). */
	execNotFound: "exec-not-found",
	/** A non-zero exit outside the declared expected-failure contract. */
	unexpectedExitCode: "unexpected-exit-code",
	/** The process could not be started at all. */
	spawnFailed: "spawn-failed",
});

/** What a shell answers for a command it cannot find. */
const COMMAND_NOT_FOUND = 127;

/**
 * How much of a check's output is kept. A test suite can print without bound,
 * and the bytes are held in memory until the artifact is written; the cap is
 * **recorded on the result** rather than applied silently.
 */
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * §14.23: **two lanes never run mechanical checks concurrently.**
 *
 * One chain per process, and the controller process is the only one running
 * lanes — the controller lease excludes a second one (§4.6). It is a chain
 * rather than a lease because §11.6's check schema declares **no
 * parallel-safety**: two suites at once collide on ports, databases, and
 * fixtures, and produce a failure the ticket did not cause — the exact
 * conflation §8 exists to prevent. `checks[].parallelSafe` is the recorded v2
 * upgrade that lifts this (§9.5); a later reader must not read the serialization
 * as an oversight and "fix" it into cross-ticket check collisions.
 *
 * It is deliberately not a lease row: a lease is settled by probing its holder,
 * and there is nothing to probe here — the holder is a promise in this process.
 * §9.5's `integration` lease serializes rebase → verify → publish for a reason
 * one indirection up, and holding it is the caller's business, not this
 * module's.
 *
 * **What this does not cover, stated rather than left to be discovered:**
 * `doctor --baseline` is a second process, and §10.5 makes `doctor` lock-free on
 * purpose so it answers while a run is live. An operator who runs one during a
 * run's baseline gets the collision §9.5 describes. That is the operator's own
 * doing rather than two lanes racing, and the alternative — a lock — is what
 * §10.5 refuses, because a diagnostic that blocks on a live controller is a
 * diagnostic nobody can use when it matters.
 */
const serialized = createTurnstile();

/**
 * Run a declared set of checks in one directory and classify each result.
 *
 * @param {ReadonlyArray<object>} declared the validated `checks` block (§11.6) —
 *   the whole list, every time; this function selects within it and never takes
 *   a caller's subset
 * @param {object} where
 * @param {string} where.select one of `CHECK_SELECTIONS`
 * @param {string} where.cwd the controller-owned worktree the checks run in (§8.2)
 * @param {Record<string, string | undefined>} [where.env] the environment the
 *   commands see. **The controller's own by default**: §6.8's isolation is a
 *   property of a *worker's* session, and these are the controller's reruns of
 *   the project's own commands
 * @param {number} [where.maxOutputBytes]
 * @param {() => number} [where.now] injectable clock, so a duration is measurable
 * @returns {Promise<Readonly<{ ok: boolean, red: ReadonlyArray<string>,
 *   results: ReadonlyArray<object>, skipped: ReadonlyArray<string> }>>}
 * @throws {FactoryCheckError} `check-selection-unknown`
 */
export async function runChecks(declared, { select, cwd, env = process.env, maxOutputBytes = MAX_OUTPUT_BYTES, now = Date.now }) {
	// Before the lane, so a caller asking for something §8.2 does not offer waits
	// for nothing and starts nothing.
	const selected = selectedChecks(declared, select);

	return serialized(async () => {
		const results = [];
		for (const check of selected) {
			results.push(await runCheck(check, { cwd, env, maxOutputBytes, now }));
		}

		// §8.2: advisory checks record evidence and never block, so the verdict
		// reads the required ones alone — and an `unrunnable` required check is as
		// red as a failed one. A run must never start on a suite nobody could run
		// (§14.14); which of the two it was decides who is blamed, not whether the
		// set is green.
		const red = results.filter(
			(result) => result.severity === "required" && result.result !== CHECK_RESULTS.passed,
		);

		return Object.freeze({
			ok: red.length === 0,
			red: Object.freeze(red.map((result) => result.name)),
			results: Object.freeze(results),
			skipped: Object.freeze(
				declared.filter((check) => !selected.includes(check)).map((check) => check.name),
			),
		});
	});
}

/**
 * One check, run to a classified result.
 *
 * The command is handed to a shell, because §11.6 declares a **command line**
 * and tokenizing one here would be this module inventing a parser for the
 * operator's `&&`. The shell is started in its own process group and killed as a
 * group on timeout: a suite that survives the check that gave up on it holds the
 * port, the database, and the fixture the next check needs.
 *
 * @returns {Promise<Readonly<object>>} the result, carrying its output as bytes
 */
function runCheck(check, { cwd, env, maxOutputBytes, now }) {
	const startedAt = now();
	const timeoutMs = check.timeout * 1000;

	return new Promise((resolve) => {
		const child = spawn(check.command, {
			cwd,
			env,
			shell: true,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const captured = [];
		let bytes = 0;
		let kept = 0;
		let truncated = false;
		// Both streams into one buffer in arrival order: an operator reading a
		// failure needs the error beside the line that produced it, and two
		// separate artifacts would have to be re-interleaved by hand. `bytes`
		// counts what the check produced and `kept` what survived the cap, so the
		// record can say the difference instead of the cap being invisible.
		const capture = (chunk) => {
			bytes += chunk.length;
			if (truncated) return;

			const room = maxOutputBytes - kept;
			const taken = chunk.length > room ? chunk.subarray(0, room) : chunk;
			captured.push(taken);
			kept += taken.length;
			// Only when bytes were actually dropped: a chunk that exactly fills the
			// remaining room lost nothing, and reporting it truncated would put a
			// caveat on complete evidence. The next chunk finds no room and sets it.
			truncated = chunk.length > room;
		};
		child.stdout.on("data", capture);
		child.stderr.on("data", capture);

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			killGroup(child);
		}, timeoutMs);

		const answer = (verdict) => {
			clearTimeout(timer);
			resolve(
				Object.freeze({
					name: check.name,
					command: check.command,
					severity: check.severity,
					expected_failure_exit_codes: Object.freeze([...check.expectedFailureExitCodes]),
					timeout_ms: timeoutMs,
					started_at: startedAt,
					duration_ms: now() - startedAt,
					output: Buffer.concat(captured),
					output_bytes: bytes,
					truncated,
					...verdict,
				}),
			);
		};

		child.on("error", (error) => answer(classify(check, { spawnError: error })));

		child.on("close", (code, signal) => answer(classify(check, { code, signal, timedOut })));
	});
}

/**
 * §8.2's fault attribution, and **the one place it is decided** — every way a
 * check can end, including never having started, so there is no second site to
 * keep in step with this one.
 *
 * The **declared contract wins over every other reading of an exit code**: a
 * repo that lists 127 has said what 127 means for its check, and second-guessing
 * that here would be the runner overriding the only field §11.6 refuses to
 * default.
 */
function classify(check, { code = null, signal = null, timedOut = false, spawnError = null }) {
	if (spawnError !== null) {
		return {
			result: CHECK_RESULTS.unrunnable,
			reason: UNRUNNABLE_REASONS.spawnFailed,
			exit_code: null,
			signal: null,
			message: `${check.name} could not be started: ${spawnError.message}`,
		};
	}

	if (timedOut) {
		return {
			result: CHECK_RESULTS.unrunnable,
			reason: UNRUNNABLE_REASONS.timeout,
			exit_code: null,
			signal: signal ?? null,
			message: `${check.name} outran its declared timeout of ${check.timeout}s and its process group was killed.`,
		};
	}

	if (code === 0) {
		return { result: CHECK_RESULTS.passed, reason: null, exit_code: 0, signal: null, message: `${check.name} passed.` };
	}

	if (code === null) {
		return {
			result: CHECK_RESULTS.unrunnable,
			reason: UNRUNNABLE_REASONS.signal,
			exit_code: null,
			signal,
			message: `${check.name} was killed by ${signal}, which says nothing about the code under test.`,
		};
	}

	if (check.expectedFailureExitCodes.includes(code)) {
		return {
			result: CHECK_RESULTS.failed,
			reason: null,
			exit_code: code,
			signal: null,
			message: `${check.name} failed with exit ${code}, which it declares as a genuine failure.`,
		};
	}

	if (code === COMMAND_NOT_FOUND) {
		return {
			result: CHECK_RESULTS.unrunnable,
			reason: UNRUNNABLE_REASONS.execNotFound,
			exit_code: code,
			signal: null,
			message: `${check.name} exited ${code}: the shell could not find \`${check.command}\`. This check is broken, not the code under test.`,
		};
	}

	return {
		result: CHECK_RESULTS.unrunnable,
		reason: UNRUNNABLE_REASONS.unexpectedExitCode,
		exit_code: code,
		signal: null,
		message:
			`${check.name} exited ${code}, which is outside its declared expected-failure codes ` +
			`(${check.expectedFailureExitCodes.join(", ") || "none"}). That makes it a broken check, not a failing one.`,
	};
}

/**
 * The result as the journal, the attestation, and the operator read it: **never
 * the bytes.** Large output goes into the artifact store and comes back as
 * §6.6's reference; the bytes never enter an event payload or an outbox
 * (§8.7, §12.1).
 *
 * @param {object} result
 * @param {object | null} [artifact] §6.6's reference to the captured output
 */
export function checkRecord(result, artifact = null) {
	return {
		name: result.name,
		command: result.command,
		severity: result.severity,
		result: result.result,
		reason: result.reason,
		exit_code: result.exit_code,
		signal: result.signal,
		duration_ms: result.duration_ms,
		output_bytes: result.output_bytes,
		truncated: result.truncated,
		message: result.message,
		output: artifact,
	};
}

/**
 * Kill the whole process group. `detached` made the shell its group's leader, so
 * the negative pid reaches the suite it spawned; a bare `child.kill()` would
 * leave the tests running and only stop the shell waiting on them.
 */
function killGroup(child) {
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		// Already gone between the timer firing and the signal — the close event
		// is on its way, and there is nothing left to kill.
	}
}

function requireSelection(select) {
	if (Object.values(CHECK_SELECTIONS).includes(select)) return select;

	throw new FactoryCheckError(
		"check-selection-unknown",
		`A check selection is one of ${Object.values(CHECK_SELECTIONS).join(", ")} (§8.2); found ${JSON.stringify(select ?? null)}. ` +
			"A selection names where a set is paid for, never which area a change touched: there is no per-surface targeting.",
		{ at: "select", found: select ?? null, expected: Object.values(CHECK_SELECTIONS).join("|") },
	);
}
