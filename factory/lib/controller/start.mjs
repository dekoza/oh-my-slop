import { capacityPlan, implementDispatch } from "../capacity/plan.mjs";
import { openCapacity } from "../capacity/slots.mjs";
import {
	EXIT_LEASE_LOST,
	EXIT_REFUSED,
	EXIT_USAGE,
	exitCodeForEndReason,
} from "../cli/exit-codes.mjs";
import {
	CONTROLLER_EXIT_LEASE_LOST,
	DISPOSITION_RELEASED,
	END_REASON_ABANDONED,
	END_REASON_BASELINE_RED,
	END_REASON_CAPACITY_EXHAUSTED,
	END_REASON_CIRCUIT_BREAKER,
	END_REASON_CONTROLLER_LOST,
	END_REASON_DRAINED,
	END_REASON_STOPPED_BY_OPERATOR,
	RUN_LIFECYCLE,
} from "../domain/vocabulary.mjs";
import { circuitBreaker } from "./breaker.mjs";
import { FactoryEffectError } from "../effects/errors.mjs";
import { FactoryGitError } from "../git/errors.mjs";
import { readAttemptBranches, unreadableAttemptBranches } from "../git/parked.mjs";
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
import { FactoryTrackerError } from "../tracker/errors.mjs";
import { attemptIdOf, mintedAttemptBranches } from "../worker/attempt.mjs";
import { createAdoptionProbe } from "../worker/adoption.mjs";
import { settleUnadoptable } from "../worker/lifecycle.mjs";
import { applyDisposition } from "../tracker/disposition.mjs";
import {
	emptyScopeDiagnosis,
	humanSinks,
	isEmptyParentScope,
	MEMBER_CLASSES,
	noSinkWarning,
	readScope,
} from "../tracker/frontier.mjs";
import { createGiteaReader } from "../tracker/gitea.mjs";
import { resolveMapScope } from "./map-scope.mjs";
import { SCOPE_FORMS } from "./scope.mjs";
import { createGiteaWriter } from "../tracker/writer.mjs";
import { drainReport } from "./drain.mjs";
import { decideEntry, ENTRY_MODES, liveRunAnswer } from "./entry.mjs";
import { CONTROLLER_PANE_ENV, FOREGROUND_FLAG, launch } from "./launch.mjs";
import { FactoryRunError, isUsageRefusal } from "./errors.mjs";
import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from "./heartbeat.mjs";
import { holdControllerLease } from "./lease-guard.mjs";
import { preflight } from "./preflight.mjs";
import { applyExpiry } from "../retention/expiry.mjs";
import { createProductionPipeline } from "../pipeline/production.mjs";
import { schedule } from "./scheduler.mjs";
import { describeScope, PARENT_FLAG, parseScope } from "./scope.mjs";
import { createReadmissionProbe } from "../worker/readmit.mjs";

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
 * @param {(lane: object) => Promise<object> | null} [invocation.pipeline] an
 *   override for the phases above the claim. Omitted selects #147's production
 *   composition; explicit `null` keeps the no-pipeline seam for focused tests
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
	pipeline,
	frontier,
	execute,
}) {
	const reader = tracker ?? createGiteaReader({ repo: config.tracker.repo, login: config.tracker.login });

	// #182: a bare number that is a `wayfinder:map` means the map's members.
	// Resolved **here, above the process-shape branch**, so the detached launcher
	// and the foreground controller answer §10.4's live-run question about the
	// same selector, and the run records the selector rather than the number.
	// The read is made only by a start that would read a live frontier at all,
	// for the reason #181's pre-run check is: a run with nothing to execute asks
	// the tracker nothing.
	//
	// A tracker that cannot be read is the **controller's** refusal, typed. The
	// launcher's read serves only §10.4's answer — the controller it launches
	// resolves the line again from `rawArgs` and refuses if it cannot — so a
	// launcher that could not read carries the parsed scope through rather than
	// refusing on behalf of a process that has not looked yet.
	const foreground = flags.has(FOREGROUND_FLAG);
	let requested;
	let resolvedFrom = null;
	try {
		requested = parseScope(args, { parent: flags.has(PARENT_FLAG) });
		if (readsLiveFrontier({ pipeline, execute, frontier })) {
			try {
				({ scope: requested, resolved_from: resolvedFrom } = await resolveMapScope(reader, requested));
			} catch (error) {
				if (!(error instanceof FactoryTrackerError)) throw error;
				if (foreground) throw unreadableScope(error, args);
			}
		}
	} catch (error) {
		return refusal(error);
	}

	// §10.1's process shape: the **default launch is detached into a Herdr pane**,
	// and `--foreground` is the invocation running as the controller in this
	// terminal. They are one verb because they are one job with one decision
	// between them; the branch is the decision, and the two shapes share the
	// scope parse and §10.4's live-run answer above it.
	if (!foreground) {
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

	const store = await openStore({ repoRoot, agentDir });
	try {
		return await start(store, {
			requested,
			resolvedFrom,
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

	// #181: a parent nothing declares membership of is refused **before a run
	// exists**, so the journal never records a drain over a scope that was never
	// there — §10.3's end reasons describe runs that ran, and "empty" is not one.
	// The read happens only when this run would read a live frontier at all: a
	// run with nothing to execute reads none (§3.3), and a tracker asked on its
	// behalf would be a read with no consumer.
	//
	// #183 rides the same read: a parent with no `ready-for-human` member is a
	// scope that will go quiet when it drains. A warning on the report and the
	// start line, never a refusal — a parent scoped by hand may have none.
	const warnings = [];
	if (entry.scope.kind === SCOPE_FORMS.parent && readsLiveFrontier(context)) {
		const view = await readScope(context.tracker, entry.scope, { at: startedAt });
		if (isEmptyParentScope(view)) {
			const { reason, message, details } = emptyScopeDiagnosis(view);
			return refusal(new FactoryRunError(reason, message, details));
		}
		if (humanSinks(view).length === 0) warnings.push(noSinkWarning(view));
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

	// §12.6: **once per controller invocation, after reconcile and before
	// preflight, under the controller lease** — the established "state is
	// authoritative and nothing is in flight" window, and never on a timer, never
	// mid-run (§14.30). It sits above `openLifecycle` on purpose: this run has no
	// record yet, so it is not a candidate, and an adopted one is held as `live`.
	// A failure here propagates rather than being swallowed — a housekeeping pass
	// that warns and continues is the failure mode §11.2 exists to end, and a run
	// that could not settle its own history has not established the "nothing is in
	// flight" premise the rest of this function is written under.
	const expiry = applyExpiry(store, { retention: context.config.retention, hold, at: startedAt });
	openLifecycle(hold, entry, { at: startedAt, pane: context.pane });
	const paneMark = await markOwnPane(context, entry.run);
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
		const plan = capacityPlan({
			concurrency: context.config.concurrency,
			profiles: context.config.profiles,
			activeRouting: context.activeRouting,
		});
		const capacity = openCapacity(store, {
			leases: context.leases,
			plan,
			run: entry.run,
			hold,
			now: context.now,
			// #154: the memo's expiry is settled by probe, never by the clock (§5.2).
			// The probe spends one cheap completion on the class under the worker
			// binding; with no production context there is nothing to probe with,
			// and the gate answers "blocked, missing the probe" rather than opening
			// on an assumption.
			probeClass:
				checked.production === null
					? null
					: createReadmissionProbe({
							plan,
							profiles: context.config.profiles,
							environment: checked.production.worker.environment,
							repoRoot: context.repoRoot,
							transport: context.workerTransports?.readmit ?? {},
						}),
		});

		// The composition this run would execute a lane with, decided **before** the
		// reclaim below: §5.5's adoption is only worth doing for a run that can
		// actually resume the lane it adopts.
		let scheduling = context;
		if (checked.ok && context.pipeline === undefined) {
			const production = createProductionPipeline(store, {
				hold,
				leases: context.leases,
				config: context.config,
				activeRouting: context.activeRouting,
				tracker: context.tracker,
				trackerWriter: context.trackerWriter,
				herdr: context.herdrControl,
				preflight: checked.production,
				executable: context.executable,
				env: context.env,
				now: context.now,
			});
			scheduling = {
				...context,
				pipeline: production.execute,
				prepareExecution: production.prepare,
			};
		}
		const executor = checked.ok ? executorFor(store, entry, hold, scheduling) : null;

		// §9.4: a slot a previous controller left held is settled **by probing its
		// holder, never by waiting for a clock** — and §5.5's adoption is that same
		// probe's other answer. A provable worker of this run comes back as a lane
		// to resume; a disproved one has its attempt settled and its row released;
		// an unanswerable read moves nothing and is accounted for when the run ends.
		//
		// **The transfer is gated on there being a run to transfer into.** A red
		// preflight, or a package with nothing to execute a lane with, adopts
		// nothing: a row moved onto a generation that ends without using it is
		// exactly the row no successor can settle.
		const reclaimed = await capacity.reclaim({
			probe: createAdoptionProbe({ store, herdr: context.herdrControl }),
			adopt: executor !== null,
			settleAttempt: (answer) =>
				settleUnadoptable(store, {
					hold,
					identity: { run: answer.run, ticket: answer.ticket, phase: answer.phase, attempt: answer.attempt },
					adoption: adoptionEvidence(answer),
					actor: "controller",
					now: context.now,
				}),
			at: context.now(),
		});

		// Only a green run reaches `running`: a red required preflight ends the run
		// with `baseline-red` without a lane ever being offered a slot.
		let executed = null;
		let executionContext = context;
		if (checked.ok) {
			lifecycle = move(hold, entry.run, RUN_LIFECYCLE.running, { at: context.now() });
			executionContext = scheduling;
			executed = await runScheduler(store, capacity, entry, hold, scheduling, {
				executor,
				resumed: reclaimed.resumed,
			});
			lifecycle = move(hold, entry.run, RUN_LIFECYCLE.draining, { at: context.now() });
		}

		if (hold.lost) return leaseLostAnswer(store, hold);

		// Anything this run adopted and never ran is given back before it ends. Its
		// generation is superseded the moment the run is over, and a row held under
		// a generation nobody drives is a row no successor may adopt (§5.5) — so a
		// lane the loop never reached, because a stop was already pending or an
		// abandon came first, must not leave an index quietly one short.
		const releasedAdopted = capacity.releaseAdopted({ at: context.now() });

		// §10.3's mandatory reason, read **after** the loop: a stop that arrived
		// mid-run was honoured at a ticket boundary, and the record of it is what
		// says so.
		const requests = operatorRequests(store, entry.run);
		// §8.6, read once and used twice: the reason this run ended and the number
		// the report shows the operator come from the same call, so the report
		// cannot say "two consecutive automation failures" beside an end reason
		// that disagrees.
		const breaker = circuitBreaker(store, { run: entry.run, threshold: context.config.budgets.circuitBreaker });
		const endReason = endReasonOf(checked, requests, breaker, executed);
		let execution = executionReport(store, entry.run, executed, executionContext);
		if (endReason !== END_REASON_BASELINE_RED) {
			execution = await settleAtBoundary(store, hold, entry.run, {
				endReason,
				at: context.now(),
				executed,
				context: executionContext,
				// #151's read is git's to answer, and the private clone is the green
				// preflight's handle. A run that never got one carries no evidence
				// rather than an assumption about what its attempts left behind.
				clone: checked.production?.clone ?? null,
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
			scope: {
				...entry.scope,
				described: describeScope(entry.scope),
				// #182: where a rewritten selector came from — the map ticket and the
				// label that made it one — or `null` when the line said it outright.
				resolved_from: context.resolvedFrom ?? null,
			},
			reconcile: reconcileReport(reconciled),
			// #183: what the operator should know that stopped nothing. Always
			// present, so a `--json` consumer reads an empty list rather than a
			// field that sometimes exists.
			warnings: Object.freeze(
				warnings.map((warning) => Object.freeze({ reason: warning.reason, message: warning.message, ...warning.details })),
			),
			expiry,
			// §12.8's sixth target kind, reported rather than assumed: whether this
			// run's controller pane carries the mark that makes it reclaimable, and
			// why not when it does not. A pane that could not be marked is a pane
			// cleanup will leave alone forever, which an operator should be able to
			// read off the run that left it.
			controller_pane: paneMark,
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
			capacity: {
				...capacity.snapshot({ at: endedAt }),
				reclaim: reclaimReport(reclaimed),
				released_adopted: releasedAdopted,
				// §5.5, §12.4: what this run could not settle, said out loud rather
				// than left as a pool one index short. A row an unanswerable probe left
				// behind is not adoptable by anyone — the run that took it is over —
				// so the report names it and what will settle it.
				unsettled: capacity.unsettled({ at: endedAt }),
			},
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
function runScheduler(store, capacity, entry, hold, context, { executor, resumed = [] }) {
	const run = entry.run;

	return schedule({
		capacity,
		frontier: executor === null ? emptyFrontier : readsLiveFrontier(context) ? liveFrontier(entry, context) : context.frontier,
		// §5.5's adopted lanes, entered ahead of the first frontier read. They are
		// empty unless a previous controller left a worker this one could prove.
		resumed,
		dispatch: (member, { at }) =>
			implementDispatch(
				{ profiles: context.config.profiles, activeRouting: context.activeRouting },
				member,
				{ exhaustion: capacity.exhaustion, at },
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
			latestRequest(operatorRequests(store, run)) === null &&
			!circuitBreaker(store, { run, threshold: context.config.budgets.circuitBreaker }).tripped,
		abandoning: () => latestRequest(operatorRequests(store, run))?.kind === "run.abandon-requested",
		at: context.now,
	});
}

/**
 * The reclaim, as the **report** carries it.
 *
 * `resumed` hands the scheduler live slot holds, and a hold is a capability
 * rather than a fact: a report is printed, serialised, and read by the monitor,
 * and none of those is something to do with one. The lanes are named instead —
 * their ticket, the attempt the probe proved, the rows they hold, and the
 * evidence that authorised the move.
 */
function reclaimReport(reclaimed) {
	return {
		...reclaimed,
		resumed: reclaimed.resumed.map((lane) => ({
			ticket: lane.ticket,
			attempt: lane.attempt,
			slots: [lane.slots.ticket.name, ...(lane.slots.model === null ? [] : [lane.slots.model.name])],
			evidence: lane.evidence,
		})),
	};
}

/**
 * §5.5's verdict, as the ending of a disproved attempt records it.
 *
 * The whole probe answer minus the identity the record already carries: an
 * `attempt.ended` naming its own run, ticket, and attempt a second time inside
 * its payload is noise in the one record an operator reads first.
 */
function adoptionEvidence(answer) {
	return Object.freeze({ verdict: answer.verdict, tests: answer.tests ?? {}, evidence: answer.detail ?? {} });
}

/**
 * What this run can do with a claimable ticket, or `null` if nothing.
 *
 * **One predicate, read by both the loop and the report.** An injected `execute`
 * is a whole ticket execution and answers for itself; otherwise the claim is
 * composed onto a pipeline, and with no pipeline there is nothing to compose.
 */
function executorFor(store, entry, hold, context) {
	if (!hasExecutor(context)) return null;
	if (context.execute !== undefined) return context.execute;
	return ticketExecution(store, entry, hold, context);
}

/**
 * The predicate `executorFor` answers `null` by, readable without a hold — and
 * readable **before** #147's production pipeline is composed, which happens
 * after preflight. An omitted `pipeline` is that composition, so it counts; only
 * an explicit `null` is the focused no-pipeline seam.
 */
function hasExecutor(context) {
	return context.execute !== undefined || context.pipeline !== null;
}

/**
 * Whether this run reads §3.2's frontier **from the tracker**: it has something
 * to execute, and no suite handed it a frontier of its own. Both the loop's
 * wiring and #181's pre-run check read this one answer, so a run cannot be
 * refused over a tracker read it would never have made.
 */
function readsLiveFrontier(context) {
	return hasExecutor(context) && context.frontier === undefined;
}

/** #182: the tracker failed while the line was still being read. */
function unreadableScope(error, args) {
	return new FactoryRunError(
		"scope-unreadable",
		`The tracker could not be read to resolve \`factory start ${args.join(" ")}\`: ${error.message}`,
		{ at: "scope", tracker: { reason: error.reason, ...error.details } },
	);
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
	return async ({ ticket, member, slots, capacity, route }) => {
		// §7.3's deterministic identity, so a re-entered run rebuilds the same one
		// and §4.5's duplicate check returns the claim already committed.
		const attempt = attemptIdOf({ run: entry.run, ticket, ordinal: 1 });
		// #199: production decides continuation before the claim because the claim
		// comment is the durable human-facing record of that decision. Injected
		// pipelines keep the old interface and need no preparation.
		const preparation =
			context.prepareExecution === undefined
				? null
				: await context.prepareExecution({ ticket, member, attempt, route });
		const claim = await claimTicket(store, {
			reader: context.tracker,
			writer: context.trackerWriter,
			hold,
			run: entry.run,
			ticket,
			attempt,
			assignee: context.config.tracker.assignee,
			at: context.now(),
			continuation: preparation?.claim ?? null,
		});

		// §3.3's four refusing outcomes each end the lane having written nothing.
		// `claimed: false` is what keeps them out of the report's claim count — a
		// run that touched no ticket must not report one (§9.7).
		if (!HELD_BY_THIS_RUN.has(claim.outcome)) {
			// **Three of them write nothing at all; the lost collision is the
			// exception**, and it is the only way a `ticket_execution` row exists for
			// a ticket this run does not hold: it assigned and commented before the
			// re-read told it the claim is somebody else's (§3.3). The row is settled
			// `released` here — the journal half of §8.9's row and **none of its
			// tracker half**, since §3.3's loser leaves the field exactly as it is —
			// because an execution nobody is working on must not sit in §9.6's
			// in-flight set, where the abandon boundary would drop **the winner's**
			// claim (#159). It is also what that row has always meant: this run gave
			// the execution up rather than finishing it.
			if (claim.outcome === CLAIM_OUTCOMES.lostCollision) {
				hold.append({
					kind: "ticket.disposition-changed",
					source: "controller",
					run: entry.run,
					ticket,
					occurredAt: context.now(),
					observedAt: context.now(),
					payload: { disposition: DISPOSITION_RELEASED, reason_class: null, fault: null },
				});
			}
			return { disposition: null, claimed: false, claim };
		}

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
			capacity,
			preparation,
			// §11.5's dispatch decision, made before the claim and against §9.8's
			// memo (#155). It travels with the lane for the same reason §11.6's
			// budgets do: the route this lane's model slot was taken for and the
			// route its first attempt is minted under are the one decision, and a
			// composer resolving it again would be a second place it could differ.
			route,
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
				advisory: outcome?.advisory ?? null,
				// #151: the pipeline read the attempt branches, because reading git is
				// the pipeline's to do and a disposition never shells out. A lane whose
				// composition made no such read carries `null`, which the block records
				// as "nobody looked" rather than as "nothing was built".
				parked: outcome?.attempt_branches ?? null,
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
function endReasonOf(checked, requests, breaker, executed = null) {
	if (!checked.ok) return END_REASON_BASELINE_RED;

	// The latest request decides: an abandon supersedes the stop that preceded
	// it (§13.A), and a request an earlier incarnation already honoured cannot
	// still be outstanding — honouring a stop ends the run.
	const latest = latestRequest(requests);
	if (latest !== null && latest.kind === "run.abandon-requested") return END_REASON_ABANDONED;
	if (latest !== null && latest.kind === "run.stop-requested") return END_REASON_STOPPED_BY_OPERATOR;
	if (breaker.tripped) return END_REASON_CIRCUIT_BREAKER;

	// #154: claimable work the run could not spend, because every class it
	// routes to is locked by §9's exhaustion memo. This outranks `drained` for
	// the reason the breaker outranks it: a scope with work left on it is not
	// done, and exiting 0 over it is §9.7's green-looking run that did nothing.
	if ((executed?.exhausted?.length ?? 0) > 0) return END_REASON_CAPACITY_EXHAUSTED;

	return END_REASON_DRAINED;
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
 * **The disposition is §8.9's, whole** (#159). Recording `released` and stopping
 * there left the journal and the tracker disagreeing about the same ticket, and
 * the tracker is the half a human reads: an assignee still standing under a claim
 * comment nothing answers reads as a run still working. §8.9's table says
 * `released` drops the claim, states itself, and adds no label, and this path is
 * reached by ordinary operator action — a second stop or a SIGTERM (§10.5, §15) —
 * rather than only by a crash. §3.3's staleness still settles a claim whose
 * controller died mid-settlement, but as the backstop it is rather than as a
 * timeout standing in for a fact this controller already knew.
 *
 * §9.6's abandon *stops issuing new effects* about the **work**: no pane is
 * touched, no worker is relaunched, nothing new is claimed. A wedged pane is
 * evidence (§13.B, §14.27) and pane reclamation is cleanup-plan's exclusively.
 * Giving the claim back is not new work — it is the settlement of work already
 * done with, and §8.9 has one word for it.
 *
 * The lanes are not awaited (§9.6), so one may still be alive in this process and
 * may still reach its own §8.9 row — and then §4.5's pair is what decides, since
 * both settlements key the same `comment-post` on the same ticket execution: the
 * second is a typed payload conflict rather than two disagreeing comments on one
 * ticket. It lands in a promise nobody awaits, in the moment before the binary
 * exits; that is the whole of the exposure, and it is the pair doing its job.
 *
 * **A tracker refusal is carried, never raised.** Letting it escape would trade
 * the run's own ending — `run.ended`, the lease release, exit 4 — for a mutation
 * that has somewhere else to be answered, which is the one thing a settlement
 * must not do. What that somewhere is, exactly: the disposition is already in the
 * journal, and the refused mutation is §4.5's *requested* half, so reconcile
 * re-probes it and §12.4 alarms on it — **reconcile settles the record, it does
 * not perform the write**. So the claim itself falls back to §3.3's staleness for
 * that ticket, as it did before this path wrote anything, and the run names the
 * ticket in `released_unsettled` rather than reporting a release the tracker
 * refused. The announcement is not posted over a claim that is still standing:
 * §8.9's order is the eligibility change first, and a comment saying the work was
 * given up, above an assignee saying it was not, is worse than the silence.
 */
async function settleAtBoundary(store, hold, run, { endReason, at, executed, context, clone }) {
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

	// Every record first, then the tracker: the durable half is what §13.A reads
	// back and what §3.3 proves a takeover from, and a refusal partway through the
	// mutations below must not leave some of these executions with no disposition
	// at all.
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
			payload: { disposition: DISPOSITION_RELEASED, reason_class: null, fault: null },
		}),
	);

	// **Every one of them is a claim this run holds.** §3.3's contest loser is the
	// one execution that would not be, and un-assigning there would clear *the
	// winner's* claim — arbitration is only reachable between installs sharing one
	// tracker identity, so the two claims are one field. That row never reaches
	// here: the lane records its own `released` the moment it loses, which is what
	// keeps this loop from needing a rule about whose claim it is settling.
	const unsettled = [];
	for (const execution of inFlight) {
		try {
			await applyDisposition(store, {
				writer: context.trackerWriter,
				hold,
				run,
				ticket: execution.ticket,
				// The identity the claim was made under (§7.3), derived rather than read
				// back: it is what the ordinary path names on its own disposition, so one
				// ticket execution reads the same in the journal whichever way it ended.
				attempt: attemptIdOf({ run, ticket: execution.ticket, ordinal: 1 }),
				assignee: context.config.tracker.assignee,
				at,
				disposition: DISPOSITION_RELEASED,
				parked: await parkedBranches(store, clone, { run, ticket: execution.ticket }),
			});
		} catch (error) {
			if (isLeaseLoss(error)) throw error;
			if (!(error instanceof FactoryTrackerError) && !(error instanceof FactoryEffectError)) throw error;
			unsettled.push(Object.freeze({ ticket: execution.ticket, reason: error.message }));
		}
	}

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
		// Named rather than counted: the operator's next question about a release the
		// tracker did not take is *which ticket*, and §12.4's alarm on the unresolved
		// effect is the other half of the answer.
		released_unsettled: Object.freeze(unsettled),
	});
}

/**
 * #151's evidence for a ticket execution the run is giving up on, as
 * `git/parked.mjs`'s two halves composed here.
 *
 * The composition is at the call site by that module's own design — the journal
 * says which attempts exist and the clone says what their refs are now, and the
 * seam between intent and fact stays visible in the signatures. The production
 * pipeline composes the same two for the dispositions it produces; this is the
 * one ending that never reaches it, which is exactly why the evidence is most
 * likely to matter here: an abandon catches a builder mid-work, and §7.7 makes
 * its branch the only copy of what it committed.
 *
 * A run with no green production handles has no clone to ask, and answers `null`
 * — **"nobody looked", never "nothing was built"** (§11.2).
 */
async function parkedBranches(store, clone, { run, ticket }) {
	if (clone === null) return null;

	try {
		return await readAttemptBranches(clone, mintedAttemptBranches(store, { run, ticket }));
	} catch (error) {
		// The read is evidence about a disposition already decided, so a refusal
		// costs the evidence and never the settlement — the same carry, and the same
		// typed refusal, the pipeline's own composition makes of this pair. The read
		// half never throws by construction; the journal half can, on an identity no
		// branch name is derivable from. A store that cannot answer is not caught
		// here and is not meant to be: the `hold.append` above would already have
		// failed on it, and this function is not where that gets discovered.
		if (!(error instanceof FactoryGitError)) throw error;
		return unreadableAttemptBranches(error.message);
	}
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
	// manages. It is recorded, never acted on — this run and every later one
	// leave the pane exactly as found (§13.B).
	//
	// **Cleanup does not find the pane through this record**, and deliberately
	// not: Herdr reuses pane ids, so a recorded one may since have become the
	// operator's own terminal. §12.8's plan enumerates panes by the token
	// `markOwnPane` stamps, which is §14.27's guard rather than a lookup. What the
	// record is for is the operator reading a finished run's report and wanting to
	// know where it ran.
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
 * §12.8's sixth target kind, made reachable: **stamp the run onto the
 * controller's own pane**, and only where the factory made that pane.
 *
 * The discriminator is the launcher's declared environment, never
 * `HERDR_PANE_ID` alone. Herdr sets the pane id in every pane it manages,
 * including the terminal an operator ran `--foreground` from, so stamping on
 * that evidence would make the operator's own shell a cleanup target — which is
 * precisely the sentence §14.27 exists to write: *the factory does not own panes
 * it did not create.* Unstamped is the safe state, and it is the default.
 *
 * **A refusal is not fatal, and that is a decision rather than a shrug.** The
 * only thing the stamp buys is that this pane can be reclaimed later; without it
 * cleanup finds no token and never touches the pane, which is the same outcome as
 * §13.B's for every pane in the system before #118. Failing the run over an
 * unmarked pane would trade a live run for a byte of housekeeping — and the mark
 * is display-only metadata, not state anything reads for correctness. The answer
 * rides the run's report either way, so a pane cleanup will never reclaim is
 * visible on the run that left it rather than discovered as missing bytes.
 *
 * `null` is the honest answer for a run whose pane the factory did not make:
 * nothing was attempted, so there is no outcome to report.
 */
async function markOwnPane(context, run) {
	if (context.pane === null || (context.env?.[CONTROLLER_PANE_ENV] ?? "") === "") return null;

	return context.herdrControl.stampRun(context.pane, { run, title: `factory ${run}` });
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

	// #182: the operator typed a map's number, and the sentence says what that
	// became before it says what happened to it.
	const resolved =
		report.scope.resolved_from === null || report.scope.resolved_from === undefined
			? ""
			: `#${report.scope.resolved_from.ticket} carries ${report.scope.resolved_from.label}, so its members were the scope: `;

	const sentence =
		`${resolved}run ${report.run} over ${report.scope.described} ended ${ended}, ` +
		`having claimed ${report.execution.claimed} tickets${scope}.`;

	return `${sinkLead(report)}${sentence}${sinkTail(report)}${warningTail(report)}`;
}

/**
 * #183: the sinks — `ready-for-human` members — are where a drained scope asks
 * the operator to look, so the report reads in the order they must act: a
 * delivered scope leads with the sink; one with answers still owed names those
 * first and the sink last.
 */
function sinksOf(report) {
	return report.execution.members.filter((member) => member.frontier_class === MEMBER_CLASSES.humanOwned);
}

function owedFirst(report) {
	return report.execution.members.filter(
		(member) => member.class === MEMBER_CLASSES.needsHuman || member.class === MEMBER_CLASSES.failed,
	);
}

function describeSink(sink) {
	return `${sink.title} (#${sink.ticket})`;
}

/** "Delivered." only when every member that is not a sink is closed. */
function sinkLead(report) {
	const sinks = sinksOf(report);
	if (sinks.length === 0 || report.execution.drained !== true) return "";
	const delivered = report.execution.members.every(
		(member) => member.class === MEMBER_CLASSES.closed || member.frontier_class === MEMBER_CLASSES.humanOwned,
	);
	return delivered ? `Delivered. Waiting on you: ${sinks.map(describeSink).join(", ")}. ` : "";
}

function sinkTail(report) {
	const sinks = sinksOf(report);
	if (sinks.length === 0 || sinkLead(report) !== "") return "";
	const first = owedFirst(report);
	const owed = first.length === 0 ? "" : ` Still on you first: ${first.map((member) => `#${member.ticket} (${member.class})`).join(", ")};`;
	return `${owed} waiting on you last: ${sinks.map(describeSink).join(", ")}.`;
}

function warningTail(report) {
	return (report.warnings ?? []).map((warning) => ` Warning: ${warning.message}`).join("");
}
