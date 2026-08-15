import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { artifactBytesByClass } from "../artifacts/ledger.mjs";
import { unresolvedEffects } from "../effects/records.mjs";
import { packageHandshake } from "../package/handshake.mjs";
import { reconcile, RECONCILE_MODES } from "../reconcile/engine.mjs";
import { PROBES } from "../reconcile/probes.mjs";

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
 * @param {string} context.agentDir where §4.1's state root lives
 * @param {string} [context.executable] the running binary, anchoring §11.7's handshake
 * @param {object | null} [context.expect] `package.expect` from config
 * @param {Record<string, string | undefined>} [context.env]
 * @param {object} [context.probes] the §5.3 probe registry
 * @param {number} [context.at]
 * @returns {Promise<Readonly<object>>} the one structured value both renderings come from
 */
export async function doctorReport(
	store,
	{ repoRoot, agentDir, executable = process.argv[1], expect = null, env = process.env, probes = PROBES, at = Date.now() },
) {
	const handshake = packageHandshake({ executable, expect, env });
	const unresolved = store === null ? [] : unresolvedEffects(store);
	const reconciled =
		store === null
			? null
			: await reconcile(store, { probes, mode: RECONCILE_MODES.report, actor: "operator:doctor", at });

	const value = {
		schema_version: 1,
		at,
		store: storeSection(store),
		integrity: store === null ? null : integritySection(store),
		reconcile: reconciled,
		pins: pinsSection(unresolved, reconciled),
		baseline: baselineSection(),
		counters: countersSection(store, unresolved),
		package: packageSection(handshake),
		monitor: monitorSection(repoRoot),
		legacy: legacySection(repoRoot, agentDir),
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
		alarms.push(alarm("journal-stream-broken", `Stream ${stream} does not verify against its own chain (§4.7).`, { stream }));
	}

	for (const pin of value.pins) {
		alarms.push(
			alarm(
				"unresolved-effect-pin",
				pin.unsettleable > 0
					? `${describeRun(pin.run)} holds ${pin.unresolved} unresolved effect(s), ${pin.unsettleable} of which nothing in this package can settle (§12.4).`
					: `${describeRun(pin.run)} holds ${pin.unresolved} unresolved effect(s), still awaiting a probe (§12.4).`,
				pin,
			),
		);
	}

	for (const finding of value.package.findings) {
		alarms.push(alarm("package-handshake", finding.message, finding));
	}

	for (const projection of value.store.projections ?? []) {
		if (projection.ok) continue;
		alarms.push(
			alarm("projection-unreadable", `Projection ${projection.name} is not readable by this build (§14.9).`, projection),
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

function storeSection(store) {
	if (store === null) {
		return Object.freeze({
			present: false,
			message: "This repository has no factory state yet; nothing has run here (§4.1).",
		});
	}

	return Object.freeze({
		present: true,
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
 * Repo-scoped effects answer under `run: null`. They are outside §5.4's scope,
 * which is exactly why they must be visible here: nothing else would ever
 * mention them.
 */
function pinsSection(unresolved, reconciled) {
	const unsettleable = new Set(
		[...(reconciled?.unsettled ?? []), ...(reconciled?.out_of_scope ?? [])].map((entry) => entry.effect_key),
	);
	const pins = new Map();

	for (const effect of unresolved) {
		const pin = pins.get(effect.run_id) ?? { run: effect.run_id, unresolved: 0, unsettleable: 0, oldest_requested_at: effect.requested_at, effects: [] };
		pin.unresolved += 1;
		if (unsettleable.has(effect.effect_key)) pin.unsettleable += 1;
		pin.oldest_requested_at = Math.min(pin.oldest_requested_at, effect.requested_at);
		pin.effects.push(effect.effect_key);
		pins.set(effect.run_id, pin);
	}

	return Object.freeze([...pins.values()].map((pin) => Object.freeze({ ...pin, effects: Object.freeze(pin.effects) })));
}

/**
 * §10.5: **by default doctor reports the last baseline result**, with its
 * `as-of` and the base commit it ran at, stating plainly that it was **not**
 * re-run. `--baseline` executes it, in a throwaway worktree inside the
 * factory-private clone — and both the record and the execution arrive with the
 * check runner.
 */
function baselineSection() {
	return Object.freeze({
		recorded: false,
		as_of: null,
		base_commit: null,
		rerun: false,
		message:
			"No baseline result is recorded, and this run did not re-run one — `doctor --baseline` is what executes the checks (§10.5).",
		missing: "the check runner and the baseline gate (#104)",
		spec: "§8.3, §10.5",
	});
}

/**
 * §10.5's per-ticket counters, "since *why did this stop* is usually a budget
 * question". The attempt count is a projection this package maintains; the three
 * budget counters belong to §8.5's two repair tiers and §8.6's breaker, and a
 * zero reported for a counter nothing increments would answer the operator's
 * question wrongly.
 *
 * The scope is the runs doctor is already talking about: those still open, plus
 * any run holding an unresolved effect.
 */
function countersSection(store, unresolved) {
	if (store === null) return Object.freeze({ tickets: Object.freeze([]), missing: null, spec: "§8.5, §8.6" });

	const runs = new Set([
		...store.readUnendedRuns().map((row) => row.run_id),
		...unresolved.map((effect) => effect.run_id).filter((run) => run !== null),
	]);

	const tickets = [...runs].flatMap((run) =>
		store.readTicketExecutions(run).map((execution) =>
			Object.freeze({
				run,
				ticket: execution.ticket,
				phase: execution.phase,
				disposition: execution.disposition,
				attempts: execution.attempt_count,
				repair: null,
				fresh_retry: null,
				automation: null,
			}),
		),
	);

	return Object.freeze({
		tickets: Object.freeze(tickets),
		missing: "the two repair tiers (#110) and the budgets and circuit breaker (#111)",
		spec: "§8.5, §8.6",
	});
}

/** §11.7's handshake, in report mode: probing is a read, and findings are data. */
function packageSection(handshake) {
	return Object.freeze({
		ok: handshake.ok,
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
