import { EXIT_REFUSED, EXIT_USAGE } from "../cli/exit-codes.mjs";
import { createHerdrControl, runHerdr as defaultRunHerdr } from "../controller/herdr-control.mjs";
import { probeHerdr } from "../controller/herdr.mjs";
import { holdControllerLease } from "../controller/lease-guard.mjs";
import { reconcile } from "../reconcile/engine.mjs";
import { PROBES } from "../reconcile/probes.mjs";
import { applyExpiry } from "../retention/expiry.mjs";
import { FactoryStateError } from "../state/errors.mjs";
import { openLeases } from "../state/leases.mjs";
import { resolveAgentDir } from "../state/location.mjs";
import { openRepoStoreReadOnly, openStore } from "../state/store.mjs";
import { withHerdrProbes } from "../worker/probes.mjs";
import { executeCleanup } from "./execute.mjs";
import { FactoryCleanupError } from "./errors.mjs";
import { createPaneReclaimer } from "./panes.mjs";
import { planCleanup } from "./plan.mjs";
import { kindsFor } from "./targets.mjs";

/**
 * §12.8's operator surface: **plan, then execute**, and never one call.
 *
 * The pair exists because cleanup touches things a human may be standing in — a
 * worktree they `cd`'d into, a pane they are reading — so what is about to be
 * deleted is printed, reviewed, and only then applied against the digest of the
 * thing that was reviewed. That is also the whole of why **there is no
 * `--force`** anywhere on this surface (§14.26): the guard the flag would switch
 * off is the guard the pair exists to enforce.
 *
 * The asymmetry between the two verbs is §10.5's and is deliberate:
 *
 * - **`cleanup-plan` is read-only and always permitted.** It takes the read-only
 *   store handle and no lease, so an operator can ask what is reclaimable while a
 *   run is live — the moment they most want to know.
 * - **`cleanup-execute` requires the controller lease**, so it can never race a
 *   live controller (§14.25). It refuses against a holder the way `reconcile`
 *   does, naming the run and pane and pointing at the two lock-free reads.
 */

/** §12.8's two scope narrowings. Both take their value as `--flag=value`. */
export const RUN_FLAG = "--run";
export const KIND_FLAG = "--kind";

/**
 * `factory cleanup-plan` (§12.8, §10.5).
 *
 * @param {object} invocation as the CLI assembles it
 * @returns {Promise<{ message: string, report: object } | { error: object, exitCode: number }>}
 */
export async function runCleanupPlan({
	repoRoot,
	agentDir = null,
	env,
	flags = new Set(),
	flagValues = new Map(),
	runHerdr = defaultRunHerdr,
	herdr: probe = probeHerdr,
	at = Date.now(),
}) {
	let scope;
	try {
		scope = parseScope({ flags, flagValues });
	} catch (error) {
		if (!(error instanceof FactoryCleanupError)) throw error;
		return refusal(error, EXIT_USAGE);
	}

	const agent = agentDir === null ? await resolveAgentDir() : { path: agentDir, source: "caller" };
	const store = await openRepoStoreReadOnly({ repoRoot, agentDir: agent.path });

	try {
		// A repository nothing has run in has nothing to reclaim, and saying so is
		// a fact rather than a store to bring into existence — the same answer
		// `status` gives, for the same reason.
		if (store === null) return { message: emptyHeadline(), report: emptyReport(scope, at) };

		const plan = await planCleanup(store, { scope, herdr: await controlFor({ runHerdr, env, probe }), at });
		return { message: headline(plan), report: plan };
	} finally {
		store?.close();
	}
}

/**
 * `factory cleanup-execute <plan digest>` (§12.8, §14.25).
 *
 * The order inside the lease is settled and not a preference:
 *
 * 1. **reconcile**, because §5.4 settles what the last controller left behind
 *    before the lease is used for any effect — and because an unresolved effect
 *    is one of §12.4's pins, so a repository that has not reconciled would report
 *    runs as held that reconcile is about to release.
 * 2. **cleanup**, on the plan whose digest still matches.
 * 3. **expiry**, which §12.6 folds in here so an operator with no run to start
 *    can still reclaim. It runs *after* cleanup, not before: expiry deletes a
 *    run's tier-1 detail, and a plan derived afterwards would have lost the
 *    record that a worktree belongs to a run whose pins were checked.
 */
export async function runCleanupExecute({
	repoRoot,
	config,
	agentDir = null,
	env,
	// The shipped registry, which `cli/main.mjs` populates once as the binary's
	// composition root. A second one built here would be a second place the reads
	// are registered, and the one that drifted would settle effects the other
	// could not — so this defaults to the singleton exactly as `start` does.
	probes = PROBES,
	args = [],
	flags = new Set(),
	flagValues = new Map(),
	runHerdr = defaultRunHerdr,
	herdr: probe = probeHerdr,
	at = Date.now(),
}) {
	let scope;
	let digest;
	try {
		scope = parseScope({ flags, flagValues });
		digest = requireDigest(args);
	} catch (error) {
		if (!(error instanceof FactoryCleanupError)) throw error;
		return refusal(error, EXIT_USAGE);
	}

	const store = await openStore({ repoRoot, agentDir });

	try {
		const leases = openLeases(store);
		let hold;
		try {
			hold = holdControllerLease({ store, leases });
		} catch (error) {
			if (!(error instanceof FactoryStateError) || error.reason !== "lease-held") throw error;
			return refusal(leaseHeld(error), EXIT_REFUSED);
		}

		try {
			const herdr = await controlFor({ runHerdr, env, probe });
			// §5.3: the harness read closes over one multiplexer client, so it joins
			// this invocation's registry rather than the module singleton — the same
			// reason `start` composes it per run.
			const registry = herdr === null ? probes : withHerdrProbes(probes, { herdr });

			// The hold is handed over so the pass discharges §5.4's precondition on
			// it: the latch is what makes "reconcile before any effect" an order the
			// hold enforces rather than one this function remembered to follow.
			const reconciled = await reconcile(store, {
				probes: registry,
				hold,
				fencingGeneration: hold.fencingGeneration,
				actor: "operator:cleanup-execute",
				at,
			});

			const cleanup = await executeCleanup(store, {
				hold,
				scope,
				digest,
				herdr,
				panes: createPaneReclaimer({ run: runHerdr, env }),
				actor: "operator:cleanup-execute",
				at,
			});

			const expiry = applyExpiry(store, {
				retention: config.retention,
				hold,
				at,
				actor: "operator:cleanup-execute",
			});

			const report = Object.freeze({ spec: "§12.6, §12.8", reconcile: reconciled, cleanup, expiry });
			return { message: executedHeadline(cleanup, expiry), report };
		} catch (error) {
			if (!(error instanceof FactoryCleanupError)) throw error;
			return refusal(error, EXIT_REFUSED);
		} finally {
			// Released in a `finally`, because a cleanup that crashed while holding
			// the lease would leave the repository excluded from its own controller
			// until the TTL lapsed — `reconcile`'s reasoning, for the same lease.
			hold.release();
		}
	} finally {
		store.close();
	}
}

/**
 * §12.8's scope: the whole eligible set by default, narrowable by run and by
 * kind.
 *
 * **The default being everything matters**: an operator reclaiming space should
 * see the full picture including the skips, so a narrowing is something they ask
 * for rather than something a default quietly applies.
 */
function parseScope({ flags, flagValues }) {
	return Object.freeze({
		run: flags.has(RUN_FLAG) ? flagValues.get(RUN_FLAG) : null,
		kinds: kindsFor(flags.has(KIND_FLAG) ? flagValues.get(KIND_FLAG) : null),
	});
}

/**
 * The digest the plan printed, taken as the verb's one positional argument.
 *
 * It is **required, with no default and no "latest"**: a `cleanup-execute` that
 * re-derived its own plan and executed it would be the single-call verb §12.8
 * refuses, and a plan nobody read is a plan nobody reviewed.
 */
function requireDigest(args) {
	const [digest, ...extra] = args;
	if (digest === undefined || extra.length > 0) {
		throw new FactoryCleanupError(
			"cleanup-digest-required",
			"`factory cleanup-execute` takes exactly one argument: the digest `factory cleanup-plan` printed. " +
				"Executing without one would be a plan nobody reviewed (§12.8).",
			{ at: "digest", found: args.length === 0 ? null : args.join(" ") },
		);
	}

	return digest;
}

/**
 * The Herdr control surface, or `null` when the multiplexer is not there.
 *
 * `null` makes the two pane kinds **unanswerable** rather than empty, which is
 * §12.4's distinction and the reason the plan reports them separately: a machine
 * without Herdr must not read "no panes to reclaim" off a question nobody could
 * ask.
 */
async function controlFor({ runHerdr, env, probe }) {
	const availability = await probe({ env });
	return availability.available ? createHerdrControl({ binary: availability.binary, env, run: runHerdr }) : null;
}

function refusal(error, exitCode) {
	return { error: { kind: error.reason, message: error.message, ...error.details }, exitCode };
}

/** §10.5's refusal shape, said about the verb that refused. */
function leaseHeld(error) {
	return new FactoryCleanupError(
		"cleanup-lease-held",
		`Run ${error.details.run ?? "(unnamed)"} holds the controller lease in pane ${error.details.pane ?? "(unknown)"}, ` +
			"so cleanup-execute cannot take it — deleting a live run's worktrees is the one thing the lease exists to " +
			"prevent (§14.25). `factory cleanup-plan`, `factory status`, and `factory doctor` are lock-free reads and " +
			"work against a live run (§10.5).",
		error.details,
	);
}

function headline(plan) {
	const targets = plan.targets.length;
	const bytes = plan.reclaimable_bytes;
	const tail =
		`${plan.skips.length} skip(s), ${plan.held.length} run(s) held` +
		(plan.unanswerable.length === 0 ? "" : `, ${plan.unanswerable.length} kind(s) unanswerable`);

	if (targets === 0) return `nothing to reclaim in this scope; ${tail}. Plan ${plan.digest}.`;

	return (
		`${targets} target(s) reclaiming ${bytes} byte(s); ${tail}. ` +
		`Execute with: factory cleanup-execute ${plan.digest}${scopeSuffix(plan.scope)}`
	);
}

function executedHeadline(cleanup, expiry) {
	const refused = cleanup.refused.length === 0 ? "" : `, ${cleanup.refused.length} refused`;

	return (
		`cleanup reclaimed ${cleanup.performed.length} target(s) and ${cleanup.reclaimed_bytes} byte(s)${refused}; ` +
		`expiry removed ${expiry.expired.length} run(s) and ${expiry.reclaimed_bytes} byte(s).`
	);
}

function scopeSuffix(scope) {
	// Reprinted so the command an operator copies re-derives the plan they read.
	// A digest executed under a different scope is a different plan, and §14.25
	// would refuse it — correctly, and confusingly.
	return `${scope.run === null ? "" : ` ${RUN_FLAG}=${scope.run}`}${scope.kinds.length === 1 ? ` ${KIND_FLAG}=${scope.kinds[0]}` : ""}`;
}

function emptyHeadline() {
	return "nothing has run in this repository, so there is nothing to reclaim.";
}

function emptyReport(scope, at) {
	return Object.freeze({
		spec: "§12.8",
		at,
		scope,
		targets: Object.freeze([]),
		skips: Object.freeze([]),
		unanswerable: Object.freeze([]),
		held: Object.freeze([]),
		reclaimable_bytes: 0,
		digest: null,
	});
}
