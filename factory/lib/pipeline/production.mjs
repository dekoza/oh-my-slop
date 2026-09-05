import { reserveModelRoute } from "../capacity/selection.mjs";
import { FactoryCapacityError } from "../capacity/errors.mjs";
import { DEFAULT_EXHAUSTION_MEMO_MS } from "../capacity/exhaustion.mjs";
import { resourceClassOf } from "../config/profiles.mjs";
import { PHASE_IMPLEMENT } from "../domain/vocabulary.mjs";
import { createAttemptWorktree } from "../git/attempt.mjs";
import { FactoryGitError } from "../git/errors.mjs";
import { attemptBranch } from "../git/isolation.mjs";
import { readAttemptBranches, unreadableAttemptBranches } from "../git/parked.mjs";
import { FactoryTrackerError } from "../tracker/errors.mjs";
import { snapshotTicket } from "../tracker/snapshot.mjs";
import { createClaudeAdapter } from "../worker/claude.mjs";
import { FactoryWorkerError } from "../worker/errors.mjs";
import { createPiAdapter } from "../worker/pi.mjs";
import {
	allocateAttempt,
	mintAttempt,
	mintedDispatch,
	mintedAttemptBranches,
	requireAttemptIdentity,
} from "../worker/attempt.mjs";
import { dispatchOrder, pooledCandidates, selectRoute } from "../worker/dispatch.mjs";
import { missingResult, PIPELINE_ROLES, postureOf } from "../worker/roles.mjs";
import { fedCheckEvidence } from "./feeds.mjs";
import { createRetrySeam } from "./retry.mjs";
import { harvestPhase } from "./phases.mjs";
import { integrationVerify, integratePublish } from "./integration.mjs";
import { reviewPhase } from "./review.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { walkStages } from "./stages.mjs";
import { reviewAutomationRetry } from "./budgets.mjs";
import { planTicketContinuation } from "./resume.mjs";

/**
 * #147's production composition of §8.1.
 *
 * This module assembles the existing owners; it does not reimplement them. The
 * claim remains in `controller/start.mjs`, attempt identities remain in
 * `worker/attempt.mjs`, worktrees in `git/attempt.mjs`, typed completion in the
 * runtime adapters, and every phase verdict in its existing pipeline module.
 */
export function createProductionPipeline(store, context) {
	const {
		hold,
		leases,
		config,
		activeRouting,
		tracker,
		trackerWriter,
		herdr,
		preflight,
		executable,
		env,
		now,
	} = context;
	const { clone, worker, socket } = requireProductionPreflight(preflight);
	const retryPlans = new Map();
	const adapters = workerAdapters({ herdr, socket, now, worker });

	return Object.freeze({ prepare: prepareExecution, execute: productionPipeline });

	async function prepareExecution({ ticket }) {
		// Pin immediately before the decision (§7.2), then snapshot immediately
		// before the claim. The resulting object is the one value used by the claim,
		// mint, and prompt; none of those layers re-derive #199's answer.
		const base = await clone.fetchBase({ baseBranch: config.git.baseBranch });
		const ticketSnapshot = await snapshotTicket(tracker, ticket);
		return planTicketContinuation({
			clone,
			baseCommit: base.commit,
			ticketSnapshot,
			trackerLogin: config.tracker.login,
		});
	}

	async function productionPipeline(lane) {
		return withAttemptBranches(lane, await settled(lane));
	}

	async function settled(lane) {
		try {
			return await executeProduction(lane);
		} catch (error) {
			if (!PRODUCTION_FAILURES.some((kind) => error instanceof kind)) throw error;
			return Object.freeze({
				disposition: "failed",
				reason_class: null,
				fault: "automation",
				reason: error.message,
			});
		}
	}

	/**
	 * #151: **what each attempt left on its branch, attached to every disposition
	 * this pipeline produces.**
	 *
	 * Here rather than inside the walk, and once rather than per row, because both
	 * ways of ending are covered from one place: §8.10's dispose rows come back
	 * through `executeProduction`, and a typed subsystem refusal comes back through
	 * `settled`'s catch — an attempt whose branch carries work is just as likely to
	 * be settled by the second as by the first. A phase or a row that had to
	 * remember to carry it would be a phase or a row that could forget.
	 *
	 * The clone read is git's answer to *now* (§5.2), so it is taken after the walk
	 * has finished with the attempt and not while a worker may still be committing.
	 *
	 * **A refusal here is carried, never raised.** The read is evidence about a
	 * disposition that has already been decided, so letting a typed refusal escape
	 * would trade the settlement for the evidence and leave the ticket claimed with
	 * nothing on it — the one state §8.9 has no word for. An outcome that settles
	 * nothing needs no evidence to ride, and is returned untouched.
	 */
	async function withAttemptBranches(lane, outcome) {
		if ((outcome?.disposition ?? null) === null) return outcome;

		try {
			const minted = mintedAttemptBranches(store, { run: runOfAttempt(lane.attempt), ticket: lane.ticket });
			return Object.freeze({ ...outcome, attempt_branches: await readAttemptBranches(clone, minted) });
		} catch (error) {
			if (!PRODUCTION_FAILURES.some((kind) => error instanceof kind)) throw error;
			return Object.freeze({ ...outcome, attempt_branches: unreadableAttemptBranches(error.message) });
		}
	}

	async function executeProduction(lane) {
		const { ticket, attempt, slots, capacity, route, preparation } = lane;
		if (preparation === null || preparation === undefined) {
			throw new FactoryPipelineError(
				"phase-unwired",
				`Ticket ${ticket}'s production lane reached attempt ${attempt} without its pre-claim continuation plan (#199).`,
				{ at: "continuation", ticket, attempt },
			);
		}
		const ticketSnapshot = preparation.ticketSnapshot;
		const labels = ticketSnapshot.labels;
		// §11.5's dispatch for this ticket is the scheduler's, made before the
		// claim and against the memo, and it is what the ticket slot and the
		// implement model slot were taken for (§9.4, #155). Resolving it again
		// here could reach a different answer — the memo moves — and the lane
		// would then be running on a pool it never took.
		const initialRoute = requireLaneRoute(
			mintedDispatch(store, { run: runOfAttempt(attempt), ticket, attempt })?.routing ?? route,
			{ ticket, attempt },
		);
		const initial = await openInitialAttempt({
			store,
			clone,
			hold,
			run: runOfAttempt(attempt),
			ticket,
			attempt,
			route: initialRoute,
			baseCommit: preparation.baseCommit,
			workerConfig: worker.environment,
			now,
		});

		if (preparation.brief !== null) retryPlans.set(attempt, Object.freeze({ brief: preparation.brief }));

		// One outstanding reservation per lane, consumed by the attempt that
		// launches. Recovery may bring the live reviewer's slot rather than a1's.
		const modelReservation = { slot: slots.model };
		const common = {
			modelReservation,
			store,
			clone,
			hold,
			leases,
			config,
			activeRouting,
			tracker,
			trackerWriter,
			ticketSnapshot,
			labels,
			worker,
			adapters,
			retryPlans,
			executable,
			env,
			now,
			capacity,
			acceptedRuns: preparation.acceptedRuns,
		};

		const nextAttempt = createRetrySeam(store, clone, {
			hold,
			run: initial.identity.run,
			ticket,
			baseBranch: config.git.baseBranch,
			selectRoute: (request) =>
				roleRoute(common, { ticket, ...request }),
			workerConfig: worker.environment,
			readResult: (prior) => endedAttempt(store, initial.identity.run, prior)?.payload.result ?? null,
			actor: "controller",
			now,
		});

		try {
			return await walkStages(store, {
				hold,
				run: initial.identity.run,
				ticket,
				attempt,
				phases: phaseExecutors(common),
				nextAttempt: async (request) => {
					const opened = await nextAttempt(request);
					retryPlans.set(opened.attempt, opened.plan);
					return opened;
				},
				budgets: lane.budgets,
				actor: "controller",
				now,
			});
		} finally {
			modelReservation.slot?.release({ reason: "unused-reservation", at: now() });
		}
	}
}

/** Typed subsystem refusals become §8.9 automation failures after a claim. */
const PRODUCTION_FAILURES = Object.freeze([
	FactoryCapacityError,
	FactoryGitError,
	FactoryPipelineError,
	FactoryTrackerError,
	FactoryWorkerError,
]);

function phaseExecutors(context) {
	return {
		implement: ({ run, ticket, phase, attempt }) => implement(context, { run, ticket, phase, attempt }),
		harvest: async ({ run, attempt }) => {
			const opened = attemptRecord(context.store, { run, attempt });
			return harvestPhase(context.clone, {
				worktreePath: opened.worktree,
				branch: opened.branch,
				baseCommit: opened.baseCommit,
				// #194: a rebase-repair's mint names the base it was told to rebase
				// onto, and §7.4's boundary under that tier is the merge-base with it.
				onto: opened.onto,
			});
		},
		verify: async ({ run, ticket, attempt }) => {
			const opened = attemptRecord(context.store, { run, attempt });
			return integrationVerify(context.store, context.clone, {
				...integrationContext(context, { run, ticket, attempt, opened }),
			});
		},
		review: ({ run, ticket, attempt }) => review(context, { run, ticket, attempt }),
		integrate: async ({ run, ticket, attempt }) => {
			const opened = attemptRecord(context.store, { run, attempt });
			return integratePublish(context.store, context.clone, {
				...integrationContext(context, { run, ticket, attempt, opened }),
				ticketTitle: context.ticketSnapshot.title,
				packageRevision: context.worker.packageRev,
			});
		},
	};
}

async function implement(context, identity) {
	const opened = attemptRecord(context.store, identity);
	const result = await withAttemptModelSlot(context, opened, identity.attempt, () =>
		runWorker(context, {
			identity,
			opened,
			repair: context.retryPlans.get(identity.attempt)?.brief ?? null,
			review: null,
		}),
	);
	return builderResult(roleFor(context.worker.roles, opened.role), result);
}

/**
 * The builder's phase result from its attempt's outcome — **the builder-side
 * half of §8.4's "two levels, two owners"** (#189).
 *
 * §6.6's schema judgement already happened in `worker/outbox.mjs`, and a record
 * it refused arrives here as `invalid-result` with the problems it named. What
 * is judged here is what the *role* owes: a `completed` builder record with no
 * trace produced no result for its role, exactly as a `completed` reviewer with
 * no verdict produces none for its (`pipeline/review.mjs`). Both are
 * `invalid-result`, and §8.10's row for this phase — fresh-retry on the repair
 * budget — is unchanged.
 *
 * The owed-ness is asked of **the record, whatever the attempt's outcome**: a
 * builder still alive at turn end with a valid `completed` file is
 * `wrote-but-hung`, which §8.10 harvests exactly as a completion — so a
 * traceless record there is the same invalid result, rather than a review
 * reached with nothing to brief the spec axis with.
 *
 * **The detail on an invalid result is the controller's own sentences and
 * never the record.** The row marks its evidence as fact so §8.5's brief tells
 * the fresh attempt why it exists; a record put on that detail would reach the
 * next builder as controller-verified fact, which no worker's prose is.
 *
 * @param {Readonly<object>} role the attempt's pipeline role
 * @param {{ outcome: string, record: object | null, problems?: ReadonlyArray<string> }} result
 * @returns {{ outcome: string, detail: object | null }}
 */
export function builderResult(role, result) {
	if (result.outcome === "invalid-result") {
		return { outcome: result.outcome, detail: { problems: [...(result.problems ?? [])] } };
	}
	const missing = missingResult(role, result.record ?? null);
	if (missing !== null) return { outcome: "invalid-result", detail: { problems: [missing] } };
	return { outcome: result.outcome, detail: result.record };
}

// The attempt's own base (§7.3) deliberately does not ride along here either:
// for a repair it is the prior attempt's tip, and handing it to the review as
// though it were the diff's boundary briefed both axes on the repair's delta
// while their verdicts gated the publication of the whole chain (#165). The
// phase reads both ends of the diff off the passing verify record.
async function review(context, { run, ticket, attempt }) {
	return reviewPhase(context.store, context.clone, {
		hold: context.hold,
		run,
		ticket,
		attempt,
		workerConfig: context.worker.environment,
		// §8.4's two axes are routed one at a time and never together: the seam
		// takes an axis and answers for that axis alone, so an exhausted class
		// walks each down its own declared order (§11.5, #155).
		routeAxis: ({ axis, index, dispatched }) =>
			roleRoute(context, { ticket, role: axis, axis: index, dispatched }),
		runAxis: async (axis) => {
			const axisOpened = attemptRecord(context.store, { run, attempt: axis.identity.attempt });
			return withAttemptModelSlot(context, axisOpened, axis.identity.attempt, () =>
				runWorker(context, {
					identity: axis.identity,
					opened: axisOpened,
					repair: null,
					// #189: the builder's trace rides with the fixed point, and the
					// template renders it for the axis whose expectations check it.
					review: { baseCommit: axis.baseCommit, reviewedCommit: axis.reviewedCommit, trace: axis.trace },
				}),
			);
		},
		automationRetry: reviewAutomationRetry(context.store, {
			run,
			ticket,
			budgets: context.config.budgets,
		}),
		actor: "controller",
		now: context.now,
	});
}

async function runWorker(context, { identity, opened, repair, review }) {
	const ended = endedAttempt(context.store, identity.run, identity.attempt);
	const result = ended !== null ? outcomeFromEnd(ended) : await launched(context, { identity, opened, repair, review });

	// #154: the refusal the wait observed becomes §9's memo the moment the
	// attempt ends on it — before the walk routes, before the scheduler asks
	// about the class again. The class, not the ticket or the attempt, is what
	// is unavailable, and the memo rides the controller stream so the next run
	// consults what this one paid to learn. **A re-entry finds the ending and
	// guarantees the memo beside it**: a controller that died between the two
	// records must not leave the class unprotected, so the check is "does this
	// attempt's memo exist" rather than "did this call just record it".
	if (result.outcome === "provider-refused") {
		const profile = namedProfile(context.config.profiles, opened.profile);
		const className = resourceClassOf(profile);
		const recorded = context.store
			.readEvents({ kind: "capacity.exhausted" })
			.some((event) => event.payload.evidence?.attempt === identity.attempt);
		if (!recorded) {
			const at = context.now();
			context.capacity.exhaustion.record(className, {
				until: at + DEFAULT_EXHAUSTION_MEMO_MS,
				at,
				evidence: {
					run: identity.run,
					ticket: identity.ticket,
					attempt: identity.attempt,
					signatures: result.refusal?.signatures ?? [],
					excerpt: result.refusal?.excerpt ?? null,
				},
			});
		}
	}

	return result;
}

async function launched(context, { identity, opened, repair, review }) {
	const role = roleFor(context.worker.roles, opened.role);
	const profile = namedProfile(context.config.profiles, opened.profile);
	const adapter = context.adapters[profile.kind];
	const binding = context.worker.environment.binding({
		kind: profile.kind,
		posture: postureOf(role),
		// #209: the attempt runs on the machine whose pool it holds a slot in.
		endpoint: profile.endpoint ?? null,
	});
	const common = {
		store: context.store,
		hold: context.hold,
		identity,
		role,
		profile,
		observedModel: observedModel(context.worker.runtimes[profile.kind], profile),
		packageRev: context.worker.packageRev,
		worktreePath: opened.worktree,
		branch: opened.branch,
		ticketSnapshot: context.ticketSnapshot,
		repair,
		review,
		trustedEvidence: fedCheckEvidence(context.store, {
			run: identity.run,
			ticket: identity.ticket,
			phase: identity.phase,
			checks: context.config.checks,
		}),
		sessionArgs: binding.args,
		sessionEnv: binding.paneEnv,
		// §6.6's two clocks: the profile's declared ceiling and no-progress window,
		// or the lifecycle's code-owned defaults when neither is — never absent,
		// because an absent deadline made the timeout row unreachable and a hung
		// worker was waited on forever (#150).
		timeoutMs: profile.attemptTimeoutMs,
		noProgressTimeoutMs: profile.noProgressTimeoutMs,
		recheckContext: {
			executable: context.executable,
			expect: context.config.package?.expect ?? null,
			env: context.env,
		},
		actor: "controller",
		now: context.now,
	};

	try {
		const correlated = correlatedAttempt(context.store, identity.run, identity.attempt);
		const launchedPane =
			correlated === null
				? await adapter.launch({ ...common, plugin: pluginName(context.worker.runtimes[profile.kind]) })
				: {
						pane: correlated.payload.herdr.pane,
						agent: correlated.payload.herdr.agent,
					};
		return await adapter.awaitCompletion({ ...common, ...launchedPane });
	} catch (error) {
		if (!(error instanceof FactoryWorkerError)) throw error;
		return Object.freeze({
			outcome: "automation-failure",
			record: Object.freeze({ summary: error.message, reason: error.reason, details: error.details }),
		});
	}
}

async function withAttemptModelSlot(context, opened, attempt, work) {
	// The lane's own model slot serves its initial attempt — **unless the lane was
	// resumed without one** (§5.5). A controller that died between an attempt
	// ending and its model row going back leaves a lane whose ticket row is
	// adoptable and whose model row is not, and that lane asks the pool for one
	// here like any later attempt does. The ticket row is what spans the
	// execution; the model row is per attempt (§9.4).
	const className = resourceClassOf(namedProfile(context.config.profiles, opened.profile));
	let slot = context.modelReservation.slot;
	if (slot !== null) {
		if (slot.class !== className || (slot.attempt !== null && slot.attempt !== attempt)) {
			throw new FactoryWorkerError(
				"routing-ambiguous", "The held model slot does not match the minted attempt (§9.4).",
				{ attempt, class: className, slot: slot.name },
			);
		}
		context.modelReservation.slot = null;
	}
	if (slot === null) {
		while (slot === null) {
			// #154: an exhausted class is not launched into again before its
			// expiry, and the expiry is settled by probe, never by the clock —
			// so an in-pipeline attempt waits here rather than rediscovering the
			// refusal the previous attempt already paid for. The wait announces
			// itself like a slot wait: "this lane is blocked on this class" is
			// one fact however the class is blocked (§9.7).
			const gate = await context.capacity.exhaustion.settle(className, { at: context.now() });
			if (gate.state === "blocked") {
				context.capacity.exhaustion.wait({
					ticket: context.ticketSnapshot.number,
					resourceClass: className,
					at: context.now(),
				});
				const remaining = gate.until === null ? 15_000 : gate.until - context.now();
				await context.capacity.wait({ ms: Math.max(250, Math.min(15_000, remaining)) });
				continue;
			}
			slot = context.capacity.acquireModel({
				ticket: context.ticketSnapshot.number,
				resourceClass: className,
				attempt,
				at: context.now(),
			});
			if (slot === null) await context.capacity.wait();
		}
	}

	try {
		return await work();
	} finally {
		slot.release({ reason: "attempt-ended", at: context.now() });
	}
}

// The attempt's own base (§7.3) deliberately does not ride along: for a repair
// it is the prior attempt's tip, and handing it to integration as though it
// were §7.5's replay boundary is exactly how the implement commit was dropped
// from the replay set (#161). Integration reads what to replay off the graph.
function integrationContext(context, { run, ticket, attempt, opened }) {
	return {
		hold: context.hold,
		leases: context.leases,
		run,
		ticket,
		attempt,
		branch: opened.branch,
		baseBranch: context.config.git.baseBranch,
		checks: context.config.checks,
		reader: context.tracker,
		writer: context.trackerWriter,
		acceptedRuns: context.acceptedRuns,
		actor: "controller",
		now: context.now,
	};
}

/**
 * §11.5's dispatch for one pipeline role on this ticket, read under §9.8's memo.
 *
 * The role arrives by **pipeline** name (`fresh-retry`, `review-standards`) and
 * is mapped to its routing role here, because §11.5 routes roles and §6.1's
 * inventory is what knows which is which — a caller spelling the routing role
 * itself would be a second copy of that mapping.
 */
async function roleRoute({ config, activeRouting, capacity, labels, now, modelReservation }, { ticket, role, axis = null, dispatched = [] }) {
	const declared = PIPELINE_ROLES.find((entry) => entry.name === role);
	if (declared === undefined) {
		throw new FactoryWorkerError("role-invalid", `"${role}" is not a pipeline role, so §11.5 has no order for it.`, {
			at: "role",
			ticket,
			found: role,
			expected: PIPELINE_ROLES.map((entry) => entry.name).join("|"),
		});
	}

	const where = { role: declared.routingRole, labels, axis };
	const selection = { order: dispatchOrder(activeRouting, where), profiles: config.profiles, dispatched, at: now() };
	if (pooledCandidates(activeRouting, where) === null) {
		return selectRoute({ ...selection, exhaustion: capacity.exhaustion });
	}
	const reserved = await reserveModelRoute({ ...selection, capacity, ticket, now });
	modelReservation.slot = reserved.slot;
	return reserved.route;
}

/**
 * The dispatch decision the scheduler made for this lane, held to being one.
 *
 * A lane with no route is a composition defect rather than a missing default:
 * §9.4 took this lane's slots from a specific class pool, and the only thing
 * that named that class is the decision this asks for. Falling back to resolving
 * §11.5 here would fill the hole with an answer that can differ from the one the
 * slot was taken under.
 */
function requireLaneRoute(route, { ticket, attempt }) {
	if (typeof route?.profile === "string") return route;

	throw new FactoryWorkerError(
		"routing-ambiguous",
		`Ticket ${ticket}'s lane was handed no dispatch decision, and attempt ${attempt} cannot be minted without one ` +
			"(§11.5, §9.4). The scheduler chooses the route before the claim and takes the model slot from the class it " +
			"names; resolving the routing again here could name a different class than the slot this lane holds.",
		{ at: "route", ticket, attempt, found: route?.profile ?? null },
	);
}

async function openInitialAttempt({ store, clone, hold, run, ticket, attempt, route, baseCommit, workerConfig, now }) {
	const purpose = { initial: true };
	const allocated = allocateAttempt(store, { run, ticket, purpose });
	if (allocated.attempt !== attempt) {
		throw new FactoryWorkerError(
			"attempt-identity-invalid",
			`The claim names initial attempt ${attempt}, but the ticket execution allocated ${allocated.attempt}.`,
			{ run, ticket, found: attempt, expected: allocated.attempt },
		);
	}
	const identity = requireAttemptIdentity({ run, ticket, phase: PHASE_IMPLEMENT, attempt });
	mintAttempt(store, {
		hold,
		identity,
		role: PHASE_IMPLEMENT,
		profile: route.profile,
		routing: route,
		baseCommit,
		purpose,
		at: now(),
	});
	const created = await createAttemptWorktree(store, clone, {
		hold,
		run,
		ticket,
		attempt,
		phase: PHASE_IMPLEMENT,
		baseCommit,
		workerConfig,
		actor: "controller",
		at: now(),
	});
	return { identity, ...created };
}

/**
 * The production adapters launch and never probe, so their context is the
 * launch defaults plus the two skill-delivery facts the preflight already
 * proved: pi's pinned skills roots and Claude's §6.3 plugin directory. The
 * worker session and the probe thereby run one binding (#160) — the delivery
 * facts have exactly one origin, the green preflight.
 */
function workerAdapters({ herdr, socket, now, worker }) {
	const launch = { herdr, socket, now };
	return Object.freeze({
		pi: createPiAdapter({ launch, skillsRoots: worker.skillsRoots }),
		claude: createClaudeAdapter({ launch, pluginDir: worker.pluginDir }),
	});
}

function attemptRecord(store, { run, attempt }) {
	const event = store
		.readEvents({ stream: `run:${run}`, kind: "attempt.launched" })
		.find((entry) => entry.attempt === attempt);
	if (event === undefined) {
		throw new FactoryWorkerError("worker-not-launched", `Attempt ${attempt} has no durable mint.`, { run, attempt });
	}
	return {
		role: event.payload.role,
		profile: event.payload.profile,
		baseCommit: event.payload.base_commit,
		// The base a rebase-repair was told to rebase onto, off its purpose
		// (`pipeline/repair.mjs`); `null` on every other attempt (#194).
		onto: event.payload.onto ?? null,
		branch: event.payload.branch ?? attemptBranch({ ticket: event.ticket, attempt }),
		worktree: event.payload.worktree,
	};
}

function correlatedAttempt(store, run, attempt) {
	return (
		store
			.readEvents({ stream: `run:${run}`, kind: "attempt.correlated" })
			.find((event) => event.attempt === attempt) ?? null
	);
}

function endedAttempt(store, run, attempt) {
	return (
		store
			.readEvents({ stream: `run:${run}`, kind: "attempt.ended" })
			.find((event) => event.attempt === attempt) ?? null
	);
}

function outcomeFromEnd(event) {
	return Object.freeze({
		outcome: event.payload.outcome,
		record: event.payload.result,
		// §6.6's schema problems ride the ending too, so a re-entry's invalid
		// result names the same block the first controller's did (#189).
		problems: Object.freeze([...(event.payload.problems ?? [])]),
		refusal: event.payload.refusal ?? null,
	});
}

function roleFor(roles, name) {
	const role = roles.find((candidate) => candidate.name === name);
	if (role !== undefined) return role;
	throw new FactoryWorkerError("role-invalid", `The pinned package has no production role ${name}.`, { role: name });
}

function namedProfile(profiles, name) {
	const profile = profiles[name];
	if (profile !== undefined) return Object.freeze({ name, ...profile });
	throw new FactoryWorkerError("routing-ambiguous", `The active routing selected undeclared profile ${name}.`, {
		profile: name,
	});
}

function observedModel(runtime, profile) {
	return runtime.resolvedModels?.[profile.model] ?? null;
}

function pluginName(runtime) {
	return runtime?.plugin?.manifest?.name ?? null;
}

function runOfAttempt(attempt) {
	const match = /^(.+)-t[1-9][0-9]*-a[1-9][0-9]*$/.exec(attempt);
	if (match !== null) return match[1];
	throw new FactoryWorkerError("attempt-identity-invalid", `${attempt} is not an attempt id.`, { attempt });
}

function requireProductionPreflight(preflight) {
	if (preflight !== null) return preflight;
	throw new FactoryWorkerError(
		"worker-not-launched",
		"The production pipeline was selected without the green preflight handles it executes against.",
		{ at: "preflight" },
	);
}
