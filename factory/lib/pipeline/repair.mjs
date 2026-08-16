import {
	EVIDENCE_TRUST,
	PHASE_HARVEST,
	PHASE_IMPLEMENT,
	PHASE_REVIEW,
	PHASE_VERIFY,
	RETRY_BASES,
	STAGE_ACTIONS,
} from "../domain/vocabulary.mjs";
import { createAttemptWorktree } from "../git/attempt.mjs";
import { attemptBranch, attemptWorktreePath } from "../git/isolation.mjs";
import { runStream } from "../state/events.mjs";
import {
	attemptIdOf,
	attemptOutboxPath,
	launchedAttempt,
	ordinalOf,
	requireAttemptIdentity,
	runOf,
	ticketOf,
} from "../worker/attempt.mjs";
import { PIPELINE_ROLES, profileForRole } from "../worker/roles.mjs";
import { FactoryPipelineError } from "./errors.mjs";

/**
 * §8.5's two tiers, and the trust framing of the prompt that drives them.
 *
 * **Every resume is a fresh attempt with a fresh worktree**, so nothing in this
 * module continues a session, resumes a transcript, or reuses a worktree. What
 * the two tiers differ on is one question — *is the prior attempt's work worth
 * keeping* — and every other difference follows from the answer:
 *
 * | | branches from | work | profile |
 * |---|---|---|---|
 * | **repair** | the prior attempt's tip | preserved | the originating attempt's, pinned |
 * | **fresh-retry** | the pinned base | discarded | routed, and the one place routing is tier-dependent |
 *
 * They answer different failures. A failing test is usually a small fix on top
 * of good work; a worker that flailed should not have its flailing inherited.
 *
 * **The repair chain reaches the PR unsquashed.** A repair branch starts at the
 * prior tip and nothing here rewrites, amends, squashes, or cherry-picks what a
 * worker committed — stated explicitly, because the alternative is the
 * controller rewriting worker commits, which is a new class of thing for it to
 * get wrong. The history is honest about what happened.
 *
 * **A tier is always planned from a failure**, never from a tier name alone: the
 * tier *is* §8.10's row for that failure, and the brief the next worker is given
 * is built from the same row. One input, so the attempt that runs and the
 * evidence it is given cannot come to describe different failures.
 */

/** §8.5's fresh-retry role, read from the inventory that owns role names (§6.1). */
const FRESH_RETRY_ROLE = PIPELINE_ROLES.find((role) => role.routingRole === "freshRetry");

/**
 * Whose words a phase's evidence is, where §8.10's row marks it untrusted.
 * `implement` answers with the prior builder's own account of its failure;
 * `review` with the reviewer's findings. Both are worker-authored text, and
 * neither is a fact about the world.
 */
const UNTRUSTED_SOURCES = Object.freeze({
	[PHASE_IMPLEMENT]: "the prior worker",
	[PHASE_REVIEW]: "the reviewer",
});

/**
 * Who produced a phase's evidence, where §8.10's row marks it fact. Both are
 * programs the controller ran itself and read the exit code of: §8.2's check
 * runner in its own verification worktree, and §7.4's git predicates.
 */
const FACT_PRODUCERS = Object.freeze({
	[PHASE_VERIFY]: { producer: "checks", label: "checks" },
	[PHASE_HARVEST]: { producer: "git", label: "predicate" },
});

/**
 * The fields of a prior attempt's outbox record that are **the worker's own
 * prose** (§6.6). §8.5 names the prior worker's summary as untrusted material,
 * and it reaches a repair from the outbox rather than from the failing stage —
 * a `verify` failure's detail is check output, and the worker's account of what
 * it was doing is somewhere else entirely.
 */
const WORKER_AUTHORED_RESULT_FIELDS = Object.freeze(["summary", "explanation", "question"]);

/**
 * The originating attempt, read from the record that minted it.
 *
 * Repair is pinned to *that attempt's* profile (§11.5), so the profile has to
 * come from somewhere durable — and the only honest somewhere is the
 * `attempt.launched` payload, which is what the controller actually dispatched
 * rather than what today's config would dispatch. A run whose config changed
 * mid-flight would otherwise repair under a profile the prior attempt never ran.
 *
 * The journal rather than the `attempt` projection because the projection holds
 * the tuple and not the payload: it can say an attempt exists, which is what
 * `launchedAttempt` is for, and cannot say what it was dispatched as.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number, attempt: string }} where
 * @returns {Readonly<{ attempt: string, ordinal: number, phase: string, role: string,
 *   profile: string | null, branch: string }> | null} `null` for an attempt
 *   nothing launched — there is nothing to continue from, and inventing it would
 *   be the controller reasoning about an external fact (§14.1)
 */
export function originatingAttempt(store, { run, ticket, attempt }) {
	const launched = store
		.readEvents({ stream: runStream(run), kind: "attempt.launched" })
		.find((record) => record.ticket === ticket && record.attempt === attempt);
	if (launched === undefined) return null;

	return Object.freeze({
		attempt,
		ordinal: ordinalOf(attempt),
		phase: launched.phase,
		role: launched.payload.role,
		profile: launched.payload.profile ?? null,
		// Derived, never read back: §7.3 makes the branch a deterministic function
		// of the tuple, and a repair reaching for a *recorded* branch name would be
		// reading a copy of something it can compute.
		branch: attemptBranch({ ticket, attempt }),
	});
}

/**
 * Plan the next attempt for the tier §8.10's row names. Pure: it reads no clock,
 * no git, and no store, so the same failure plans the same attempt on a re-entry
 * after a crash — which is what makes calling it twice harmless.
 *
 * @param {object} context
 * @param {Readonly<object>} context.prior the originating attempt (`originatingAttempt`)
 * @param {object} context.failure the resolved stage that routed here
 * @param {string} context.failure.phase
 * @param {string} context.failure.outcome
 * @param {object | null} [context.failure.detail]
 * @param {Readonly<object>} context.failure.row §8.10's row, whose action is the tier
 * @param {Readonly<object> | null} [context.priorResult] the prior attempt's
 *   outbox record, where it wrote one (§6.6) — its prose is untrusted material
 * @param {{ roles: object, rules: ReadonlyArray<object> }} [context.routing] the
 *   active routing. **Required for fresh-retry and unread for repair**
 * @param {ReadonlyArray<string>} [context.labels] the ticket's labels, as the
 *   claim-time snapshot has them
 * @returns {Readonly<{ tier: string, attempt: string, ordinal: number, priorAttempt: string,
 *   role: string, routingRole: string | null, profile: string, routed: boolean,
 *   from: Readonly<{ kind: string, of: string | null }>, inheritsWork: boolean,
 *   brief: Readonly<object> }>}
 * @throws {FactoryPipelineError} `retry-unplannable`
 * @throws {FactoryWorkerError} `routing-ambiguous` — §11.5's dispatch is the
 *   worker module's, and a fresh-retry is the one tier that asks it
 */
export function planRetry({ prior, failure, priorResult = null, routing = null, labels = [] }) {
	const tier = failure?.row?.action;
	if (!Object.hasOwn(RETRY_BASES, tier)) {
		throw unplannable("tier", `${JSON.stringify(tier ?? null)} is not one of §8.5's two tiers.`, {
			tier: tier ?? null,
			expected: Object.keys(RETRY_BASES).join("|"),
		});
	}

	const next = nextAttemptId(prior);
	const shared = {
		tier,
		attempt: next.attempt,
		ordinal: next.ordinal,
		priorAttempt: prior.attempt,
		routingRole: null,
		brief: repairBrief({ tier, prior, priorResult, ...failure }),
	};

	// The two tiers are built by two expressions rather than by one with
	// conditionals, because the repair one **takes no routing at all**: "repair is
	// not routable" is then a property of the code's shape rather than a branch
	// somebody could later make read the routing "just for the model".
	if (tier === STAGE_ACTIONS.repair) {
		if (typeof prior.profile !== "string") {
			// The one way a repair could still be planned here is by asking the
			// routing — which is the re-routing §11.5 forbids, arrived at through the
			// back door of a missing record rather than through a decision.
			throw unplannable(
				"profile",
				`Attempt ${prior.attempt} has no recorded profile, and a repair is pinned to the originating attempt's ` +
					"profile (§11.5). There is nothing else to pin to: consulting the routing instead is the re-routing " +
					"that tier does not have.",
				{ tier, attempt: prior.attempt },
			);
		}

		return Object.freeze({
			...shared,
			role: prior.role,
			profile: prior.profile,
			routed: false,
			from: Object.freeze({ kind: RETRY_BASES[tier], of: prior.branch }),
			inheritsWork: true,
		});
	}

	if (routing === null) {
		throw unplannable(
			"routing",
			"A fresh-retry is the one tier-dependent routing point (§11.5), so it is planned with the active routing in " +
				"hand. Planning one without it could only mean guessing the profile, and the guess with a plausible " +
				"defence — the implement role's — is exactly the implicit freshRetry §11.5 says does not exist.",
			{ tier },
		);
	}

	return Object.freeze({
		...shared,
		role: FRESH_RETRY_ROLE.name,
		routingRole: FRESH_RETRY_ROLE.routingRole,
		profile: profileForRole(routing, { role: FRESH_RETRY_ROLE.routingRole, labels }),
		routed: true,
		from: Object.freeze({ kind: RETRY_BASES[tier], of: null }),
		inheritsWork: false,
	});
}

/**
 * Create the planned attempt's branch and worktree at its tier's base (§7.3,
 * §8.5).
 *
 * Both git mutations are `createAttemptWorktree`'s effects, so this is
 * re-enterable for the same reason a first attempt's claim is: a controller that
 * died between the branch and the worktree finishes the pair, and one that died
 * after both performs nothing. The plan being pure is what makes the re-entry
 * arrive at the same attempt id to find them under.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle (`git/clone.mjs`)
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {Readonly<object>} context.plan a `planRetry` plan
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {{ commit: string }} [context.base] §7.2's freshly fetched tip.
 *   **Required for fresh-retry**, unread by repair
 * @param {object} context.workerConfig §6.8's worker config environment
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<object>>} the plan with the git facts on it
 * @throws {FactoryPipelineError} `retry-unplannable`
 */
export async function openRetryAttempt(
	store,
	clone,
	{ hold, plan, run, ticket, base = null, workerConfig, actor, at },
) {
	// A retry always re-enters `implement`: both tiers produce a builder attempt,
	// and the phase the failure came from is evidence rather than a destination.
	const identity = requireAttemptIdentity({ run, ticket, phase: PHASE_IMPLEMENT, attempt: plan.attempt });
	const baseCommit = await retryBaseCommit(clone, { plan, base });

	mintRetryAttempt(store, { hold, identity, plan, baseCommit, at });

	const created = await createAttemptWorktree(store, clone, {
		hold,
		run,
		ticket,
		attempt: identity.attempt,
		phase: identity.phase,
		baseCommit,
		workerConfig,
		actor,
		at,
	});

	return Object.freeze({ ...plan, ...created });
}

/**
 * §6.5's mint, for the attempt a tier just decided to run.
 *
 * It comes **before** the branch and the worktree because the projections refuse
 * an attempt-scoped record — and both git mutations are effects — for a tuple
 * nothing minted. That is the same order a first attempt's claim follows, and
 * `launchWorker` finds this record exactly as it finds the claim's.
 *
 * **The minter is not the launcher, and the projector inserts one row per
 * attempt**, so `launchWorker` cannot append a second `attempt.launched` and
 * does not try. Everything knowable at mint time is therefore written here —
 * including the three derived paths, which cost nothing to compute and are what
 * an operator greps for. What is knowable only at launch — the runtime, the
 * declared model, the manifest and prompt digests — stays in the attempt
 * manifest on disk and does **not** reach this record. That is a property of
 * §6.5's split rather than of this tier, and it holds for a first attempt's
 * claim exactly as much; closing it belongs to whoever composes claim → launch.
 */
function mintRetryAttempt(store, { hold, identity, plan, baseCommit, at }) {
	if (launchedAttempt(store, identity.attempt) !== null) return;

	hold.append({
		kind: "attempt.launched",
		source: "controller",
		run: identity.run,
		ticket: identity.ticket,
		phase: identity.phase,
		attempt: identity.attempt,
		occurredAt: at,
		observedAt: at,
		payload: {
			role: plan.role,
			profile: plan.profile,
			// Which tier produced this attempt, and which one it answers — so the
			// journal says *why* an attempt exists rather than leaving an operator to
			// infer a repair from two attempts and a gap.
			tier: plan.tier,
			prior_attempt: plan.priorAttempt,
			base_kind: plan.from.kind,
			base_commit: baseCommit,
			branch: attemptBranch({ ticket: identity.ticket, attempt: identity.attempt }),
			worktree: attemptWorktreePath(store.storeDir, identity.attempt),
			outbox: attemptOutboxPath(store.storeDir, identity.attempt),
		},
	});
}

/**
 * The commit the tier's branch starts at.
 *
 * Repair resolves the prior branch **now** rather than carrying a tip captured
 * when the plan was made: the tip is the prior attempt's last commit, and
 * reading it at the moment the branch is created is what makes "branches from
 * the prior attempt's tip" true of the branch rather than of a stale value.
 */
async function retryBaseCommit(clone, { plan, base }) {
	if (plan.from.kind === RETRY_BASES[STAGE_ACTIONS.repair]) {
		return clone.git(["rev-parse", "--verify", `refs/heads/${plan.from.of}^{commit}`]);
	}

	if (base === null || typeof base?.commit !== "string") {
		throw unplannable(
			"base",
			"A fresh-retry branches from the pinned base (§8.5), and §7.2 pins it by fetching immediately before the " +
				"branch is created. Without that fetch there is no base to pin, and the prior attempt's own base is a " +
				"commit the run has since moved past.",
			{ tier: plan.tier },
		);
	}

	return base.commit;
}

/**
 * The next attempt's id: **one ordinal past the attempt being answered**, and
 * derived wholly from that attempt's id — run, ticket and ordinal all read off
 * the one string, so no two of them can disagree.
 */
function nextAttemptId(prior) {
	const run = runOf(prior?.attempt);
	const ticket = ticketOf(prior?.attempt);
	const ordinal = ordinalOf(prior?.attempt);
	if (run === null || ticket === null || ordinal === null) {
		throw unplannable("prior", `${JSON.stringify(prior?.attempt ?? null)} is not a §2.1 attempt id.`, {
			found: prior?.attempt ?? null,
		});
	}

	return { ordinal: ordinal + 1, attempt: attemptIdOf({ run, ticket, ordinal: ordinal + 1 }) };
}

/**
 * §8.5's repair brief: **what the next worker is told about the failure, split
 * by who wrote it.**
 *
 * The split is not editorial. Controller-produced evidence — check exit codes,
 * digest-referenced output, git predicates — is presented **as fact**, because
 * the controller ran those programs itself and read their exit codes.
 * Worker-authored text — the prior worker's account of its own failure, the
 * reviewer's findings — is quoted in a delimited untrusted block, because a
 * reviewer whose findings contain an injected directive must not have it
 * promoted into an instruction to a write-capable builder.
 *
 * **Which side a phase's evidence falls on is §8.10's own `evidence` column**
 * (`EVIDENCE_TRUST`), read off the row rather than decided here. A row's trust
 * marking and the action it routes to were declared together, and a second
 * opinion in this module is a second place for them to disagree. The prior
 * worker's own outbox prose is the one thing not on a row, and it is untrusted
 * unconditionally — there is no reading of §8.5 under which a worker's summary
 * is a fact.
 *
 * @param {object} context
 * @param {string} context.tier the plan's tier
 * @param {Readonly<object>} context.prior the originating attempt
 * @param {string} context.phase the phase whose result routed here
 * @param {string} context.outcome that phase's outcome
 * @param {object | null} [context.detail] the resolved stage's detail
 * @param {Readonly<object>} context.row §8.10's row for `(phase, outcome)`
 * @param {Readonly<object> | null} [context.priorResult] the prior attempt's outbox record
 * @returns {Readonly<{ tier: string, prior: object, phase: string, outcome: string,
 *   facts: ReadonlyArray<Readonly<{ producer: string, label: string, value: unknown }>>,
 *   untrusted: ReadonlyArray<Readonly<{ source: string, label: string, text: string }>> }>}
 */
export function repairBrief({ tier, prior, phase, outcome, detail = null, row, priorResult = null }) {
	// The frame is fact on every row, evidence or not: the controller minted the
	// prior attempt, walked it to this phase, and derived this outcome. A tier
	// with no evidence at all — a worker that wrote nothing readable — still owes
	// the next one the sentence explaining why it exists.
	const facts = [
		{ producer: "controller", label: "tier", value: tier },
		{ producer: "controller", label: "prior_attempt", value: prior.attempt },
		{ producer: "controller", label: "phase", value: phase },
		{ producer: "controller", label: "outcome", value: outcome },
	];
	const untrusted = [];

	if (detail !== null && row.evidence === EVIDENCE_TRUST.fact) {
		const { producer, label } = FACT_PRODUCERS[phase] ?? { producer: "controller", label: "detail" };
		facts.push({ producer, label, value: detail });
	}

	if (detail !== null && row.evidence === EVIDENCE_TRUST.untrusted) {
		const source = UNTRUSTED_SOURCES[phase] ?? "a worker";
		for (const [label, value] of Object.entries(detail)) {
			untrusted.push({ source, label, text: quoted(value) });
		}
	}

	for (const field of WORKER_AUTHORED_RESULT_FIELDS) {
		const value = priorResult?.[field];
		// A field the routing phase's own detail already carried is not repeated:
		// one voice saying one thing once.
		if (value === undefined || value === null || untrusted.some((entry) => entry.label === field)) continue;
		untrusted.push({ source: UNTRUSTED_SOURCES[PHASE_IMPLEMENT], label: field, text: quoted(value) });
	}

	return Object.freeze({
		tier,
		prior: Object.freeze({ attempt: prior.attempt, profile: prior.profile ?? null }),
		phase,
		outcome,
		facts: Object.freeze(facts.map((fact) => Object.freeze(fact))),
		untrusted: Object.freeze(untrusted.map((entry) => Object.freeze(entry))),
	});
}

/** Untrusted material reaches the prompt as text, whatever shape it arrived in. */
function quoted(value) {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function unplannable(at, sentence, details = {}) {
	return new FactoryPipelineError("retry-unplannable", sentence, { at, ...details });
}
