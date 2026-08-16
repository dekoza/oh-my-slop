import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { artifactBytesByClass } from "../artifacts/ledger.mjs";
import { capacityFor } from "../capacity/report.mjs";
import { baselineForRepo } from "../checks/baseline.mjs";
import { checkRecord } from "../checks/run.mjs";
import { CIRCUIT_BREAKER_THRESHOLD, circuitBreaker } from "../controller/breaker.mjs";
import { describeScope, PARENT_FLAG } from "../controller/scope.mjs";
import { unresolvedEffects } from "../effects/records.mjs";
import { budgetSpend } from "../pipeline/budgets.mjs";
import { FactoryPackageError } from "../package/errors.mjs";
import { packageHandshake } from "../package/handshake.mjs";
import { reconcile, RECONCILE_MODES } from "../reconcile/engine.mjs";
import { PROBES } from "../reconcile/probes.mjs";
import { resolveStorePaths } from "../state/location.mjs";
import { FactoryTrackerError } from "../tracker/errors.mjs";
import { readScope } from "../tracker/frontier.mjs";
import { isDue, readCursor } from "../tracker/observation.mjs";

/**
 * §10.5's `doctor`: **the reconciliation engine with a read-only flag**, plus
 * the facts an operator asking "why did this stop" needs beside it.
 *
 * The whole value is computed from a read-only store handle, so §14.24 — *doctor
 * appends nothing to the journal and writes no projection, in either mode* — is
 * a property of the handle rather than a rule this file follows. Nothing here
 * deletes anything either: legacy artifacts are **reported**, and reclaiming
 * them is `cleanup-plan`'s reviewed decision (§12.8).
 *
 * Sections whose subsystem has not landed report what is missing and which
 * ticket owes it. A verb that cannot do part of its job says so; it never goes
 * quiet and never fills the gap with a plausible zero.
 */

/** §4.1's legacy layout, replaced by the per-repo store: flat and non-repo-scoped. */
const LEGACY_STATE_DIRS = Object.freeze(["runs", "active"]);

/** The legacy factory's worktrees, all named for its `factory-*` run ids. */
const LEGACY_WORKTREE_DIR = ".worktrees";
const LEGACY_WORKTREE_PREFIX = "factory-";

/** §11.1's standalone monitor config. A missing or broken one never fails a run. */
const MONITOR_CONFIG = join(".pi", "factory-monitor.json");

/**
 * @param {object | null} store a read-only store handle, or null when this
 *   repository has no factory state yet
 * @param {object} context
 * @param {string} context.repoRoot
 * @param {{ path: string, source: string }} context.agentDir where §4.1's state
 *   root is, and how it was resolved — reported rather than swallowed, because a
 *   run that fell back to the documented default is a fact doctor should state
 * @param {object} context.config the validated configuration
 * @param {object} context.activeRouting the routing this invocation selected
 * @param {string} [context.executable] the running binary, anchoring §11.7's handshake
 * @param {object | null} [context.expect] `package.expect` from config
 * @param {Record<string, string | undefined>} [context.env]
 * @param {object} [context.probes] the §5.3 probe registry
 * @param {object | null} [context.scope] §3.1's selector, when the operator named one
 * @param {object | null} [context.tracker] the §5.1 read client, or null when there is none
 * @param {boolean} [context.baseline] §10.5's `--baseline`: **execute** the declared
 *   checks rather than reporting the last recorded result
 * @param {number} [context.at]
 * @returns {Promise<Readonly<object>>} the one structured value both renderings come from
 */
export async function doctorReport(
	store,
	{
		repoRoot,
		agentDir,
		config,
		activeRouting,
		executable = process.argv[1],
		expect = null,
		env = process.env,
		probes = PROBES,
		scope = null,
		tracker = null,
		baseline = false,
		at = Date.now(),
	},
) {
	const handshake = attemptHandshake({ executable, expect, env });
	const unresolved = store === null ? [] : unresolvedEffects(store);
	const reconciled =
		store === null
			? null
			: await reconcile(store, { probes, mode: RECONCILE_MODES.report, actor: "operator:doctor", at });

	const value = {
		schema_version: 1,
		at,
		store: storeSection(store, agentDir),
		scope: await scopeSection(store, { scope, tracker, at }),
		integrity: store === null ? null : integritySection(store),
		reconcile: reconciled,
		pins: pinsSection(unresolved, reconciled),
		/**
		 * §9.7's saturation numbers. They belong in a diagnosis for the same reason
		 * they belong in `status`: "why did this stop" and "why is this slow" have
		 * the same wrong answer — a run whose lanes are all queued behind one slot
		 * looks exactly like a run that is working.
		 */
		capacity: capacityFor(store, {
			config,
			activeRouting,
			run: store?.readUnendedRuns()[0]?.run_id ?? null,
			at,
		}),
		baseline: await baselineSection(store, { repoRoot, agentDir, config, rerun: baseline, at }),
		counters: countersSection(store, unresolved),
		package: packageSection(handshake),
		monitor: monitorSection(repoRoot),
		legacy: legacySection(repoRoot, agentDir.path),
		artifacts: store === null ? null : Object.freeze({ by_class: artifactBytesByClass(store) }),
	};

	const alarms = alarmsOf(value);
	return Object.freeze({ ...value, alarms, ok: alarms.length === 0 });
}

/**
 * What doctor is **shouting** about, gathered from the sections rather than
 * raised as each is computed — so the list is the whole picture and the human
 * rendering has one place to put it.
 *
 * Monitor health and legacy artifacts are deliberately absent: §10.5 makes the
 * monitor advisory-only, and a legacy directory is a reclamation opportunity
 * rather than a fault.
 */
function alarmsOf(value) {
	const alarms = [];

	for (const failure of value.integrity?.failures ?? []) {
		// §4.7 refuses to start *once*; the next invocation opens the fresh store
		// and finds nothing wrong. This record is the only lasting evidence that
		// a journal was quarantined, so doctor is where it stays loud.
		alarms.push(
			alarm(
				"journal-integrity-failed",
				`The journal was quarantined at ${failure.quarantine_path}; the store answering now is a fresh one (§4.7).`,
				failure,
			),
		);
	}

	for (const stream of value.integrity?.broken ?? []) {
		alarms.push(
			alarm("journal-stream-broken", `Stream ${stream} does not verify against its own chain (§4.7).`, { stream }),
		);
	}

	for (const pin of value.pins) {
		alarms.push(
			alarm(
				"unresolved-effect-pin",
				pin.unsettleable > 0
					? `${describeRun(pin.run)} holds ${pin.unresolved} unresolved effect(s), ${pin.unsettleable} of ` +
						"which nothing in this package can settle (§12.4)."
					: `${describeRun(pin.run)} holds ${pin.unresolved} unresolved effect(s), still awaiting a probe (§12.4).`,
				pin,
			),
		);
	}

	// A scope the operator asked about and the factory could not read: no run
	// over it can claim anything, and the reason is a fact rather than a
	// diagnosis the operator has to reconstruct from a stack trace.
	if (value.scope.requested && value.scope.ok === false) {
		alarms.push(
			alarm(
				"tracker-unreadable",
				`${value.scope.described} could not be resolved: ${value.scope.error.message}`,
				value.scope.error,
			),
		);
	}

	// A red baseline **this invocation just observed** is an alarm for the same
	// reason an unreadable tracker is: no run can start against it (§8.3, §14.14).
	// A *recorded* red is deliberately not one — the section says outright that it
	// was not re-run, and raising an alarm on a result that may predate the fix
	// would teach the operator to ignore the list.
	if (value.baseline.rerun && value.baseline.ok === false) {
		alarms.push(
			alarm("baseline-red", value.baseline.message, value.baseline.detail ?? { red: value.baseline.red }),
		);
	}

	if (value.package.error !== null && value.package.error !== undefined) {
		alarms.push(alarm("package-unanchored", value.package.error.message, value.package.error));
	}

	for (const finding of value.package.findings) {
		alarms.push(alarm("package-handshake", finding.message, finding));
	}

	for (const projection of value.store.projections ?? []) {
		if (projection.ok) continue;
		alarms.push(
			alarm(
				"projection-unreadable",
				`Projection ${projection.name} is not readable by this build (§14.9).`,
				projection,
			),
		);
	}

	return Object.freeze(alarms);
}

function alarm(reason, message, detail) {
	return Object.freeze({ reason, message, detail });
}

function describeRun(run) {
	return run === null ? "The repository" : `Run ${run}`;
}

/**
 * §3.1's scope, resolved over the **live** tracker graph and classified per
 * member (§3.2, §3.5) — **and nothing is claimed to produce it.**
 *
 * This is the read path's operator surface: `doctor #42` or `doctor --parent 75`
 * answers "what would a run over this scope find, and why is each member where
 * it is" without an assignee, a comment, or a label moving. Every read it makes
 * is a `GET`, and §14.24 still holds because the answer never touches the
 * journal either — the durable cursor is *read* here, never opened or advanced.
 *
 * A scope is optional. `doctor` with none is the diagnosis an operator runs when
 * the controller is dead, and refusing to answer any of it because they did not
 * name a ticket would be the Babysitter failure again.
 */
async function scopeSection(store, { scope, tracker, at }) {
	if (scope === null) {
		return Object.freeze({
			requested: false,
			message: `No scope was given, so no tracker read was made. \`doctor <ticket…>\` or \`doctor ${PARENT_FLAG} <parent>\` classifies a scope's members (§3.1).`,
			members: Object.freeze([]),
		});
	}

	if (tracker === null) {
		return Object.freeze({
			requested: true,
			selector: scope,
			described: describeScope(scope),
			ok: false,
			error: Object.freeze({
				reason: "tracker-unconfigured",
				message: "No tracker client is available to this invocation, so the scope was not resolved.",
			}),
			members: Object.freeze([]),
		});
	}

	try {
		const resolved = await readScope(tracker, scope, { at });

		return Object.freeze({
			requested: true,
			selector: scope,
			described: describeScope(scope),
			ok: true,
			error: null,
			counts: resolved.counts,
			// §3.2's order, so the operator reads the frontier in the order a run
			// would take it.
			claimable: resolved.claimable,
			// The frontier's own records, passed through rather than re-shaped. A
			// second projection of them here would be a second place to remember
			// whenever a member grows a field — and the one it forgot would be the
			// field the operator needed.
			members: resolved.members,
			cursor: cursorReport(store, scope, at),
			claimed: false,
			// Said outright, because "doctor listed my frontier" and "a run claimed
			// my frontier" must never be confusable at a glance.
			note: "Read-only: this listing claims nothing, assigns nobody, and moves no label (§10.5).",
		});
	} catch (error) {
		if (!(error instanceof FactoryTrackerError)) throw error;

		// A tracker that cannot be read is a real alarm — no run can claim
		// anything — but it must not take the journal, the pins, and the
		// reconciliation down with it, so it becomes a section like any other.
		return Object.freeze({
			requested: true,
			selector: scope,
			described: describeScope(scope),
			ok: false,
			error: Object.freeze({ reason: error.reason, message: error.message, ...error.details }),
			members: Object.freeze([]),
		});
	}
}

/**
 * §5.1's cursor for this scope, **read and never opened**. A `doctor` that
 * created a cursor would be writing durable state from the one verb that
 * promises not to (§14.24), and it would do it precisely when the operator is
 * trying to find out what state already exists.
 */
function cursorReport(store, scope, at) {
	if (store === null) return Object.freeze({ present: false, message: "There is no store to hold one yet." });

	const cursor = readCursor(store, scope);
	if (cursor === null) {
		return Object.freeze({
			present: false,
			message: "This scope has never been observed; a cursor is opened by a run, never by doctor (§5.1).",
		});
	}

	return Object.freeze({
		present: true,
		last_updated_at: cursor.last_updated_at,
		last_updated_at_raw: cursor.last_updated_at_raw,
		last_foreign_id: cursor.last_foreign_id,
		polled_at: cursor.polled_at,
		polls: cursor.polls,
		due: isDue(cursor, at),
	});
}

function storeSection(store, agentDir) {
	if (store === null) {
		return Object.freeze({
			present: false,
			agent_dir: agentDir,
			message: "This repository has no factory state yet; nothing has run here (§4.1).",
		});
	}

	return Object.freeze({
		present: true,
		agent_dir: agentDir,
		path: store.dbPath,
		canonical_repo_path: store.canonicalPath,
		instance_uuid: store.instanceUuid,
		head: store.head(),
		projections: store.projectionContract(),
	});
}

/**
 * §4.7's per-stream verification, and the record §4.7 leaves behind. Both are
 * reads: `verifyJournal` appends nothing, so doctor may run it in either mode.
 */
function integritySection(store) {
	const verified = store.verifyJournal();

	return Object.freeze({
		ok: verified.ok,
		streams: verified.streams.length,
		broken: verified.broken,
		failures: Object.freeze(
			store.readEvents({ kind: "journal.integrity-failed" }).map((event) =>
				Object.freeze({
					at: event.occurred_at,
					scope: event.payload.scope,
					quarantine_path: event.payload.quarantine_path,
					problems: event.payload.problems,
				}),
			),
		),
	});
}

/**
 * §12.4's fourth pin, per run — **and the alarm it exists to give**. A run held
 * here for weeks means an effect nothing can settle, which a silent table-level
 * exception would have hidden.
 *
 * Repo-scoped effects answer under `run: null` — the repository's own pin, which
 * §5.4 puts in scope for exactly this reason: an obligation nothing reports is
 * an obligation nobody discharges.
 */
function pinsSection(unresolved, reconciled) {
	const unsettleable = new Set((reconciled?.unsettled ?? []).map((entry) => entry.effect_key));
	const pins = new Map();

	for (const effect of unresolved) {
		const pin = pins.get(effect.run_id) ?? {
			run: effect.run_id,
			unresolved: 0,
			unsettleable: 0,
			oldest_requested_at: effect.requested_at,
			effects: [],
		};
		pin.unresolved += 1;
		if (unsettleable.has(effect.effect_key)) pin.unsettleable += 1;
		pin.oldest_requested_at = Math.min(pin.oldest_requested_at, effect.requested_at);
		pin.effects.push(effect.effect_key);
		pins.set(effect.run_id, pin);
	}

	return Object.freeze([...pins.values()].map((pin) => Object.freeze({ ...pin, effects: Object.freeze(pin.effects) })));
}

/**
 * §10.5's two modes.
 *
 * **By default doctor reports the last baseline result**, with its `as-of` and
 * the base commit it ran at, **stating plainly that it was not re-run** — a
 * stale green presented as current is the plausible zero this whole report
 * refuses everywhere else. **`--baseline` executes** the declared checks, inside
 * §7.1's factory-private clone in a throwaway worktree, never the operator's
 * checkout.
 *
 * Under both modes doctor **appends nothing and writes no projection** (§14.24).
 * Running a declared check in a disposable worktree is explicitly not that
 * mutation, but recording its output as an artifact would be — an artifact write
 * is an effect and a ledger row. So the re-run answers from the value it hands
 * back, and that is also why a red check's output appears here as a bounded tail
 * rather than as §6.6's reference: there is no reference to give, and the bytes
 * are gone with the process. The whole of a red run's evidence stays on disk in
 * the retained worktree (§12.7), which is what the section names.
 */
async function baselineSection(store, { repoRoot, agentDir, config, rerun, at }) {
	return rerun
		? await executedBaseline({ store, repoRoot, agentDir, config, at })
		: recordedBaseline(store);
}

/** How much of a red check's output a diagnosis carries: enough to read, not a transcript. */
const DIAGNOSTIC_TAIL_BYTES = 4000;

/**
 * The last baseline this repository recorded, read off the journal.
 *
 * It is a journal read rather than a projection because a baseline result is a
 * fact about one moment, not current state, and §4.4's projections are the
 * monitor's read contract — a table nothing else needs would be a projector
 * version to keep in step for one line of a diagnosis.
 *
 * The scan is bounded by retention rather than by a limit: `preflight.checked`
 * lives on a `run:<ULID>` stream, and §12.2 deletes those whole at the horizon,
 * so this reads the preflight stages of the runs still in full detail — not of
 * every run this repository has ever had.
 */
function recordedBaseline(store) {
	// The last baseline **result**, whatever it said — including the one that went
	// red because the base could not be pinned, which is a baseline result and not
	// an absent one. Skipping those would answer "the last baseline" with an older,
	// greener run, which is the stale green this section exists to refuse.
	// `unbuilt` is the one record that is not a result: it is what a package
	// without this subsystem wrote, and it says nothing about the base.
	const recorded = store === null
		? null
		: store
				.readEvents({ kind: "preflight.checked" })
				.filter((event) => event.payload.check === "baseline" && event.payload.result !== "unbuilt")
				.at(-1);

	if (recorded === undefined || recorded === null) {
		return Object.freeze({
			recorded: false,
			rerun: false,
			as_of: null,
			base_commit: null,
			message:
				"No baseline result is recorded for this repository, and this invocation did not run one — " +
				"`doctor --baseline` executes the declared checks (§10.5).",
			spec: "§8.3, §10.5",
		});
	}

	// A baseline that never got to run carries no base and no checks, and says so
	// with nulls rather than with an empty list that reads as "nothing failed".
	const detail = recorded.payload.detail;
	return Object.freeze({
		recorded: true,
		rerun: false,
		ok: recorded.payload.result === "passed",
		as_of: recorded.occurred_at,
		run: recorded.run,
		base_branch: detail.base_branch ?? null,
		base_commit: detail.base_commit ?? null,
		checks: detail.checks ?? null,
		worktree: detail.worktree ?? null,
		message: `${recorded.payload.message} It was **not** re-run: this is what run ${recorded.run} recorded (§10.5).`,
		spec: "§8.3, §10.5",
	});
}

/**
 * `--baseline`, executed. The clone and the pinned base come from the same check
 * a run's preflight uses, so `doctor --baseline` and `factory start` cannot
 * disagree about which commit the base is — and a repository with no state yet
 * is diagnosed too: the clone is derived, disposable state (§7.1), and creating
 * it is not the durable state §14.24 is about.
 */
async function executedBaseline({ store, repoRoot, agentDir, config, at }) {
	const answered = await baselineForRepo(
		{
			canonicalPath: store?.canonicalPath ?? repoRoot,
			storeDir: store?.storeDir ?? resolveStorePaths({ repoRoot, agentDir: agentDir.path }).primary.dir,
		},
		config,
		{ at },
	);

	if (!answered.ran) {
		return Object.freeze({
			recorded: false,
			rerun: true,
			ok: false,
			as_of: at,
			base_commit: answered.detail.base_commit ?? null,
			red: null,
			message: answered.message,
			detail: answered.detail,
			spec: "§7.1, §8.3, §10.5",
		});
	}

	const baseline = answered.baseline;
	return Object.freeze({
		recorded: false,
		rerun: true,
		ok: baseline.ok,
		as_of: at,
		base_branch: baseline.base_branch,
		base_commit: baseline.base_commit,
		// The red names, kept beside the checks: an alarm that has to reconstruct
		// them from the list would be one more place to get the filter wrong.
		red: baseline.red,
		checks: Object.freeze(baseline.results.map(diagnosed)),
		skipped: baseline.skipped,
		worktree: baseline.worktree,
		message: baseline.message,
		spec: "§8.3, §10.5",
	});
}

/** A check as a diagnosis reads it: the record, plus the tail of a red one's output. */
function diagnosed(result) {
	const record = checkRecord(result);
	if (result.result === "passed") return Object.freeze(record);

	return Object.freeze({
		...record,
		output_tail: result.output.subarray(-DIAGNOSTIC_TAIL_BYTES).toString("utf8"),
	});
}

/**
 * §10.5's per-ticket counters, "since *why did this stop* is usually a budget
 * question", plus §8.6's breaker verdict per run — the run-level half of the
 * same question.
 *
 * **Every number here is derived**, the way §12.10's byte accounting falls out
 * of the ledger: the attempt count is a projection this package maintains, and
 * the three budget spends are counts over the stage resolutions that charged
 * them. A parallel counter table would be a number that can disagree with the
 * chain it claims to describe, and a `doctor` whose answer disagrees with the
 * controller's is worse than one that says nothing.
 *
 * A zero here is therefore a real zero — a ticket execution that failed nothing
 * has spent nothing — rather than the plausible zero of a counter nothing
 * increments, which is what this section refused to print before §8.6 was built.
 *
 * The scope is the runs doctor is already talking about: those still open, plus
 * any run holding an unresolved effect.
 */
function countersSection(store, unresolved) {
	if (store === null) {
		return Object.freeze({
			tickets: Object.freeze([]),
			circuit_breaker: null,
			missing: null,
			spec: "§8.5, §8.6",
		});
	}

	const runs = new Set([
		...store.readUnendedRuns().map((row) => row.run_id),
		...unresolved.map((effect) => effect.run_id).filter((run) => run !== null),
	]);

	const tickets = [...runs].flatMap((run) =>
		store.readTicketExecutions(run).map((execution) => {
			const spend = budgetSpend(store, { run, ticket: execution.ticket });
			return Object.freeze({
				run,
				ticket: execution.ticket,
				phase: execution.phase,
				disposition: execution.disposition,
				attempts: execution.attempt_count,
				repair: spend.repair,
				fresh_retry: spend.freshRetry,
				automation: spend.automation,
			});
		}),
	);

	return Object.freeze({
		tickets: Object.freeze(tickets),
		// §8.6's run-level verdict, reported whether or not it tripped: a run one
		// automation failure short of the threshold is exactly what an operator
		// wants to see before it stops claiming rather than after.
		circuit_breaker: Object.freeze({
			threshold: CIRCUIT_BREAKER_THRESHOLD,
			runs: Object.freeze([...runs].map((run) => Object.freeze({ run, ...circuitBreaker(store, { run }) }))),
		}),
		missing: null,
		spec: "§8.5, §8.6",
	});
}

/**
 * §11.7's handshake, or the reason there is none.
 *
 * The handshake makes its *findings* data because `doctor` reports them (§10.5),
 * but it still throws over a package it cannot anchor or read at all — and a
 * broken install is exactly when `doctor` is run. So the throw is caught here
 * and becomes a section like any other: one unreadable package must not take the
 * journal, the pins, and the reconciliation down with it.
 */
function attemptHandshake({ executable, expect, env }) {
	try {
		return packageHandshake({ executable, expect, env });
	} catch (error) {
		if (!(error instanceof FactoryPackageError)) throw error;
		return { error: Object.freeze({ reason: error.reason, message: error.message, ...error.details }) };
	}
}

/**
 * §11.7's handshake, in report mode: probing is a read, and findings are data.
 *
 * `error` and `findings` are kept apart on purpose: a finding is one of §11.7's
 * closed reasons, which a `--json` consumer branches on, while an unanchorable
 * package is the handshake never having run.
 */
function packageSection(handshake) {
	if (handshake.error !== undefined) {
		return Object.freeze({ ok: false, error: handshake.error, findings: Object.freeze([]) });
	}

	return Object.freeze({
		ok: handshake.ok,
		error: null,
		package: handshake.package,
		participants: handshake.participants,
		tree: handshake.tree,
		git: handshake.git,
		findings: handshake.findings,
	});
}

/**
 * §10.5: `.pi/factory-monitor.json` health, **advisory-only**. The dependency is
 * one-directional — a missing or broken monitor never fails a factory run — so
 * nothing here reaches the alarm list, whatever it finds.
 */
function monitorSection(repoRoot) {
	const path = join(repoRoot, MONITOR_CONFIG);
	const stats = statOrNull(path);

	if (stats === null) {
		return Object.freeze({
			path,
			present: false,
			readable: null,
			mode: null,
			advisory: true,
			message: "No monitor configuration; the monitor is optional and its absence never fails a run (§10.6).",
		});
	}

	const readable = parses(path);
	return Object.freeze({
		path,
		present: true,
		readable,
		mode: (stats.mode & 0o777).toString(8),
		advisory: true,
		message: readable
			? "The monitor configuration parses."
			: "The monitor configuration does not parse; the monitor will not start, and the factory runs regardless (§10.6).",
	});
}

/**
 * §10.5: legacy run artifacts, **reported without deleting anything**. The
 * legacy layout was a flat, non-repo-scoped `runs/` beside an `active/` lock
 * directory (§4.1), and its worktrees were named for its `factory-*` run ids.
 */
function legacySection(repoRoot, agentDir) {
	const worktrees = entriesOf(join(repoRoot, LEGACY_WORKTREE_DIR))
		.filter((entry) => entry.isDirectory() && entry.name.startsWith(LEGACY_WORKTREE_PREFIX))
		.map((entry) => join(repoRoot, LEGACY_WORKTREE_DIR, entry.name));

	const stateDirs = LEGACY_STATE_DIRS.map((name) => join(agentDir, "software-factory", name))
		.filter((path) => statOrNull(path) !== null)
		.map((path) => Object.freeze({ path, entries: entriesOf(path).length }));

	return Object.freeze({
		worktrees: Object.freeze(worktrees),
		state_dirs: Object.freeze(stateDirs),
		message: "Reported only: reclaiming these is `cleanup-plan`'s reviewed decision (§12.8).",
	});
}

function entriesOf(path) {
	try {
		return readdirSync(path, { withFileTypes: true });
	} catch {
		return [];
	}
}

function statOrNull(path) {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

function parses(path) {
	try {
		JSON.parse(readFileSync(path, "utf8"));
		return true;
	} catch {
		return false;
	}
}
