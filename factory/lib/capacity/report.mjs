import { runStream } from "../state/events.mjs";
import { isSuperseded, LEASE_NAMES, openLeases } from "../state/leases.mjs";
import { capacityPlan } from "./plan.mjs";

/**
 * §9.7's saturation observability, computed once for every reader of it.
 *
 * > "The run is slow" looks identical whether lanes are working or all of them
 * > are queued behind one slot.
 *
 * So `status`, `doctor`, and the live run's own report print **the declared
 * ceiling, the effective concurrency, and per class: size, held, waiting** — and
 * they print the same numbers, because this is the only place any of them is
 * derived. A config saying 4 while routing resolves entirely to `local` is a
 * comfortable lie, and effective concurrency is what makes it visible.
 *
 * Every number comes from the rows and the journal. **There is no counter to
 * keep in step**: `held` is the `capacity:*` rows, and `waiting` is a walk over
 * the run's own `capacity.*` records — the same derivation §12.10's byte
 * accounting uses over the ledger.
 */

/** The kinds a lane's block and its resolution are written as. */
const CAPACITY_KINDS = Object.freeze(["capacity.waiting", "capacity.granted", "capacity.released"]);

/**
 * §9.7's section, for a verb that has a config and a store rather than a live
 * pool: `status` and `doctor`. Both read it through here, so neither can answer
 * differently from the other or from the controller's own report.
 *
 * The plan comes from the configuration this invocation loaded, which is the
 * honest answer to "what would a run started **now** get" — declared ceiling
 * beside the concurrency the active routing actually resolves to.
 *
 * The generation to fence against is the live controller's own lease row. With
 * no controller holding it there is nothing for a row to be superseded *by*, so
 * nothing is called superseded: a leftover row is reported as the holder it is.
 *
 * @param {object | null} store a read-only store handle, or null
 * @param {{ config: object, activeRouting: object, run?: string | null, at?: number }} context
 * @returns {Readonly<object>}
 */
export function capacityFor(store, { config, activeRouting, run = null, at = Date.now() }) {
	const plan = capacityPlan({
		concurrency: config.concurrency,
		profiles: config.profiles,
		activeRouting,
	});

	if (store === null) return capacitySnapshot(store, { plan, run: null, rows: [], generation: null, at });

	const leases = openLeases(store);
	return capacitySnapshot(store, {
		plan,
		run,
		rows: leases.list("capacity:"),
		generation: leases.inspect(LEASE_NAMES.controller)?.fencingGeneration ?? null,
		at,
	});
}

/**
 * @param {object} store an open store, read-only or not
 * @param {object} context
 * @param {object} context.plan §9.1's capacity plan
 * @param {string | null} context.run the run whose lanes are counted, or null
 * @param {ReadonlyArray<object>} context.rows the `capacity:*` lease rows
 * @param {number | null} context.generation the live controller's fencing
 *   generation; null when no controller holds the lease, in which case nothing is
 *   called superseded — there is no live generation to be superseded *by*
 * @param {number} [context.at]
 * @returns {Readonly<object>} the one value all three renderings come from
 */
export function capacitySnapshot(store, { plan, run, rows, generation, at = Date.now() }) {
	const waiting = waitingLanes(store, run);
	const ticket = tally(rows, [], { pool: "ticket", resourceClass: null, size: plan.ticketSlots, generation });
	const classes = plan.classes.map((entry) =>
		Object.freeze({
			class: entry.class,
			...tally(rows, waiting, { pool: "model", resourceClass: entry.class, size: entry.size, generation }),
		}),
	);

	return Object.freeze({
		at,
		declared_ceiling: plan.declaredCeiling,
		/**
		 * §9.2: `local` is a resource class of size 1, so routing that resolves
		 * entirely to it yields effective concurrency 1. **Nothing to forget** —
		 * this is arithmetic rather than a branch in the scheduler.
		 */
		effective_concurrency: plan.effectiveConcurrency,
		implement_slots: plan.implementSlots,
		resource_slots: plan.resourceSlots,
		pane_bound: plan.paneBound,
		ticket: Object.freeze(ticket),
		classes: Object.freeze(classes),
		/**
		 * The two numbers a headline needs, derived **here** so no caller adds them
		 * up its own way. They are deliberately not one number: a working lane
		 * holds a ticket row *and* a model row, so summing the pools would print
		 * one lane as two.
		 */
		lanes: Object.freeze({
			running: ticket.held,
			waiting: classes.reduce((total, entry) => total + entry.waiting, 0),
		}),
		/**
		 * A slot row **names its holder**, which is the whole reason §9.4 refuses a
		 * counter. Printing them is what lets an operator ask the pane rather than
		 * the number.
		 */
		holders: Object.freeze(rows.map((row) => describeSlot(row, generation))),
	});
}

/**
 * One pool's line. `waiting` is empty for the ticket pool by construction: a
 * full ticket pool is the declared ceiling doing its job rather than a resource
 * anyone is queued behind, and §9.7 counts a lane as waiting when it blocks on a
 * **class**.
 */
function tally(rows, waiting, { pool, resourceClass, size, generation }) {
	const mine = rows.filter(
		(row) => (row.identity?.pool ?? null) === pool && (row.identity?.class ?? null) === resourceClass,
	);
	const superseded = mine.filter((row) => generation !== null && isSuperseded(row, generation));

	return {
		size,
		held: mine.length - superseded.length,
		waiting: waiting.filter((lane) => lane.class === resourceClass).length,
		superseded: superseded.length,
	};
}

/**
 * A capacity row as every reader of one describes it — the pool's own report,
 * `blocked()`, and `reclaim()`'s answer. **A slot row names its holder**, which
 * is the whole reason §9.4 refuses a counter, so there is one shape for saying
 * who that is.
 *
 * @param {object} row a decoded `lease` row
 * @param {number | null} generation the live controller's, or null when none holds it
 * @returns {Readonly<object>}
 */
export function describeSlot(row, generation) {
	return Object.freeze({
		slot: row.name,
		pool: row.identity?.pool ?? null,
		class: row.identity?.class ?? null,
		run: row.identity?.run ?? null,
		ticket: row.identity?.ticket ?? null,
		attempt: row.identity?.attempt ?? null,
		fencing_generation: row.fencingGeneration,
		superseded: generation !== null && isSuperseded(row, generation),
	});
}

/**
 * What a lane's block is latched and counted under. One spelling, because the
 * pool announces a wait under it and the report counts waits under it — two
 * spellings would be two answers to "is this lane still blocked".
 */
export function laneKey({ ticket, resourceClass }) {
	return `${ticket}:${resourceClass ?? ""}`;
}

/**
 * The lanes currently blocked on a class, from the journal rather than from a
 * live controller's memory — so a `status` in another terminal answers exactly
 * what the running controller would.
 *
 * A lane is waiting when its last capacity record for that class is the block:
 * `capacity.granted` is what ends the wait, and `capacity.released` is read the
 * same way, because a released slot is a lane that had got one.
 */
function waitingLanes(store, run) {
	if (run === null) return [];

	const records = CAPACITY_KINDS.flatMap((kind) => store.readEvents({ stream: runStream(run), kind })).sort(
		(left, right) => left.seq - right.seq,
	);

	/** @type {Map<string, { ticket: number | null, class: string | null }>} */
	const blocked = new Map();
	for (const record of records) {
		// The ticket pool's own grants and releases carry no class and never a
		// block, so they close nothing and open nothing.
		const resourceClass = record.payload.resource_class ?? null;
		if (resourceClass === null) continue;

		const key = laneKey({ ticket: record.ticket, resourceClass });
		if (record.kind === "capacity.waiting") blocked.set(key, { ticket: record.ticket, class: resourceClass });
		else blocked.delete(key);
	}

	return [...blocked.values()];
}
