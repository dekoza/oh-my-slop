import { EXIT_LEASE_LOST } from "../cli/exit-codes.mjs";
import { processIdentity } from "../identity/process.mjs";
import { FactoryStateError } from "../state/errors.mjs";
import { LEASE_NAMES } from "../state/leases.mjs";

/**
 * The controller's own hold on §4.6's `controller` lease.
 *
 * The lease exists to exclude a *second* controller, not to mark a run as
 * live (§10.1). Holding it is therefore a property of this process: it
 * renews while it runs, and the moment a renewal finds the row is somebody
 * else's, §14.6 applies without discretion — **stop issuing effects, emit
 * `controller.lease-lost`, exit non-zero, and never reacquire.**
 *
 * A controller that fights for its lease back is how two of them end up
 * writing to the same tickets, so there is no reacquisition path in this file
 * to be reached by accident.
 */

/** §4.8: the row is renewed every 10s — that is the liveness fact. */
export const CONTROLLER_LEASE_RENEWAL_MS = 10_000;

/** Three missed renewals, matching the monitor's three-missed-heartbeat rule. */
export const CONTROLLER_LEASE_TTL_MS = 3 * CONTROLLER_LEASE_RENEWAL_MS;

/**
 * @param {object} options
 * @param {object} options.store the open store, for the one event this can emit
 * @param {object} options.leases the §4.6 primitive
 * @param {string} options.run the run this controller is driving
 * @param {string | null} options.pane the controller pane, named in §10.5's refusal
 * @param {(loss: object) => void} [options.onLost] the run loop's abandon path
 * @returns {object} the hold
 * @throws {FactoryStateError} `lease-held` when another controller holds it
 */
export function holdControllerLease({
	store,
	leases,
	run,
	pane = null,
	ttlMs = CONTROLLER_LEASE_TTL_MS,
	renewalMs = CONTROLLER_LEASE_RENEWAL_MS,
	now = Date.now,
	onLost = () => {},
	timers = { setInterval, clearInterval },
}) {
	let held = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: processIdentity({ run, pane }),
		ttlMs,
	});
	let lost = false;
	let released = false;

	const renewal = timers.setInterval(() => renew(), renewalMs);
	renewal.unref?.();

	/** One renewal. A lost lease is terminal, so it is never retried. */
	function renew() {
		if (lost || released) return false;
		try {
			held = leases.renew(held);
			return true;
		} catch (error) {
			if (!(error instanceof FactoryStateError) || error.reason !== "lease-lost") throw error;
			concede(error);
			return false;
		}
	}

	/**
	 * §14.6, in the order the specification states it: stop, emit, hand the run
	 * loop its non-zero exit. In-flight work is abandoned where it stands —
	 * nothing here touches Gitea or git, and `assertMayIssueEffects` is what
	 * stops anything else from doing so.
	 */
	function concede(error) {
		lost = true;
		timers.clearInterval(renewal);

		const at = now();
		try {
			store.append({
				kind: "controller.lease-lost",
				source: "controller",
				run,
				occurredAt: at,
				observedAt: at,
				payload: {
					lease: LEASE_NAMES.controller,
					fencing_generation: held.fencingGeneration,
					holder_generation: error.details.holder_generation ?? null,
				},
			});
		} finally {
			// A store that cannot record the loss is not a reason to end the run
			// zero, so the run loop is told either way; the store's own failure
			// then propagates on its own account.
			onLost({ endReason: "lease-lost", exitCode: EXIT_LEASE_LOST, details: error.details });
		}
	}

	return Object.freeze({
		get token() {
			return held.token;
		},
		get fencingGeneration() {
			return held.fencingGeneration;
		},
		get lost() {
			return lost;
		},

		/** What an effect is stamped with, so a superseded one is not honored (§14.5). */
		fence() {
			assertMayIssueEffects();
			return { token: held.token, generation: held.fencingGeneration };
		},

		/**
		 * The gate every effect passes through. It reads the latch rather than
		 * the database: the renewal is what discovers the loss, and §14.6's
		 * fencing check at resolution is the backstop, so this does not have to
		 * win a race to be safe.
		 */
		assertMayIssueEffects,

		renew,

		release: () => {
			if (lost || released) return false;
			released = true;
			timers.clearInterval(renewal);
			return leases.release(held);
		},
	});

	function assertMayIssueEffects() {
		if (lost) {
			throw new FactoryStateError(
				"lease-lost",
				"The controller lease is lost; this controller issues no further effects and does not reacquire (§14.6).",
				{ lease: LEASE_NAMES.controller, fencing_generation: held.fencingGeneration, run },
			);
		}
		if (released) {
			throw new FactoryStateError(
				"lease-lost",
				"The controller lease was released; this controller issues no further effects.",
				{ lease: LEASE_NAMES.controller, fencing_generation: held.fencingGeneration, run },
			);
		}
	}
}
