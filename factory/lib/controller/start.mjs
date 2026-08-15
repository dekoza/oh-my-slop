import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE, exitCodeForEndReason } from "../cli/exit-codes.mjs";
import {
	END_REASON_BASELINE_RED,
	END_REASON_CONTROLLER_LOST,
	END_REASON_DRAINED,
	END_REASON_LEASE_LOST,
	RUN_LIFECYCLE,
} from "../domain/vocabulary.mjs";
import { reconcile } from "../reconcile/engine.mjs";
import { PROBES } from "../reconcile/probes.mjs";
import { FactoryStateError } from "../state/errors.mjs";
import { LEASE_RENEWAL_MS, openLeases } from "../state/leases.mjs";
import { openStore } from "../state/store.mjs";
import { decideEntry, ENTRY_MODES, resolveAgainstLiveRun } from "./entry.mjs";
import { FactoryRunError, isUsageRefusal } from "./errors.mjs";
import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from "./heartbeat.mjs";
import { holdControllerLease } from "./lease-guard.mjs";
import { preflight } from "./preflight.mjs";
import { describeScope, PARENT_FLAG, parseScope } from "./scope.mjs";

/**
 * `factory start` (§10.1, §10.3, §10.4).
 *
 * > **One invocation, one run.** It acquires the controller lease, reconciles,
 * > applies expiry, preflights, executes to drain, emits `ended` with its reason,
 * > releases the lease, prints the classified per-member report, and exits. **No
 * > idle polling, no residency.**
 *
 * The lease exists to exclude a *second* controller, not to mark a service up —
 * which is why this file has no loop waiting for work to appear. A resident
 * factory with a work queue is excluded outright (§19): the tracker is already
 * the queue, and labelling a ticket under the run's parent *is* the enqueue.
 *
 * **Every path through here ends the run exactly once, with a reason.** §10.3
 * makes the end reason mandatory and its exit code published contract, so the
 * one thing this must never do is exit without saying why — a caller writing
 * `factory start && next-thing` is trusting exactly that.
 *
 * Detached launch into a Herdr pane (§10.1) and the stop-request record (§10.5)
 * are #98's; this run holds the terminal it was started in.
 */

/** The flag §10.4 gives the operator for refusing to re-enter. */
export const NEW_RUN_FLAG = "--new-run";

/**
 * @param {object} invocation as the CLI assembles it
 * @param {string} invocation.repoRoot
 * @param {string[]} invocation.args the scope on the line
 * @param {ReadonlySet<string>} invocation.flags
 * @param {object} invocation.config the validated configuration
 * @param {string} invocation.configPath
 * @param {object} invocation.activeRouting
 * @param {Record<string, ReadonlyArray<string>>} invocation.declared
 * @param {string | null} [invocation.agentDir]
 * @param {string} [invocation.executable]
 * @param {Record<string, string | undefined>} [invocation.env]
 * @param {object} [invocation.probes] the §5.3 probe registry
 * @param {() => number} [invocation.now]
 * @param {object} [invocation.timers] injectable renewal and heartbeat clocks
 * @param {(options: object) => Promise<object>} [invocation.herdr] §10.3's availability probe
 * @returns {Promise<{ message: string, report: object, exitCode: number } | { error: object, exitCode: number }>}
 */
export async function runStart({
	repoRoot,
	args = [],
	flags = new Set(),
	config,
	configPath,
	activeRouting,
	declared,
	agentDir = null,
	executable,
	env,
	probes = PROBES,
	now = Date.now,
	timers = { setInterval, clearInterval },
	herdr,
}) {
	let requested;
	try {
		requested = parseScope(args, { parent: flags.has(PARENT_FLAG) });
	} catch (error) {
		return refusal(error);
	}

	const store = await openStore({ repoRoot, agentDir });
	try {
		return await start(store, {
			requested,
			newRun: flags.has(NEW_RUN_FLAG),
			config,
			configPath,
			activeRouting,
			declared,
			executable,
			env,
			probes,
			now,
			timers,
			herdr,
			pane: env?.HERDR_PANE_ID ?? null,
		});
	} finally {
		store.close();
	}
}

async function start(store, context) {
	let hold;
	try {
		hold = holdControllerLease({
			store,
			leases: openLeases(store, { now: context.now }),
			pane: context.pane,
			timers: context.timers,
		});
	} catch (error) {
		// §10.4: a live holder is resolved against, never queued behind.
		if (!(error instanceof FactoryStateError) || error.reason !== "lease-held") throw error;
		return liveRun(store, error.details, context.requested);
	}

	try {
		return await drive(store, hold, context);
	} finally {
		// A start that threw while holding the lease would otherwise exclude the
		// repository from its own controller until the TTL lapsed.
		hold.release();
	}
}

/**
 * The run, from the lease to the end reason. The order is §10.1's sentence,
 * with §12.6's "after reconcile and before preflight" for expiry and §10.3's
 * "after the run exists" for preflight.
 */
async function drive(store, hold, context) {
	const startedAt = context.now();

	// §5.4, and the reason it is first: reconcile settles what the last
	// controller left behind **before the lease is used for any effect**. The
	// hold keeps that as a latch rather than as an order of calls anyone can get
	// wrong, so nothing below could have run first.
	const reconciled = await reconcile(store, {
		probes: context.probes,
		fencingGeneration: hold.fencingGeneration,
		hold,
		actor: "controller",
		at: startedAt,
	});

	let entry;
	try {
		entry = decideEntry(store, { requested: context.requested, newRun: context.newRun });
	} catch (error) {
		return refusal(error);
	}
	hold.adopt(entry.run);

	// §10.4: the abandoned run is ended by a **different** controller — this one —
	// which is what lets `controller-lost` be written at all without any process
	// ever self-asserting it (§14.36).
	for (const abandoned of entry.abandon) {
		endRun(store, abandoned, { endReason: END_REASON_CONTROLLER_LOST, at: startedAt, observer: entry.run });
	}

	const expiry = applyExpiry();
	openLifecycle(store, entry, { at: startedAt });

	let lifecycle = RUN_LIFECYCLE.preflight;
	const heartbeat = startHeartbeat({
		store,
		hold,
		run: entry.run,
		now: context.now,
		timers: context.timers,
		// Both are **derived from the run's own projections**, never constants.
		// A hardcoded zero here would be the plausible zero this codebase refuses
		// everywhere else — and worse than elsewhere, because §5.1 asks the beat
		// to make *quiet* distinguishable from *stopped watching*, which a
		// literal cannot do. Read this way they are already right, and they stay
		// right on the day attempts start launching panes.
		activity: () => `${lifecycle}: ${store.readTicketExecutions(entry.run).length} ticket executions`,
		watching: () => watchedPanes(store, entry.run),
	});

	try {
		const checked = await preflight(store, {
			run: entry.run,
			hold,
			scope: entry.scope,
			config: context.config,
			configPath: context.configPath,
			activeRouting: context.activeRouting,
			declared: context.declared,
			executable: context.executable,
			env: context.env,
			herdr: context.herdr,
			actor: "controller",
			at: startedAt,
		});

		// The reason is decided **before** the run executes, because two of the
		// three reasons are already settled by this point: a red preflight and a
		// lost lease both mean this controller drives nothing further. Only a run
		// that has neither reaches `running`.
		const endReason = endReasonOf(hold, checked);
		if (endReason === END_REASON_DRAINED) {
			lifecycle = move(store, entry.run, RUN_LIFECYCLE.running, { at: context.now() });
			lifecycle = move(store, entry.run, RUN_LIFECYCLE.draining, { at: context.now() });
		}

		const endedAt = context.now();
		// The red checks ride only the reason they explain. A `lease-lost` run
		// carrying them would read as a run that ended over its preflight, and the
		// operator's next question — which of the two happened — is the one the
		// record has to answer.
		endRun(store, entry.run, {
			endReason,
			at: endedAt,
			red: endReason === END_REASON_BASELINE_RED ? checked.red : [],
		});
		lifecycle = RUN_LIFECYCLE.ended;

		const report = {
			run: entry.run,
			lifecycle,
			end_reason: endReason,
			exit_code: exitCodeForEndReason(endReason),
			started_at: startedAt,
			ended_at: endedAt,
			entry: entryReport(entry),
			scope: { ...entry.scope, described: describeScope(entry.scope) },
			reconcile: reconcileReport(reconciled),
			expiry,
			preflight: { ok: checked.ok, red: checked.red, checks: checked.checks },
			manifest: checked.manifest,
			liveness: {
				heartbeats: heartbeat.emitted,
				heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
				lease_renewal_ms: LEASE_RENEWAL_MS,
				fencing_generation: hold.fencingGeneration,
			},
			execution: executionReport(),
			monitor: {
				requested: false,
				missing: "the typed pi.events run-start trigger (#99)",
				spec: "§10.6",
			},
		};

		return { message: headline(report), report, exitCode: report.exit_code };
	} finally {
		heartbeat.stop();
	}
}

/**
 * §5.1's "watching N panes", counted rather than declared.
 *
 * **All worker attempts run as Herdr panes** (§6.4), one pane per live attempt,
 * so the attempts this run has launched and not yet ended *are* the panes being
 * watched. Counting them off the projection means the number is a fact about
 * this run rather than a placeholder waiting for the observer to land: it is
 * zero today because nothing has been launched, not because nothing counts it.
 */
function watchedPanes(store, run) {
	return store.readAttempts({ runId: run }).filter((attempt) => attempt.ended_at === null).length;
}

/**
 * §10.3's mandatory reason, decided in the order the reasons outrank each other.
 *
 * A lost lease wins over everything: §14.6 stops the controller where it stands,
 * so whatever preflight was in the middle of saying is no longer this
 * controller's to act on. `baseline-red` is next, and it is the reason a red
 * preflight check produces — §10.3 runs preflight after the run exists precisely
 * so this reason can **name the specific red check**.
 *
 * `lease-lost` ends the run even though the successor that took the lease may be
 * driving it by then. §10.3 makes the reason mandatory on an ended run and makes
 * this one a controller's *own* exit, so the alternative is a controller that
 * exits 6 having recorded nothing about why. The successor's own ending is the
 * later record and supersedes it; reconciling the two runs' worth of in-flight
 * work is #114's.
 */
function endReasonOf(hold, checked) {
	if (hold.lost) return END_REASON_LEASE_LOST;
	if (!checked.ok) return END_REASON_BASELINE_RED;
	return END_REASON_DRAINED;
}

/**
 * §12.6: expiry runs **once per controller invocation, after reconcile and
 * before preflight, under the controller lease** — the established "state is
 * authoritative and nothing is in flight" window.
 *
 * It is a no-op until retention lands, and says so rather than reporting a
 * plausible zero: "reclaimed 0 bytes" and "nothing ran" are different answers to
 * the operator's question, and only one of them is true here.
 */
function applyExpiry() {
	return {
		ran: false,
		reclaimed_bytes: null,
		expired_runs: null,
		missing: "the two retention tiers, the four pins, and expiry (#117)",
		spec: "§12.6",
	};
}

/**
 * §3.5's drain, as far as this package can take it: nothing is claimable,
 * because nothing here can claim.
 *
 * **It says so in the report rather than reporting an empty member list.** §9.7
 * names the failure this avoids outright — a run that starts, claims nothing,
 * and drains as though the work were done is a green-looking run that did
 * nothing, "the worst outcome available here". The exit code is still `0`,
 * because the run genuinely drained; what stops that from being a lie is this
 * section naming the three subsystems that would have found work.
 */
function executionReport() {
	return {
		claimed: 0,
		members: [],
		missing:
			"the tracker scope and eligibility reader (#100), capacity slots and the scheduler loop (#101), " +
			"and claiming, release, and the classified drain report (#102)",
		spec: "§3.2, §3.5, §9",
	};
}

/**
 * A run exists before preflight does (§10.3). A *new* run is opened with
 * `run.started`, which is what mints its projection row and records its
 * selector; an adopted one already has both and is moved back to `preflight`,
 * because a re-entered run preflights again — the world it checked may have
 * changed while nobody was driving.
 */
function openLifecycle(store, entry, { at }) {
	if (entry.mode === ENTRY_MODES.adopted) {
		move(store, entry.run, RUN_LIFECYCLE.preflight, { at });
		return;
	}

	store.append({
		kind: "run.started",
		source: "controller",
		run: entry.run,
		occurredAt: at,
		observedAt: at,
		payload: { scope: entry.scope, mode: entry.mode },
	});
}

function move(store, run, lifecycle, { at }) {
	store.append({
		kind: "run.lifecycle-changed",
		source: "controller",
		run,
		occurredAt: at,
		observedAt: at,
		payload: { lifecycle },
	});
	return lifecycle;
}

/**
 * The one record that closes a run, wherever the reason came from. `red` names
 * the preflight checks behind a `baseline-red`, and `observer` names the
 * controller that made a `controller-lost` observation — the field is what keeps
 * that reason readable as somebody else's assertion rather than the run's own.
 */
function endRun(store, run, { endReason, at, red = [], observer = null }) {
	store.append({
		kind: "run.ended",
		source: "controller",
		run,
		occurredAt: at,
		observedAt: at,
		payload: {
			end_reason: endReason,
			...(red.length === 0 ? {} : { red_checks: [...red] }),
			...(observer === null ? {} : { observed_by: observer }),
		},
	});
}

/** §10.4's answer against a live holder: a message and exit 0, or a refusal. */
function liveRun(store, live, requested) {
	try {
		const resolved = resolveAgainstLiveRun(store, live, requested);
		return {
			message: resolved.message,
			report: {
				run: resolved.run,
				live: true,
				claimed: 0,
				pane: resolved.pane,
				lifecycle: resolved.lifecycle,
				scope: { ...resolved.scope, described: describeScope(resolved.scope) },
				queued: false,
			},
			// `EXIT_OK`, not `drained`'s code: **no run ran here**. Reaching for the
			// end-reason table would say this invocation drained a scope, and the
			// whole point of the table is that a caller can read a run's outcome
			// off it.
			exitCode: EXIT_OK,
		};
	} catch (error) {
		return refusal(error);
	}
}

/**
 * A refusal, with the code that says what kind it is. A missing or malformed
 * scope is usage, and §10.3 reserves `1` for exactly that — it happens before a
 * run exists and therefore has no end reason. Everything else here is a refusal
 * about state that belongs to somebody else, which is deliberately outside the
 * end-reason range so no caller reads it as a run outcome.
 */
function refusal(error) {
	if (!(error instanceof FactoryRunError)) throw error;

	return {
		error: { kind: error.reason, message: error.message, ...error.details },
		exitCode: isUsageRefusal(error.reason) ? EXIT_USAGE : EXIT_REFUSED,
	};
}

function entryReport(entry) {
	return {
		mode: entry.mode,
		adopted: entry.adopted,
		ended_as_controller_lost: [...entry.abandon],
	};
}

/**
 * Reconcile's own report is `factory reconcile`'s and `doctor`'s to print whole;
 * a run summarises it. What a start's reader needs is whether the last
 * controller left anything nothing could settle — §12.4's alarm — not the
 * evidence basis of every conclusion.
 */
function reconcileReport(reconciled) {
	return {
		settled: reconciled.settled,
		entities: reconciled.entities.length,
		unsettled: reconciled.unsettled.map((entry) => entry.effect_key),
	};
}

/** The one sentence an operator reads first, and the whole verdict in it. */
function headline(report) {
	const ended = `${report.end_reason} (exit ${report.exit_code})`;

	if (report.end_reason === END_REASON_BASELINE_RED) {
		return `run ${report.run} ended ${ended}, red at: ${report.preflight.red.join(", ")}.`;
	}

	return (
		`run ${report.run} over ${report.scope.described} ended ${ended}, ` +
		`having claimed ${report.execution.claimed} tickets.`
	);
}
