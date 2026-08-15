import { newUlid } from "../identity/ulid.mjs";
import { FactoryRunError } from "./errors.mjs";
import { describeScope, isScope, sameScope, scopeCovers } from "./scope.mjs";

/**
 * §10.4: recovery and re-entry.
 *
 * > **A restart re-enters an orphaned run, keeping its `run_id`.** Startup
 * > reconcile finds a run not `ended` whose lease is free or expired and adopts
 * > it.
 *
 * Re-entry is not a mode. §5.4 says resume *is* startup, and this is the same
 * idea one level up: there is no `factory resume`, because a verb someone has to
 * remember to type is a verb that gets typed as `start` on the night it matters.
 * One logical delivery fragmented across run ids would also break the monitor's
 * overlay, and §5.5's pane-token worker adoption would be pointless if start
 * always opened a new run.
 *
 * **Everything here runs under the controller lease.** That is what makes the
 * reading trustworthy: only a lease-holder ends a run, so the set of unended runs
 * cannot move while this decides.
 */

/** How this invocation came by its run. */
export const ENTRY_MODES = Object.freeze({
	started: "started",
	adopted: "adopted",
	forced: "forced-new-run",
});

/**
 * Decide which run this controller drives.
 *
 * @param {object} store an open store, read under the controller lease
 * @param {object} invocation
 * @param {object | null} invocation.requested §3.1's selector, or null when the
 *   line carried none — which is a re-entry asking for the run's own scope back
 * @param {boolean} invocation.newRun whether `--new-run` was on the line
 * @param {() => string} [invocation.mint] the run-id source, injectable for tests
 * @returns {Readonly<object>} the mode, the run, its scope, and any run this
 *   invocation is about to end as `controller-lost`
 * @throws {FactoryRunError} `scope-required` · `scope-immutable`
 */
export function decideEntry(store, { requested, newRun, mint = newUlid }) {
	// Oldest first, as the projection orders them: a controller re-entering a
	// repository takes the runs in the order they were started.
	const orphans = store.readUnendedRuns();

	if (newRun) {
		return Object.freeze({
			mode: ENTRY_MODES.forced,
			run: mint(),
			scope: requireScope(requested, "`--new-run` opens a fresh run, and a fresh run declares its scope."),
			adopted: null,
			unadopted: Object.freeze([]),
			// §10.4: `--new-run` ends the abandoned run with `controller-lost` — an
			// observation by a **different** controller, which is what keeps
			// §14.36's never-self-asserted rule true while still closing the run.
			abandon: Object.freeze(orphans.map((row) => row.run_id)),
		});
	}

	const orphan = orphans.find((row) => isScope(row.scope));
	if (orphan !== undefined) {
		requireSameScope(orphan, requested);
		return Object.freeze({
			mode: ENTRY_MODES.adopted,
			run: orphan.run_id,
			// The run's own selector, never the line's: membership is immutable for
			// a run's life (§3.1), so re-entry restores rather than restates.
			scope: Object.freeze(orphan.scope),
			adopted: Object.freeze({ run: orphan.run_id, lifecycle: orphan.lifecycle, started_at: orphan.started_at }),
			abandon: Object.freeze([]),
			// Every other orphan stays exactly as it is. Only a lease-holder ends a
			// run, and ending one this controller is not driving would be asserting
			// something about work it never looked at — so they are reported instead,
			// and `--new-run` is the verb that closes them.
			unadopted: Object.freeze(orphans.filter((row) => row.run_id !== orphan.run_id).map((row) => row.run_id)),
		});
	}

	return Object.freeze({
		mode: ENTRY_MODES.started,
		run: mint(),
		scope: requireScope(
			requested,
			"There is no unended run in this repository to re-enter, so this start declares its own scope.",
		),
		adopted: null,
		abandon: Object.freeze([]),
		unadopted: Object.freeze(orphans.map((row) => row.run_id)),
	});
}

/**
 * §10.4's other half: `factory start` against a **live** lease-holder.
 *
 * > It resolves against the live selector; it does not queue. In scope → print
 * > "already in scope of run *R*, it will be claimed when the frontier reaches
 * > it" and exit `0`. Out of scope → refuse, naming the live run.
 *
 * Queueing would be the private work queue §19 excludes, one indirection down:
 * the tracker is already the queue, and labelling a ticket under the run's
 * parent *is* the enqueue.
 *
 * @param {object} store an open store — a read, taken without the lease
 * @param {object} live the `lease-held` refusal's details: run, pane, generation
 * @param {object | null} requested §3.1's selector, or null
 * @returns {Readonly<object>} what to print, having claimed nothing
 * @throws {FactoryRunError} `run-out-of-scope` · `scope-unresolvable`
 */
export function resolveAgainstLiveRun(store, live, requested) {
	const run = live.run ?? null;
	const row = run === null ? null : store.readRun(run);

	// A controller that has taken the lease and not yet decided its run — the
	// first milliseconds of a start. There is nothing to resolve against yet, and
	// guessing would answer about a selector that does not exist.
	if (row === null || !isScope(row.scope)) {
		throw new FactoryRunError(
			"scope-unresolvable",
			`A controller holds the lease in pane ${live.pane ?? "(unknown)"} but has not recorded its run's ` +
				"scope yet, so this start cannot be resolved against it. Try again in a moment, or read " +
				"`factory status`.",
			{ run, pane: live.pane ?? null, fencing_generation: live.fencing_generation ?? null },
		);
	}

	const covered = scopeCovers(row.scope, requested);

	if (covered === true) {
		return Object.freeze({
			run,
			pane: live.pane ?? null,
			scope: row.scope,
			lifecycle: row.lifecycle,
			message:
				requested === null
					? `Run ${run} is live in pane ${live.pane ?? "(unknown)"}, covering ${describeScope(row.scope)}. ` +
						"This start claimed nothing and opened no second run (§10.4)."
					: `${describeScope(requested)} is already in scope of run ${run}; it will be claimed when ` +
						"the frontier reaches it (§10.4).",
		});
	}

	if (covered === null) {
		throw new FactoryRunError(
			"scope-unresolvable",
			`Run ${run} is live over ${describeScope(row.scope)}, and whether ${describeScope(requested)} ` +
				"belongs to it is a `Part of #N` question on the tracker (§3.1) that this package cannot ask " +
				"yet — the tracker scope and eligibility reader is #100. Refusing rather than guessing: an " +
				'optimistic "already in scope" would promise a frontier that never reaches it.',
			{
				run,
				pane: live.pane ?? null,
				live_scope: row.scope,
				requested,
				missing: "the tracker scope reader (#100)",
				spec: "§3.1, §10.4",
			},
		);
	}

	throw new FactoryRunError(
		"run-out-of-scope",
		`Run ${run} holds the controller lease in pane ${live.pane ?? "(unknown)"} over ` +
			`${describeScope(row.scope)}, which does not cover ${describeScope(requested)}. A run's ` +
			"membership is immutable for its life (§3.1), and start does not queue — wait for run " +
			`${run} to drain, or widen the scope on a later run.`,
		{ run, pane: live.pane ?? null, live_scope: row.scope, requested },
	);
}

function requireScope(requested, because) {
	if (requested !== null) return requested;
	throw new FactoryRunError(
		"scope-required",
		`${because} Usage: \`factory start <ticket…>\` or \`factory start --parent <issue>\`.`,
		{ at: "scope" },
	);
}

/**
 * A scope restated on re-entry has to be the run's own. §3.1 makes membership
 * immutable for a run's life precisely because the monitor derives structure
 * from it, and a widening selector reads as structure changing underneath.
 */
function requireSameScope(orphan, requested) {
	if (requested === null || sameScope(orphan.scope, requested)) return;

	throw new FactoryRunError(
		"scope-immutable",
		`Run ${orphan.run_id} is not ended and covers ${describeScope(orphan.scope)}; re-entering it ` +
			`with ${describeScope(requested)} would widen a membership that is immutable for the run's ` +
			"life (§3.1). Re-enter it with `factory start` alone, or end it and open a fresh run with " +
			"`--new-run`.",
		{ run: orphan.run_id, live_scope: orphan.scope, requested },
	);
}
