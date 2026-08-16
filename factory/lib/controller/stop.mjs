import { EXIT_OK, EXIT_REFUSED } from "../cli/exit-codes.mjs";
import { CONTROLLER_LEASE, RUN_LIFECYCLE } from "../domain/vocabulary.mjs";
import { runStream } from "../state/events.mjs";
import { hasLapsed, openLeases } from "../state/leases.mjs";
import { openStore } from "../state/store.mjs";

/**
 * `factory stop` (§10.5).
 *
 * > **`stop` writes a durable stop-request record** carrying §4.5's actor
 * > slot, polled by the controller at ticket boundaries. It works from any
 * > terminal without finding a pid, survives arrival mid-phase, needs no
 * > signal-handler reentrancy inside an async scheduler, and **makes
 * > `draining` visible to the monitor the moment it is *requested*** rather
 * > than when the phase ends.
 *
 * The record is the interface. There is deliberately no pid here and no
 * signal: the controller polls its own run's stream, and a request written to
 * a run that is not yet driven is honoured by the controller that drives it
 * next — a stop that had to find its target's process would be a stop that
 * misses a controller mid-restart, which is exactly the window §10.4 exists
 * to cover.
 *
 * **The verb never takes the lease and never moves a lifecycle.** The request
 * is an operator fact on the run's stream; the draining is the controller's
 * own transition, written under its token. A stop that raced the controller
 * for the lease would refuse precisely when the controller is alive — the
 * moment the operator most needs it to land.
 *
 * Escalation: a second `stop` — or a SIGTERM, or a second Ctrl-C, which the
 * controller records itself — supersedes the pending stop with
 * `run.abandon-requested`. The two are different records because they leave
 * the world in different states (§13.A): one lets the in-flight lanes reach
 * their terminal disposition, the other marks them `released`.
 */

/** §4.5's actor slot for this verb: the operator's `stop`, through its process. */
const ACTOR = "operator:stop";

/**
 * §10.5's escalation ladder, shared by every writer of a request: this verb,
 * and the controller's own signal path, which records the very same records.
 *
 * The ladder is a decision about **the sequence of requests**, never about the
 * invocation making them: a Ctrl-C is the second stop request on a run that
 * already holds one, whatever process pressed it. `base` is what the writer
 * would record first — `stop` for the verb and for SIGINT, `abandon` for
 * SIGTERM, which is the escalation rather than a stop.
 *
 * @param {{ kind: string, seq: number } | null} latest the run's latest request, if any
 * @param {"stop" | "abandon"} base
 * @returns {{ kind: string, supersedes: number | null } | null} the record to append, or null when nothing is left to record
 */
export function requestLadder(latest, base) {
	if (latest !== null && latest.kind === "run.abandon-requested") return null;
	if (latest !== null) return { kind: "run.abandon-requested", supersedes: latest.seq };
	return {
		kind: base === "abandon" ? "run.abandon-requested" : "run.stop-requested",
		supersedes: null,
	};
}

/** The closed set this verb's refusals draw from. */
export const STOP_ERROR_REASONS = Object.freeze([
	/** No run in this repository to stop. */
	"no-run",
	/**
	 * The live holder has not recorded its run yet — the first milliseconds of
	 * a start, or a run whose `run.started` has not committed. Refuse rather
	 * than guess: §10.4's own answer for a selector it cannot read is the
	 * refusal, never the optimistic target.
	 */
	"run-unresolvable",
	/** The run the holder names is already ended; a stop for it is nowhere to poll. */
	"run-ended",
	/** Unended runs exist but nothing names which one to address. */
	"run-ambiguous",
]);

export class FactoryStopError extends Error {
	/**
	 * @param {string} reason one of STOP_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details]
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!STOP_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown stop error reason "${reason}".`);
		}
		this.name = "FactoryStopError";
		this.reason = reason;
		this.details = details;
	}
}

/**
 * @param {object} invocation
 * @param {string} invocation.repoRoot
 * @param {string | null} [invocation.agentDir]
 * @param {() => number} [invocation.now] the verb's clock, injectable for tests
 * @returns {Promise<{ message: string, report: object, exitCode: number } | { error: object, exitCode: number }>}
 */
export async function runStop({ repoRoot, agentDir = null, now = Date.now }) {
	const store = await openStore({ repoRoot, agentDir });

	try {
		const row = openLeases(store).inspect(CONTROLLER_LEASE);
		const live = row !== null && !hasLapsed(row, now());

		const target = resolveTarget(store, { row, live });
		if (target.error !== undefined) return refusal(target.error);

		const { runId, run, pane } = target;
		const requests = operatorRequests(store, runId);
		const latest = latestRequest(requests);
		const decision = requestLadder(latest, "stop");

		let action;
		let record = null;
		let message;

		if (decision === null) {
			// §13.A: abandon and stop are different records and different
			// endings. The escalation is already on the stream; a third stop
			// appends nothing, because a second `run.abandon-requested` would
			// be a duplicate fact with a later sequence — noise the monitor
			// would have to ignore.
			action = "abandon-already-requested";
			message =
				`Run ${runId} was already asked to abandon by ${latest.payload.actor} ` +
				`(record ${latest.seq}); it ends "abandoned" when its controller reaches the next ` +
				`ticket boundary. Nothing more to record.`;
		} else if (decision.kind === "run.abandon-requested") {
			const at = now();
			store.append({
				kind: decision.kind,
				source: "operator",
				run: runId,
				occurredAt: at,
				observedAt: at,
				payload: { actor: ACTOR, supersedes: decision.supersedes },
			});
			action = "abandon-escalated";
			record = { kind: decision.kind };
			message =
				`Escalated to abandon for run ${runId}: in-flight ticket executions are marked ` +
				`released, and worker panes are left alive for the next reconcile. It ends ` +
				`"abandoned" at the next ticket boundary — the controller never closes a pane (§13.B).`;
		} else {
			const at = now();
			store.append({
				kind: decision.kind,
				source: "operator",
				run: runId,
				occurredAt: at,
				observedAt: at,
				payload: { actor: ACTOR },
			});
			action = "stop-requested";
			record = { kind: decision.kind };
			message = live
				? `Stop requested for run ${runId}: it drains at the next ticket boundary and every ` +
					"in-flight ticket execution finishes. A second `stop` escalates to abandon."
				: `Stop requested for run ${runId}. No live controller is polling it right now; the ` +
					`request is durable, so the next controller to enter the run honours it. A second ` +
					"`stop` escalates to abandon.";
		}

		return {
			message,
			report: {
				run: runId,
				pane,
				lifecycle: run.lifecycle,
				live,
				action,
				record,
				requests: requests.map(requestReport),
			},
			exitCode: EXIT_OK,
		};
	} finally {
		store.close();
	}
}

/**
 * What the verb may address: the run the live holder names, or — when no
 * lease row exists at all — the one unended run the repository holds.
 *
 * A lapsed lease is not "no controller": its row is still the repository's
 * record of which run a controller was driving, and a stop written to that
 * run is honoured by whoever drives it next. What the lapsed row cannot do is
 * answer "is it live", and the report says `live: false` rather than guess.
 */
function resolveTarget(store, { row, live }) {
	if (row !== null) {
		const runId = row.identity?.run ?? null;

		if (runId === null) {
			return {
				error: new FactoryStopError(
					"run-unresolvable",
					`A controller holds the lease in pane ${row.identity?.pane ?? "(unknown)"} but has ` +
						"not recorded its run yet. Try again in a moment, or read `factory status`.",
					{ pane: row.identity?.pane ?? null, fencing_generation: row.fencingGeneration },
				),
			};
		}

		const run = store.readRun(runId);
		if (run === null) {
			return {
				error: new FactoryStopError(
					"run-unresolvable",
					`The live controller names run ${runId}, but its record does not exist yet. ` +
						"Try again in a moment, or read `factory status`.",
					{ run: runId },
				),
			};
		}

		if (run.lifecycle === RUN_LIFECYCLE.ended) {
			return {
				error: new FactoryStopError(
					"run-ended",
					`Run ${runId} already ended ${run.end_reason}; there is no controller left to ` +
						"poll a stop for it.",
					{ run: runId, end_reason: run.end_reason },
				),
			};
		}

		return { runId, run, pane: row.identity?.pane ?? null };
	}

	const orphans = store.readUnendedRuns();
	if (orphans.length === 0) {
		return {
			error: new FactoryStopError(
				"no-run",
				"There is no run in this repository to stop; `factory status` shows the recent ones.",
			),
		};
	}
	if (orphans.length > 1) {
		return {
			error: new FactoryStopError(
				"run-ambiguous",
				`This repository holds ${orphans.length} unended runs and nothing names which one to ` +
					"address: " +
					orphans.map((run) => run.run_id).join(", ") +
					". A controller may be starting; try again in a moment.",
				{ runs: orphans.map((run) => run.run_id) },
			),
		};
	}

	return { runId: orphans[0].run_id, run: orphans[0], pane: null };
}

/**
 * The run stream's operator requests, oldest first: §10.5's stop and its
 * escalation, read from durable state rather than memory, which is what makes
 * a request written before a controller existed — or by a process it cannot
 * see — honoured rather than lost.
 */
export function operatorRequests(store, runId) {
	return store
		.readEvents({ stream: runStream(runId) })
		.filter((event) => event.kind === "run.stop-requested" || event.kind === "run.abandon-requested");
}

/** The latest of a run's operator requests — the one §10.5's ladder counts — or null. */
export function latestRequest(requests) {
	return requests.length === 0 ? null : requests[requests.length - 1];
}

/** A request as both the journal and the operator read it: never the internals. */
export function requestReport(event) {
	return { kind: event.kind, actor: event.payload.actor, at: event.occurred_at, seq: event.seq };
}

function refusal(error) {
	return { error: { kind: error.reason, message: error.message, ...error.details }, exitCode: EXIT_REFUSED };
}
