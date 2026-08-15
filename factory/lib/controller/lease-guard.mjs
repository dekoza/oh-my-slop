import { EXIT_LEASE_LOST } from "../cli/exit-codes.mjs";
import { END_REASON_LEASE_LOST } from "../domain/vocabulary.mjs";
import { processIdentity } from "../identity/process.mjs";
import { FactoryStateError } from "../state/errors.mjs";
import { LEASE_NAMES, LEASE_RENEWAL_MS } from "../state/leases.mjs";

/**
 * The controller's own hold on §4.6's `controller` lease.
 *
 * The lease exists to exclude a *second* controller, not to mark a run as live
 * (§10.1). Holding it is therefore a property of this process: it renews while
 * it runs, and the moment a compare-and-swap finds the row is somebody else's,
 * §14.6 applies without discretion — **stop issuing effects, emit
 * `controller.lease-lost`, exit non-zero, and never reacquire.**
 *
 * A controller that fights for its lease back is how two of them end up writing
 * to the same tickets, so there is no reacquisition path in this file to be
 * reached by accident.
 */

/**
 * @param {object} options
 * @param {object} options.store the open store, for the one event this emits
 * @param {object} options.leases the §4.6 registry, whose clock this shares
 * @param {string | null} [options.run] the run this controller is driving, when it
 *   is already known. It is **not** known at `factory start`: §10.4 decides
 *   between adopting an orphaned run and minting one *under* the lease, because
 *   startup reconcile is what adopts. `adopt()` names it once that is settled
 * @param {string | null} [options.pane] the controller pane, named in §10.5's refusal
 * @param {(loss: object) => void} [options.onLost] the run loop's abandon path,
 *   handed the end reason and the exit code the run must leave with
 * @param {{ setInterval: Function, clearInterval: Function }} [options.timers]
 *   injectable so a test drives the renewal instead of waiting for it
 * @returns {Readonly<object>} the hold
 * @throws {FactoryStateError} `lease-held` when another controller holds it
 */
export function holdControllerLease({
	store,
	leases,
	run = null,
	pane = null,
	onLost = () => {},
	timers = { setInterval, clearInterval },
}) {
	let driving = run;
	let held = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: processIdentity({ run: driving, pane }),
	});
	let lost = false;
	let released = false;
	// §5.4: reconcile runs at startup **before the lease is used for any
	// effect**. Holding that as a latch on the hold itself makes it structural:
	// there is no order of calls that issues an effect first, and no mode anyone
	// has to remember to enter.
	let reconciled = false;

	const renewal = timers.setInterval(() => renew(), LEASE_RENEWAL_MS);
	renewal.unref?.();

	/** One renewal. A lost lease is terminal, so it is never retried. */
	function renew() {
		if (lost || released) return false;
		try {
			held = leases.renew(held);
			return true;
		} catch (error) {
			if (!(error instanceof FactoryStateError) || error.reason !== "lease-lost") throw error;
			concede(error.details);
			return false;
		}
	}

	/**
	 * §14.6, in the order the specification states it: stop, emit, hand the run
	 * loop its non-zero exit. In-flight work is abandoned where it stands —
	 * nothing here touches Gitea or git, and `assertMayIssueEffects` is what
	 * stops anything else from doing so.
	 */
	function concede(details) {
		lost = true;
		timers.clearInterval(renewal);

		const at = leases.now();
		try {
			store.append({
				kind: "controller.lease-lost",
				source: "controller",
				run: driving,
				occurredAt: at,
				observedAt: at,
				payload: {
					lease: LEASE_NAMES.controller,
					fencing_generation: held.fencingGeneration,
					holder_generation: details.holder_generation ?? null,
				},
			});
		} finally {
			// A store that cannot record the loss is not a reason to end the run
			// zero, so the run loop is told either way; the store's own failure
			// then propagates on its own account.
			onLost({ endReason: END_REASON_LEASE_LOST, exitCode: EXIT_LEASE_LOST, details });
		}
	}

	/**
	 * The gate every effect passes through. It reads the latch rather than the
	 * database: the renewal is what discovers the loss, and §14.6's fencing check
	 * at resolution is the backstop, so this does not have to win a race to be
	 * safe.
	 */
	function assertMayIssueEffects() {
		if (!reconciled && !lost && !released) {
			throw new FactoryStateError(
				"reconcile-required",
				"This controller has not reconciled yet; §5.4 settles what the last one left behind " +
					"before the lease is used for any effect.",
				{ lease: LEASE_NAMES.controller, fencing_generation: held.fencingGeneration, run: driving },
			);
		}
		if (lost) {
			throw new FactoryStateError(
				"lease-lost",
				"The controller lease is lost; this controller issues no further effects and does not reacquire (§14.6).",
				{ lease: LEASE_NAMES.controller, fencing_generation: held.fencingGeneration, run: driving },
			);
		}
		if (released) {
			throw new FactoryStateError(
				"lease-released",
				"The controller lease was released at the end of this run; it issues no further effects.",
				{ lease: LEASE_NAMES.controller, fencing_generation: held.fencingGeneration, run: driving },
			);
		}
	}

	return Object.freeze({
		get token() {
			return held.token;
		},
		get fencingGeneration() {
			return held.fencingGeneration;
		},
		get run() {
			return driving;
		},
		get lost() {
			return lost;
		},
		get released() {
			return released;
		},
		get reconciled() {
			return reconciled;
		},

		/**
		 * Name the run this controller drives, once §10.4 has decided it.
		 *
		 * The decision is made **under** the lease — startup reconcile is what
		 * adopts an orphaned run — so it cannot be an argument to the acquisition
		 * that precedes it. Only the advisory blob changes: the token, the
		 * generation, and the renewal are untouched, because none of them means
		 * anything different now that the hold has a run to name.
		 *
		 * @param {string} runId
		 */
		adopt(runId) {
			assertMayIssueEffects();
			try {
				const described = leases.describe(held, processIdentity({ run: runId, pane }));
				driving = runId;
				held = described;
			} catch (error) {
				if (!(error instanceof FactoryStateError) || error.reason !== "lease-lost") throw error;
				concede(error.details);
				throw error;
			}
		},

		/**
		 * §5.4's reconciliation happened under this hold, so the gate opens.
		 *
		 * Called by the engine rather than by the run loop, so satisfying it means
		 * having actually reconciled. It opens on a pass that could not settle
		 * everything: a probe nothing implements is §12.4's alarm, and refusing to
		 * start over one would stop the factory permanently rather than loudly.
		 */
		recordStartupReconcile() {
			reconciled = true;
		},

		/** What an effect is stamped with, so a superseded one is not honored (§14.5). */
		fence() {
			assertMayIssueEffects();
			return { token: held.token, generation: held.fencingGeneration };
		},

		assertMayIssueEffects,
		renew,

		/**
		 * The orderly end of a run. A release whose compare-and-swap fails means
		 * the lease was already somebody else's, which is a loss like any other
		 * and gets §14.6's treatment rather than a quiet `false`.
		 *
		 * @returns {boolean} whether this holder's row was the one removed
		 */
		release({ event = null } = {}) {
			if (lost || released) return false;
			timers.clearInterval(renewal);

			// `leases.release` compare-and-deletes the token and appends `event` in
			// one transaction. Set the local latch only after that transaction
			// commits; a projector failure rolls both halves back.
			if (leases.release(held, { event })) {
				released = true;
				return true;
			}

			concede({ lease: LEASE_NAMES.controller, holder_generation: null });
			return false;
		},
	});
}
