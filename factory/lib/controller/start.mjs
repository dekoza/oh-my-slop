import {
	EXIT_LEASE_LOST,
	EXIT_OK,
	EXIT_REFUSED,
	EXIT_USAGE,
	exitCodeForEndReason,
} from "../cli/exit-codes.mjs";
import {
	CONTROLLER_EXIT_LEASE_LOST,
	END_REASON_BASELINE_RED,
	END_REASON_CONTROLLER_LOST,
	END_REASON_DRAINED,
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
 * > applies expiry, preflights, executes to drain, atomically emits `ended` with
 * > its reason while releasing the lease, prints the classified per-member
 * > report, and exits. **No idle polling, no residency.**
 *
 * The lease exists to exclude a *second* controller, not to mark a service up —
 * which is why this file has no loop waiting for work to appear. A resident
 * factory with a work queue is excluded outright (§19): the tracker is already
 * the queue, and labelling a ticket under the run's parent *is* the enqueue.
 *
 * **A normal path ends the run at most once, with a reason.** Lease loss is the
 * exception: stale authority exits 6 but cannot close a run a successor may
 * already have adopted. The terminal event and token-checked release share one
 * transaction, so there is no gap in which ownership can change between them.
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
 * @param {() => number} [invocation.watching] actual live Herdr subscriptions; #99 wires
 *   the observer, so zero is the truthful default rather than an attempt-derived guess
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
	watching = () => 0,
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
			watching,
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

	let answered = null;
	let failure = null;
	try {
		answered = await drive(store, hold, context);
	} catch (error) {
		failure = error;
	}

	// A refusal or an unexpected failure before normal terminalization still
	// gives up this process's hold. A successful drive already released in the
	// same transaction as `run.ended`.
	if (!hold.released && !hold.lost) {
		try {
			hold.release();
		} catch (error) {
			failure ??= error;
		}
	}

	// Only the typed ownership loss is converted to exit 6. A disk failure while
	// recording that loss, or any unrelated exception racing with it, still
	// propagates rather than being hidden behind the lease verdict.
	if (failure !== null && !isLeaseLoss(failure)) throw failure;
	if (hold.lost) return leaseLostAnswer(store, hold);
	if (failure !== null) throw failure;
	return answered;
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
	// An adopted run's row already exists, so a loss from here on may name it. A
	// minted one is only *intended* until its `run.started` commits — a loss in
	// between reports no run, because no durable record names one (§14.6).
	if (entry.mode === ENTRY_MODES.adopted) hold.adopt(entry.run);
	else hold.intend(entry.run);

	// §10.4: the abandoned run is ended by a **different** controller — this one —
	// which is what lets `controller-lost` be written at all without any process
	// ever self-asserting it (§14.36).
	for (const abandoned of entry.abandon) {
		hold.append(
			runEndedEvent(abandoned, { endReason: END_REASON_CONTROLLER_LOST, at: startedAt, observer: entry.run }),
		);
	}

	const expiry = applyExpiry();
	openLifecycle(hold, entry, { at: startedAt });

	let lifecycle = RUN_LIFECYCLE.preflight;
	const heartbeat = startHeartbeat({
		store,
		hold,
		run: entry.run,
		now: context.now,
		timers: context.timers,
		activity: () => `${lifecycle}: ${store.readTicketExecutions(entry.run).length} ticket executions`,
		// This is the observer's live subscription count. An unfinished attempt is
		// only a target it should watch; treating that row as proof of a subscription
		// makes a dead observer look healthy. Until #99 wires the observer, zero is
		// the only observed value.
		watching: context.watching,
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

		// Lease loss is a controller-process outcome, not authority to close the
		// run. The successor may already be driving this same `run_id`.
		if (hold.lost) return leaseLostAnswer(store, hold);

		// The run's reason is decided before execution: a red required preflight
		// ends here, while only a green run reaches `running`.
		const endReason = endReasonOf(checked);
		if (endReason === END_REASON_DRAINED) {
			lifecycle = move(hold, entry.run, RUN_LIFECYCLE.running, { at: context.now() });
			lifecycle = move(hold, entry.run, RUN_LIFECYCLE.draining, { at: context.now() });
		}

		const endedAt = context.now();
		const ended = hold.release({
			event: runEndedEvent(entry.run, {
				endReason,
				at: endedAt,
				red: endReason === END_REASON_BASELINE_RED ? checked.red : [],
			}),
		});
		if (!ended) return leaseLostAnswer(store, hold);
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

/** §10.3's mandatory reason for a run this controller still owns. */
function endReasonOf(checked) {
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
function openLifecycle(hold, entry, { at }) {
	if (entry.mode === ENTRY_MODES.adopted) {
		move(hold, entry.run, RUN_LIFECYCLE.preflight, { at });
		return;
	}

	hold.append({
		kind: "run.started",
		source: "controller",
		run: entry.run,
		occurredAt: at,
		observedAt: at,
		payload: { scope: entry.scope, mode: entry.mode },
	});
	// The append above committed under the token, so the run now durably exists
	// and a later loss names it rather than reporting no run.
	hold.adopt(entry.run);
}

/**
 * A run's lifecycle moves **through the hold**, never through the store.
 *
 * These four records are the run's authoritative state — the monitor renders
 * them and the next controller re-enters on them — and unlike an effect they
 * have no §14.5 backstop that quietly declines a superseded write. A holder
 * whose row lapsed and was adopted learns it is stale only at its next
 * compare-and-swap, so a plain `store.append` here would let a stale process
 * park a successor's run at `draining` while the successor preflights it.
 * `hold.append` compares the token in the same transaction as the write.
 */
function move(hold, run, lifecycle, { at }) {
	hold.append({
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
 *
 * There is no `lease-lost` caller and there cannot be one: the reason names a
 * controller process's exit, and the projector refuses it on a `run.ended`
 * (§14.6). The run this controller drives ends by riding its lease release; the
 * runs `--new-run` abandons end through `hold.append`, under the same proof.
 */
function runEndedEvent(run, { endReason, at, red = [], observer = null }) {
	return {
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
	};
}

/**
 * A stale process's own result. The run deliberately has no terminal reason:
 * only the current holder may append one, and a successor can re-enter this
 * same `run_id`. `controller.lease-lost` is the durable explanation.
 */
function leaseLostAnswer(store, hold) {
	const run = hold.run;
	const row = run === null ? null : store.readRun(run);
	const report = {
		run,
		lifecycle: row?.lifecycle ?? null,
		end_reason: null,
		controller_exit_outcome: CONTROLLER_EXIT_LEASE_LOST,
		exit_code: EXIT_LEASE_LOST,
		fencing_generation: hold.fencingGeneration,
	};
	return {
		message:
			run === null
				? `controller lost lease generation ${hold.fencingGeneration} before adopting a run; exiting 6.`
				: `controller lost lease generation ${hold.fencingGeneration} for run ${run}; ` +
					"the stale process left the run open for its current owner and is exiting 6.",
		report,
		exitCode: EXIT_LEASE_LOST,
	};
}

function isLeaseLoss(error) {
	return error instanceof FactoryStateError && error.reason === "lease-lost";
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
