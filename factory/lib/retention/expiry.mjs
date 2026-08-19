import { deleteArtifactBlob } from "../artifacts/blobs.mjs";
import { artifactBytesByClass, artifactBytesByRun, tombstoneArtifact } from "../artifacts/ledger.mjs";
import { RUN_LIFECYCLE } from "../domain/vocabulary.mjs";
import { deleteRunEffects } from "../effects/records.mjs";
import { HEARTBEAT_STREAM, RUN_STREAM_PREFIX, runStream, sourceForActor } from "../state/events.mjs";
import { clearDerivedProjections } from "../state/projections.mjs";
import { deleteStreamWhole, truncateStreamFront } from "../state/truncation.mjs";
import { tierOneHorizon } from "./horizon.mjs";
import { pinsForRun } from "./pins.mjs";

/**
 * §12's subtractive half: **the two tiers, applied**.
 *
 * > Expiry is horizon-driven, fully derivable from durable state, and safe
 * > unattended — the controller applies it.
 *
 * Three properties hold this file together, and each is load-bearing:
 *
 * - **Purely subtractive** (§12.3). The tier-2 digest is maintained continuously
 *   as a projection, so nothing here writes the history it is about to delete.
 *   Building the digest at expiry time would make a bug in this file the way
 *   history is irrecoverably lost, and would put the one operation that deletes
 *   and the one operation that first records in the same place.
 * - **Derivation and execution are two functions.** `planExpiry` writes nothing,
 *   so `doctor` (§14.24) and #118's `cleanup-plan` read the same numbers a run
 *   would act on, from the same code — the two verbs cannot disagree about what
 *   is reclaimable.
 * - **Nothing here reads a size.** §12.10 is explicit: a byte ceiling fires at a
 *   moment nobody chose and its first victims are the largest runs, which are
 *   disproportionately the failed ones an operator is still reading. Bytes are
 *   *reported* by the plan and are not an input to it (§14.30).
 *
 * **Never on a timer, never mid-run** (§12.6, §14.30): the only callers are
 * `factory start`, once per invocation between reconcile and preflight, and
 * #118's `cleanup-execute`, which already holds the lease. There is no interval
 * in this file and no scheduling of one.
 */

/**
 * Why a run beyond the horizon is still here. Two answers, and neither is a
 * fourth pin: `live` is §12.6's "never mid-run" — a run whose lifecycle has not
 * reached `ended` is either this invocation's own or an orphan a re-entry will
 * adopt, and deleting either's stream destroys state something is about to read.
 */
export const HELD_REASONS = Object.freeze({ pinned: "pinned", live: "live" });

/**
 * What expiry *would* do, from durable state alone. It writes nothing.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ retention: { fullDetailRuns: number, fullDetailDays: number }, at?: number }} options
 * @returns {Readonly<object>} the plan, and the byte accounting §12.10 reports beside it
 */
export function planExpiry(store, { retention, at = Date.now() }) {
	const accounting = retentionAccounting(store, { retention, at });
	const horizon = tierOneHorizon(store.readRunDigests(), retention, { at });

	const expiring = [];
	const held = [];

	for (const run of store.readRetainedRuns()) {
		if (horizon.members.has(run.run_id)) continue;

		if (run.lifecycle !== RUN_LIFECYCLE.ended) {
			held.push(Object.freeze({ run: run.run_id, reason: HELD_REASONS.live, pins: Object.freeze([]) }));
			continue;
		}

		const pins = pinsForRun(store, run.run_id);
		if (pins.length > 0) {
			held.push(Object.freeze({ run: run.run_id, reason: HELD_REASONS.pinned, pins }));
			continue;
		}

		const artifacts = store.read((db) => reclaimableArtifacts(db, run.run_id));
		expiring.push(
			Object.freeze({
				run: run.run_id,
				ended_at: run.ended_at,
				artifact_count: artifacts.length,
				bytes: artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
			}),
		);
	}

	return Object.freeze({
		...accounting,
		spec: "§12.3, §12.4, §12.6",
		expiring: Object.freeze(expiring),
		held: Object.freeze(held),
		reclaimable_bytes: expiring.reduce((total, entry) => total + entry.bytes, 0),
	});
}

/**
 * §12.10's half on its own: **bytes per retention class and per run, and the
 * horizon they are measured against** — with no pin evaluated.
 *
 * `status` reports exactly this and no more. §12.10 gives `status` and `doctor`
 * the byte accounting and gives *`cleanup-plan`* the reclaimable number, and the
 * split is not only editorial: deciding what is reclaimable means asking every
 * over-horizon run whether a pin holds it, which is several queries per run
 * against the tracker's observed facts. `status` is the lock-free read an
 * operator runs against a live run (§10.5), and it should not pay for an answer
 * it is not asked to give.
 *
 * **Accounting reports and never triggers** (§12.10, §14.30). Nothing that reads
 * this value feeds it back into the horizon.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ retention: { fullDetailRuns: number, fullDetailDays: number }, at?: number }} options
 * @returns {Readonly<object>}
 */
export function retentionAccounting(store, { retention, at = Date.now() }) {
	const horizon = tierOneHorizon(store.readRunDigests(), retention, { at });

	return Object.freeze({
		at,
		horizon: Object.freeze({
			runs: horizon.runs,
			days: horizon.days,
			cutoff_at: horizon.cutoff_at,
			count_boundary: horizon.count_boundary,
			// How many runs the horizon itself admits. Pinned runs are kept *past*
			// it and are counted in a plan's `held` instead, because "the horizon
			// covers 20 runs" and "23 runs still have detail" are different facts,
			// and an operator reading one as the other would think a pin had lapsed.
			tier_one: horizon.members.size,
		}),
		bytes: Object.freeze({
			by_class: artifactBytesByClass(store),
			by_run: artifactBytesByRun(store),
		}),
	});
}

/**
 * Apply the plan, under the controller lease (§12.6).
 *
 * Each run goes in **one transaction**: its artifacts tombstoned, its effect
 * rows dropped, its derived projections cleared, its stream deleted, and
 * `run.expired` appended on the `controller` stream — because deleting a run's
 * stream cannot be recorded inside it (§12.2). The compare on the lease token is
 * inside that transaction too: destroying a run's history after the lease moved
 * on would take the successor's evidence with it.
 *
 * **The blobs are unlinked after the transaction commits, never before.** The
 * ledger row is the record: a crash in between leaves a tombstoned row whose
 * bytes are still on disk, which resolves to the *correct* answer —
 * `unavailable(retention-expired)`, dated (§12.5) — and is reclaimed by the next
 * pass, which re-attempts every tombstone. Unlinking first would invert that: the
 * bytes would be gone while the row still claimed them, and the digest would
 * resolve as `blob-missing`, the answer that means "something swept evidence a
 * pin should have held".
 *
 * That is also why the unlink is **not an effect**. §4.5's pair exists for
 * mutations the database cannot know the outcome of; this one is a file beside
 * `state.db` whose absence is checkable at any moment for free, and whose intent
 * and outcome the ledger row already records. An `artifact-delete` pair keyed by
 * the run would be a record of the deletion *inside the thing being deleted*, and
 * keyed repo-scoped it would put two permanent journal records per artifact on the
 * stream §12.2 keeps low-volume on purpose. `artifact-delete` stays what the
 * catalogue says it is: cleanup's, for the orphaned blobs that have no row at all
 * (§12.8).
 *
 * @param {object} store an open controller store
 * @param {object} options
 * @param {{ fullDetailRuns: number, fullDetailDays: number }} options.retention §12.10's two numbers
 * @param {object} options.hold the controller-lease hold (`controller/lease-guard.mjs`)
 * @param {number} [options.at]
 * @param {string} [options.actor]
 * @returns {Readonly<object>} what the plan proposed and what this pass did
 */
export function applyExpiry(store, { retention, hold, at = Date.now(), actor = "controller" }) {
	const plan = planExpiry(store, { retention, at });

	const expired = plan.expiring.map((entry) =>
		hold.transaction((tx) => expireRun(tx, entry, { at, actor })),
	);

	// After the runs, because "wherever tier 1 currently starts" is a fact about
	// the streams that survived this pass — one knob rather than a horizon of the
	// heartbeat stream's own (§12.2).
	const truncated = hold.transaction((tx) => truncateHeartbeats(tx, { at, actor }));

	// Every tombstone, not only this pass's: a row whose blob outlived a crash is
	// indistinguishable from one whose blob this pass just tombstoned, and one
	// unlink attempt each is what makes the crash window self-healing with no
	// second table to keep in step.
	//
	// The gate is re-read first. The unlink is the one step of this pass that is
	// not inside a token-checked transaction — a file has no transaction to be in
	// — so this is what keeps §12.6's "under the controller lease" true of the
	// whole pass rather than of the database half of it.
	hold.assertMayIssueEffects();
	const reclaimed = reclaimTombstonedBlobs(store);

	return Object.freeze({
		ran: true,
		spec: "§12.6",
		at,
		horizon: plan.horizon,
		expired: Object.freeze(expired),
		held: plan.held,
		reclaimed_bytes: expired.reduce((total, entry) => total + entry.bytes_reclaimed, 0),
		blobs_removed: reclaimed,
		heartbeat: truncated,
	});
}

/**
 * One run's whole tier-1 footprint, inside the caller's transaction.
 *
 * The order is the order a reader needs it in: the ledger first, because the
 * counts it produces are what `run.expired` carries; the stream last but one,
 * because everything above still reads from it; and the record last, on the
 * stream that survives.
 */
function expireRun(tx, entry, { at, actor }) {
	// Re-read inside the transaction rather than trusting the plan's numbers: the
	// record is of what this transaction did, and a payload carrying a count taken
	// before the write would be the journal asserting something it did not observe.
	const artifacts = reclaimableArtifacts(tx.db, entry.run);
	for (const artifact of artifacts) tombstoneArtifact(tx, artifact, { at });
	const bytes = artifacts.reduce((total, artifact) => total + artifact.bytes, 0);

	const effects = deleteRunEffects(tx, { run: entry.run });
	const projections = clearDerivedProjections(tx.db, entry.run);
	const { deleted } = deleteStreamWhole(tx, { stream: runStream(entry.run) });

	tx.appendEvent({
		kind: "run.expired",
		source: sourceForActor(actor),
		occurredAt: at,
		observedAt: at,
		payload: { run_id: entry.run, bytes_reclaimed: bytes, artifact_count: artifacts.length, at },
	});

	return Object.freeze({
		run: entry.run,
		bytes_reclaimed: bytes,
		artifact_count: artifacts.length,
		events_deleted: deleted,
		effects_deleted: effects,
		projections_cleared: Object.freeze(projections),
	});
}

/**
 * §12.2: heartbeats front-truncate to **the tier-1 boundary**, so "was the
 * controller alive at time T" stays answerable for exactly the runs whose detail
 * still exists — never longer, never shorter.
 *
 * The boundary is a sequence rather than a time (§14.37): the first record of
 * the oldest run stream still present. With no run streams at all there is no
 * tier-1 start to truncate to, and nothing is truncated — an empty repository is
 * not a reason to start deleting the only record that it was ever up.
 */
function truncateHeartbeats(tx, { at, actor }) {
	// The prefix is a module constant with no `LIKE` metacharacter in it, so there
	// is nothing here to escape and no caller who could put one in.
	const boundary = tx.db
		.prepare("SELECT MIN(seq) AS seq FROM event WHERE stream LIKE ?")
		.get(`${RUN_STREAM_PREFIX}%`).seq;
	if (boundary === null) return Object.freeze({ truncated: 0, up_to_seq: null, boundary_seq: null });

	// `truncateStreamFront` refuses to retain nothing — front-truncating a stream
	// empty would let the next append silently restart at genesis. Asking first
	// keeps that refusal for the callers it is about rather than making a repository
	// whose heartbeats all predate its oldest run into an error.
	const retained = tx.db
		.prepare("SELECT COUNT(*) AS beats FROM event WHERE stream = ? AND seq >= ?")
		.get(HEARTBEAT_STREAM, boundary).beats;
	if (retained === 0) return Object.freeze({ truncated: 0, up_to_seq: null, boundary_seq: boundary });

	const front = truncateStreamFront(tx, { stream: HEARTBEAT_STREAM, throughSeq: boundary - 1, at, actor });
	return Object.freeze({ truncated: front.deleted, up_to_seq: front.upToSeq, boundary_seq: boundary });
}

/**
 * The blobs a run's expiry reclaims: its own, not yet tombstoned.
 *
 * The ledger stamps a row with its **most recent** producer, so bytes two runs
 * produced identically belong to the later one and are reclaimed exactly once,
 * by that run's expiry — which is what lets §12.1 carry no reference counting at
 * all. Repo-scoped artifacts carry no run and are `permanent` (§12.2); no run's
 * expiry ever names them.
 */
function reclaimableArtifacts(db, run) {
	return db
		.prepare("SELECT algorithm, digest, bytes FROM artifact WHERE run_id = ? AND expired_at IS NULL ORDER BY digest")
		.all(run);
}

/**
 * One unlink attempt per tombstoned row.
 *
 * A tombstone says the bytes are gone; this is what makes that true, and
 * re-attempting every row is what heals a crash between the transaction and the
 * unlink. It costs a `stat` and an `unlink` per artifact the repository has ever
 * expired, once per controller invocation. If that ever stops being free, the
 * upgrade is a column on the row recording that its blob was reclaimed — not a
 * grace period, which is §12.8's rejected stale-plan clock in another costume.
 */
function reclaimTombstonedBlobs(store) {
	const tombstoned = store.read((db) =>
		db.prepare("SELECT algorithm, digest FROM artifact WHERE expired_at IS NOT NULL").all(),
	);

	return tombstoned.filter((address) => deleteArtifactBlob(store.storeDir, address)).length;
}
