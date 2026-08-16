import { CHECK_RESULTS, PHASE_IMPLEMENT, PHASE_INTEGRATE, PHASE_VERIFY } from "../domain/vocabulary.mjs";
import { effectKey } from "../effects/keys.mjs";
import { effectByKey } from "../effects/records.mjs";
import {
	adoptRebasedHead,
	assessIntegration,
	openIntegrationWorktree,
	preserveEvidence,
	pushAttemptBranch,
	REBASE_RESULTS,
	rebaseAttempt,
	reclaimAttemptWorktree,
	releaseIntegrationWorktree,
} from "../git/integrate.mjs";
import { FactoryGitError } from "../git/errors.mjs";
import { LEASE_NAMES } from "../state/leases.mjs";
import { createTurnstile } from "../state/turnstile.mjs";
import { publishPullRequest, pullTitle, renderPullBody } from "../tracker/pulls.mjs";
import { writeAttestation } from "./attestation.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { verifyPhase } from "./phases.mjs";
import { stageResults } from "./stages.mjs";

/**
 * §7.5's integration and §9.5's serialization, composed — **the two phase
 * executors a lane hands `walkStages` for `verify` and `integrate`.**
 *
 * **The integration lease is acquired twice, and the gap between them is the
 * point.** §9.5: holding one lease across the agent-borne review phase would
 * serialize every lane on a model call, which is the standard way a lock
 * destroys the throughput it was added to protect. So:
 *
 * ```
 * verify:    [ lease ] fetch → evidence ref → rebase → run the required set [ release ]
 * review:    (no lease at all — two model calls, one per axis)
 * integrate: [ lease ] base still the same? → predicates → push → PR [ release ]
 * ```
 *
 * **The rebase is in `verify`, not in `integrate`, and that is what makes
 * §8.2's invariant literally true**: the checks always run at the post-rebase
 * commit that will be pushed, with no conditional re-check path bolted on for
 * the case where the base moved. §14.13 falls out of it rather than being
 * enforced somewhere.
 *
 * **`integrate` re-acquires under a base-commit identity precondition.** If the
 * base moved while the review was running — the only way it ever moves is a
 * human merge, since the factory pushes branches and never the default ref —
 * the loop goes back and re-rebases and re-verifies, **consuming no budget**,
 * because nothing failed. That is §15's case 10, and it is the reason this is a
 * loop rather than a check.
 *
 * **Only the controller integrates.** Nothing here takes a worker, a pane, or a
 * model; every step is git, the tracker, or the project's own commands.
 */

/**
 * How many times §9.5's compare-and-publish loop will re-rebase before giving
 * up, and **why it is a code constant rather than a knob**.
 *
 * It is not configuration: nobody tunes "how many times may a human merge while
 * I am publishing". It is the point at which *the base keeps moving* stops being
 * a race and starts being a fact about the repository — a repository under
 * continuous merge, where an unbounded loop would hold the integration lease
 * indefinitely and report nothing, which is the throughput failure §9.5 exists
 * to prevent arriving from the other direction. Policy that is not configuration
 * lives in code and is read from exactly one place.
 *
 * There is deliberately **no parameter and no default** for it. §11.2's rule is
 * that a value the code fills in for a caller who forgot is a policy nobody can
 * read on disk; a default here would be one nothing can read anywhere.
 */
export const MAX_BASE_MOVES = 3;

/**
 * §7.7's lease is a **row and an in-process turn**, and it needs both.
 *
 * The row is the durable fact — fenced, probeable, and what reconcile finds
 * after a crash — but a row alone answers "somebody else has it" with a refusal,
 * and a lane meeting that refusal would fail an integration for a reason that is
 * not a failure. The turnstile is what makes a second lane **wait** instead.
 *
 * It is this module's own, never shared with `checks/run.mjs`'s: those are two
 * different exclusions, and one queue serving both would make every integration
 * wait behind an unrelated suite.
 */
const serialized = createTurnstile();

/**
 * Run `work` holding the `integration` lease, and give it up however `work`
 * ends.
 *
 * Release is in a `finally` because every way out of an integration — a typed
 * outcome, a refusal, a crash in a git call — leaves the next lane needing the
 * lease, and the one that is **not** released here is the one a process death
 * leaves behind, which §4.6 settles by fencing rather than by a clock.
 */
async function underIntegrationLease(leases, { hold, run, ticket, attempt, span }, work) {
	return serialized(async () => {
		const held = leases.acquire({
			name: LEASE_NAMES.integration,
			identity: { run, ticket, attempt, span },
			// §9.4: fenced to the **controller's** generation, not one of its own, so
			// a row a superseded controller took is recognisable as superseded
			// whenever it was taken.
			fencedTo: hold.fence().generation,
		});

		try {
			return await work();
		} finally {
			leases.release(held);
		}
	});
}

/**
 * §8.1's `verify` phase, as §9.5 composes it: **rebase onto the fresh base, then
 * run the full declared set at the result.**
 *
 * The evidence ref is written **before** the rebase and only when there is a
 * rebase to do — §7.5's "before a destructive rebase", read literally, since a
 * base that has not moved makes nothing destructive.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle
 * @param {object} context
 * @param {object} context.hold the controller's hold
 * @param {object} context.leases the §4.6 registry
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt
 * @param {string} context.branch the attempt branch
 * @param {string} context.baseCommit the attempt's **own** base (§7.3)
 * @param {string} context.baseBranch the default branch to fetch
 * @param {ReadonlyArray<object>} context.checks the validated `checks` block
 * @param {Record<string, string | undefined>} [context.env]
 * @param {string} context.actor
 * @param {() => number} context.now
 * @returns {Promise<Readonly<{ outcome: string, detail: Readonly<object> }>>}
 *   §8.10's `verify` row: `passed` · `failed` · `unrunnable` · `rebase-conflict`
 */
export async function integrationVerify(store, clone, context) {
	return underIntegrationLease(context.leases, { ...context, span: "rebase+verify" }, () =>
		rebaseAndVerify(store, clone, context),
	);
}

/**
 * The half of §7.5 that runs under the first lease, and again under the second
 * whenever the base moved. **One function, so the two can never disagree about
 * what "verified" means** — which is the whole of §14.13.
 */
async function rebaseAndVerify(store, clone, { hold, run, ticket, attempt, branch, baseCommit, baseBranch, checks, env, actor, now }) {
	const fresh = await clone.fetchBase({ baseBranch });
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	let evidence = null;
	if (fresh.commit !== baseCommit) {
		evidence = await preserveEvidence(store, clone, {
			hold,
			run,
			ticket,
			attempt,
			head: opened.head,
			actor,
			at: now(),
		});
	}

	const rebased = await rebaseAttempt(clone, { worktreePath: opened.path, baseCommit, onto: fresh.commit });
	if (rebased.result === REBASE_RESULTS.conflict) {
		// The worktree is left where it is (§12.7): a conflict is exactly when an
		// operator wants to `cd` in and see what would not replay.
		return answer("rebase-conflict", {
			base_commit: fresh.commit,
			previous_base: baseCommit,
			head: rebased.head,
			conflicts: rebased.conflicts,
			evidence_ref: evidence?.ref ?? null,
			worktree: opened.path,
		});
	}

	// The branch adopts the rebased result under compare-and-swap, so what is
	// verified is what the branch is — and §7.4's later identity check compares
	// the push against a branch, not against a detached head only this step saw.
	await adoptRebasedHead(clone, { branch, from: opened.head, to: rebased.head });

	const verified = await verifyPhase(checks, { cwd: opened.path, ...(env === undefined ? {} : { env }), now });
	// The commit list only when there is something to publish: a red set stops
	// here, and reading the range would be work whose answer nobody uses. The
	// worktree stays either way — §9.5's second lease publishes from it on the
	// green path, and §12.7 retains it on the red one.
	const commits =
		verified.outcome === CHECK_RESULTS.passed
			? (await assessIntegration(clone, { worktreePath: opened.path, baseCommit: fresh.commit, head: rebased.head, run, ticket }))
					.commits
			: [];

	return answer(verified.outcome, {
		...verified.detail,
		base_commit: fresh.commit,
		previous_base: baseCommit,
		head: rebased.head,
		rebased: rebased.result === REBASE_RESULTS.rebased,
		evidence_ref: evidence?.ref ?? null,
		evidence_sha: evidence?.sha ?? null,
		commits,
		worktree: opened.path,
	});
}

/**
 * §8.1's `integrate` phase: §9.5's compare-and-publish, then §7.5's steps 4–6.
 *
 * The loop runs at most `MAX_BASE_MOVES` times, and hitting the bound files as
 * `push-failed` — which §8.10 retries on the automation budget, because the
 * publication did not happen and nothing about the work is implicated.
 *
 * **`branch` is the *builder* attempt's branch, and it is passed rather than
 * derived.** §7.3 derives the branch from the attempt that built the work, and
 * `attempt` is the one the walk is on. #146 settles that those are the same
 * attempt on the live path — an automation retry of this phase mints nothing,
 * because `integrate` has no worker (§8.8), so the walk re-enters under the
 * attempt it is already on. The branch stays a parameter because the two are
 * different facts: deriving it here would be this phase forming a second opinion
 * about which attempt owns the work it is publishing, and §7.5's publication
 * effects are keyed by the branch for exactly that reason.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle
 * @param {object} context everything `integrationVerify` takes, plus:
 * @param {object} context.reader a `createGiteaReader` client
 * @param {object} context.writer a `createGiteaWriter` client
 * @param {string} context.ticketTitle the ticket's own title (§7.5)
 * @param {string | null} [context.packageRevision] §11.7's pinned revision
 * @returns {Promise<Readonly<{ outcome: string, detail: Readonly<object> }>>}
 *   §8.10's `integrate` row: `integrated` · `rebase-conflict` · `predicate-failed`
 *   · `push-failed` · `integration-red`
 */
export async function integratePublish(store, clone, context) {
	const { hold, leases, run, ticket, attempt, branch } = context;

	// What the verify phase attested, read from the record rather than passed in:
	// §14.13 makes the attested commit a fact of durable state, and a caller's
	// copy of it is a second opinion about which commit was measured.
	let verified = attestedByVerify(store, { run, ticket, attempt });

	// **§9.5's loop is skipped whole when the publication already landed**, and
	// the phase goes straight to the steps that follow the push (§14.12: a
	// published branch is never touched again). A re-entry that went into the loop
	// would find the base had moved — a human *merging this very PR* moves it —
	// and would rebase and re-verify a branch that is already out there, meeting
	// §4.5's refusal only after the rewrite.
	//
	// It skips the loop and **not** the publication: the sweep §7.5 owes and
	// §12.7's reclamation both come after the PR is created, so a crash between
	// them and the resolution is exactly what a re-entry exists to finish. Nothing
	// in `publish` fetches, rebases, or moves a ref; every mutation in it is an
	// effect that has already resolved or has not happened yet.
	if (publicationLanded(store, { run, ticket, branch })) {
		return underIntegrationLease(leases, { hold, run, ticket, attempt, span: "integrate+publish" }, () =>
			publish(store, clone, { ...context, verified }),
		);
	}

	for (let pass = 1; ; pass += 1) {
		const settled = await underIntegrationLease(leases, { hold, run, ticket, attempt, span: "integrate+publish" }, async () => {
			// §9.5's precondition, asked **while holding the lease**: the base commit
			// the verified commit sits on is still the remote's tip.
			const fresh = await clone.fetchBase({ baseBranch: context.baseBranch });
			if (fresh.commit === verified.baseCommit) {
				return publish(store, clone, { ...context, verified });
			}

			if (pass >= MAX_BASE_MOVES) {
				return answer("push-failed", {
					problem: `the base moved on ${pass} consecutive passes, so the compare-and-publish loop stopped`,
					base_commit: fresh.commit,
					verified_base: verified.baseCommit,
					passes: pass,
				});
			}

			// §15's case 10: re-rebase and re-verify, **consuming no budget**, because
			// nothing failed — the base only ever moves by a human merge.
			return Object.freeze({ reverify: await rebaseAndVerify(store, clone, { ...context, baseCommit: verified.baseCommit }) });
		});

		if (settled.reverify === undefined) return settled;

		const outcome = reverified(settled.reverify);
		if (outcome !== null) return outcome;
		verified = attestedBy(settled.reverify.detail);
	}
}

/**
 * What a re-verify inside §9.5's loop means for the `integrate` phase, or `null`
 * when it means "carry on and publish this instead".
 *
 * A red set here is **`integration-red`**, not `predicate-failed`: §7.4's
 * integration-side predicates are controller faults — a damaged diff, a
 * mis-pushed sha — while this is two changes that each pass alone and do not
 * compose. §8.6 says product-level outcomes never trip the circuit breaker, and
 * filing it as an automation fault would stop a run over infrastructure that is
 * working perfectly.
 */
function reverified({ outcome, detail }) {
	if (outcome === CHECK_RESULTS.passed) return null;
	if (outcome === "rebase-conflict") return answer("rebase-conflict", detail);

	return answer("integration-red", {
		...detail,
		problem:
			`the required set is ${outcome} at ${detail.head}, the result of rebasing onto a base that moved during ` +
			"review. The branch was green at its own base; the two changes do not compose (§8.3's baseline-red, one " +
			"phase later).",
	});
}

/**
 * §7.5's steps 4–6, under the second lease and the precondition it was taken
 * for: the predicates, the push, the pull request, and §8.7's attestation.
 *
 * The order is the one a crash makes safe. The attestation is written **before**
 * the push, because it is content-addressed and immutable and a re-entry
 * recomputes the same digest — while a PR body naming a digest nothing wrote
 * would be a link to nothing. The push comes next, then the PR, so the branch a
 * pull request names always exists.
 */
async function publish(store, clone, context) {
	const { hold, run, ticket, attempt, branch, baseBranch, verified, actor, now } = context;

	// No worktree: every predicate is a question about commits and trees, which
	// the bare clone answers — and that is what lets a re-entry after a success
	// that already reclaimed the worktree re-derive the same verdict (§7.7).
	const predicates = await assessIntegration(clone, {
		baseCommit: verified.baseCommit,
		head: verified.head,
		run,
		ticket,
	});
	if (!predicates.pushable) {
		// Retained (§12.7): the branch is unpushed, so the worktree and it are the
		// only copy, and a human is about to be asked to look at both.
		return answer("predicate-failed", {
			reason: predicates.reason,
			detail: predicates.detail,
			untrailed: predicates.untrailed,
			head: verified.head,
			base_commit: verified.baseCommit,
		});
	}

	const attested = writeAttestation(store, {
		hold,
		actor,
		at: now(),
		run,
		ticket,
		attempt,
		publishedCommit: verified.head,
		branch,
		baseCommit: verified.baseCommit,
		packageRevision: context.packageRevision ?? null,
		checks: verified.checks,
		integration: {
			rebased: verified.rebased ?? null,
			evidence_ref: verified.evidenceRef ?? null,
			// **The verified list, not the one just re-derived.** §14.13 wants the
			// attestation and the push to name the same commits, and they are two
			// consumers of one fact — so they read one value. Attesting a freshly
			// computed range while pushing the recorded one would be two answers to
			// "which commits were measured", which is the second opinion this
			// module's own `attestedByVerify` exists to refuse.
			commits: [...verified.commits],
		},
	});

	try {
		await pushAttemptBranch(store, clone, {
			hold,
			run,
			ticket,
			branch,
			head: verified.head,
			verifiedCommits: verified.commits,
			actor,
			at: now(),
		});
	} catch (error) {
		// **Only the two failures this phase has a word for are classified; every
		// other one escapes.**
		//
		// §7.4's identity check refusing — the branch is not the commits
		// verification attested — is an integration-side predicate, and §8.10 gives
		// a `predicate-failed` no retry, because retrying would push the same
		// unattested branch. A remote that would not take a branch it agrees with
		// says nothing about the work, and that is the automation retry.
		//
		// Everything else is rethrown, and the two that make the difference
		// concrete are why: §4.5's `effect-payload-conflict` is §14.12's
		// *enforcement* — a second head offered for a published branch — and
		// catching it as `push-failed` would hand that row an automation retry;
		// and a lost lease or a superseded generation is terminal under §14.6,
		// where the answer is to stop issuing effects and exit 6, never to retry.
		if (!(error instanceof FactoryGitError)) throw error;
		if (error.reason !== "identity-mismatch" && error.reason !== "git-command-failed") throw error;

		const predicateFailure = error.reason === "identity-mismatch";
		return answer(predicateFailure ? "predicate-failed" : "push-failed", {
			problem: error.message,
			reason: error.reason,
			...(predicateFailure ? { ...error.details } : {}),
			head: verified.head,
		});
	}

	const published = await publishPullRequest(store, {
		reader: context.reader,
		writer: context.writer,
		hold,
		run,
		ticket,
		attempt,
		branch,
		baseBranch,
		title: pullTitle({ ticket, title: context.ticketTitle }),
		body: renderPullBody({
			identity: { run, ticket, attempt },
			base_commit: verified.baseCommit,
			package_revision: context.packageRevision ?? null,
			branch,
			head: verified.head,
			evidence: evidenceOf(attested.reference),
			attestation: {
				algorithm: attested.reference.algorithm,
				digest: attested.reference.digest,
				bytes: attested.reference.bytes,
			},
			summary: attested.summary,
			// §8.7: advisory findings surfaced here, blocking findings never.
			advisory: attested.document.review.advisory,
		}),
		at: now(),
	});

	// §12.7: on integrated success **both** worktrees go eagerly — the branch is
	// pushed, so neither holds anything unique — and the local branch becomes
	// cleanup-eligible, which §12.8's planner acts on rather than this step. The
	// attempt's own is the effect, because it is the one that was the only copy
	// of a worker's work right up until the push landed.
	await releaseIntegrationWorktree(clone, { path: verified.worktree });
	const reclaimed = await reclaimAttemptWorktree(store, clone, { hold, run, ticket, attempt, actor, at: now() });

	return answer("integrated", {
		pr: { number: published.pull.number, url: published.pull.url },
		superseded: published.superseded,
		head: verified.head,
		base_commit: verified.baseCommit,
		branch,
		attestation: { algorithm: attested.reference.algorithm, digest: attested.reference.digest },
		summary: attested.summary,
		advisory: attested.document.review.advisory,
		worktrees_reclaimed: [verified.worktree, reclaimed.path],
		branch_cleanup_eligible: true,
	});
}

/**
 * §7.5's "evidence links" in the PR body: the attestation's own reference, which
 * is what every other digest in this ticket execution hangs off. The full
 * per-artifact list lives in §8.9's disposition block, which reads this ticket
 * execution's artifact-write effects — and duplicating it here would be a second
 * derivation of one list.
 */
function evidenceOf(reference) {
	return [{ role: "attestation", algorithm: reference.algorithm, digest: reference.digest, bytes: reference.bytes }];
}

/**
 * What the `verify` stage attested for this attempt, or a refusal naming the
 * gap.
 *
 * §14.15 makes `integrate` reachable only through a passing verify, so a missing
 * record is a composition defect rather than a state to handle — and publishing
 * on a caller's word about what was checked is the one thing §14.16 forbids.
 */
function attestedByVerify(store, { run, ticket, attempt }) {
	// One reader and one shape. **This attempt's own passing verify, or the ticket
	// execution's most recent one.** The first is the live answer: #146 settles
	// that §8.10's `integrate × push-failed` retry mints no attempt, so the walk
	// re-enters this phase under the attempt that verified. The fallback is kept
	// because it is the right answer to the question either way — an automation
	// retry rebuilds nothing (§8.5), so a caller walking `integrate` under some
	// other attempt is still publishing the commit this execution verified, and
	// refusing it as though nothing had been verified is the opposite of what
	// happened. §7.4's identity compare at the push is what holds the pair honest.
	const passed = stageResults(store, { run, ticket, phase: PHASE_VERIFY }).filter(
		(record) => record.outcome === CHECK_RESULTS.passed,
	);
	const recorded = passed.find((record) => record.attempt === attempt) ?? passed.at(-1) ?? null;

	if (typeof recorded?.detail?.head !== "string") {
		throw new FactoryPipelineError(
			"phase-unwired",
			`Ticket execution ${run}/${ticket} has no passing verify stage to publish from (§14.15). The integrate phase ` +
				"is reachable only through one, and taking the commit or the check results on a caller's word instead is " +
				"exactly what §14.16 makes the controller's own rerun the boundary against.",
			{ at: "phase", phase: PHASE_INTEGRATE, run, ticket, attempt, verified: passed.length },
		);
	}

	return attestedBy(recorded.detail);
}

/**
 * Whether this attempt's branch is already out there under an open pull request.
 *
 * Read off the two effects that *are* the publication — the push and the pull
 * request — rather than off a stage record, because those are the mutations
 * outside the database and they are what a crash between the world and the
 * journal leaves half-done.
 *
 * **Both**, not either. A push resolved with no PR behind it has not published
 * anything a human can act on: §7.5's step 6 has not happened, and the loop's
 * check-then-create adopts the branch that is already pushed. The asymmetry is
 * the right way round — what the answer skips is the destructive half.
 */
function publicationLanded(store, { run, ticket, branch }) {
	// **Neither key names an attempt** (§4.5's rule, in `effects/keys.mjs`): the
	// subject of both is the published branch, which one ticket execution
	// publishes once. That is what lets this answer the same way from whichever
	// attempt is walking `integrate` — including a §8.10 automation retry of the
	// phase, which is the case that would otherwise look at a key nothing wrote
	// and push a second time (#146).
	const pushed = effectByKey(
		store,
		effectKey({ run, ticket, phase: PHASE_INTEGRATE, attempt: null, operation: "push", operand: branch }),
	);
	const opened = effectByKey(
		store,
		effectKey({ run, ticket, phase: PHASE_IMPLEMENT, attempt: null, operation: "pr-create", operand: branch }),
	);

	return pushed?.state === "resolved" && opened?.state === "resolved";
}

/** One reading of a verify detail, shared by the record and the loop's re-verify. */
function attestedBy(detail) {
	return {
		baseCommit: detail.base_commit,
		head: detail.head,
		commits: detail.commits,
		checks: detail.checks,
		worktree: detail.worktree,
		rebased: detail.rebased,
		evidenceRef: detail.evidence_ref,
	};
}

/**
 * A phase result, in the one shape `walkStages` resolves. The phase is not on
 * it: the walk knows which phase it is walking, and a second opinion carried in
 * the answer is a second thing to keep in step.
 */
function answer(outcome, detail) {
	return Object.freeze({ outcome, detail: Object.freeze(detail) });
}
