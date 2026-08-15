import { randomBytes } from "node:crypto";

import { FactoryStateError } from "./errors.mjs";

/**
 * §4.6's lease primitive: **one** compare-and-swap over database rows, serving
 * the `controller`, `integration`, and `capacity:*` objects.
 *
 * Both legacy systems failed here, identically enough that the shape of this
 * module is a direct answer to them: `software-factory`'s `open(…,"wx")` lock
 * recorded a pid it never tested — the live store still holds a lock naming
 * dead pid 3852874, hand-renamed to `.lock.stale` to escape it — and
 * `job-pipeline`'s `releaseJobLock` was an unconditional `rmSync`, so any
 * process could drop any owner's lock.
 *
 * So: **the token is the only ownership proof**, the identity blob is advisory
 * and never tested, and every removal path compares the token first.
 */

/** The two singleton objects. `capacity:*` rows are named by the builders below. */
export const LEASE_NAMES = Object.freeze({
	controller: "controller",
	integration: "integration",
});

/**
 * §4.6's objects are a closed set, and `acquire` refuses anything outside it.
 * That is what makes "**there is no worktree lease**" a property of the code
 * rather than a note in a document: no caller can mint one.
 */
export const LEASE_NAME_PATTERN = /^(controller|integration|capacity:ticket:\d+|capacity:model:[0-9A-Za-z-]+:\d+)$/;

/**
 * §9.4's capacity rows are **discrete and named**, never a counter: a slot row
 * names its holder and is therefore probeable, and §5.3 settles an unresolved
 * fact by probing rather than by reasoning about a number.
 *
 * @param {number} index `0 … maxTicketExecutions - 1`
 */
export function capacityTicketSlot(index) {
	return `capacity:ticket:${index}`;
}

/** @param {string} resourceClass @param {number} index `0 … size - 1` */
export function capacityModelSlot(resourceClass, index) {
	return `capacity:model:${resourceClass}:${index}`;
}

/**
 * **There is no worktree lease.** Attempt identity already makes a worktree
 * single-writer (§4.6, invariant 23), so a lock over one would be a second,
 * weaker answer to a question already settled by construction.
 *
 * @param {object} store an open store (§4.1)
 * @param {{ now?: () => number }} [options] the clock, injectable for tests
 */
export function openLeases(store, { now = Date.now } = {}) {
	return Object.freeze({
		/**
		 * @param {{ name: string, identity: object, ttlMs: number | null, event?: object | null }} request
		 *   `ttlMs: null` is §9.4's untimed capacity slot; `event` is appended in
		 *   the **same transaction** as the row, because a lease row is canonical
		 *   rather than a projection and must not drift from its event (§4.4).
		 * @returns {Readonly<object>} the hold, whose token is the ownership proof
		 * @throws {FactoryStateError} `lease-held` when a live holder has it
		 */
		acquire: ({ name, identity, ttlMs, event = null }) =>
			store.transaction(({ db, appendEvent }) => {
				requireLeaseName(name);
				const at = now();
				const incumbent = decode(db.prepare("SELECT * FROM lease WHERE name = ?").get(name));
				if (incumbent !== null) {
					if (!hasLapsed(incumbent, at)) refuseHeld(name, incumbent);
					// §10.4: a lease that is free *or expired* is adopted. Nothing
					// probes the previous holder's process to decide that — the
					// clock and the new generation are the whole mechanism.
					db.prepare("DELETE FROM lease WHERE name = ? AND holder_token = ?").run(name, incumbent.token);
				}

				const generation = mintGeneration(db);
				const token = randomBytes(16).toString("hex");
				const expiresAt = ttlMs === null ? null : at + ttlMs;

				db.prepare(
					`INSERT INTO lease(name, holder_token, fencing_generation, expires_at, renewed_at, identity)
					 VALUES (?, ?, ?, ?, ?, ?)`,
				).run(name, token, generation, expiresAt, at, JSON.stringify(identity));
				if (event !== null) appendEvent(event);

				return Object.freeze({
					name,
					token,
					fencingGeneration: generation,
					expiresAt,
					renewedAt: at,
					ttlMs,
					identity,
				});
			}),

		/**
		 * §4.8's liveness write: every 10s, and it costs no journal growth. The
		 * generation is untouched — a renewal is the same holder saying so, and
		 * bumping it would invalidate every effect this controller has in flight.
		 *
		 * @returns {object} the renewed hold
		 * @throws {FactoryStateError} `lease-lost` when this token no longer holds the row
		 */
		renew: (held) =>
			store.transaction(({ db }) => {
				const at = now();
				const expiresAt = held.ttlMs === null ? null : at + held.ttlMs;
				const updated = db
					.prepare("UPDATE lease SET renewed_at = ?, expires_at = ? WHERE name = ? AND holder_token = ?")
					.run(at, expiresAt, held.name, held.token);

				if (updated.changes !== 1) {
					refuseLost(held, decode(db.prepare("SELECT * FROM lease WHERE name = ?").get(held.name)));
				}

				return Object.freeze({ ...held, renewedAt: at, expiresAt });
			}),

		/**
		 * Compare-and-delete on the token. There is **no unconditional removal
		 * path** in this module: `job-pipeline`'s `releaseJobLock` was a bare
		 * `rmSync`, so any process could drop any owner's lock.
		 *
		 * @returns {boolean} whether this holder's row was the one removed
		 */
		release: (held, { event = null } = {}) =>
			store.transaction(({ db, appendEvent }) => {
				const removed = db
					.prepare("DELETE FROM lease WHERE name = ? AND holder_token = ?")
					.run(held.name, held.token);
				if (removed.changes === 1 && event !== null) appendEvent(event);
				return removed.changes === 1;
			}),

		/**
		 * The takeover path, for a row whose holder is **demonstrably** gone: a
		 * lapsed expiry, or a generation the live controller has already
		 * superseded (§9.4's "held by a dead generation"). Still a
		 * compare-and-swap — the caller passes the token it read off the row — so
		 * the "any process may drop any lock" hole stays closed.
		 *
		 * Deciding that the holder is gone is the caller's evidence to produce:
		 * §5.3 settles an unresolved fact by probing the pane or the repository,
		 * never by waiting for a clock.
		 *
		 * @param {{ name: string, token: string, generation: number }} claim
		 *   `generation` is the reclaimer's own live controller generation
		 * @throws {FactoryStateError} `lease-held` when the row is not dead,
		 *   `lease-lost` when the token is not the row's
		 */
		reclaim: ({ name, token, generation, event = null }) =>
			store.transaction(({ db, appendEvent }) => {
				const row = decode(db.prepare("SELECT * FROM lease WHERE name = ?").get(name));
				if (row === null) return false;
				if (row.token !== token) {
					throw new FactoryStateError(
						"lease-lost",
						`The ${name} lease is no longer on the token this reclaim observed; it has been renewed or reclaimed since.`,
						{ lease: name, fencing_generation: row.fencingGeneration },
					);
				}
				if (!hasLapsed(row, now()) && !isSuperseded(row, generation)) refuseHeld(name, row);

				db.prepare("DELETE FROM lease WHERE name = ? AND holder_token = ?").run(name, token);
				if (event !== null) appendEvent(event);
				return true;
			}),

		inspect: (name) => store.read((db) => decode(db.prepare("SELECT * FROM lease WHERE name = ?").get(name))),

		/** Every held row, for `status`, `doctor`, and reconcile. */
		list: () => store.read((db) => db.prepare("SELECT * FROM lease ORDER BY name").all().map(decode)),

		/** The counter's current value, which is the live controller's fence. */
		generation: () => store.read((db) => db.prepare("SELECT value FROM fencing_generation WHERE id = 1").get().value),
	});
}

function requireLeaseName(name) {
	if (typeof name !== "string" || !LEASE_NAME_PATTERN.test(name)) {
		throw new FactoryStateError(
			"invalid-lease-name",
			`${JSON.stringify(name ?? null)} is not one of §4.6's lease objects (${LEASE_NAME_PATTERN}).`,
			{ found: name ?? null, expected: String(LEASE_NAME_PATTERN) },
		);
	}
}

/**
 * §9.4: a row stamped with a superseded generation **is not honored**. The
 * counter is DB-wide, so "older than the live controller's generation" is a
 * total order rather than a per-lease guess — that is the whole reason §4.6
 * mints from one counter.
 *
 * @param {{ fencingGeneration: number }} row
 * @param {number} generation the live controller's generation
 */
export function isSuperseded(row, generation) {
	return row.fencingGeneration < generation;
}

/**
 * A row is lapsed when its own expiry has passed. A row with **no expiry** —
 * §9.4's capacity slots — never lapses: an expiring slot would free itself
 * while its pane is still alive and still talking to the model host,
 * double-booking a resource that physically has one slot (invariant 22).
 */
function hasLapsed(row, at) {
	return row.expiresAt !== null && row.expiresAt <= at;
}

/**
 * §10.5's refusal: it **names the holding run and pane**, because "the lease is
 * taken" without saying by whom leaves the operator with nothing to look at.
 * Both come out of the advisory identity blob, which is exactly what an
 * operator-facing sentence may use it for — the token, and only the token, is
 * ownership proof (§4.6).
 */
function refuseHeld(name, incumbent) {
	const identity = incumbent.identity ?? {};
	const run = identity.run ?? null;
	const pane = identity.pane ?? null;

	throw new FactoryStateError(
		"lease-held",
		`The ${name} lease is held by run ${run ?? "(unnamed)"} in pane ${pane ?? "(unknown)"}, generation ${incumbent.fencingGeneration}.`,
		{
			lease: name,
			run,
			pane,
			fencing_generation: incumbent.fencingGeneration,
			expires_at: incumbent.expiresAt,
			renewed_at: incumbent.renewedAt,
		},
	);
}

/**
 * The compare half of every compare-and-swap failing: this token is not what
 * the row says, so the hold is gone. For the controller lease §14.6 makes the
 * consequence absolute — stop, emit, exit, **never reacquire** — which is why
 * this is a refusal and not a `false` a caller can shrug at.
 */
function refuseLost(held, incumbent) {
	throw new FactoryStateError(
		"lease-lost",
		incumbent === null
			? `The ${held.name} lease row is gone; this holder no longer holds it.`
			: `The ${held.name} lease is now held under generation ${incumbent.fencingGeneration}, not this holder's ${held.fencingGeneration}.`,
		{
			lease: held.name,
			fencing_generation: held.fencingGeneration,
			holder_generation: incumbent === null ? null : incumbent.fencingGeneration,
		},
	);
}

/**
 * One DB-wide monotonic counter, so generations are **totally ordered across
 * all leases** (§4.6) — a per-lease counter could not order an integration
 * lease against the controller lease that is supposed to fence it.
 */
function mintGeneration(db) {
	db.prepare("UPDATE fencing_generation SET value = value + 1 WHERE id = 1").run();
	return db.prepare("SELECT value FROM fencing_generation WHERE id = 1").get().value;
}

function decode(row) {
	if (row === undefined) return null;
	return {
		name: row.name,
		token: row.holder_token,
		fencingGeneration: row.fencing_generation,
		expiresAt: row.expires_at,
		renewedAt: row.renewed_at,
		identity: row.identity === null ? null : JSON.parse(row.identity),
	};
}
