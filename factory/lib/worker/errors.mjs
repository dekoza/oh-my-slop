/**
 * Worker-adapter refusals (§6.1, §6.2). Every one of them is an automation
 * failure by classification: the worker never ran, or must not run, because the
 * factory could not prove what it would be running.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const WORKER_ERROR_REASONS = Object.freeze([
	/** A role tuple missing one of §6.1's five slots, or carrying junk in one. */
	"role-invalid",
	/** An adapter constructed without one of the four operations, or with extras. */
	"adapter-invalid",
	/**
	 * §6.8's one predicate, fail closed: a required skill that is shadowed,
	 * duplicated, disabled, or missing. One typed failure for all four, and the
	 * diagnostic names the offending source. (Live-probe misses are findings on
	 * the `runtime-probe` check — `probe.mjs`'s vocabulary — until #107's
	 * attempt path turns them into attempt outcomes.)
	 */
	"skill-conflict",
	/** §6.3's generator refused, or produced a tree strict validation rejects. */
	"plugin-build-failed",
	/**
	 * §11.7: a per-attempt recheck whose recomputed handshake digest differs from
	 * the run's pin. A failure, never a new pin.
	 */
	"handshake-drift",
	/** A recheck asked of a run that never pinned a handshake at preflight. */
	"handshake-unpinned",
	/**
	 * §11.7: the observed resolved model id changed between attempts within one
	 * run — the audited split-brain in slow motion.
	 */
	"model-drift",
	/**
	 * §2.1/§6.5: a tuple whose parts disagree, or an identity segment that would
	 * derive a path outside the controller-owned root. Minted once and read off
	 * every derived name, so a mismatch is refused where it is first noticed.
	 */
	"attempt-identity-invalid",
	/**
	 * §5.5: an attempt that already has an `attempt.launched` record. A failed or
	 * abandoned attempt is never continued and a live one is *adopted* (#114), so
	 * a second launch would put two workers on one worktree (§14.23).
	 */
	"attempt-already-launched",
	/**
	 * §6.4: the multiplexer refused a step of the launch — no pane, no agent, or
	 * a command that failed. The worker never ran, which makes it an automation
	 * failure rather than anything the attempt could be blamed for.
	 */
	"worker-launch-failed",
	/**
	 * §6.6: a wait or a cancel asked of an attempt this store never launched.
	 * There is no worker to harvest or stop, and inventing one would be the
	 * controller reasoning about an external fact (§14.1).
	 */
	"worker-not-launched",
	/**
	 * §6.8: a posture nothing dispatches to, or a per-run deny that is not a
	 * permission rule at all. Both are refusals rather than defaults, because the
	 * permissive answer is the one a default would reach for.
	 */
	"permission-invalid",
	/**
	 * §14.17: an override that would re-enable what the deny floor denies. The
	 * floor is never subtractable, so this is a refusal and never a merge.
	 */
	"deny-floor-subtracted",
	/**
	 * §6.8: the controller-owned config environment could not be built, or a
	 * declared promotion — the worker-context file, an extension — is not there.
	 * A worker inheriting the operator's config instead is the failure this
	 * refusal exists to prevent.
	 */
	"config-environment-invalid",
	/**
	 * §11.5's *ticket-scoped* half of the two-level conflict rule: a ticket
	 * matching more than one rule for a role, or a role a routing never declared.
	 * It is a worker refusal rather than a config-load one because the loader's
	 * static check has already passed — two rules whose `labelsAny` sets are
	 * disjoint are legal until a ticket carries a label from each — so this fails
	 * one ticket's dispatch at claim time and never the run.
	 */
	"routing-ambiguous",
	// §6.8's trust misses are **not** here: an unproven pre-trust is observed by
	// the live probe, so it belongs to `probe.mjs`'s finding vocabulary, exactly
	// as the shadowing predicate's live half does. One reason, one home.
]);

export class FactoryWorkerError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of WORKER_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (at, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!WORKER_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown worker error reason "${reason}".`);
		}
		this.name = "FactoryWorkerError";
		this.reason = reason;
		this.details = details;
	}
}
