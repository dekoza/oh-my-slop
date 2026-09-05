import { randomBytes } from "node:crypto";

import { CONTROLLER_LEASE } from "../domain/vocabulary.mjs";
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

/**
 * The two singleton objects. `capacity:*` rows are named by the builders below.
 *
 * The controller's name comes from `domain/vocabulary.mjs` because §14.5's
 * fencing check reads that row from the other side, and one spelling in two
 * files is one spelling too many.
 */
export const LEASE_NAMES = Object.freeze({
	controller: CONTROLLER_LEASE,
	integration: "integration",
});

/**
 * The class segment of a model row, **spelled once** and used by all three
 * grammars below — the name this module builds, the set `acquire` admits, and
 * the parse that reads a name back. §9.1's endpoint-derived classes put a host
 * in this segment (#209), so it carries dots; it can never carry the `:` the
 * grammar separates on.
 */
const CLASS_SEGMENT = "[0-9A-Za-z.-]+";

/**
 * §4.6's objects are a closed set, and `acquire` refuses anything outside it.
 * That is what makes "**there is no worktree lease**" a property of the code
 * rather than a note in a document: no caller can mint one.
 */
export const LEASE_NAME_PATTERN = new RegExp(
	`^(${LEASE_NAMES.controller}|${LEASE_NAMES.integration}|capacity:ticket:\\d+|capacity:model:${CLASS_SEGMENT}:\\d+)$`,
);

/** The same grammar as a reader: one capture for the class, one for the index. */
const MODEL_SLOT_PATTERN = new RegExp(`^capacity:model:(${CLASS_SEGMENT}):(\\d+)$`);

/** §4.8: the controller row is renewed every 10s — that is the liveness fact. */
export const LEASE_RENEWAL_MS = 10_000;

/** Three missed renewals. §4.8 expects an expired row to be one of the two
 * `controller-lost` signals, "whichever it sees first", so it is deliberately
 * shorter than the monitor's ~3-minute heartbeat rule. */
export const CONTROLLER_LEASE_TTL_MS = 3 * LEASE_RENEWAL_MS;

/**
 * **Which leases a clock may free, and after how long.** The controller lease is
 * the only one: §10.4 adopts a run whose lease is "free or expired", and that
 * adoption is what a dead controller's successor needs.
 *
 * Everything else is untimed, and that is invariant 22 made structural rather
 * than left to a caller: an expiring capacity slot would free itself while its
 * pane is still alive and still holding a resource that physically has one
 * slot, and an `integration` lease freed by a clock would let a second lane
 * rebase over a crash the specification says **reconcile settles by probing
 * git** (§4.6, §9.4). A dead holder is recognised by its superseded fencing
 * generation, never by elapsed time.
 */
const LEASE_TTLS = Object.freeze({ [LEASE_NAMES.controller]: CONTROLLER_LEASE_TTL_MS });

/**
 * §9.4's two capacity pools. The words live **here**, beside the row names they
 * appear in, because a pool is one third of the slot-name grammar: a second
 * spelling somewhere else is a name this module could build and not parse.
 */
export const POOLS = Object.freeze({ ticket: "ticket", model: "model" });

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
 * The same grammar, read backwards: **a row name is what a slot canonically
 * is**, and its pool, class, and index come out of it rather than out of the
 * advisory identity blob a previous controller wrote (§4.6).
 *
 * Recovery is exactly where that distinction bites. #114 rebuilds a hold over a
 * row a *dead* controller took, and the blob beside it is that controller's
 * unverified word; the name is the row's own identity, which is why the pool
 * and the index a resumed lane is given are parsed from it here.
 *
 * @param {string} name
 * @returns {Readonly<{ pool: string, class: string | null, index: number }> | null}
 *   null when the name is not a capacity row's
 */
export function parseCapacitySlot(name) {
	const ticket = /^capacity:ticket:(\d+)$/.exec(name ?? "");
	if (ticket !== null) return Object.freeze({ pool: POOLS.ticket, class: null, index: Number(ticket[1]) });

	const model = MODEL_SLOT_PATTERN.exec(name ?? "");
	if (model !== null) return Object.freeze({ pool: POOLS.model, class: model[1], index: Number(model[2]) });

	return null;
}

/**
 * **There is no worktree lease.** Attempt identity already makes a worktree
 * single-writer (§4.6, invariant 23), so a lock over one would be a second,
 * weaker answer to a question already settled by construction.
 *
 * @param {object} store an open store (§4.1)
 * @param {{ now?: () => number }} [options] the clock, injectable for tests
 * @returns {Readonly<object>} the registry
 */
export function openLeases(store, { now = Date.now } = {}) {
	return Object.freeze({
		/** The registry's clock, so a holder cannot keep a second, disagreeing one. */
		now,

		/**
		 * @param {{ name: string, identity: object, event?: object | null, fencedTo?: number | null }} request
		 *   the TTL is **not** a parameter: it belongs to the object (see
		 *   `LEASE_TTLS`). `event` is appended in the **same transaction** as the
		 *   row, because a lease row is canonical rather than a projection and
		 *   must not drift from its event (§4.4).
		 *
		 *   `fencedTo` is §9.4's "**fenced to the controller's lease generation**":
		 *   a capacity slot records the generation of the controller that took it
		 *   rather than one of its own, so a row a superseded controller took is
		 *   recognisable as superseded **whenever it was taken**. Minting here
		 *   instead would stamp a row taken by a stale-but-live controller with a
		 *   number *above* its successor's, and that row would then be honored
		 *   forever. The number still comes from the one DB-wide counter — it is
		 *   the caller's own lease generation, drawn from it earlier — so §4.6's
		 *   total order across leases is untouched.
		 * @returns {Readonly<object>} the hold, whose token is the ownership proof
		 * @throws {FactoryStateError} `lease-held` when a live holder has it
		 */
		acquire: ({ name, identity, event = null, fencedTo = null }) =>
			store.transaction(({ db, appendEvent }) => {
				requireLeaseName(name);
				const at = now();
				const ttlMs = LEASE_TTLS[name] ?? null;
				const incumbent = readLease(db, name);
				if (incumbent !== null) {
					if (!hasLapsed(incumbent, at)) refuseHeld(name, incumbent);
					// §10.4: a controller lease that is free *or expired* is adopted.
					// Nothing probes the previous holder's process to decide that —
					// the clock and the new generation are the whole mechanism.
					deleteLease(db, name, incumbent.token);
				}

				const generation = fencedTo ?? mintGeneration(db);
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
		 * §4.8's liveness write. The generation is untouched — a renewal is the
		 * same holder saying so, and bumping it would invalidate every effect this
		 * controller has in flight.
		 *
		 * @returns {Readonly<object>} the renewed hold
		 * @throws {FactoryStateError} `lease-lost` when this token no longer holds the row
		 */
		renew: (held) =>
			store.transaction(({ db }) => {
				const at = now();
				const expiresAt = held.ttlMs === null ? null : at + held.ttlMs;
				const updated = db
					.prepare("UPDATE lease SET renewed_at = ?, expires_at = ? WHERE name = ? AND holder_token = ?")
					.run(at, expiresAt, held.name, held.token);

				if (updated.changes !== 1) refuseLost(held, readLease(db, held.name));

				return Object.freeze({ ...held, renewedAt: at, expiresAt });
			}),

		/**
		 * Re-state the holder's **advisory** identity, compare-and-swapped on the
		 * token like every other write here.
		 *
		 * It exists because §10.4 decides which run this controller drives *under
		 * the lease* — startup reconcile is what adopts an orphaned run — so the
		 * hold is taken before there is a run to name. Nothing reads the blob as
		 * proof (§4.6); what would go wrong without this is narrower and still
		 * real: §10.5's refusal names the holding run out of it, and a permanent
		 * "(unnamed)" would leave the next operator with nothing to look at.
		 *
		 * @returns {Readonly<object>} the hold, carrying the new identity
		 * @throws {FactoryStateError} `lease-lost` when this token no longer holds the row
		 */
		describe: (held, identity) =>
			store.transaction(({ db }) => {
				const updated = db
					.prepare("UPDATE lease SET identity = ? WHERE name = ? AND holder_token = ?")
					.run(JSON.stringify(identity), held.name, held.token);

				if (updated.changes !== 1) refuseLost(held, readLease(db, held.name));

				return Object.freeze({ ...held, identity });
			}),

		/**
		 * Append `event` **only while this token still holds the row**, both in one
		 * transaction.
		 *
		 * The token is the ownership proof, and the latch a holder keeps in memory
		 * is not: a successor adopts a *lapsed* row without asking anyone, so the
		 * previous holder learns it is stale at its next compare-and-swap and not
		 * one moment sooner. Between the lapse and that discovery a holder that
		 * writes through `store.append` is writing about state somebody else now
		 * owns. This is the write path for the records where that matters — the
		 * ones that move a run's authoritative lifecycle.
		 *
		 * @param {object} held the hold whose token is compared
		 * @param {{ event: object }} write
		 * @returns {boolean} whether this holder still held the row, and therefore
		 *   whether the event was appended
		 */
		attest: (held, { event }) =>
			store.transaction(({ db, appendEvent }) => {
				if (!holdsLease(db, held)) return false;
				appendEvent(event);
				return true;
			}),

		/**
		 * The same compare, over a body of several statements.
		 *
		 * §12.2's expiry is the shape that needs it: a run's stream deletion
		 * **cannot be recorded inside the stream**, so the deletion, the projection
		 * rows it clears, and the `run.expired` on the `controller` stream commit
		 * together or not at all — and a holder that lost the lease in between
		 * writes none of them. `attest` cannot express that, and running the body
		 * outside the compare would put the destructive half of expiry beyond the
		 * one proof of ownership this module recognises.
		 *
		 * @param {object} held
		 * @param {(tx: { db: object, appendEvent: (input: object) => object }) => unknown} body
		 * @returns {{ held: boolean, result: unknown }}
		 */
		attestIn: (held, body) =>
			store.transaction((tx) =>
				holdsLease(tx.db, held) ? { held: true, result: body(tx) } : { held: false, result: null },
			),

		/**
		 * §5.5's adoption, at the lease layer: **move rows a previous controller
		 * holds onto this one's token and fencing generation, without ever
		 * freeing the index in between.**
		 *
		 * Three properties, and each is the answer to a way this could go wrong:
		 *
		 * - It is a **compare-and-swap on the predecessor's own token**, like
		 *   every other write here. A release-then-acquire would open a window in
		 *   which a third controller takes the index while the adopted pane is
		 *   still talking to the resource §9.4's row exists to protect.
		 * - It is **all or nothing**, in one transaction. A lane is a ticket row
		 *   and a model row, and half a lane is a row nothing can resume.
		 * - It is **capacity rows only**. The `controller` lease is adopted by
		 *   `acquire` when it is free or expired (§10.4), and `integration` is
		 *   settled by probing git (§9.5); a transfer path reaching either would
		 *   be a second, weaker answer to a question those two already settle.
		 *
		 * `fencedTo` is the adopting controller's own generation, for the reason
		 * `acquire` takes one: a row is fenced to the lease that holds it, so a
		 * generation minted here would order the adopted rows above the
		 * controller that adopted them.
		 *
		 * @param {ReadonlyArray<{ row: object, identity: object, event?: object | null }>} transfers
		 * @param {{ fencedTo: number, at?: number }} where
		 * @returns {ReadonlyArray<Readonly<object>>} the new holds, in input order
		 * @throws {FactoryStateError} `invalid-lease-name` · `lease-adoption-refused`
		 */
		adoptAll: (transfers, { fencedTo, at = now() }) =>
			store.transaction(({ db, appendEvent }) => {
				const adopted = [];

				for (const { row, identity, event = null } of transfers) {
					requireCapacityName(row.name);
					const token = randomBytes(16).toString("hex");
					const moved = db
						.prepare(
							`UPDATE lease SET holder_token = ?, fencing_generation = ?, renewed_at = ?, identity = ?
							 WHERE name = ? AND holder_token = ?`,
						)
						.run(token, fencedTo, at, JSON.stringify(identity), row.name, row.token);

					if (moved.changes !== 1) refuseUnadoptable(row, readLease(db, row.name));
					if (event !== null) appendEvent(event);

					adopted.push(
						Object.freeze({
							name: row.name,
							token,
							fencingGeneration: fencedTo,
							// Untimed, like every capacity row: §9.4's slots carry no TTL,
							// and adoption is not the moment to give one a clock.
							expiresAt: null,
							renewedAt: at,
							ttlMs: null,
							identity,
						}),
					);
				}

				return Object.freeze(adopted);
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
				const released = deleteLease(db, held.name, held.token);
				if (released && event !== null) appendEvent(event);
				return released;
			}),

		/** @returns {object | null} the row as the operator and reconcile read it */
		inspect: (name) => store.read((db) => readLease(db, name)),

		/**
		 * Every row whose name starts with `prefix`, in name order.
		 *
		 * §9.4's capacity rows are a *pool* rather than a singleton, and the two
		 * questions asked of a pool — which indices are free, and who holds the rest
		 * — are one read each rather than one read per index. It lives here because
		 * the `lease` table is this module's (§4.6): a `SELECT` over it anywhere
		 * else is the second place a lease row could be interpreted.
		 *
		 * @param {string} prefix
		 * @returns {ReadonlyArray<object>}
		 */
		list: (prefix) =>
			store.read((db) =>
				Object.freeze(
					db
						.prepare("SELECT * FROM lease WHERE name LIKE ? ESCAPE '\\' ORDER BY name")
						.all(`${prefix.replaceAll(/[%_\\]/g, "\\$&")}%`)
						.map(decode),
				),
			),
	});
}

/**
 * §9.4: a row stamped with a superseded generation **is not honored** — that is
 * how a crash mid-integration is visible as "held by a dead generation" (§4.6).
 * The counter is DB-wide, so this is a total order rather than a per-lease
 * guess, which is the whole reason §4.6 mints from one counter.
 *
 * Acting on it — probing the pane or the repository, then taking the row over —
 * belongs to the ticket that owns the probe (§5.3); this is the predicate it
 * reads.
 *
 * @param {{ fencingGeneration: number }} row
 * @param {number} generation the live controller's generation
 */
export function isSuperseded(row, generation) {
	return row.fencingGeneration < generation;
}

/**
 * The names §5.5's adoption may move. Narrower than `requireLeaseName` on
 * purpose: the two singleton objects have their own settlements, and a
 * transfer path that could reach them would be a way around both.
 */
function requireCapacityName(name) {
	if (parseCapacitySlot(name) !== null) return;

	throw new FactoryStateError(
		"invalid-lease-name",
		`${JSON.stringify(name ?? null)} is not a capacity row, and adoption moves capacity rows only: the ` +
			`${LEASE_NAMES.controller} lease is adopted free-or-expired (§10.4) and ${LEASE_NAMES.integration} is ` +
			"settled by probing git (§9.5).",
		{ found: name ?? null, expected: "capacity:ticket:<i>|capacity:model:<class>:<i>" },
	);
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
 * A row is lapsed when its own expiry has passed; an untimed row never is.
 * The clock belongs to the row, and this is the one place the check is written:
 * the acquire path, the stop verb, and the launcher all read liveness through it.
 */
export function hasLapsed(row, at) {
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
 * The compare half of a compare-and-swap failing: this token is not what the
 * row says, so the hold is gone. For the controller lease §14.6 makes the
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
 * A transfer whose compare failed: the row moved — released, or taken over —
 * between the probe that proved its holder live and this swap.
 *
 * It is deliberately **not** `lease-lost`: that reason names *this* controller's
 * own hold going away and costs the process exit 6 (§14.6). Here the controller
 * is fine and one row it hoped to adopt is not there to adopt, which leaves the
 * lane unresumed and everything else running.
 */
function refuseUnadoptable(row, incumbent) {
	throw new FactoryStateError(
		"lease-adoption-refused",
		incumbent === null
			? `The ${row.name} row was released between the probe that proved its holder live and this adoption.`
			: `The ${row.name} row is now held under generation ${incumbent.fencingGeneration} by a different token, ` +
				"so this controller is not the one adopting it.",
		{
			lease: row.name,
			fencing_generation: row.fencingGeneration,
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

function readLease(db, name) {
	return decode(db.prepare("SELECT * FROM lease WHERE name = ?").get(name));
}

/** The compare half of every compare-and-swap here, asked without swapping. */
function holdsLease(db, held) {
	return (
		db.prepare("SELECT 1 FROM lease WHERE name = ? AND holder_token = ?").get(held.name, held.token) !== undefined
	);
}

/**
 * The **only** statement in the factory that removes a lease row, and it names
 * the token. Keeping it to one function is what makes "no unconditional removal
 * path" a fact about the code rather than a habit.
 */
function deleteLease(db, name, token) {
	return db.prepare("DELETE FROM lease WHERE name = ? AND holder_token = ?").run(name, token).changes === 1;
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
