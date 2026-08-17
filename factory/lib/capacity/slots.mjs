import { capacityModelSlot, capacityTicketSlot, isSuperseded } from "../state/leases.mjs";
import {
	classAvailability,
	DEFAULT_EXHAUSTION_MEMO_MS,
	EXHAUSTION_STATES,
	exhaustionLedger,
	INCONCLUSIVE_EXHAUSTION_MEMO_MS,
	recordAdmission,
	recordExhaustion,
} from "./exhaustion.mjs";
import { FactoryCapacityError } from "./errors.mjs";
import { capacitySnapshot, describeSlot, laneKey } from "./report.mjs";

/**
 * §9.4's capacity arbitration: **discrete named rows on §4.6's lease primitive,
 * never a counter.**
 *
 * A counter has no identity to probe, and §5.3 settles an unresolved fact only
 * by re-probing the external system. A row named `capacity:ticket:3` carrying
 * the run, ticket, and pane that took it can be asked about; `held: 3` cannot.
 *
 * **The resource class is what actually arbitrates** (§9.1). Counting panes
 * would let N lanes launch and then queue invisibly behind one GPU slot, having
 * already claimed N tickets on the tracker for work that is not moving.
 *
 * Two spans, and the property that falls out of them (§9.4):
 *
 * - the **ticket slot** spans the whole ticket execution, repair and fresh-retry
 *   included, released exactly once at terminal disposition;
 * - the **model slot** is per attempt, so an exited attempt holds nothing.
 *
 * > A lane holds at most one model slot and zero between phases, so **no
 * > hold-and-wait is constructible and therefore no deadlock cycle is.**
 */

/** The two pools. A slot's pool decides its row name and its span. */
export const POOLS = Object.freeze({ ticket: "ticket", model: "model" });

/**
 * @param {object} store an open store (§4.1)
 * @param {object} context
 * @param {object} context.leases the §4.6 registry
 * @param {object} context.plan §9.1's capacity plan (`plan.mjs`)
 * @param {string} context.run the run whose stream the records land on
 * @param {object} context.hold the controller's hold (`controller/lease-guard.mjs`),
 *   which is both the gate on issuing anything and the generation every row is
 *   fenced to
 * @param {() => number} [context.now]
 * @param {((className: string, context: object) => Promise<{ verdict: string, evidence: object }>) | null} [context.probeClass]
 *   #154's readmission probe: one cheap completion on the class, answering
 *   `admitted`, `refused`, or `inconclusive`. Injected like §9.4's pane probe —
 *   the pool owns the memo, the wiring owns the runtime
 * @returns {Readonly<object>} the pool
 */
export function openCapacity(store, { leases, plan, run, hold, now = Date.now, probeClass = null }) {
	/**
	 * Which lanes have already announced a block, per pool. §9.7 emits
	 * `capacity.waiting` **once when a lane first blocks on a class, never per
	 * poll** — retry-storm spam is how this diagnostic normally destroys its own
	 * usefulness — and the loop asks on every scheduling decision.
	 *
	 * It is a latch on *emission* only. Every number an operator reads comes from
	 * the journal and the rows (`report.mjs`), so a fresh process reports the same
	 * waiting lanes this one does.
	 */
	const announced = new Set();

	/**
	 * §9.4's acquisition: **the ticket slot and the implement attempt's model slot
	 * together, before the Gitea claim** (§3.3, §14.21). That is also what makes
	 * local-only-is-sequential structurally true rather than merely arithmetically
	 * true — a second ticket can never be claimed while the one slot is held.
	 *
	 * Availability in both pools is settled before either row is written, so a
	 * lane that cannot run never takes a ticket slot to wait in — and the journal
	 * never fills with grant/release pairs for work that did not start.
	 *
	 * @param {{ ticket: number, resourceClass: string, attempt?: string | null, at?: number }} request
	 * @returns {{ ticket: object, model: object } | null} both holds, or null when
	 *   this lane is blocked — which is §9.6's whole backpressure mechanism:
	 *   **not claiming**, with nothing buffered and no intent queued
	 */
	function acquireLane({ ticket, resourceClass, attempt = null, at = now() }) {
		const ticketIndex = freeIndex(POOLS.ticket, null);
		// A full ticket pool is the declared ceiling doing its job, not a resource
		// anyone is queued behind, so nothing is announced: §9.7's record is about
		// a lane blocking **on a class**, and the ceiling already explains this one.
		if (ticketIndex === null) return null;

		const modelIndex = freeIndex(POOLS.model, resourceClass);
		if (modelIndex === null) {
			announceWait({ resourceClass, ticket, at });
			return null;
		}

		const ticketSlot = take({ pool: POOLS.ticket, resourceClass: null, index: ticketIndex, ticket, attempt, at });

		try {
			const modelSlot = take({ pool: POOLS.model, resourceClass, index: modelIndex, ticket, attempt, at });
			clearWait({ ticket, resourceClass });
			return Object.freeze({ ticket: ticketSlot, model: modelSlot });
		} catch (error) {
			// Nothing else writes these rows while this controller holds the lease,
			// so this is a genuine surprise rather than contention. The ticket slot
			// is given back rather than left held by a lane that never started.
			ticketSlot.release({ reason: "acquisition-failed", at });
			throw error;
		}
	}

	/**
	 * A later attempt's model slot. The first one comes with the lane, because
	 * §9.4 acquires it before the claim; every attempt after that asks here, and
	 * the exited attempt's slot has already gone back to the pool.
	 *
	 * @param {{ ticket: number, resourceClass: string, attempt?: string | null, at?: number }} request
	 * @returns {object | null} the hold, or null when the class is saturated
	 */
	function acquireModel({ ticket, resourceClass, attempt = null, at = now() }) {
		const index = freeIndex(POOLS.model, resourceClass);
		if (index === null) {
			announceWait({ resourceClass, ticket, at });
			return null;
		}

		const slot = take({ pool: POOLS.model, resourceClass, index, ticket, attempt, at });
		clearWait({ ticket, resourceClass });
		return slot;
	}

	/**
	 * The first index in a pool whose row is free.
	 *
	 * A row held under a **superseded generation** is neither free nor takeable:
	 * §9.4 says a slot stamped with a superseded generation is not honored, and
	 * that its holder is settled by **probing the pane, never by waiting for a
	 * clock**. Treating it as free would double-book a resource that physically
	 * has one slot while the old pane is still talking to it.
	 */
	function freeIndex(pool, resourceClass) {
		for (let index = 0; index < poolSize(pool, resourceClass); index += 1) {
			if (leases.inspect(slotName(pool, resourceClass, index)) === null) return index;
		}

		return null;
	}

	function poolSize(pool, resourceClass) {
		if (pool === POOLS.ticket) return plan.ticketSlots;

		const declared = plan.classes.find((entry) => entry.class === resourceClass);
		if (declared === undefined) {
			throw new FactoryCapacityError(
				"resource-class-unknown",
				`No profile the active routing reaches runs on resource class "${resourceClass}", so it has no slot pool (§11.6 makes an unsized active class a load error).`,
				{ class: resourceClass, expected: plan.classes.map((entry) => entry.class).join("|") },
			);
		}

		return declared.size;
	}

	function slotName(pool, resourceClass, index) {
		return pool === POOLS.ticket ? capacityTicketSlot(index) : capacityModelSlot(resourceClass, index);
	}

	/**
	 * One row and the record announcing it, in **one transaction** — a lease row
	 * is canonical rather than a projection (§4.4), so a grant nobody can read in
	 * the journal, or a journal entry with no row, are both excluded here rather
	 * than reconciled later.
	 *
	 * The row is stamped through `hold.fence()`, which is the same gate every
	 * effect passes: a controller that has not reconciled, or has lost or released
	 * its lease, takes no slots. **The generation it stamps is the controller's
	 * own** (§9.4): a slot is fenced to the lease that took it, so a stale
	 * controller's row is recognisable as superseded however late it was written.
	 */
	function take({ pool, resourceClass, index, ticket, attempt, at }) {
		const name = slotName(pool, resourceClass, index);
		const fence = hold.fence();
		const held = leases.acquire({
			name,
			fencedTo: fence.generation,
			identity: { run, ticket, attempt, pool, class: resourceClass },
			event: {
				kind: "capacity.granted",
				source: "controller",
				run,
				ticket,
				...(attempt === null ? {} : { attempt }),
				occurredAt: at,
				observedAt: at,
				payload: {
					slot: name,
					pool,
					resource_class: resourceClass,
					size: poolSize(pool, resourceClass),
					fencing_generation: fence.generation,
				},
			},
		});

		return slotHold(held, { pool, resourceClass, index, ticket, attempt });
	}

	/**
	 * A hold, with the one thing a caller does to it. `release` answers **whether
	 * this call was the release** — the ticket slot is released exactly once at
	 * terminal disposition (§9.4), and a lane whose cleanup runs twice must not
	 * write two records saying so.
	 */
	function slotHold(held, { pool, resourceClass, index, ticket, attempt }) {
		let released = false;

		return Object.freeze({
			name: held.name,
			pool,
			class: resourceClass,
			index,
			ticket,
			attempt,
			fencingGeneration: held.fencingGeneration,

			release({ reason, at = now() }) {
				if (released) return false;

				// §14.6: a controller that lost its lease stops issuing and abandons
				// in-flight work where it stands. Its rows are exactly what the
				// successor settles by probe, so dropping them here — under a token
				// this process may no longer own — would erase the evidence.
				if (hold.lost) return false;

				released = leases.release(held, {
					event: {
						kind: "capacity.released",
						source: "controller",
						run,
						ticket,
						...(attempt === null ? {} : { attempt }),
						occurredAt: at,
						observedAt: at,
						payload: { slot: held.name, pool, resource_class: resourceClass, reason },
					},
				});

				return released;
			},
		});
	}

	/**
	 * The saturation record §9.7 asks for: **once when a lane first blocks on a
	 * class, never per poll.**
	 *
	 * It is a plain append rather than a token-checked one: a wait is an
	 * observation about this controller's own lane, not a move of the run's
	 * lifecycle, so there is nothing here a stale writer could corrupt for a
	 * successor. The grants and releases beside it ride the lease
	 * compare-and-swap, which is where ownership actually matters.
	 */
	function announceWait({ resourceClass, ticket, at }) {
		const key = laneKey({ ticket, resourceClass });
		if (announced.has(key)) return;
		announced.add(key);

		store.append({
			kind: "capacity.waiting",
			source: "controller",
			run,
			ticket,
			occurredAt: at,
			observedAt: at,
			payload: {
				pool: POOLS.model,
				resource_class: resourceClass,
				size: poolSize(POOLS.model, resourceClass),
			},
		});
	}

	/** A lane that was granted may announce a later block on the same class. */
	function clearWait({ ticket, resourceClass }) {
		announced.delete(laneKey({ ticket, resourceClass }));
	}

	/**
	 * #154: **the provider-exhaustion memo, as §9's capacity facet.**
	 *
	 * A class a provider refused for quota or rate reasons is unavailable until
	 * the recorded expiry, and the refusal is remembered durably — on the
	 * `controller` stream, so the next run consults what this one paid to learn.
	 * Dispatch asks `settle` before it launches into a class; the saturation
	 * surface reads the same ledger.
	 */
	const exhaustion = Object.freeze({
		/** The memo records, resolved at `at` — the snapshot's and `settle`'s one derivation. */
		ledger: ({ at = now() } = {}) => exhaustionLedger(store, { at }),

		/** One class's availability at `at`: `available`, `exhausted`, or `probe-due`. */
		stateOf: (className, { at = now() } = {}) =>
			classAvailability(exhaustionLedger(store, { at }), className),

		/** Record an observed refusal: the class is unavailable until `until`. */
		record: (className, { until, at = now(), evidence = {} }) =>
			recordExhaustion(hold, { class: className, until, at, evidence }),

		/**
		 * The dispatch gate for one class.
		 *
		 * A live memo blocks. An expiry that passed is **settled by probe, never
		 * by the clock** (§5.2): the probe answers `admitted` — recorded, and the
		 * class opens — or the memo is renewed from the probe's own verdict, a
		 * refused refusal on the full window and an inconclusive read on the short
		 * one. With no probe wired there is no answer, and the class stays blocked
		 * saying what is missing — §12.4's alarm shape rather than a plausible zero.
		 *
		 * @param {string} className
		 * @param {{ at?: number }} [options]
		 * @returns {Promise<Readonly<{ state: "available" | "blocked", until: number | null, missing?: string }>>}
		 */
		async settle(className, { at = now() } = {}) {
			const status = classAvailability(exhaustionLedger(store, { at }), className);
			if (status === EXHAUSTION_STATES.available) {
				return Object.freeze({ state: "available", until: null });
			}
			if (status === EXHAUSTION_STATES.exhausted) {
				const entry = exhaustionLedger(store, { at }).find((memo) => memo.class === className);
				return Object.freeze({ state: "blocked", until: entry.until });
			}

			// Probe-due: the expiry passed, and nothing but a probe may say the
			// class is back (§5.2).
			if (probeClass === null) {
				return Object.freeze({
					state: "blocked",
					until: null,
					missing: "the readmission probe that re-admits an expired exhaustion memo by probe, never by the clock (#154)",
				});
			}

			const answer = await probeClass(className);
			if (answer.verdict === "admitted") {
				recordAdmission(hold, { class: className, at, evidence: answer.evidence ?? {} });
				return Object.freeze({ state: "available", until: null });
			}

			const window =
				answer.verdict === "refused" ? DEFAULT_EXHAUSTION_MEMO_MS : INCONCLUSIVE_EXHAUSTION_MEMO_MS;
			const until = at + window;
			recordExhaustion(hold, { class: className, until, at, evidence: answer.evidence ?? {} });
			return Object.freeze({ state: "blocked", until });
		},

		/**
		 * Announce a lane blocking on the memo — §9.7's `capacity.waiting`, the
		 * same record a full slot pool announces, because "this lane is blocked on
		 * this class" is one fact however the class is blocked.
		 */
		wait: ({ ticket, resourceClass, at = now() }) => announceWait({ resourceClass, ticket, at }),
	});

	/** Every capacity row this store holds, decoded. */
	function rows() {
		return leases.list("capacity:");
	}

	/**
	 * The rows a **superseded** controller took. Because a slot is fenced to the
	 * generation of the lease that took it, this is exactly "somebody else's, from
	 * before this hold" — including rows a stale-but-live predecessor is still
	 * writing.
	 */
	function supersededRows() {
		return rows().filter((row) => isSuperseded(row, hold.fencingGeneration));
	}

	return Object.freeze({
		plan,
		acquireLane,
		acquireModel,
		exhaustion,

		/**
		 * The rows occupying an index under a **dead generation** — the slots a
		 * previous controller left behind. They are reported rather than reclaimed,
		 * because §9.4 settles them by probe and §5.3 refuses to settle anything by
		 * reasoning.
		 */
		blocked: () => Object.freeze(supersededRows().map((row) => describeSlot(row, hold.fencingGeneration))),

		/**
		 * §9.4's settlement: **by probing the holder, never by waiting for a
		 * clock.** The probe is handed the row's advisory identity and answers
		 * whether that holder is still there; a live one is left alone, because
		 * adopting it is the recovery slice's job (#114) and evicting a pane that
		 * is still talking to the GPU is the double-booking this whole design
		 * refuses.
		 *
		 * With no probe there is no answer, and the rows stay exactly as they are —
		 * which is §12.4's alarm rather than a plausible zero.
		 *
		 * @param {{ probe?: ((row: object) => { live: boolean, detail?: object }) | null, at?: number }} [options]
		 */
		reclaim({ probe = null, at = now() } = {}) {
			const superseded = supersededRows();
			const describe = (row) => describeSlot(row, hold.fencingGeneration);
			if (probe === null) {
				return Object.freeze({
					reclaimed: 0,
					held: Object.freeze(superseded.map(describe)),
					missing:
						superseded.length === 0
							? null
							: "the pane probe that adopts or declares a previous controller's lane dead (#114, #107)",
					spec: "§9.4, §14.22",
				});
			}

			const held = [];
			let reclaimed = 0;

			for (const row of superseded) {
				const answer = probe({ slot: row.name, identity: row.identity ?? {}, row, at });
				if (answer.live) {
					held.push(describe(row));
					continue;
				}

				// Compare-and-delete on the token the row itself carries: there is no
				// unconditional removal path here either (§4.6), and the evidence the
				// probe gave rides the record that removes it.
				const removed = leases.release(
					{ name: row.name, token: row.token },
					{
						event: {
							kind: "capacity.released",
							source: "controller",
							run,
							occurredAt: at,
							observedAt: at,
							payload: {
								slot: row.name,
								pool: row.identity?.pool ?? null,
								resource_class: row.identity?.class ?? null,
								reason: "reclaimed-by-probe",
								evidence: answer.detail ?? {},
								held_by: {
									run: row.identity?.run ?? null,
									ticket: row.identity?.ticket ?? null,
									fencing_generation: row.fencingGeneration,
								},
							},
						},
					},
				);
				if (removed) reclaimed += 1;
				else held.push(describe(row));
			}

			return Object.freeze({ reclaimed, held: Object.freeze(held), missing: null, spec: "§9.4, §14.22" });
		},

		/** §9.7's numbers, derived from the rows and the journal (`report.mjs`). */
		snapshot: ({ at = now() } = {}) =>
			capacitySnapshot(store, { plan, run, rows: rows(), generation: hold.fencingGeneration, at }),
	});
}

