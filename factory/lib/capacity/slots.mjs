import { setTimeout as delay } from "node:timers/promises";
import { capacityModelSlot, capacityTicketSlot, isSuperseded, parseCapacitySlot, POOLS } from "../state/leases.mjs";
import {
	classAvailability,
	DEFAULT_EXHAUSTION_MEMO_MS,
	EXHAUSTION_STATES,
	exhaustionLedger,
	INCONCLUSIVE_EXHAUSTION_MEMO_MS,
	recordAdmission,
	recordExhaustion,
} from "./exhaustion.mjs";
import { ADOPTION_VERDICTS } from "../domain/vocabulary.mjs";
import { FactoryStateError } from "../state/errors.mjs";
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

/**
 * Why a superseded row this pass could not settle is still held (§12.4). Each
 * is a different thing for the operator to do, which is exactly why a single
 * "still held" count is not an answer.
 */
export const RETAINED_REASONS = Object.freeze({
	/** Herdr or the filesystem taught this process nothing (§5.2). */
	unanswerable: "probe-unanswerable",
	/** A provably live worker, belonging to a run this controller is not driving. */
	otherRun: "live-holder-of-another-run",
	/** A provably live worker, on a run that is not going to execute anything. */
	notExecuting: "run-will-not-execute",
	/** The ticket row of a live lane is missing, so there is no whole lane to resume. */
	halfLane: "no-whole-lane-to-resume",
	/** The compare-and-delete found somebody else's token on the row. */
	moved: "row-moved-under-the-probe",
	/**
	 * A row naming a pool this run does not have — a class the configuration no
	 * longer declares, or an index above the ceiling it was taken under. Adopting
	 * it would hold a slot no pool accounts for, and releasing it by anything but
	 * a probe is what §9.4 refuses.
	 */
	outsidePool: "row-outside-this-run-s-pools",
});

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
export function openCapacity(store, { leases, plan, run, hold, now = Date.now, probeClass = null, interrupted = () => false }) {
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

	function assertActive() {
		if (interrupted()) throw new DOMException("Capacity wait abandoned (§9.6).", "AbortError");
		hold.fence();
	}

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

		const shapes = [
			{ pool: POOLS.ticket, resourceClass: null, index: ticketIndex, ticket, attempt, at },
			{ pool: POOLS.model, resourceClass, index: modelIndex, ticket, attempt, at },
		];
		try {
			const held = leases.acquireAll(shapes.map(grantRequest));
			clearWait({ ticket, resourceClass });
			return Object.freeze({ ticket: slotHold(held[0], shapes[0]), model: slotHold(held[1], shapes[1]) });
		} catch (error) {
			if (error instanceof FactoryStateError && error.reason === "lease-held") return null;
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

		const shape = { pool: POOLS.model, resourceClass, index, ticket, attempt, at };
		try {
			const slot = slotHold(leases.acquire(grantRequest(shape)), shape);
			clearWait({ ticket, resourceClass });
			return slot;
		} catch (error) {
			if (error instanceof FactoryStateError && error.reason === "lease-held") return null;
			throw error;
		}
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
	function grantRequest({ pool, resourceClass, index, ticket, attempt, at }) {
		const name = slotName(pool, resourceClass, index);
		const fence = hold.fence();
		return {
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
		};
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
			const ledger = exhaustionLedger(store, { at });
			const status = classAvailability(ledger, className);
			if (status === EXHAUSTION_STATES.available) {
				return Object.freeze({ state: "available", until: null });
			}
			if (status === EXHAUSTION_STATES.exhausted) {
				const entry = ledger.find((memo) => memo.class === className);
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
	 * The rows this controller took over from a predecessor, kept so the run can
	 * give back anything its scheduler never got to use. They are ordinary slot
	 * holds — `release` is idempotent, so a lane that ran and released its own
	 * has nothing more taken from it here.
	 */
	const adoptedHolds = [];

	/**
	 * The last verdict a probe gave each row it could not settle, so the run's
	 * closing account says *why* a row is still held rather than only that it is
	 * (§12.4). Keyed by row name; a row settled later simply stops appearing in
	 * the superseded set the account is built from.
	 */
	const retainedVerdicts = new Map();

	/**
	 * §5.5's adoption, at the pool: **move a whole lane's rows onto this
	 * controller's generation, on the predecessor's own tokens.**
	 *
	 * A lane is its ticket row *and* its model row, and it is taken whole or not
	 * at all: a model row adopted without the ticket row that spans the execution
	 * is a row no lane can resume, and the ticket row is what §9.4 makes span the
	 * repair and the fresh-retry.
	 */
	function adoptLanes(adoptable, { at }) {
		const retained = [];
		const byTicket = new Map();

		for (const entry of adoptable) {
			const shape = parseCapacitySlot(entry.row.name);
			// A row whose pool this run does not have cannot be adopted into one.
			// The configuration moved under the crash, and §9.4 still says the row
			// is settled by probing its holder — so it is left exactly as it is.
			if (!poolDeclared(shape)) {
				retained.push({ ...entry, reason: RETAINED_REASONS.outsidePool });
				continue;
			}

			const ticket = entry.row.identity?.ticket ?? null;
			const lane = byTicket.get(ticket) ?? { ticket, ticketRow: null, modelRow: null, extra: [] };
			if (shape.pool === POOLS.ticket && lane.ticketRow === null) lane.ticketRow = entry;
			else if (shape.pool === POOLS.model && lane.modelRow === null) lane.modelRow = entry;
			else lane.extra.push(entry);
			byTicket.set(ticket, lane);
		}

		const whole = [...byTicket.values()].filter((lane) => lane.ticketRow !== null);
		retained.push(
			...[...byTicket.values()]
				.filter((lane) => lane.ticketRow === null)
				.flatMap((lane) => [lane.modelRow, ...lane.extra])
				.concat(whole.flatMap((lane) => lane.extra))
				.filter((entry) => entry !== null && entry !== undefined)
				.map((entry) => ({ ...entry, reason: RETAINED_REASONS.halfLane })),
		);

		const resumed = [];
		const adopted = [];
		// One fence for the whole pass, like every other write this hold makes: it
		// is the gate as much as the number, and asking twice per row would let two
		// rows of one lane be stamped either side of a loss.
		const fence = hold.fence();

		// **One transaction per lane**, because the lane is the atomic unit: a lane
		// whose row moved under the probe leaves the others exactly where they are,
		// and this run resumes the ones it could still prove.
		for (const lane of whole) {
			// The lane's answer is the **ticket row's**: that row is the one spanning
			// the whole execution, and its candidate is the attempt a resumed lane is
			// resuming (§9.4).
			lane.answer = lane.ticketRow.answer;
			const rows = [lane.ticketRow, lane.modelRow].filter((entry) => entry !== null);
			let held;
			try {
				held = leases.adoptAll(
					rows.map((entry) => transferOf(entry, { generation: fence.generation, at })),
					{ fencedTo: fence.generation, at },
				);
			} catch (error) {
				if (!(error instanceof FactoryStateError) || error.reason !== "lease-adoption-refused") throw error;
				retained.push(...rows.map((entry) => ({ ...entry, reason: RETAINED_REASONS.moved })));
				continue;
			}

			const holdsByName = new Map(held.map((entry) => [entry.name, entry]));
			const slots = {
				ticket: holdFor(holdsByName.get(lane.ticketRow.row.name), lane),
				model: lane.modelRow === null ? null : holdFor(holdsByName.get(lane.modelRow.row.name), lane),
			};
			adoptedHolds.push(slots.ticket);
			if (slots.model !== null) adoptedHolds.push(slots.model);
			adopted.push(...held);
			resumed.push(
				Object.freeze({
					ticket: lane.ticket,
					attempt: lane.answer?.attempt ?? null,
					// §3.1 recomputes membership at every scheduling decision, so a
					// resumed lane carries only its ticket: the labels routing reads come
					// from the ticket snapshot the execution takes for itself, never from
					// a member record this recovery would have to invent.
					member: Object.freeze({ ticket: lane.ticket, labels: Object.freeze([]) }),
					slots: Object.freeze(slots),
					evidence: lane.answer?.detail ?? null,
				}),
			);
		}

		return { resumed, retained, adopted };
	}

	/**
	 * Whether any later controller could still **adopt** this row rather than only
	 * disprove it: adoption requires the row to name the run that controller is
	 * driving, so a row of this run — which is ending — is nobody's to adopt, and
	 * one naming a run already ended is nobody's either.
	 */
	function adoptableLater(row) {
		const named = row.identity?.run ?? null;
		if (named === null || named === run) return false;
		return store.readRun(named)?.lifecycle !== "ended";
	}

	/**
	 * Whether a row names a slot **this run's plan still has** — a declared class,
	 * and an index inside its size. A ceiling that shrank, or a class the routing
	 * no longer reaches, leaves rows a pool cannot account for.
	 */
	function poolDeclared(shape) {
		if (shape === null) return false;
		if (shape.pool === POOLS.ticket) return shape.index < plan.ticketSlots;
		return plan.classes.some((entry) => entry.class === shape.class && shape.index < entry.size);
	}

	/** One row's transfer: the new identity it carries, and the record announcing it. */
	function transferOf({ row, answer }, { generation, at }) {
		const shape = parseCapacitySlot(row.name);
		const identity = {
			run,
			ticket: row.identity?.ticket ?? null,
			attempt: answer.attempt ?? null,
			pool: shape.pool,
			class: shape.class,
		};

		return {
			row,
			identity,
			event: {
				kind: "capacity.granted",
				source: "controller",
				run,
				ticket: identity.ticket,
				...(identity.attempt === null ? {} : { attempt: identity.attempt }),
				occurredAt: at,
				observedAt: at,
				payload: {
					slot: row.name,
					pool: shape.pool,
					resource_class: shape.class,
					size: poolSize(shape.pool, shape.class),
					fencing_generation: generation,
					// §5.5: the row was not re-taken from a free pool, it was moved off
					// a dead generation — and the evidence that proved its worker alive
					// rides with it, because that proof is the whole authority for the
					// move (§14.1).
					adopted_from: {
						fencing_generation: row.fencingGeneration,
						run: row.identity?.run ?? null,
						attempt: row.identity?.attempt ?? null,
					},
					adoption: answer.detail ?? null,
				},
			},
		};
	}

	function holdFor(held, lane) {
		const shape = parseCapacitySlot(held.name);
		return slotHold(held, {
			pool: shape.pool,
			resourceClass: shape.class,
			index: shape.index,
			ticket: lane.ticket,
			attempt: lane.answer?.attempt ?? null,
		});
	}

	/**
	 * §15 case 7's release: **compare-and-delete on the token the row itself
	 * carries**, with the probe's evidence riding the record that removes it.
	 * There is no unconditional removal path here either (§4.6), and no clock
	 * anywhere in it.
	 */
	function releaseByProbe(row, answer, at) {
		const shape = parseCapacitySlot(row.name);
		return leases.release(
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
						pool: shape?.pool ?? null,
						resource_class: shape?.class ?? null,
						reason: "reclaimed-by-probe",
						verdict: answer.verdict,
						tests: answer.tests ?? {},
						evidence: answer.detail ?? {},
						// §5.5's *declare dead otherwise* has two halves, and the record
						// says which one this release carried: the attempt whose ending
						// went with it, or null when durable state had already ended it.
						settled_attempt: answer.attempt ?? null,
						held_by: {
							run: row.identity?.run ?? null,
							ticket: row.identity?.ticket ?? null,
							fencing_generation: row.fencingGeneration,
						},
					},
				},
			},
		);
	}

	/** A row nothing settled this pass, described with the verdict that left it. */
	function retain(row, { reason, answer = null }) {
		const verdict = Object.freeze({
			reason,
			verdict: answer?.verdict ?? null,
			tests: answer?.tests ?? null,
			evidence: answer?.detail ?? null,
		});
		retainedVerdicts.set(row.name, verdict);
		return Object.freeze({ ...describeSlot(row, hold.fencingGeneration), ...verdict });
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
		assertActive,
		/** Bounded-rate waits still observe abandon and lease loss during long memo windows. */
		async wait({ ms = 25 } = {}) {
			assertActive();
			for (let remaining = ms; remaining > 0; remaining -= 25) {
				await delay(Math.min(25, remaining));
				assertActive();
			}
		},
		acquireLane,
		acquireModel,
		exhaustion,
		/** All held rows count, including other roles and superseded/adopted lanes. */
		occupancy: () => {
			const held = rows().map((row) => parseCapacitySlot(row.name));
			return plan.classes.map(({ class: className, size }) => Object.freeze({
				class: className, size,
				held: held.filter((row) => row?.pool === POOLS.model && row.class === className).length,
			}));
		},

		/**
		 * The rows occupying an index under a **dead generation** — the slots a
		 * previous controller left behind. They are reported rather than reclaimed,
		 * because §9.4 settles them by probe and §5.3 refuses to settle anything by
		 * reasoning.
		 */
		blocked: () => Object.freeze(supersededRows().map((row) => describeSlot(row, hold.fencingGeneration))),

		/**
		 * §9.4's settlement: **by probing the holder, never by waiting for a
		 * clock** — and §5.5's adoption, which is the same probe's other answer.
		 *
		 * The probe is handed the row's advisory identity and answers §5.5's typed
		 * verdict (`worker/adoption.mjs`). Each row then settles exactly one of
		 * three ways, and the third is what keeps the first two safe:
		 *
		 * - **provable** — a live worker of *this* run, whose lane this controller
		 *   can resume: the row moves onto this controller's generation on the
		 *   predecessor's own token, and the lane comes back as `resumed` (§15
		 *   case 6). Nothing is released and re-taken, because the gap between
		 *   would double-book a resource whose pane is still using it.
		 * - **disproved** — an authoritative negative: the attempt it names is
		 *   settled first, then the row is released **by probe** (§15 case 7). The
		 *   order is what a crash makes visible — a row left behind is re-probed by
		 *   the next controller, while an unfinished attempt nothing names is
		 *   finished by nobody.
		 * - **unanswerable** — Herdr or the filesystem said nothing, so nothing
		 *   moves. That is §12.4's alarm rather than a plausible zero, and the
		 *   run's own report is what carries it (`unsettled`).
		 *
		 * With no probe there is no answer at all, and every row stays exactly as
		 * it is — for the same reason.
		 *
		 * **`adopt` is the preflight's verdict**, and it gates the transfer alone.
		 * A run whose preflight is red, or that has nothing to execute a lane
		 * with, moves no generations: rows transferred to a controller that then
		 * ends without running them would be fenced to a generation that is
		 * superseded the moment it ends, which is exactly the state no successor
		 * can settle. Disproving is not gated — a dead holder is dead whatever
		 * this run is about to do.
		 *
		 * @param {object} [options]
		 * @param {((row: object) => Promise<object>) | null} [options.probe] §5.5's verdict
		 * @param {boolean} [options.adopt] whether this run may take a lane over
		 * @param {((answer: object) => Promise<unknown>) | null} [options.settleAttempt]
		 *   §5.5's *declare dead otherwise*, injected because ending an attempt is
		 *   `worker/lifecycle.mjs`'s write and not this pool's
		 * @param {number} [options.at]
		 */
		async reclaim({ probe = null, adopt = false, settleAttempt = null, at = now() } = {}) {
			const superseded = supersededRows();
			if (probe === null) {
				// Every slot spelled, so the two branches answer the same shape: a
				// caller reading `settled` must not have to tell "nothing was ended"
				// from "this branch does not say" (§11.2).
				return Object.freeze({
					reclaimed: 0,
					adopted: 0,
					resumed: Object.freeze([]),
					settled: Object.freeze([]),
					held: Object.freeze(superseded.map((row) => retain(row, { reason: RETAINED_REASONS.unanswerable }))),
					missing:
						superseded.length === 0
							? null
							: "a §5.5 adoption probe on this call; nothing is settled by reasoning about a row nobody asked about (`worker/adoption.mjs`)",
					spec: "§5.5, §9.4, §14.22",
				});
			}

			const held = [];
			const adoptable = [];
			const settled = new Set();
			let reclaimed = 0;

			for (const row of superseded) {
				const answer = await probe({ slot: row.name, identity: row.identity ?? {}, row, at });

				if (answer.verdict === ADOPTION_VERDICTS.provable) {
					if (!adopt) {
						held.push(retain(row, { reason: RETAINED_REASONS.notExecuting, answer }));
					} else if ((row.identity?.run ?? null) !== run) {
						// A live lane of a run this controller is not driving. §2.1 gives a
						// run one ticket execution per ticket, so there is no lane here to
						// resume it into — and evicting a working pane is what §9.4 refuses.
						held.push(retain(row, { reason: RETAINED_REASONS.otherRun, answer }));
					} else {
						adoptable.push({ row, answer });
					}
					continue;
				}

				if (answer.verdict === ADOPTION_VERDICTS.disproved) {
					// **The attempt first, the row second.** Two rows of one lane name
					// one attempt, so the ending is written once — the projector refuses
					// a second one, and asking it to is an automation failure rather
					// than a settlement (§6.6).
					if (settleAttempt !== null && answer.attempt !== null && !settled.has(answer.attempt)) {
						settled.add(answer.attempt);
						await settleAttempt(answer);
					}

					const removed = releaseByProbe(row, answer, at);
					if (removed) reclaimed += 1;
					else held.push(retain(row, { reason: RETAINED_REASONS.moved, answer }));
					continue;
				}

				held.push(retain(row, { reason: RETAINED_REASONS.unanswerable, answer }));
			}

			const lanes = adoptLanes(adoptable, { at });
			for (const entry of lanes.retained) {
				held.push(retain(entry.row, { reason: entry.reason, answer: entry.answer }));
			}

			return Object.freeze({
				reclaimed,
				adopted: lanes.adopted.length,
				resumed: Object.freeze(lanes.resumed),
				settled: Object.freeze([...settled]),
				held: Object.freeze(held),
				missing: null,
				spec: "§5.5, §9.4, §14.22",
			});
		},

		/**
		 * **What this run is leaving held, and why** — the closing half of §12.4's
		 * alarm, recomputed at the end rather than carried from the reclaim.
		 *
		 * It exists because a retained row's future is not symmetric. Adoption is
		 * gated on the row naming the run this controller drives, so a row left
		 * behind by a run that has now *ended* can never be adopted by anyone: the
		 * only settlement left for it is a later probe disproving it. A run that
		 * ended without saying so would leave an index quietly one short, which is
		 * §9.7's slow run that looks like a busy one.
		 *
		 * @param {{ at?: number }} [options]
		 */
		unsettled({ at = now() } = {}) {
			const rowsHeld = supersededRows().map((row) => {
				const known = retainedVerdicts.get(row.name) ?? null;
				return Object.freeze({
					...describeSlot(row, hold.fencingGeneration),
					reason: known?.reason ?? null,
					verdict: known?.verdict ?? null,
					evidence: known?.evidence ?? null,
					// The operator's actual question: is anything going to pick this up
					// on its own? Only a controller driving the run the row names can
					// adopt it — this run is ending, so its own rows are nobody's to
					// adopt, and the rest depend on whether their run is still open.
					adoptable_by_successor: adoptableLater(row),
				});
			});

			return Object.freeze({
				count: rowsHeld.length,
				rows: Object.freeze(rowsHeld),
				at,
				resolution:
					rowsHeld.length === 0
						? null
						: "a later controller re-probes each row and releases the ones it disproves; the ones marked " +
							"`adoptable_by_successor: false` can be settled no other way, because the run that took them " +
							"is over (§5.5, §9.4)",
				spec: "§5.5, §9.4, §12.4",
			});
		},

		/**
		 * Give back every row this run adopted whose lane never ran.
		 *
		 * A transfer is an ownership claim, and a run that ends without using one
		 * has claimed an index for nothing: its generation is superseded the moment
		 * it ends, and the row would then be unadoptable by anyone. Releasing is
		 * safe precisely because the holds are *this* controller's — the release is
		 * a compare-and-swap on its own token, like every other.
		 *
		 * Lanes that ran gave their slots back in the scheduler's `finally`, and
		 * `release` is idempotent, so this takes nothing from them.
		 *
		 * **It is a backstop, and today's wiring cannot reach it**, which is worth
		 * knowing before deleting it as dead: the transfer is gated on there being
		 * an executor, and the scheduler starts every resumed lane before its loop
		 * head, so every adopted row is a running lane's. What would reach it is a
		 * return between the reclaim and the scheduler, or a scheduler that could
		 * decline a lane — and either would otherwise strand an index silently.
		 *
		 * @param {{ reason?: string, at?: number }} [options]
		 * @returns {number} how many rows this call actually released
		 */
		releaseAdopted({ reason = "adopted-lane-never-ran", at = now() } = {}) {
			return adoptedHolds.filter((slot) => slot.release({ reason, at })).length;
		},

		/** §9.7's numbers, derived from the rows and the journal (`report.mjs`). */
		snapshot: ({ at = now() } = {}) =>
			capacitySnapshot(store, { plan, run, rows: rows(), generation: hold.fencingGeneration, at }),
	});
}

