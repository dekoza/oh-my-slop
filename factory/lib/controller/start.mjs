import { capacityPlan, implementResourceClass } from "../capacity/plan.mjs";
import { openCapacity } from "../capacity/slots.mjs";
import {
	EXIT_LEASE_LOST,
	EXIT_REFUSED,
	EXIT_USAGE,
	exitCodeForEndReason,
} from "../cli/exit-codes.mjs";
import {
	CONTROLLER_EXIT_LEASE_LOST,
	END_REASON_ABANDONED,
	END_REASON_BASELINE_RED,
	END_REASON_CIRCUIT_BREAKER,
	END_REASON_CONTROLLER_LOST,
	END_REASON_DRAINED,
	END_REASON_STOPPED_BY_OPERATOR,
	RUN_LIFECYCLE,
} from "../domain/vocabulary.mjs";
import { circuitBreaker } from "./breaker.mjs";
import { FactoryEffectError } from "../effects/errors.mjs";
import { latestRequest, operatorRequests, requestReport } from "./stop.mjs";
import { installSignalRequests } from "./signals.mjs";
import { reconcile } from "../reconcile/engine.mjs";
import { PROBES } from "../reconcile/probes.mjs";
import { withTrackerProbes } from "../reconcile/tracker-probes.mjs";
import { withHerdrProbes } from "../worker/probes.mjs";
import { createHerdrControl } from "./herdr-control.mjs";
import { FactoryStateError } from "../state/errors.mjs";
import { LEASE_RENEWAL_MS, openLeases } from "../state/leases.mjs";
import { openStore } from "../state/store.mjs";
import { CLAIM_OUTCOMES, claimTicket } from "../tracker/claims.mjs";
import { applyDisposition } from "../tracker/disposition.mjs";
import { readScope } from "../tracker/frontier.mjs";
import { createGiteaReader } from "../tracker/gitea.mjs";
import { createGiteaWriter } from "../tracker/writer.mjs";
import { drainReport } from "./drain.mjs";
import { decideEntry, ENTRY_MODES, liveRunAnswer } from "./entry.mjs";
import { FOREGROUND_FLAG, launch } from "./launch.mjs";
import { FactoryRunError, isUsageRefusal } from "./errors.mjs";
import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from "./heartbeat.mjs";
import { holdControllerLease } from "./lease-guard.mjs";
import { preflight } from "./preflight.mjs";
import { schedule } from "./scheduler.mjs";
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
 * @param {{ pi?: object, claude?: object }} [invocation.workerTransports] the §6.2
 *   runtime probes' IO, injectable for the same reason `herdr` is
 * @param {() => number} [invocation.watching] actual live Herdr subscriptions; #99 wires
 *   the observer, so zero is the truthful default rather than an attempt-derived guess
 * @param {object} [invocation.signal] the event target §10.5's signals listen on —
 *   `process` by default, injectable so a test fires a signal at a chosen moment
 * @param {(args: string[], options: object) => Promise<object>} [invocation.runHerdr]
 *   §10.1's Herdr command runner for the detached launch, injectable for the same
 *   reason `herdr` is: a test drives both answers without a multiplexer on the machine
 * @param {object | null} [invocation.tracker] §5.1's read client. With one, the run
 *   resolves §3.2's live frontier itself and reconcile can settle tracker effects
 * @param {object | null} [invocation.trackerWriter] §3.3's write client; built from
 *   the same config when a tracker is present, injectable for the same reason
 * @param {(lane: object) => Promise<object>} [invocation.pipeline] the phases above
 *   the claim (#108's stage machine) — implement, harvest, verify, review,
 *   integrate. **The claim is composed onto it here**, so a package without it
 *   claims nothing
 * @param {() => Promise<object>} [invocation.frontier] §3.2's live frontier reader,
 *   overriding the one composed from `tracker`
 * @param {(lane: object) => Promise<object>} [invocation.execute] one whole ticket
 *   execution, overriding the claim-plus-pipeline composition
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
	workerTransports,
	watching = () => 0,
	signal = globalThis.process,
	runHerdr,
	tracker = null,
	trackerWriter = null,
	pipeline = null,
	frontier,
	execute,
}) {
	let requested;
	try {
		requested = parseScope(args, { parent: flags.has(PARENT_FLAG) });
	} catch (error) {
		return refusal(error);
	}

	// §10.1's process shape: the **default launch is detached into a Herdr pane**,
	// and `--foreground` is the invocation running as the controller in this
	// terminal. They are one verb because they are one job with one decision
	// between them; the branch is the decision, and the two shapes share the
	// scope parse and §10.4's live-run answer above it.
	if (!flags.has(FOREGROUND_FLAG)) {
		return launch({
			repoRoot,
			requested,
			rawArgs: args,
			agentDir,
			executable,
			env,
			herdr,
			runHerdr,
			now,
		});
	}

	const reader = tracker ?? createGiteaReader({ repo: config.tracker.repo, login: config.tracker.login });
	const store = await openStore({ repoRoot, agentDir });
	try {
		return await start(store, {
			requested,
			newRun: flags.has(NEW_RUN_FLAG),
			config,
			configPath,
			repoRoot,
			activeRouting,
			declared,
			executable,
			env,
			probes,
			now,
			timers,
			herdr,
			// §10.3's availability probe and the commands are two different things
			// and two different modules: the probe answers "is there a multiplexer",
			// and this issues pane and agent operations against it. Both are
			// injectable for the same reason.
			herdrControl: createHerdrControl({ env, ...(runHerdr === undefined ? {} : { run: runHerdr }) }),
			workerTransports,
			watching,
			signal,
			// The clients this repository's config describes. Neither holds a
			// credential: `tracker.login` names a `tea` login and `tea` resolves the
			// instance and the token (§6.8), which is also why the deny floor lists
			// `Bash(tea *)`. Injectable so a suite drives real answer shapes without
			// a Gitea, exactly as `probes` and `herdr` are.
			tracker: reader,
			trackerWriter:
				trackerWriter ?? createGiteaWriter({ repo: config.tracker.repo, login: config.tracker.login }),
			pipeline,
			frontier,
			execute,
			pane: env?.HERDR_PANE_ID ?? null,
		});
	} finally {
		store.close();
	}
}

async function start(store, context) {
	// One registry, shared by the hold and by §9.4's capacity rows: two would be
	// two clocks, and a slot's generation has to be comparable with the
	// controller generation that fences it.
	const leases = openLeases(store, { now: context.now });
	let hold;
	try {
		hold = holdControllerLease({
			store,
			leases,
			pane: context.pane,
			timers: context.timers,
		});
	} catch (error) {
		// §10.4: a live holder is resolved against, never queued behind.
		if (!(error instanceof FactoryStateError) || error.reason !== "lease-held") throw error;
		return liveRunAnswer(store, error.details, context.requested);
	}

	let answered = null;
	let failure = null;
	try {
		answered = await drive(store, hold, { ...context, leases });
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
	// §10.5: the signal path is live from the moment this controller holds the
	// lease. A signal that arrives before the run has a record has no stream to
	// write to, so its intent rides in the installer's memory and lands on
	// attach; the run's `finally` removes the listener, so a signal the run can
	// no longer be asked about goes nowhere rather than reaching a released hold.
	const signals = installSignalRequests({
		signal: context.signal,
		store,
		hold,
		now: context.now,
	});

	try {
		return await driveRun(store, hold, context, signals);
	} finally {
		signals.remove();
	}
}

async function driveRun(store, hold, context, signals) {
	const startedAt = context.now();

	// §5.4, and the reason it is first: reconcile settles what the last
	// controller left behind **before the lease is used for any effect**. The
	// hold keeps that as a latch rather than as an order of calls anyone can get
	// wrong, so nothing below could have run first.
	const reconciled = await reconcile(store, {
		// §5.3's probes for the tracker's own mutations ship with the subsystem that
		// introduces them, and they close over this invocation's reader — so they
		// join the registry here rather than at import, where there is no reader and
		// a second invocation in one process would refuse a duplicate registration.
		// The attempt path's `agent-start` and `agent-stop` join the same way, and
		// for the same reason: their read closes over one multiplexer client.
		probes: withHerdrProbes(
			withTrackerProbes(context.probes, {
				reader: context.tracker,
				assignee: context.config.tracker.assignee,
			}),
			{ herdr: context.herdrControl },
		),
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
	openLifecycle(hold, entry, { at: startedAt, pane: context.pane });
	signals.attach(entry.run);

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
			repoRoot: context.repoRoot,
			activeRouting: context.activeRouting,
			declared: context.declared,
			executable: context.executable,
			env: context.env,
			herdr: context.herdr,
			workerTransports: context.workerTransports ?? {},
			actor: "controller",
			at: startedAt,
		});

		// Lease loss is a controller-process outcome, not authority to close the
		// run. The successor may already be driving this same `run_id`.
		if (hold.lost) return leaseLostAnswer(store, hold);

		// §9.1's pools, opened once the run is green. The numbers are the config's
		// own: the loop below is parametric in them and reads no ceiling constant,
		// which is what makes raising the ceiling a one-line change in the loader.
		const capacity = openCapacity(store, {
			leases: context.leases,
			plan: capacityPlan({
				concurrency: context.config.concurrency,
				profiles: context.config.profiles,
				activeRouting: context.activeRouting,
			}),
			run: entry.run,
			hold,
			now: context.now,
		});

		// §9.4: a slot a previous controller left held is settled **by probing its
		// holder, never by waiting for a clock**. The probe belongs to the slice
		// that can ask a pane whether it is still there (#114, #107); until then
		// this call is what reports the rows nothing can settle, rather than a
		// silent pool one index short.
		const reclaimed = capacity.reclaim({ probe: context.slotProbe ?? null, at: context.now() });

		// Only a green run reaches `running`: a red required preflight ends the run
		// with `baseline-red` without a lane ever being offered a slot.
		let executed = null;
		if (checked.ok) {
			lifecycle = move(hold, entry.run, RUN_LIFECYCLE.running, { at: context.now() });
			executed = await runScheduler(store, capacity, entry, hold, context);
			lifecycle = move(hold, entry.run, RUN_LIFECYCLE.draining, { at: context.now() });
		}

		if (hold.lost) return leaseLostAnswer(store, hold);

		// §10.3's mandatory reason, read **after** the loop: a stop that arrived
		// mid-run was honoured at a ticket boundary, and the record of it is what
		// says so.
		const requests = operatorRequests(store, entry.run);
		// §8.6, read once and used twice: the reason this run ended and the number
		// the report shows the operator come from the same call, so the report
		// cannot say "two consecutive automation failures" beside an end reason
		// that disagrees.
		const breaker = circuitBreaker(store, { run: entry.run });
		const endReason = endReasonOf(checked, requests, breaker);
		let execution = executionReport(store, entry.run, executed, context);
		if (endReason !== END_REASON_BASELINE_RED) {
			execution = settleAtBoundary(store, hold, entry.run, {
				endReason,
				at: context.now(),
				executed,
				context,
			});
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
			detached: false,
			exit_code: exitCodeForEndReason(endReason),
			started_at: startedAt,
			ended_at: endedAt,
			entry: entryReport(entry),
			scope: { ...entry.scope, described: describeScope(entry.scope) },
			reconcile: reconcileReport(reconciled),
			expiry,
			preflight: { ok: checked.ok, red: checked.red, checks: checked.checks },
			// §8.6, on every run and not only the ones it stopped: a run that got to
			// one automation failure short of the threshold is the operator's early
			// warning, and a number only printed when it is already too late is not
			// a number anybody can act on.
			circuit_breaker: breaker,
			operator: requests.map(requestReport),
			manifest: checked.manifest,
			liveness: {
				heartbeats: heartbeat.emitted,
				heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
				lease_renewal_ms: LEASE_RENEWAL_MS,
				fencing_generation: hold.fencingGeneration,
			},
			// §9.7: "the run is slow" looks identical whether lanes are working or
			// all of them are queued behind one slot, so the run says which — and
			// beside it, what the last controller left that this one could not
			// settle.
			capacity: { ...capacity.snapshot({ at: endedAt }), reclaim: reclaimed },
			execution,
			monitor: {
				// The trigger is a property of the launch surface, not of the run:
				// the /factory front publishes it after the start answers, and a
				// start from the shell has no monitor at all (§10.2, §10.6).
				requested: false,
				published_by:
					"the /factory front, after the start answers; a start from the shell publishes nothing",
				spec: "§10.6",
			},
		};

		return { message: headline(report), report, exitCode: report.exit_code };
	} finally {
		heartbeat.stop();
	}
}

/**
 * §9.6's loop, driven for this run.
 *
 * **The frontier and the execution are wired together or not at all**, and that
 * is a §3.3 rule rather than tidiness: *claiming work that cannot start puts an
 * assignee and a claim comment on the tracker for work that is not moving —
 * visible to humans and other tooling as a falsehood.* So a run that can read a
 * frontier but has no pipeline to run reads no frontier: it would otherwise offer
 * the loop a ticket it could only refuse, having already taken a slot for it.
 *
 * With both present the composition is this package's whole job — slots, order,
 * backpressure, waiting, the claim, and the disposition — and #108's stage
 * machine is what sits between the claim and that disposition.
 *
 * `executor` is asked once and both seams read the same answer. Deciding "is
 * there anything to run" twice, once here and once where the report names what is
 * missing, is how a run ends up reading a live frontier with nothing able to
 * execute against it.
 */
function runScheduler(store, capacity, entry, hold, context) {
	const run = entry.run;
	const executor = executorFor(store, entry, hold, context);

	return schedule({
		capacity,
		frontier: executor === null ? emptyFrontier : (context.frontier ?? liveFrontier(entry, context)),
		resourceClassOf: (member) =>
			implementResourceClass(
				{ profiles: context.config.profiles, activeRouting: context.activeRouting },
				member,
			),
		execute: executor ?? refuseExecution,
		// §10.5: the stop request is **polled at ticket boundaries**, which is
		// exactly where the loop asks. §13.A's abandon supersedes a pending stop
		// rather than being one, so the two predicates read the same record and
		// differ only in which kind they stop for.
		//
		// §8.6's breaker is the second way to stop claiming, and it is the same
		// stop: **draining covers an operator's stop and the circuit breaker
		// identically** (§10.3), and only the end reason carries the difference.
		// A ticket boundary is also exactly where the breaker's own order is
		// observable — a lane's disposition is committed by the time the loop asks
		// again.
		claiming: () =>
			latestRequest(operatorRequests(store, run)) === null && !circuitBreaker(store, { run }).tripped,
		abandoning: () => latestRequest(operatorRequests(store, run))?.kind === "run.abandon-requested",
		at: context.now,
	});
}

/**
 * What this run can do with a claimable ticket, or `null` if nothing.
 *
 * **One predicate, read by both the loop and the report.** An injected `execute`
 * is a whole ticket execution and answers for itself; otherwise the claim is
 * composed onto a pipeline, and with no pipeline there is nothing to compose.
 */
function executorFor(store, entry, hold, context) {
	if (context.execute !== undefined) return context.execute;
	if (context.pipeline === null || context.pipeline === undefined) return null;
	return ticketExecution(store, entry, hold, context);
}

/**
 * §3.2's live answer, re-read at every scheduling decision (§3.1).
 *
 * The edge map is deliberately not passed: `readScope` then reads
 * `dependencies` per member, which §5.1 reserves for an `add_dependency`
 * observation. The maintained map belongs to the observation poll, and this run
 * does not open one — §5.1's cursor is a run's to keep, and wiring a poll that
 * nothing consumes would be a cost with no reader. It is the honest cost of not
 * having the poll rather than a stale graph pretending to be one (#109).
 */
function liveFrontier(entry, context) {
	return () => readScope(context.tracker, entry.scope, { at: context.now() });
}

/**
 * One ticket execution: **the claim, then the pipeline above it** (§3.3, §8.10).
 *
 * A claim that does not come back this run's is **not** a lane failure: a
 * human-claimed ticket, a live claim, and a lost collision are §3.3's ordinary
 * answers, and the ticket simply stays where it was. The lane ends with no
 * disposition, carrying why.
 *
 * A pipeline that throws leaves the claim standing on purpose. A disposition is
 * what settles a ticket execution, and a throw is not one: dropping the assignee
 * here would put the ticket back in the frontier for the next run to die on
 * identically, which is §8.9's `failAutomation` mistake, while labelling it
 * `factory:failed` would assert a disposition the walk never reached. §3.3's
 * same-factory staleness is what settles a claim whose run died: proven from
 * durable state, with no waiting period.
 *
 * **The disposition is recorded before it is acted on.** A crash in between
 * leaves a `released` record beside a claim still standing, which §3.3 settles;
 * the other order would leave a dropped claim with no record, and the run would
 * report a lane it finished as still in flight.
 */
function ticketExecution(store, entry, hold, context) {
	return async ({ ticket, member, slots }) => {
		// §7.3's deterministic identity, so a re-entered run rebuilds the same one
		// and §4.5's duplicate check returns the claim already committed.
		const attempt = `${entry.run}-t${ticket}-a1`;
		const claim = await claimTicket(store, {
			reader: context.tracker,
			writer: context.trackerWriter,
			hold,
			run: entry.run,
			ticket,
			attempt,
			assignee: context.config.tracker.assignee,
			at: context.now(),
		});

		// §3.3's four refusing outcomes each end the lane having written nothing.
		// `claimed: false` is what keeps them out of the report's claim count — a
		// run that touched no ticket must not report one (§9.7).
		if (!HELD_BY_THIS_RUN.has(claim.outcome)) return { disposition: null, claimed: false, claim };

		// §11.6's declared numbers travel with the lane rather than being fetched
		// by whoever composes the walk: the budgets a ticket execution spends and
		// the ones its run was started under are the same numbers, and a composer
		// reaching for the config itself would be a second place they could be read
		// from — including, on a re-entry, a file that has since changed.
		const outcome = await context.pipeline({
			ticket,
			member,
			slots,
			attempt,
			claim,
			budgets: context.config.budgets,
		});
		const disposition = outcome?.disposition ?? null;

		if (disposition !== null) {
			hold.append({
				kind: "ticket.disposition-changed",
				source: "controller",
				run: entry.run,
				ticket,
				occurredAt: context.now(),
				observedAt: context.now(),
				// §8.6: the fault rides the record because the circuit breaker counts
				// **automation** failures in terminal-commit order, and this is the
				// record that establishes that order. Deriving it afterwards would
				// mean re-walking the chain to ask a question the settlement already
				// answered — and the reason class rides along for the same reason the
				// tracker comment carries it: it is what the operator opens first.
				payload: {
					disposition,
					reason_class: outcome?.reason_class ?? null,
					fault: outcome?.fault ?? null,
				},
			});
		}

		// §8.9's tracker action, whichever of the four it is. The stage machine
		// produces the disposition and writes nothing to the tracker itself
		// (#108); `disposition.mjs` is the one place a disposition becomes a fact
		// on Gitea, so a lane cannot settle a ticket a different way than a report
		// of it says.
		if (disposition !== null) {
			await applyDisposition(store, {
				writer: context.trackerWriter,
				hold,
				run: entry.run,
				ticket,
				attempt,
				assignee: context.config.tracker.assignee,
				at: context.now(),
				disposition,
				reasonClass: outcome?.reason_class ?? null,
				fault: outcome?.fault ?? null,
				question: outcome?.question ?? null,
				pr: outcome?.pr ?? null,
				reason: outcome?.reason ?? null,
			});
		}

		return { disposition, claimed: true, claim, outcome };
	};
}

/** The two claim outcomes that leave the ticket this run's to work on (§3.3). */
const HELD_BY_THIS_RUN = new Set([
	CLAIM_OUTCOMES.claimed,
	CLAIM_OUTCOMES.alreadyClaimed,
	CLAIM_OUTCOMES.takenOver,
]);

/**
 * The frontier a run with nothing to execute has: empty, and empty for a reason
 * the report names. Answering anything else here would be §9.7's green-looking
 * run that did nothing.
 */
async function emptyFrontier() {
	return { claimable: [], members: [] };
}

/** Unreachable while the frontier is empty, and explicit rather than a silent no-op. */
function refuseExecution({ ticket }) {
	throw new Error(
		`Ticket ${ticket} was claimable, but nothing composes the implement attempt this package can walk (#108).`,
	);
}

/**
 * §10.3's mandatory reason for a run this controller still owns, from the
 * controller loop's own inputs only: the preflight verdict, the operator's
 * request, and §8.6's breaker verdict.
 *
 * §9.6's **"one report, one end reason", never derived from the lanes**, holds:
 * no execution row and no lane outcome reaches this function. The breaker is not
 * an exception to that — it is a read over the *durable* record of what ticket
 * executions committed, in the journal's own order, so a controller that
 * re-entered this run after a crash computes the same reason from the same
 * facts. A lane's in-memory answer would not survive that, which is exactly why
 * it is not what is read.
 *
 * **The operator's request outranks the breaker.** Both drain identically
 * (§10.3), and if a human asked for the stop the run should say so: the exit
 * code they read is the answer to what they typed. The breaker's own verdict is
 * on the report either way, so nothing about the machine's state is hidden by
 * the ordering.
 */
function endReasonOf(checked, requests, breaker) {
	if (!checked.ok) return END_REASON_BASELINE_RED;

	// The latest request decides: an abandon supersedes the stop that preceded
	// it (§13.A), and a request an earlier incarnation already honoured cannot
	// still be outstanding — honouring a stop ends the run.
	const latest = latestRequest(requests);
	if (latest !== null && latest.kind === "run.abandon-requested") return END_REASON_ABANDONED;
	if (latest !== null && latest.kind === "run.stop-requested") return END_REASON_STOPPED_BY_OPERATOR;
	if (breaker.tripped) return END_REASON_CIRCUIT_BREAKER;
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
 * §3.5's classified per-member report, over the frontier as of the loop's last
 * scheduling decision.
 *
 * The mapping and the drain verdict live in `drain.mjs`; what this function adds
 * is the run's own two facts — the durable in-flight executions, and the sentence
 * naming a subsystem that would have found work when there is one.
 *
 * **That sentence is what keeps a quiet run honest.** §9.7 names the failure
 * outright: a run that starts, claims nothing, and drains as though the work were
 * done is a green-looking run that did nothing, "the worst outcome available
 * here". A run with a tracker and a pipeline drains against a real frontier and
 * needs no such sentence; a run without a pipeline reads no frontier at all
 * (§3.3), and says which half is missing rather than reporting an empty scope.
 *
 * `refused` and `blocked` are the loop's own answers rather than absences:
 * §11.5's ticket-scoped routing conflict, and slots a previous controller left
 * held that §9.4 settles by probe. `in_flight` is what durable state says: the
 * ticket executions the projection holds without a terminal disposition. A run
 * ending beside a lane it is leaving behind says so in the same breath.
 */
function executionReport(store, run, executed, context) {
	const inFlight = store
		.readTicketExecutions(run)
		.filter((execution) => execution.disposition === null);

	return drainReport({
		view: executed?.frontier ?? null,
		executed,
		inFlight,
		missing: missingSubsystem(context),
	});
}

/**
 * What this package could not do, named — or `null` when it could do all of it.
 *
 * There is one such absence left. The tracker client is always built (§6.8 makes
 * it credential-free), the claim is this slice's, and the drain report is real —
 * so the only reason a run reads no frontier is that it has nothing to run
 * against one, and §3.3 forbids claiming in that state.
 */
function missingSubsystem(context) {
	if (context.execute !== undefined) return null;
	if (context.pipeline === null || context.pipeline === undefined) {
		return "an implement attempt for §8.10's stage machine to walk — the launch exists (#107) and nothing composes it into a phase (#108)";
	}
	return null;
}

/**
 * §9.6 at the ticket boundary: what a drain does, split by the reason that
 * asked for it.
 *
 * `drained` and `stopped-by-operator` let every in-flight execution reach its
 * terminal disposition, integration included — the loop has already done that
 * waiting by the time this runs. `abandoned` is the one reason that acts here:
 * the loop released the lanes' **slots** where it stood, and this writes the
 * durable disposition beside them, which is what the next reconcile reads to
 * tell a stopped run from an abandoned one (§13.A).
 *
 * **It touches no pane, and it touches no tracker.** §9.6's abandon *stops
 * issuing new effects*, so the assignee stays exactly where it is: dropping it
 * here would be a mutation issued by a run that has just declared it is issuing
 * none. The claim a dead run leaves behind is not stranded — §3.3's same-factory
 * staleness proves it from this same durable disposition and takes it over with
 * no waiting period, which is why the record below is the whole obligation. A
 * wedged pane is evidence for the same reason (§13.B, §14.27), and pane
 * reclamation is cleanup-plan's exclusively.
 */
function settleAtBoundary(store, hold, run, { endReason, at, executed, context }) {
	if (endReason !== END_REASON_ABANDONED) {
		return executionReport(store, run, executed, context);
	}

	// `released` is §8.8's word for an execution whose work the run gives up on
	// rather than finishes, and the record carries it: the journal is the next
	// reconcile's source, and a release that lived only in a dead process's
	// memory is a release the next controller cannot see.
	const inFlight = store
		.readTicketExecutions(run)
		.filter((execution) => execution.disposition === null);

	inFlight.forEach((execution) =>
		hold.append({
			kind: "ticket.disposition-changed",
			source: "controller",
			run,
			ticket: execution.ticket,
			occurredAt: at,
			observedAt: at,
			// §8.9's `released` carries no reason class and no fault: the operator
			// gave up on the work, and nothing about the ticket or the host failed.
			// Spelling both nulls rather than omitting them is what keeps a v2
			// reader from having to tell "no fault" from "an older writer".
			payload: { disposition: "released", reason_class: null, fault: null },
		}),
	);

	// Counted by ticket rather than added up: the loop already released the lanes
	// it was running, and the claim writes a `ticket_execution` row per ticket, so
	// the same lane appears in both lists. A run that abandoned one lane must not
	// report two.
	const released = new Set([
		...inFlight.map((execution) => execution.ticket),
		...(executed?.lanes ?? []).filter((lane) => lane.abandoned === true).map((lane) => lane.ticket),
	]);

	return Object.freeze({
		...executionReport(store, run, executed, context),
		in_flight: inFlight.length,
		released: released.size,
	});
}

/**
 * A run exists before preflight does (§10.3). A *new* run is opened with
 * `run.started`, which is what mints its projection row and records its
 * selector; an adopted one already has both and is moved back to `preflight`,
 * because a re-entered run preflights again — the world it checked may have
 * changed while nobody was driving.
 */
function openLifecycle(hold, entry, { at, pane }) {
	if (entry.mode === ENTRY_MODES.adopted) {
		move(hold, entry.run, RUN_LIFECYCLE.preflight, { at });
		return;
	}

	// The pane is the controller's own: Herdr injects it into the pane it
	// manages, and the record is where #118's cleanup finds the pane of a
	// finished run. It is recorded, never acted on — this run and every later
	// one leave the pane exactly as found (§13.B).
	hold.append({
		kind: "run.started",
		source: "controller",
		run: entry.run,
		occurredAt: at,
		observedAt: at,
		payload: { scope: entry.scope, mode: entry.mode, pane },
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

/**
 * The two ways this process learns the lease is somebody else's.
 *
 * The first is its own compare-and-swap failing — a renewal, an `append`, a
 * release. The second is §14.5's backstop firing underneath one: **an effect
 * refused for a superseded generation is proof of the same fact**, discovered by
 * the write rather than by the latch, because a successor adopts a lapsed row
 * without telling anyone and `lost` stays false until this process's next
 * compare. Both mean §14.6 without discretion — stop, emit, exit 6 — and
 * neither is an error to crash on: the release that follows performs the
 * compare that concedes, and the run is left open for whoever owns it now.
 */
function isLeaseLoss(error) {
	return (
		(error instanceof FactoryStateError && error.reason === "lease-lost") ||
		(error instanceof FactoryEffectError && error.reason === "effect-superseded-generation")
	);
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

	// §3.5's verdict belongs in the first sentence: "drained" and "stopped with
	// three still claimable" are different answers to the operator's question, and
	// only one of them means the work is done.
	//
	// It is a different question from the end reason beside it. §10.3's reason is
	// the **controller loop's** — it stopped claiming — and §3.5's is the
	// **scope's**. A run can honestly end `drained` over a scope that is not, when
	// every remaining claimable ticket turned out to belong to somebody else, and
	// the two halves of this sentence are what keep that from reading as a
	// contradiction.
	const members = report.execution.members.length;
	const scope =
		members === 0
			? ""
			: report.execution.drained
				? ` and drained all ${members} member(s) of its scope`
				: ` with ${report.execution.drain.claimable_now} of ${members} member(s) still claimable`;

	return (
		`run ${report.run} over ${report.scope.described} ended ${ended}, ` +
		`having claimed ${report.execution.claimed} tickets${scope}.`
	);
}
