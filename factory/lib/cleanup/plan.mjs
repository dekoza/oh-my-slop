import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { listArtifactBlobs } from "../artifacts/blobs.mjs";
import { recordedArtifactAddresses } from "../artifacts/ledger.mjs";
import { FACTORY_ATTEMPT_TOKEN, FACTORY_RUN_TOKEN } from "../controller/herdr-control.mjs";
import { RUN_LIFECYCLE } from "../domain/vocabulary.mjs";
import { runGit } from "../git/clone.mjs";
import { FactoryGitError } from "../git/errors.mjs";
import {
	attemptBranch,
	attemptWorktreePath,
	baselinesRoot,
	baselineWorktreePath,
	FACTORY_BRANCH_PREFIX,
	privateClonePath,
	worktreesRoot,
} from "../git/isolation.mjs";
import { pinsForRun } from "../retention/pins.mjs";
import { canonicalJson, digest } from "../state/events.mjs";
import { ordinalOf, runOf, ticketOf } from "../worker/attempt.mjs";
import {
	CLEANUP_KINDS,
	CLEANUP_SKIPS,
	cleanupOperand,
	DEFAULT_CLEANUP_KINDS,
	OPERATION_BY_KIND,
	PRIVATE_CLONE_KIND,
} from "./targets.mjs";

/**
 * §12.8's derivation: **what cleanup would reclaim, and what it will not.**
 *
 * It writes nothing and takes no lease, because `cleanup-plan` is read-only and
 * always permitted (§10.5) — an operator asking what is reclaimable must be able
 * to ask it while a run is live. `cleanup-execute` calls the same function under
 * the lease and refuses unless the digest still matches, so **the plan an
 * operator reviewed and the plan that executes come from one derivation** and
 * cannot disagree about what is in it.
 *
 * Three properties hold this file together:
 *
 * - **The world is the source, the journal is the judge.** Every candidate is
 *   enumerated from what actually exists — worktrees registered in the private
 *   clone, refs under `factory/`, panes carrying a factory token, blobs on disk —
 *   and durable state then decides whether it may go. Deriving candidates from
 *   the journal instead would make a run whose tier-1 detail expired unreclaimable
 *   forever: expiry deletes the record, and a planner that could only see records
 *   would never look at the worktree again.
 * - **Terminality, never liveness** (§12.8). A plan entry derives from the
 *   attempt having ended, because the hard-stop path deliberately orphans worker
 *   panes — "the pane exists" must never read as "work in progress", or the one
 *   path that leaves the most litter is the one path that can never be cleaned.
 * - **Cleanup obeys the same pins as expiry** (§12.4). A failed attempt's
 *   worktree and unpushed branch are the only copy of that work, so they survive
 *   exactly as long as the evidence explaining them does — one `pinsForRun`, so
 *   "the run is still in full detail" and "its forensic artifacts still exist" can
 *   never disagree.
 */

/** How many entries a `git status --porcelain` read counts before it stops. */
const STATUS_LINE_LIMIT = 10_000;

/**
 * Derive a plan.
 *
 * @param {object} store an open store, read-only or controller
 * @param {object} options
 * @param {{ run: string | null, kinds: ReadonlyArray<string> }} options.scope what the operator asked for
 * @param {object | null} [options.herdr] the Herdr control surface; `null` when the
 *   multiplexer is unavailable, which makes the pane kinds unanswerable rather
 *   than empty — "absent" and "unanswerable" are different facts (§12.4)
 * @param {Function} [options.git] the git runner, injected as everywhere else
 * @param {number} [options.at]
 * @returns {Promise<Readonly<object>>}
 */
export async function planCleanup(store, { scope, herdr = null, git = runGit, at = Date.now() }) {
	const kinds = new Set(scope.kinds ?? DEFAULT_CLEANUP_KINDS);
	const verdicts = runVerdicts(store);
	const clone = await openCloneReads(store.storeDir, git);

	const targets = [];
	const skips = [];
	const unanswerable = [];

	const collect = (found) => {
		for (const entry of found.targets ?? []) targets.push(entry);
		for (const entry of found.skips ?? []) skips.push(entry);
		for (const entry of found.unanswerable ?? []) unanswerable.push(entry);
	};

	const worktrees = clone.available ? await clone.worktrees() : [];
	const retainedWorktrees = new Set();

	if (kinds.has(CLEANUP_KINDS.attemptWorktree)) {
		collect(await planAttemptWorktrees(store, { scope, verdicts, clone, worktrees, retainedWorktrees }));
	}
	if (kinds.has(CLEANUP_KINDS.baselineWorktree)) {
		collect(await planBaselineWorktrees(store, { scope, clone, worktrees }));
	}
	if (kinds.has(CLEANUP_KINDS.attemptBranch)) {
		collect(await planAttemptBranches(store, { scope, verdicts, clone, retainedWorktrees }));
	}
	if (kinds.has(CLEANUP_KINDS.workerPane) || kinds.has(CLEANUP_KINDS.controllerPane)) {
		collect(await planPanes(store, { scope, kinds, verdicts, herdr }));
	}
	if (kinds.has(CLEANUP_KINDS.orphanedBlob)) {
		collect(planOrphanedBlobs(store, { scope }));
	}
	if (kinds.has(PRIVATE_CLONE_KIND)) {
		collect(planPrivateClone(store, { scope, verdicts, clone, worktrees }));
	}

	const plan = Object.freeze({
		spec: "§12.8",
		at,
		scope: Object.freeze({ run: scope.run ?? null, kinds: Object.freeze([...kinds]) }),
		targets: Object.freeze(targets.map(freezeTarget)),
		skips: Object.freeze(skips.map((entry) => Object.freeze(entry))),
		// A kind nothing could answer about is neither a target nor a skip: saying
		// "no panes to reclaim" when the multiplexer would not answer is the
		// fail-open §12.4 rejects everywhere else.
		unanswerable: Object.freeze(unanswerable.map((entry) => Object.freeze(entry))),
		held: heldRuns(verdicts, scope),
		reclaimable_bytes: targets.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
	});

	return Object.freeze({ ...plan, digest: planDigest(plan) });
}

/**
 * §10.5's staleness test, and the reason it is a digest rather than a clock:
 *
 * > A TTL either expires a still-correct plan or blesses a stale one.
 *
 * It covers **whatever the plan actually contains** (§12.8) — its scope, its
 * targets, and its skips — so a narrowed plan is a first-class plan rather than a
 * subset of a bigger one, and a worktree that grew an untracked file between
 * reviewing and executing moves from one list to the other and invalidates the
 * digest.
 *
 * What it deliberately leaves out is every *measurement*: byte counts and the
 * untracked/modified tallies. Those change when a build runs in a worktree that
 * was already going to be retained, and re-deriving a different number is not the
 * operator's decision changing under them. `unanswerable` is out for the same
 * reason it exists — a multiplexer that answered this time adds targets or
 * skips, and those are what move the digest.
 *
 * @param {object} plan
 * @returns {string}
 */
function planDigest(plan) {
	return digest(
		canonicalJson({
			scope: plan.scope,
			targets: plan.targets.map((entry) => ({
				kind: entry.kind,
				operation: entry.operation,
				operand: entry.operand,
				subject: entry.subject,
			})),
			skips: plan.skips.map((entry) => ({ kind: entry.kind, subject: entry.subject, reason: entry.reason })),
		}),
	);
}

// ── The kinds ────────────────────────────────────────────────────────────────

/**
 * §12.8's first kind: **attempt worktrees under the factory-private clone.**
 *
 * Enumerated from the clone's own worktree list rather than from the directory
 * tree, so a path git no longer knows about is not something this plans to
 * `worktree remove`; and filtered to the attempts root, so nothing outside §7.1's
 * topology is ever a candidate.
 */
async function planAttemptWorktrees(store, { scope, verdicts, clone, worktrees, retainedWorktrees }) {
	const targets = [];
	const skips = [];
	const root = worktreesRoot(store.storeDir);

	for (const worktree of worktrees) {
		const attempt = leafUnder(root, worktree.worktree);
		if (attempt === null) continue;
		// The path is re-derived from the identity and compared, so a worktree
		// registered at a path §2.1's containment would not have produced is not a
		// candidate at all.
		if (safePath(() => attemptWorktreePath(store.storeDir, attempt)) !== worktree.worktree) continue;

		const run = runOf(attempt);
		if (run === null || ordinalOf(attempt) === null) continue;
		if (scope.run !== null && run !== scope.run) continue;

		const verdict = attemptVerdict(store, verdicts, attempt);
		if (!verdict.eligible) {
			retainedWorktrees.add(attempt);
			skips.push(skip(CLEANUP_KINDS.attemptWorktree, attempt, verdict));
			continue;
		}

		// §14.26, and the reason there is no `--force`: this is the only copy of
		// whatever a worker left behind, and a flag that switched the check off
		// would be a guard with an off switch.
		const dirty = await clone.dirty(worktree.worktree);
		if (dirty.dirty) {
			retainedWorktrees.add(attempt);
			skips.push(retainedWork(CLEANUP_KINDS.attemptWorktree, attempt, worktree.worktree, dirty));
			continue;
		}

		targets.push({
			kind: CLEANUP_KINDS.attemptWorktree,
			subject: attempt,
			attempt,
			run,
			ticket: ticketOf(attempt),
			path: worktree.worktree,
			bytes: directoryBytes(worktree.worktree),
			basis: verdict.basis,
		});
	}

	return { targets, skips };
}

/**
 * §12.8's fifth kind: **`doctor --baseline` throwaway worktrees.**
 *
 * They belong to no run — `doctor` appends nothing to the journal in either mode
 * (§14.24), so there is no record of one to read — which is exactly why §7.1
 * hangs them off a root of their own. The root is the whole classification.
 *
 * The untracked-work guard applies here as it does to an attempt worktree,
 * because §14.26 is written over *a whitelisted worktree* and this is one. In
 * practice it retains the red ones: a green baseline's worktree is deleted
 * eagerly (§12.7), and a red one is precisely what an operator wants to `cd`
 * into, so a check run's leftovers keeping it is the same answer §12.7 already
 * gives for a different reason.
 */
async function planBaselineWorktrees(store, { scope, clone, worktrees }) {
	// A baseline belongs to no run, so a run-narrowed plan contains none: the
	// alternative is a `--run` that quietly widens to things the run never made.
	if (scope.run !== null) return {};

	const targets = [];
	const skips = [];
	const root = baselinesRoot(store.storeDir);

	for (const worktree of worktrees) {
		const execution = leafUnder(root, worktree.worktree);
		if (execution === null) continue;
		if (safePath(() => baselineWorktreePath(store.storeDir, execution)) !== worktree.worktree) continue;

		const dirty = await clone.dirty(worktree.worktree);
		if (dirty.dirty) {
			skips.push(retainedWork(CLEANUP_KINDS.baselineWorktree, execution, worktree.worktree, dirty));
			continue;
		}

		targets.push({
			kind: CLEANUP_KINDS.baselineWorktree,
			subject: execution,
			baseline: execution,
			path: worktree.worktree,
			bytes: directoryBytes(worktree.worktree),
		});
	}

	return { targets, skips };
}

/**
 * §12.8's second kind: **local `factory/t<ticket>/a<attempt>` branches.**
 *
 * Local, inside a disposable private clone — §12.7 is explicit that reclaiming
 * one is not "touching a published branch" (§14.12), and the published branch of
 * an open PR is held anyway, by the pin its run carries.
 *
 * A branch whose worktree is retained is retained with it. Git refuses to delete
 * a branch that is checked out, so planning it would be planning a refusal — and
 * the honest reason is the worktree's, not a git error message.
 */
async function planAttemptBranches(store, { scope, verdicts, clone, retainedWorktrees }) {
	if (!clone.available) return {};

	const targets = [];
	const skips = [];

	for (const branch of await clone.factoryBranches()) {
		const attempt = attemptOfBranch(branch);
		if (attempt === null) continue;

		const run = runOf(attempt);
		if (run === null) continue;
		if (scope.run !== null && run !== scope.run) continue;

		const verdict = attemptVerdict(store, verdicts, attempt);
		if (!verdict.eligible) {
			skips.push(skip(CLEANUP_KINDS.attemptBranch, branch, verdict));
			continue;
		}

		if (retainedWorktrees.has(attempt)) {
			skips.push({
				kind: CLEANUP_KINDS.attemptBranch,
				subject: branch,
				reason: CLEANUP_SKIPS.worktreeRetained,
				message: `retained: ${branch} is checked out in a worktree this plan retains`,
			});
			continue;
		}

		targets.push({
			kind: CLEANUP_KINDS.attemptBranch,
			subject: branch,
			branch,
			run,
			ticket: ticketOf(attempt),
			attempt,
			bytes: null,
			basis: verdict.basis,
		});
	}

	return { targets, skips };
}

/**
 * §12.8's third and fourth kinds: **worker panes, and the controller's own pane
 * from a finished run.**
 *
 * Both are enumerated **by token**, which is §14.27 made structural rather than
 * checked: there is no shape of this function that can reach a pane the factory
 * did not stamp, whatever any record says. A pane id read back from a journal
 * entry would not have that property — Herdr reuses ids, and the recorded one
 * may since have become somebody else's terminal.
 */
async function planPanes(store, { scope, kinds, verdicts, herdr }) {
	// "Absent" and "unanswerable" are different facts (§12.4), and both ways of
	// not getting an answer — no multiplexer at all, and one that refused —
	// produce the same entry: the pane kinds in scope, reported as unanswered.
	const unanswered = (message) => ({
		unanswerable: [CLEANUP_KINDS.workerPane, CLEANUP_KINDS.controllerPane]
			.filter((kind) => kinds.has(kind))
			.map((kind) => ({ kind, reason: "herdr-unavailable", message })),
	});

	if (herdr === null) {
		return unanswered(
			"Herdr did not answer, so no pane is a target in this plan: an unanswered multiplexer " +
				"means this process learned nothing, which is not the same as there being no panes (§5.2, §12.4).",
		);
	}

	const listed = await herdr.panes();
	if (!listed.ok) return unanswered(listed.message);

	const targets = [];
	const skips = [];

	for (const pane of listed.panes) {
		const attempt = pane?.tokens?.[FACTORY_ATTEMPT_TOKEN] ?? null;
		const run = pane?.tokens?.[FACTORY_RUN_TOKEN] ?? null;

		if (attempt !== null && kinds.has(CLEANUP_KINDS.workerPane)) {
			const owner = runOf(attempt);
			if (owner === null) continue;
			if (scope.run !== null && owner !== scope.run) continue;

			const verdict = attemptVerdict(store, verdicts, attempt);
			if (!verdict.eligible) {
				skips.push({ ...skip(CLEANUP_KINDS.workerPane, attempt, verdict), pane: pane.pane_id });
				continue;
			}

			targets.push({
				kind: CLEANUP_KINDS.workerPane,
				subject: attempt,
				attempt,
				run: owner,
				ticket: ticketOf(attempt),
				pane: pane.pane_id,
				bytes: null,
				basis: verdict.basis,
			});
			continue;
		}

		if (run !== null && kinds.has(CLEANUP_KINDS.controllerPane)) {
			if (scope.run !== null && run !== scope.run) continue;

			const verdict = runVerdictOf(store, verdicts, run);
			if (!verdict.eligible) {
				skips.push({ ...skip(CLEANUP_KINDS.controllerPane, run, verdict), pane: pane.pane_id });
				continue;
			}

			targets.push({
				kind: CLEANUP_KINDS.controllerPane,
				subject: run,
				run,
				pane: pane.pane_id,
				bytes: null,
				basis: verdict.basis,
			});
		}
	}

	return { targets, skips };
}

/**
 * §12.8's sixth kind: **orphaned artifact blobs.**
 *
 * > Orphaned blobs need no TTL. `cleanup-execute` holds the controller lease, so
 * > no controller is writing; under that lease a blob with no committed ledger
 * > row is unambiguously a crash leftover. A grace period here would be the
 * > rejected stale-plan clock all over again.
 *
 * A **tombstoned** row is not an orphan. Its blob's absence is what the tombstone
 * already asserts, and reclaiming it is expiry's own re-attempt (§12.5) — the row
 * is the record, and a second mechanism deleting the same bytes would be two
 * records of one deletion.
 */
function planOrphanedBlobs(store, { scope }) {
	// A blob belongs to a run only through its ledger row, and an orphan has
	// none. Narrowing by run therefore cannot include one without inventing a
	// producer for bytes nothing recorded.
	if (scope.run !== null) return {};

	const recorded = recordedArtifactAddresses(store);

	return {
		targets: listArtifactBlobs(store.storeDir)
			.filter((blob) => !recorded.has(`${blob.algorithm}:${blob.digest}`))
			.map((blob) => ({
				kind: CLEANUP_KINDS.orphanedBlob,
				subject: `${blob.algorithm}:${blob.digest}`,
				address: Object.freeze({ algorithm: blob.algorithm, digest: blob.digest }),
				bytes: blob.bytes,
			})),
	};
}

/**
 * §12.8's non-default target: **the factory-private bare clone.**
 *
 * Reachable only by naming it, and refused while anything still lives in it. A
 * clone deleted out from under a registered worktree takes work with it that the
 * other five kinds would have refused to touch one at a time, so the guard is the
 * union of theirs: no worktrees registered, and no run held by a pin or still
 * live.
 */
function planPrivateClone(store, { scope, verdicts, clone, worktrees }) {
	if (scope.run !== null) return {};

	if (!clone.available) {
		return {
			skips: [
				{
					kind: PRIVATE_CLONE_KIND,
					subject: clone.dir,
					reason: CLEANUP_SKIPS.cloneInUse,
					message: `nothing to reclaim: there is no factory-private clone at ${clone.dir}`,
				},
			],
		};
	}

	const held = [...verdicts.values()].filter((verdict) => !verdict.eligible);
	if (worktrees.length > 0 || held.length > 0) {
		return {
			skips: [
				{
					kind: PRIVATE_CLONE_KIND,
					subject: clone.dir,
					reason: CLEANUP_SKIPS.cloneInUse,
					worktrees: worktrees.length,
					runs_held: held.length,
					message:
						`retained: ${clone.dir} — ${worktrees.length} worktree(s) registered, ${held.length} run(s) held. ` +
						"Re-cloning is expensive and its deletion is never routine (§12.8).",
				},
			],
		};
	}

	return {
		targets: [{ kind: PRIVATE_CLONE_KIND, subject: clone.dir, path: clone.dir, bytes: directoryBytes(clone.dir) }],
	};
}

// ── Eligibility ──────────────────────────────────────────────────────────────

/**
 * Every run's verdict, computed once.
 *
 * `pinsForRun` is several queries per run against the observed tracker facts, and
 * a plan asks about each run as many times as it has resources. Computing them
 * once is not only cheaper: it is what stops one plan from containing two
 * answers about the same run, which is how a worktree gets reclaimed while the
 * branch beside it is retained.
 */
function runVerdicts(store) {
	const verdicts = new Map();

	for (const run of store.readRetainedRuns()) {
		if (run.lifecycle !== RUN_LIFECYCLE.ended) {
			verdicts.set(run.run_id, frozenVerdict({ eligible: false, reason: CLEANUP_SKIPS.liveRun, run: run.run_id }));
			continue;
		}

		const pins = pinsForRun(store, run.run_id);
		verdicts.set(
			run.run_id,
			pins.length > 0
				? frozenVerdict({ eligible: false, reason: CLEANUP_SKIPS.pinned, run: run.run_id, pins })
				: frozenVerdict({ eligible: true, basis: "ended-unpinned", run: run.run_id }),
		);
	}

	return verdicts;
}

/**
 * One run's verdict, including the runs the map has never heard of.
 *
 * A run with no tier-1 row either **expired** — which only an ended, unpinned run
 * can do (§12.6, §12.4), so the pins have already been evaluated and released —
 * or never committed a `run.started` at all, which is a crash before the run
 * existed. Both are eligible, and the basis says which so an operator reading a
 * plan can tell a reclamation from an orphan.
 */
function runVerdictOf(store, verdicts, run) {
	const known = verdicts.get(run);
	if (known !== undefined) return known;

	return frozenVerdict({
		eligible: true,
		basis: store.readRunDigest(run) === null ? "unrecorded-run" : "expired-run",
		run,
	});
}

/**
 * An attempt's verdict: its run's, and then its own **terminality** (§12.8).
 *
 * Terminality is read from `attempt.ended`'s outcome and from nothing else — not
 * from whether a pane is alive, because §13.B's hard stop deliberately orphans
 * worker panes, and not from the run being over, because a run can end while a
 * lane is abandoned mid-flight.
 *
 * An attempt whose run has no tier-1 detail has no attempt row either. It is
 * terminal by the run's own arithmetic: a run does not end with a live attempt,
 * and only an ended run reaches either of the states `runVerdictOf` admits.
 */
function attemptVerdict(store, verdicts, attempt) {
	const run = runOf(attempt);
	const verdict = runVerdictOf(store, verdicts, run);
	if (!verdict.eligible || verdict.basis !== "ended-unpinned") return verdict;

	const row = store.readAttempts({ runId: run }).find((entry) => entry.attempt_id === attempt);
	if (row === undefined) {
		return frozenVerdict({ eligible: true, basis: "unrecorded-attempt", run, attempt });
	}
	if (row.outcome === null) {
		return frozenVerdict({ eligible: false, reason: CLEANUP_SKIPS.liveAttempt, run, attempt });
	}

	return frozenVerdict({ eligible: true, basis: "attempt-ended", run, attempt, outcome: row.outcome });
}

/**
 * The runs cleanup left alone, and why — the same shape `planExpiry` answers
 * with, because it is the same question about the same pins and an operator
 * comparing the two reports should not have to translate.
 */
function heldRuns(verdicts, scope) {
	return Object.freeze(
		[...verdicts.values()]
			.filter((verdict) => !verdict.eligible)
			.filter((verdict) => scope.run === null || verdict.run === scope.run)
			.map((verdict) => Object.freeze({ run: verdict.run, reason: verdict.reason, pins: verdict.pins ?? [] })),
	);
}

function frozenVerdict(verdict) {
	return Object.freeze({ pins: [], basis: null, reason: null, attempt: null, ...verdict });
}

/**
 * §14.26's skip, in the sentence §12.8 dictates: `retained: <path> — N
 * untracked, M modified files`.
 *
 * One function for both worktree kinds, because the message is the operator's
 * contract rather than each kind's own wording — a second spelling is what makes
 * one of the two stop naming the counts, which is the whole reason the skip
 * exists.
 */
function retainedWork(kind, subject, path, dirty) {
	return {
		kind,
		subject,
		reason: CLEANUP_SKIPS.uncommittedWork,
		path,
		untracked: dirty.untracked,
		modified: dirty.modified,
		message: `retained: ${path} — ${dirty.untracked} untracked, ${dirty.modified} modified files`,
	};
}

function skip(kind, subject, verdict) {
	return {
		kind,
		subject,
		reason: verdict.reason,
		run: verdict.run,
		pins: verdict.pins,
		message: skipMessage(kind, subject, verdict),
	};
}

function skipMessage(kind, subject, verdict) {
	if (verdict.reason === CLEANUP_SKIPS.pinned) {
		return `retained: ${subject} — run ${verdict.run} is pinned by ${verdict.pins.map((pin) => pin.pin).join(", ")} (§12.4)`;
	}
	if (verdict.reason === CLEANUP_SKIPS.liveRun) {
		return `retained: ${subject} — run ${verdict.run} has not ended (§12.6)`;
	}
	return `retained: ${subject} — attempt ${verdict.attempt ?? subject} has no recorded outcome (§12.8)`;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The clone's read surface, or a handle that says it is not there.
 *
 * It deliberately does **not** go through `openPrivateClone`: that function
 * creates the clone when it is missing and converges its remote, which is a
 * mutation, and `cleanup-plan` is read-only and always permitted (§10.5). A
 * repository with no clone yet answers "nothing to reclaim" rather than acquiring
 * one to look inside.
 */
async function openCloneReads(storeDir, git) {
	const dir = privateClonePath(storeDir);

	let available = false;
	try {
		available = existsSync(dir) && (await git(["rev-parse", "--is-bare-repository"], { cwd: dir })) === "true";
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		available = false;
	}

	return Object.freeze({
		dir,
		available,

		async worktrees() {
			const listed = await git(["worktree", "list", "--porcelain"], { cwd: dir });
			return Object.freeze(
				listed
					.split("\n")
					.filter((line) => line.startsWith("worktree "))
					.map((line) => Object.freeze({ worktree: line.slice("worktree ".length) }))
					.filter((entry) => entry.worktree !== dir),
			);
		},

		/**
		 * Local branches in the factory's own namespace, and only those — §14.11's
		 * "no ref outside `factory/` and `refs/factory/*`" is a rule about writing,
		 * and this is the reading half that keeps a reclamation plan inside it.
		 */
		async factoryBranches() {
			const listed = await git(
				["for-each-ref", "--format=%(refname:short)", `refs/heads/${FACTORY_BRANCH_PREFIX}`],
				{ cwd: dir },
			);
			return Object.freeze(listed === "" ? [] : listed.split("\n"));
		},

		/**
		 * §14.26's guard, counted rather than answered yes/no: the operator's next
		 * question after "why did bytes not drop" is what is in there.
		 *
		 * `--untracked-files=all` because a collapsed directory entry would report
		 * one untracked file where there are two hundred, and the number is the
		 * whole point of the message. Ignored files are still ignored — a build
		 * cache the repository itself declares disposable is not a worker's work.
		 */
		async dirty(path) {
			const status = await git(["status", "--porcelain", "--untracked-files=all"], { cwd: path });
			const lines = status === "" ? [] : status.split("\n").slice(0, STATUS_LINE_LIMIT);
			const untracked = lines.filter((line) => line.startsWith("??")).length;

			return Object.freeze({
				untracked,
				modified: lines.length - untracked,
				dirty: lines.length > 0,
			});
		},
	});
}

/**
 * Every file under a path, summed.
 *
 * Symlinks are counted as links rather than followed: a worktree that symlinks a
 * node_modules elsewhere would otherwise report bytes reclaiming it will not
 * free, and following one out of the tree is the path escape §2.1 spends its
 * effort making unexpressible.
 */
function directoryBytes(path) {
	let total = 0;

	const walk = (current) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			// A directory that vanished between listing and walking contributes the
			// bytes it is worth now, which is none. §12.10 accounts and never
			// triggers, so an approximate number here changes no decision.
			return;
		}

		for (const entry of entries) {
			const child = join(current, entry.name);
			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				walk(child);
				continue;
			}
			try {
				total += lstatSync(child).size;
			} catch {
				/* gone since the listing; see above */
			}
		}
	};

	walk(path);
	return total;
}

// ── Small shared readings ────────────────────────────────────────────────────

/** The single path segment directly under `root`, or null when it is not one. */
function leafUnder(root, path) {
	if (!path.startsWith(`${root}/`)) return null;
	const leaf = path.slice(root.length + 1);
	return leaf === "" || leaf.includes("/") ? null : leaf;
}

/** The attempt a `factory/t<ticket>/a<attempt>` branch names, or null. */
function attemptOfBranch(branch) {
	const match = /^factory\/t([1-9][0-9]*)\/a(.+)$/.exec(branch);
	if (match === null) return null;

	const attempt = match[2];
	// Rebuilt and compared rather than trusted, so a hand-made ref that merely
	// looks like one cannot name an attempt it does not belong to (§7.3).
	return safePath(() => attemptBranch({ ticket: Number.parseInt(match[1], 10), attempt })) === branch ? attempt : null;
}

/**
 * A derivation whose refusal is an answer. Every one of these asks *"is this the
 * name the factory would have produced?"*, and "no, that identity is not even
 * well-formed" is the same answer as "no, it produces a different name".
 */
function safePath(derive) {
	try {
		return derive();
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		return null;
	}
}


/**
 * A target, with the §4.5 pair it will be performed as attached.
 *
 * The operation and the operand are derived **here**, once, from the fields the
 * planner already filled — never re-derived at execute time from a subject
 * string. A plan whose digest is computed over one spelling and executed against
 * another would make §14.25's whole comparison decorative.
 */
function freezeTarget(target) {
	return Object.freeze({ ...target, operation: OPERATION_BY_KIND[target.kind], operand: cleanupOperand(target) });
}
