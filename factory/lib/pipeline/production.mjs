import { setTimeout as delay } from "node:timers/promises";

import { FactoryCapacityError } from "../capacity/errors.mjs";
import { resourceClassOf } from "../config/profiles.mjs";
import { PHASE_IMPLEMENT } from "../domain/vocabulary.mjs";
import { createAttemptWorktree } from "../git/attempt.mjs";
import { FactoryGitError } from "../git/errors.mjs";
import { attemptBranch } from "../git/isolation.mjs";
import { FactoryTrackerError } from "../tracker/errors.mjs";
import { snapshotTicket } from "../tracker/snapshot.mjs";
import { createClaudeAdapter } from "../worker/claude.mjs";
import { FactoryWorkerError } from "../worker/errors.mjs";
import { createPiAdapter } from "../worker/pi.mjs";
import {
	allocateAttempt,
	mintAttempt,
	requireAttemptIdentity,
} from "../worker/attempt.mjs";
import { postureOf, profileForRole } from "../worker/roles.mjs";
import { createRetrySeam } from "./retry.mjs";
import { harvestPhase } from "./phases.mjs";
import { integrationVerify, integratePublish } from "./integration.mjs";
import { reviewPhase } from "./review.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { walkStages } from "./stages.mjs";
import { reviewAutomationRetry } from "./budgets.mjs";

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
	const adapters = workerAdapters({ herdr, socket, now });

	return async function productionPipeline(lane) {
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
	};

	async function executeProduction(lane) {
		const { ticket, attempt, slots, capacity } = lane;
		const ticketSnapshot = await snapshotTicket(tracker, ticket);
		const labels = ticketSnapshot.labels;
		const initialProfile = profileForRole(activeRouting, { role: PHASE_IMPLEMENT, labels });
		const initial = await openInitialAttempt({
			store,
			clone,
			hold,
			run: runOfAttempt(attempt),
			ticket,
			attempt,
			profile: initialProfile,
			baseBranch: config.git.baseBranch,
			workerConfig: worker.environment,
			now,
		});

		const common = {
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
			initialAttempt: attempt,
			initialModelSlot: slots.model,
		};

		const nextAttempt = createRetrySeam(store, clone, {
			hold,
			run: initial.identity.run,
			ticket,
			baseBranch: config.git.baseBranch,
			routing: activeRouting,
			labels,
			workerConfig: worker.environment,
			readResult: (prior) => endedAttempt(store, initial.identity.run, prior)?.payload.result ?? null,
			actor: "controller",
			now,
		});

		return walkStages(store, {
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
	return { outcome: result.outcome, detail: result.record };
}

async function review(context, { run, ticket, attempt }) {
	const opened = attemptRecord(context.store, { run, attempt });
	return reviewPhase(context.store, context.clone, {
		hold: context.hold,
		run,
		ticket,
		attempt,
		baseCommit: opened.baseCommit,
		routing: context.activeRouting,
		labels: context.labels,
		workerConfig: context.worker.environment,
		runAxis: async (axis) => {
			const axisOpened = attemptRecord(context.store, { run, attempt: axis.identity.attempt });
			return withAttemptModelSlot(context, axisOpened, axis.identity.attempt, () =>
				runWorker(context, {
					identity: axis.identity,
					opened: axisOpened,
					repair: null,
					review: { baseCommit: axis.baseCommit, reviewedCommit: axis.reviewedCommit },
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
	if (ended !== null) return outcomeFromEnd(ended);

	const role = roleFor(context.worker.roles, opened.role);
	const profile = namedProfile(context.config.profiles, opened.profile);
	const adapter = context.adapters[profile.kind];
	const binding = context.worker.environment.binding({ kind: profile.kind, posture: postureOf(role) });
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
		sessionArgs: binding.args,
		sessionEnv: binding.exports,
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
		const launched =
			correlated === null
				? await adapter.launch({ ...common, plugin: pluginName(context.worker.runtimes[profile.kind]) })
				: {
						pane: correlated.payload.herdr.pane,
						agent: correlated.payload.herdr.agent,
					};
		return await adapter.awaitCompletion({ ...common, ...launched });
	} catch (error) {
		if (!(error instanceof FactoryWorkerError)) throw error;
		return Object.freeze({
			outcome: "automation-failure",
			record: Object.freeze({ summary: error.message, reason: error.reason, details: error.details }),
		});
	}
}

async function withAttemptModelSlot(context, opened, attempt, work) {
	const first = attempt === context.initialAttempt;
	let slot = first ? context.initialModelSlot : null;
	if (!first) {
		const profile = namedProfile(context.config.profiles, opened.profile);
		const className = resourceClassOf(profile);
		while (slot === null) {
			slot = context.capacity.acquireModel({
				ticket: context.ticketSnapshot.number,
				resourceClass: className,
				attempt,
				at: context.now(),
			});
			if (slot === null) await delay(25);
		}
	}

	try {
		return await work();
	} finally {
		slot.release({ reason: "attempt-ended", at: context.now() });
	}
}

function integrationContext(context, { run, ticket, attempt, opened }) {
	return {
		hold: context.hold,
		leases: context.leases,
		run,
		ticket,
		attempt,
		branch: opened.branch,
		baseCommit: opened.baseCommit,
		baseBranch: context.config.git.baseBranch,
		checks: context.config.checks,
		reader: context.tracker,
		writer: context.trackerWriter,
		actor: "controller",
		now: context.now,
	};
}

async function openInitialAttempt({ store, clone, hold, run, ticket, attempt, profile, baseBranch, workerConfig, now }) {
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
	const base = await clone.fetchBase({ baseBranch });
	mintAttempt(store, {
		hold,
		identity,
		role: PHASE_IMPLEMENT,
		profile,
		baseCommit: base.commit,
		purpose,
		at: now(),
	});
	const created = await createAttemptWorktree(store, clone, {
		hold,
		run,
		ticket,
		attempt,
		phase: PHASE_IMPLEMENT,
		baseCommit: base.commit,
		workerConfig,
		actor: "controller",
		at: now(),
	});
	return { identity, ...created };
}

function workerAdapters({ herdr, socket, now }) {
	const launch = { herdr, socket, now };
	return Object.freeze({
		pi: createPiAdapter({ launch }),
		claude: createClaudeAdapter({ launch }),
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
	return Object.freeze({ outcome: event.payload.outcome, record: event.payload.result });
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
