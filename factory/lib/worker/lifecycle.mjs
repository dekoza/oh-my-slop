import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { agentAlive, FACTORY_ATTEMPT_TOKEN, transcriptPointerOf } from "../controller/herdr-control.mjs";
import { fromPane, watchPane } from "../controller/herdr-events.mjs";
import { ATTEMPT_CLOCK_DEADLINE, ATTEMPT_CLOCK_NO_PROGRESS } from "../domain/vocabulary.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";
import { canonicalJson, runStream } from "../state/events.mjs";
import { requireAuthority } from "../tracker/authority.mjs";
import {
	attemptDir,
	attemptManifestPath,
	attemptOutboxPath,
	attemptPromptPath,
	herdrAgentName,
	herdrPaneTitle,
	herdrTabLabel,
	launchedAttempt,
	requireAttemptIdentity,
} from "./attempt.mjs";
import { assertClosureResolvable } from "./closure.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { readOutbox } from "./outbox.mjs";
import { renderAttemptPrompt } from "./prompt.mjs";
import { attemptRecheck } from "./recheck.mjs";
import { openRunWorkspace } from "./workspace.mjs";

/**
 * §6.4–§6.6: **launch a worker into an interactive pane, and harvest a typed
 * outbox.**
 *
 * The division of authority is the whole design, and it is not symmetric:
 *
 * > **The outbox is the authoritative *domain* result; harness and Herdr
 * > lifecycle events are the authoritative *termination* signal.**
 *
 * Herdr exposes no exit code anywhere in its API, so it can never say *how*
 * something ended — only whether a worker is alive right now (§5.2). And the
 * outbox cannot say whether the worker is still going. Neither source alone
 * answers "is this attempt over, and how did it go?", which is why the wait is
 * **first-signal-wins over both** and evaluates the pair against a state table
 * rather than trusting either one.
 *
 * The three operations here are runtime-neutral. Everything a runtime differs
 * in — the agent kind Herdr starts, the session flags, the native invocation
 * syntax — arrives as a parameter from `pi.mjs` or `claude.mjs`, which is what
 * keeps §6.1's "adding a runtime means implementing the adapter and nothing
 * else" true of this file too.
 */

/**
 * §6.1's three lifecycle operations, bound to one runtime.
 *
 * What a runtime contributes here is **two values** — the agent kind Herdr
 * starts it as, and the name `prompt.mjs` derives the native invocation from —
 * which is the measure of how much of §6.4 is runtime-specific: almost none of
 * it. Everything else about an attempt travels in the attempt itself, because
 * an adapter that held a run's state would be a second place a controller's
 * work lives.
 *
 * @param {{ runtime: string, agentKind?: string }} binding
 * @param {object} [defaults] herdr control, socket path, and timeout, when the
 *   builder has them; an attempt may carry or override any of them
 * @returns {Record<string, Function>} `launch` · `awaitCompletion` · `cancel`
 */
export function lifecycleOperations({ runtime, agentKind = runtime }, defaults = {}) {
	const bind = (attempt) => ({ ...defaults, ...attempt, runtime, agentKind });

	return {
		launch: (attempt) => launchWorker(attempt.store, bind(attempt)),
		awaitCompletion: (attempt) => awaitCompletion(attempt.store, bind(attempt)),
		cancel: (attempt) => cancelAttempt(attempt.store, bind(attempt)),
	};
}

/** How long to keep asking Herdr for a transcript pointer after launch (§6.5). */
const TRANSCRIPT_BACKOFF_MS = Object.freeze([250, 500, 1_000, 2_000, 4_000]);

/**
 * How long one prompt submission gets to be visibly taken up before it is
 * re-sent, and how many submissions are made before the launch is a typed
 * failure. Measured live: Herdr's `agent prompt` answered exit 0 while Claude
 * was still initializing, the text went nowhere, and the pane sat at an empty
 * prompt with nobody watching (§6.4). "Taken up" is the worker leaving its
 * resting state or the outbox already existing — the same two signals §6.6
 * trusts, read earlier.
 */
const PROMPT_ACCEPT_BACKOFF_MS = Object.freeze([250, 500, 1_000, 2_000, 3_000, 4_000]);
const PROMPT_SUBMISSIONS = 3;

/** How often the wait re-reads the outbox. The Herdr half is subscribed, not sampled. */
const OUTBOX_POLL_INTERVAL_MS = 1_000;

/** How often the wait samples pane output as a progress signal (§6.6, #150). */
const PROGRESS_POLL_INTERVAL_MS = 5_000;

/**
 * How long a settled worker gets before its silence is called silent-completion.
 *
 * A worker writes the outbox during its turn and settles a moment later, so the
 * file is normally there first. The grace covers the reverse order rather than
 * assuming it cannot happen: calling `no-result` on a worker whose write is
 * one filesystem beat behind would burn a repair budget on a completed attempt.
 */
export const SETTLE_GRACE_MS = 2_000;

/**
 * How long the stop's own outcome is re-probed before the pane is called wedged
 * (§5.2, §6.6, §13.B).
 *
 * The quit is keystrokes into a TUI, and a TUI does not leave on the line after
 * them: it tears its screen down, flushes its session, and only then releases
 * the pane. #114's two runs recorded `stopped: false` for every attempt while
 * the pi workers stopped writing their session files 22 ms and 41 ms after the
 * `agent-stop` effect resolved. The quit had worked; the single read taken
 * immediately after it observed a teardown in flight and wrote the race down as
 * a refusal.
 *
 * **What the bound has to cover is the detection lag, not the exit.** The
 * controller closes no pane (§13.B), so `pane_exited` never fires and the shell
 * survives — the agent simply stops being detected, on Herdr's own cadence.
 * Measured directly, with an agent started and never prompted so no model runs:
 * **claude 729 ms, pi 418 ms** from the quit keys to the agent leaving the pane
 * record (`tests/live/herdr-agent-stop-latency.mjs`), and the zero-grace probe
 * reproduced this defect on demand at both. The cumulative reads land at 250,
 * 750, 1750, 3750, and 7750 ms — roughly 10× headroom over the slower of the
 * two, with claude's 729 ms close enough to the second read that a loaded
 * machine resolves it on the third instead.
 *
 * Idle is the cheap case, and it is the only one measured: a worker interrupted
 * mid-turn must abandon its inference before it can exit, which is why
 * `AGENT_STOP_KEYS` leads with `esc`, and #114 has no clean data point for it.
 * The bound is therefore sized past its evidence on purpose. Past it the pane
 * is §13.B's accepted wedge — recorded, never escalated, and reclaimed by
 * `cleanup-plan` rather than by this path — so a longer bound would only make a
 * settle wait on a pane nobody here will act on.
 */
export const STOP_CONFIRM_BACKOFF_MS = Object.freeze([250, 500, 1_000, 2_000, 4_000]);

/**
 * What a stop that could not be confirmed is called on the record (§11.2).
 *
 * Three different unknowns, because a later reader cannot act on them the same
 * way. `wedged-pane` is Herdr answering that the agent is *still there* — the
 * pane §13.B accepts and `cleanup-plan` reclaims. `stop-unconfirmed` is Herdr
 * not answering at all, which says nothing about the agent and everything about
 * the observation. `quit-undelivered` is the keys never landing: the pane read
 * cannot tell it from a wedge, because both leave a live agent sitting there,
 * but only one of them is a harness ignoring its own quit — the other is this
 * controller never having asked. Collapsing any of them into one `false` is the
 * silent guess this constant exists to refuse.
 */
export const STOP_ANOMALIES = Object.freeze({
	wedged: "wedged-pane",
	unconfirmed: "stop-unconfirmed",
	undelivered: "quit-undelivered",
});

/** The agent statuses that mean the turn is over (§6.6's liveness half). */
const SETTLED_STATUSES = Object.freeze(["idle", "done", "released", "exited"]);

/** The two that mean the worker is gone rather than waiting for input. */
const GONE_STATUSES = Object.freeze(["released", "exited"]);

/**
 * §6.6's hard ceiling when nobody declared one. Three hours: the longest
 * attempt observed live completed at 86 minutes (commit a48bcef, #114), and
 * three hours is ~2.1× that — so no observed attempt has been cut off, while a
 * worker wedged mid-turn still surrenders its lane the same day rather than
 * never. A profile declares `attemptTimeoutMs` to move it.
 */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_800_000;

/**
 * §6.6's no-progress timeout when nobody declared one. Ten minutes. The
 * journal's measured attempt durations — 17 minutes and 86 minutes to
 * completion (#114) — are whole-attempt spans, not silent gaps, so they bound
 * this from below rather than pinning it: a worker that completed in either
 * span produced observable progress far more often than every ten minutes, and
 * a worker that produces *nothing* observable for ten minutes has stopped
 * doing what a completing worker does. A profile declares `noProgressTimeoutMs`
 * to move it.
 */
export const DEFAULT_NO_PROGRESS_TIMEOUT_MS = 600_000;

/**
 * Launch one attempt (§6.4, §6.5).
 *
 * The order is not arbitrary, and each step is where it is for a reason a
 * crash makes visible:
 *
 * 1. the manifest and the prompt are written **first**, so a controller that
 *    dies mid-launch leaves the evidence of what it was about to do;
 * 2. `attempt.launched` records the **mint**, because the projections refuse an
 *    attempt-scoped record for a tuple nothing minted — and the effect below is
 *    one. A claim that already minted this attempt finds its own record;
 * 3. the pane is opened as a tab in the run's workspace (#156), **stamped**,
 *    given §6.5's identity variables, and the agent started — one effect,
 *    because a pane carrying no token is a pane reconcile cannot recognise and
 *    §14.27 will not clean up;
 * 4. the transcript pointer is captured from Herdr, polled with backoff;
 * 5. §6.2's layer-3 recheck runs — **after the mint's record exists and before
 *    the prompt**, so package drift is refused before the attempt spends;
 * 6. the first prompt is submitted;
 * 7. `attempt.correlated` records what only the harness could say, and its
 *    presence is what makes the launch *finished* (§5.5, #114).
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {{ run: string, ticket: number, phase: string, attempt: string }} context.identity
 * @param {Readonly<object>} context.role the validated §6.1 tuple
 * @param {string} context.runtime `pi` or `claude`
 * @param {string} context.agentKind the kind Herdr starts (its own vocabulary)
 * @param {string | null} [context.plugin] the §6.3 plugin's manifest name, for Claude
 * @param {{ name: string, model: string }} context.profile the dispatched profile
 * @param {string | null} [context.observedModel] the runtime's resolved model id
 * @param {string} context.packageRev the pinned tree digest
 * @param {string} context.worktreePath §7.3's attempt worktree
 * @param {string} context.branch the attempt branch
 * @param {Readonly<object>} context.ticketSnapshot §14.17's claim-time snapshot
 * @param {Readonly<object> | null} [context.repair] §8.5's brief, when a repair
 *   tier produced this attempt (`pipeline/repair.mjs`). It rides the prompt, so
 *   the attempt manifest's prompt digest attests exactly what the worker was
 *   told — on disk. For an attempt somebody else minted, that digest does not
 *   reach the journal: the projector inserts one `attempt` row per
 *   `attempt.launched`, so the mint below cannot be appended twice
 * @param {Readonly<{ baseCommit: string, reviewedCommit: string }> | null} [context.review]
 *   §8.4's fixed point, when a review axis attempt is being launched
 *   (`pipeline/review.mjs`). It rides the prompt for the same reason the repair
 *   brief does, and it is not optional in practice: both axis skills open by
 *   asking the caller for a fixed point and there is nobody in the pane to ask
 * @param {ReadonlyArray<string>} [context.sessionArgs] §6.8's binding for this posture
 * @param {Record<string, string>} [context.sessionEnv] §6.8's closed pane set — the
 *   controller-owned config-directory variables and declared capability values the
 *   worker pane must carry. The pane's shell belongs to the multiplexer server, so
 *   nothing here arrives by inheritance; what is not in this set is not there
 * @param {number | null} [context.startupTimeoutMs] the profile's declared startup guard
 * @param {ReadonlyArray<object>} [context.closureFindings] layer-1/2 findings, if any
 * @param {object} context.herdr the Herdr control surface (`controller/herdr-control.mjs`)
 * @param {object} [context.recheck] injectable, so a suite can drive drift
 * @param {string} context.actor `controller`, or `operator:<verb>`
 * @param {() => number} context.now
 * @param {(ms: number) => Promise<void>} [context.sleep]
 * @returns {Promise<Readonly<object>>} the session `attempt.correlated` recorded
 * @throws {FactoryWorkerError} `attempt-already-launched` · `worker-launch-failed` · `skill-conflict`
 */
export async function launchWorker(
	store,
	{
		hold,
		identity: minted,
		role,
		runtime,
		agentKind,
		plugin = null,
		profile,
		observedModel = null,
		packageRev,
		worktreePath,
		branch,
		ticketSnapshot,
		repair = null,
		review = null,
		sessionArgs = [],
		sessionEnv = {},
		startupTimeoutMs = null,
		closureFindings = [],
		herdr,
		recheck = attemptRecheck,
		recheckContext = {},
		actor,
		now,
		sleep = delay,
	},
) {
	const identity = requireAttemptIdentity(minted);
	const { run, ticket, phase, attempt } = identity;

	// §6.8's one conflict predicate, on the attempt path: layer 1 and 2's
	// findings become the typed automation failure here, before a pane exists.
	assertClosureResolvable(closureFindings);

	// **The completed launch is what refuses, not the mint.** `attempt.launched`
	// may already be there — the claim minted the tuple and created the worktree
	// under it — while `attempt.correlated` is written only once a worker is up
	// and prompted. So a re-entry after a mid-launch crash finishes the launch,
	// and a re-entry after a finished one refuses: a failed or abandoned attempt
	// is never continued, and a live one is adopted rather than restarted (§5.5).
	if (correlatedAttempt(store, identity) !== null) {
		throw new FactoryWorkerError(
			"attempt-already-launched",
			`Attempt ${attempt} already has a worker: its launch completed and was correlated. A failed or abandoned ` +
				`attempt is never continued and a live one is adopted rather than restarted (§5.5, #114); relaunching ` +
				`would put two workers on one worktree (§14.23).`,
			{ run, ticket, attempt },
		);
	}

	const outboxPath = attemptOutboxPath(store.storeDir, attempt);
	const prompt = renderAttemptPrompt({
		role,
		kind: runtime,
		plugin,
		identity,
		worktreePath,
		branch,
		outboxPath,
		ticket: ticketSnapshot,
		packageRev,
		repair,
		review,
	});

	const manifest = writeAttemptManifest(store.storeDir, {
		identity,
		role,
		runtime,
		profile,
		packageRev,
		worktreePath,
		branch,
		outboxPath,
		ticketSnapshot,
		prompt,
		at: now(),
	});

	// The mint, and the record that makes the attempt real. It comes **first**
	// because every attempt-scoped record after it — the `agent-start` effect
	// here, the branch and worktree effects the claim already wrote — is refused
	// by the projections for a tuple nothing minted (§6.5). A claim that already
	// minted this attempt finds its own record and adds nothing.
	if (launchedAttempt(store, attempt) === null) {
		const at = now();
		hold.append({
			kind: "attempt.launched",
			source: "controller",
			run,
			ticket,
			phase,
			attempt,
			occurredAt: at,
			observedAt: at,
			payload: {
				role: role.name,
				runtime,
				profile: profile.name,
				declared_model: profile.model,
				package_rev: packageRev,
				worktree: worktreePath,
				branch,
				outbox: outboxPath,
				manifest_digest: manifest.digest,
				prompt_digest: manifest.promptDigest,
				ticket_snapshot_digest: manifest.snapshotDigest,
			},
		});
	}

	const agent = herdrAgentName(attempt);
	const started = await startedAgent(store, {
		hold,
		identity,
		herdr,
		agent,
		agentKind,
		worktreePath,
		sessionArgs,
		sessionEnv,
		startupTimeoutMs,
		payload: {
			runtime,
			role: role.name,
			profile: profile.name,
			worktree: worktreePath,
			outbox: outboxPath,
			manifest_digest: manifest.digest,
			prompt_digest: manifest.promptDigest,
		},
		actor,
		at: now(),
	});

	const transcript = await captureTranscript({ herdr, attempt, sleep, now });

	// §6.2's layer 3, cited by #105's contract: after the mint's record exists,
	// and before the prompt, because the prompt is the first thing that spends.
	recheck(store, {
		hold,
		run,
		ticket,
		attempt,
		phase,
		profile: profile.name,
		declaredModel: profile.model,
		observedModel,
		actor,
		at: now(),
		...recheckContext,
	});

	const submissions = await submitFirstPrompt({ herdr, agent, identity, prompt, outboxPath, sleep });

	// §6.5's correlation record, last: it is the marker that the launch
	// completed, so a controller that died anywhere above leaves an attempt a
	// re-entry finishes rather than one it refuses. The cost is named rather
	// than hidden: a crash between the prompt and this record re-sends the same
	// deterministic prompt, which is a repeated instruction — cheap beside a
	// worker left sitting with none.
	const correlatedAt = now();
	hold.append({
		kind: "attempt.correlated",
		source: "controller",
		run,
		ticket,
		phase,
		attempt,
		occurredAt: correlatedAt,
		observedAt: correlatedAt,
		payload: {
			runtime,
			// §6.5's "harness session identifiers": Herdr's agent and pane ids, and
			// the runtime's own session, which arrives as the transcript pointer.
			herdr: { workspace: started.workspace, tab: started.tab, pane: started.pane, agent },
			transcript,
			resolved_model: observedModel,
			package_rev: packageRev,
			skill_source: role.entrySkill,
			// Evidence of delivery, not just of submission: how many times the
			// deterministic prompt had to be sent before the worker took it up.
			prompt_submissions: submissions,
		},
	});

	return Object.freeze({
		attempt,
		workspace: started.workspace,
		tab: started.tab,
		pane: started.pane,
		agent,
		transcript,
		outboxPath,
		manifest,
	});
}

/** The §6.5 correlation record for one attempt, or null when the launch never finished. */
function correlatedAttempt(store, { run, attempt }) {
	return (
		store
			.readEvents({ stream: runStream(run), kind: "attempt.correlated" })
			.find((event) => event.attempt === attempt) ?? null
	);
}

/** The time the launch completed (§6.5), or null when it never finished. */
function correlationTime(store, identity) {
	return correlatedAttempt(store, identity)?.occurred_at ?? null;
}

/**
 * §6.6's wait: **first-signal-wins**, over the outbox and the worker's liveness,
 * with the two clocks of #150 governing the end.
 *
 * Neither signal is polled the same way, and that asymmetry is §5.1's. Herdr is
 * **subscribed** to, because a poll structurally cannot see `working → blocked
 * → working` between two samples, and the transitions are recorded as events.
 * The outbox is a file this controller designated and is re-read on a short
 * interval — there is nothing to subscribe to and no transition to miss, only a
 * file that appears once. Pane output, the third progress signal, is **sampled**
 * on its own slower cadence: there is no output stream to subscribe to, and the
 * point is only whether the recent output *changed* since the last sample.
 *
 * **Two clocks, both finite.** The hard ceiling (`timeoutMs`) bounds the lane
 * whatever the worker is doing, and is anchored to the launch completion so a
 * controller that died and adopted a live worker does not reset the bound. The
 * no-progress clock (`noProgressTimeoutMs`) ends an attempt that has stopped
 * producing anything observable — a status transition, pane output, or a
 * transcript growing — and its verdict names which clock fired and what the last
 * observed progress was.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold
 * @param {{ run: string, ticket: number, phase: string, attempt: string }} context.identity
 * @param {string} context.pane the pane this attempt runs in
 * @param {string} context.agent the Herdr agent name
 * @param {string} context.socket the Herdr socket path
 * @param {object} context.herdr the Herdr control surface
 * @param {number} context.timeoutMs the attempt's hard ceiling
 * @param {number} context.noProgressTimeoutMs the attempt's no-progress window
 * @param {string} context.actor
 * @param {() => number} context.now
 * @param {(ms: number) => Promise<void>} [context.sleep]
 * @param {Function} [context.watch] injectable subscription opener
 * @param {number} [context.pollIntervalMs]
 * @param {number} [context.progressPollIntervalMs]
 * @returns {Promise<Readonly<object>>} the typed outcome
 */
export async function awaitCompletion(
	store,
	{
		hold,
		identity: minted,
		pane,
		agent,
		socket,
		herdr,
		timeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
		noProgressTimeoutMs = DEFAULT_NO_PROGRESS_TIMEOUT_MS,
		actor,
		now,
		sleep = delay,
		watch = watchPane,
		pollIntervalMs = OUTBOX_POLL_INTERVAL_MS,
		settleGraceMs = SETTLE_GRACE_MS,
		progressPollIntervalMs = PROGRESS_POLL_INTERVAL_MS,
	},
) {
	const identity = requireAttemptIdentity(minted);
	requireLaunched(store, identity);

	const outboxPath = attemptOutboxPath(store.storeDir, identity.attempt);
	// The hard ceiling is anchored to the launch completion, not to this wait: a
	// controller that died and adopted a live worker must not hand the lane a
	// fresh deadline (§6.6, #150).
	const deadline = (correlationTime(store, identity) ?? now()) + timeoutMs;
	const observer = observationRecorder(store, { hold, identity, pane, actor, now });

	// §6.6's second clock. The window opens when this controller starts watching,
	// because a re-entry cannot know what the worker did while it was down — the
	// progress it *did* observe is already durable, and what matters now is
	// whether the worker produces something observable from here on.
	let lastProgressAt = now();
	let lastProgress = null;
	let nextProgressCheckAt = now();
	let outputSnapshot = null;
	let observationDegraded = false;

	// **Seeded from a read, never assumed.** A worker that finished before the
	// subscription opened produces no transition at all, and starting from
	// "alive" would then read its perfectly good outbox as `wrote-but-hung`.
	//
	// The seed keeps the *status* and not the *clock*: `settledAt` stays null,
	// because a seed is a state with no history. A live agent reading "idle"
	// here may equally be one that finished long ago (its valid outbox decides
	// on the first loop, settle clock unneeded) or one whose model has not
	// begun the turn the launch just submitted — measured live, pi took longer
	// than the settle grace to leave "idle", and a seed-started clock harvested
	// the attempt as `no-result` before the worker ever worked. Silence starts
	// counting only from an observed transition into a settled status; a pane
	// already gone still decides immediately through the `dead-worker` row.
	const seen = await herdr.paneForAttempt(identity.attempt);
	let liveness = {
		...readLiveness(fromPane(seen.ok ? seen.pane : null, "seed"), { settledAt: null }, now()),
		settledAt: null,
	};

	// Transitions are queued rather than journalled from the socket callback:
	// every append then happens on this function's own path, in order, where a
	// lost lease is a refusal the caller sees rather than an exception thrown
	// out of a `data` handler nobody is awaiting.
	const pending = [];
	const watcher = watch({
		pane,
		socket,
		poll: () => herdr.paneForAttempt(identity.attempt),
		onTransition: (transition) => pending.push({ transition, at: now() }),
		onDegraded: (degradation) => pending.push({ degradation, at: now() }),
		onUnrecognised: (unrecognised) => pending.push({ unrecognised, at: now() }),
	});

	try {
		for (;;) {
			const at = now();

			while (pending.length > 0) {
				const entry = pending.shift();
				if (entry.degradation !== undefined) {
					observer.degraded(entry.degradation, entry.at);
					// The controller has admitted its own observation channel failed:
					// a no-progress verdict reached from here on is the automation's
					// failure, not the worker tier's (§8.10, #150).
					observationDegraded = true;
					continue;
				}
				if (entry.unrecognised !== undefined) {
					observer.unrecognised(entry.unrecognised, entry.at);
					continue;
				}
				liveness = readLiveness(entry.transition, liveness, entry.at);
				observer.record(entry.transition, entry.at);
				// A status transition is observed progress: something about the
				// worker changed, and the no-progress window reopens from it.
				lastProgressAt = entry.at;
				lastProgress = transitionProgress(entry.transition, entry.at);
			}

			// First schema-valid content wins: the loop keeps the first valid read
			// and never re-reads for state, so a worker writing again after the
			// harvest is writing evidence (§6.6).
			const outbox = readOutbox(outboxPath, identity);
			const decided = decideOutcome({
				outbox,
				liveness,
				at,
				deadline,
				noProgressDeadline: lastProgressAt + noProgressTimeoutMs,
				observationDegraded,
				settleGraceMs,
			});
			if (decided !== null) {
				return await settle(store, {
					hold,
					identity,
					herdr,
					agent,
					outcome: decided.outcome,
					clock: decided.clock ?? null,
					lastProgress,
					outbox,
					liveness,
					actor,
					now,
					sleep,
				});
			}

			// Still undecided: sample pane output for progress, on its own cadence.
			// A changed snapshot is observed progress; a read that fails is not an
			// end — it is one fewer observation this round, and the no-progress
			// clock, the hard ceiling, and the next sample all stand behind it.
			if (at >= nextProgressCheckAt) {
				nextProgressCheckAt = at + progressPollIntervalMs;
				const output = await herdr.readPaneOutput(pane);
				if (output.ok) {
					const digest = digestOf(output.text);
					if (digest !== outputSnapshot) {
						outputSnapshot = digest;
						observer.output({ bytes: output.bytes, digest }, at);
						lastProgressAt = at;
						lastProgress = outputProgress({ bytes: output.bytes, digest }, at);
					}
				}
			}
			await sleep(pollIntervalMs);
		}
	} finally {
		watcher.close();
	}
}

/**
 * §6.6's cancellation: **an agent stop plus a typed cancellation event carrying
 * who and why.**
 *
 * Late outboxes are ignored for state, and that is structural rather than a
 * rule this function follows: `attempt.ended` is written here, and the
 * projector refuses a second ending — so a worker that writes after being
 * cancelled has written evidence, not a result.
 *
 * @param {object} store
 * @param {object} context
 * @param {string} context.by who asked — an operator verb, or the controller
 * @param {string} context.reason why, in the operator's own words
 * @returns {Promise<Readonly<object>>}
 */
export async function cancelAttempt(store, { hold, identity: minted, herdr, agent, by, reason, actor, now, sleep = delay }) {
	const identity = requireAttemptIdentity(minted);
	requireLaunched(store, identity);

	return settle(store, {
		hold,
		identity,
		herdr,
		agent,
		outcome: "cancelled",
		outbox: null,
		liveness: null,
		cancellation: { by, reason },
		actor,
		now,
		sleep,
	});
}

/**
 * §6.6's state table, as one function: **(outbox validity × worker liveness)**,
 * now with the two clocks of #150.
 *
 * | outbox | worker | outcome |
 * |---|---|---|
 * | schema-valid | settled | the worker's own status |
 * | schema-valid | still working | `wrote-but-hung` — harvest it anyway (§8.10) |
 * | present, invalid | either | `invalid-result` |
 * | valid, foreign tuple | either | `automation-failure` (§6.5) |
 * | absent | gone | `dead-worker` |
 * | absent | settled past the grace | `no-result` — silent completion |
 * | absent | working, no progress observed | `timeout` / `clock: no-progress` |
 * | absent | working, observed progress | `timeout` / `clock: deadline` at the hard ceiling |
 * | absent | working | undecided; keep waiting |
 *
 * The no-progress row is the one that splits by fault (§8.10): when the
 * controller's own observation channel degraded, the absence of progress is
 * evidence about the controller, not the worker, so it answers
 * `automation-failure` and spends the automation budget rather than the worker
 * tier's. The hard ceiling fires regardless — it bounds the lane, not the
 * verdict about who failed.
 *
 * The two absences are different faults and route to different budgets (§8.10):
 * a worker that ended its turn without writing failed at its own job, while a
 * pane that died under it is the automation's failure.
 *
 * @returns {Readonly<{ outcome: string, clock?: string }> | null} null while nothing has decided
 */
export function decideOutcome({
	outbox,
	liveness,
	at,
	deadline,
	noProgressDeadline = null,
	observationDegraded = false,
	settleGraceMs = SETTLE_GRACE_MS,
}) {
	if (outbox.state === "foreign") return Object.freeze({ outcome: "automation-failure" });
	if (outbox.state === "invalid" || outbox.state === "unreadable") return Object.freeze({ outcome: "invalid-result" });

	if (outbox.state === "valid") {
		// **`wrote-but-hung` is not a failure** (§8.10): the outbox is valid, so
		// it is harvested, the agent is stopped as routine shutdown, and the
		// anomaly is what gets recorded.
		return Object.freeze({ outcome: liveness.alive ? "wrote-but-hung" : outbox.record.status });
	}

	if (GONE_STATUSES.includes(liveness.status)) return Object.freeze({ outcome: "dead-worker" });
	if (liveness.settledAt !== null && at - liveness.settledAt >= settleGraceMs) {
		return Object.freeze({ outcome: "no-result" });
	}

	// §6.6's no-progress clock: the worker is still going, but nothing
	// observable changed for the whole window. A controller that stopped
	// observing is the automation's failure, never the worker tier's.
	if (noProgressDeadline !== null && at >= noProgressDeadline) {
		return observationDegraded
			? Object.freeze({ outcome: "automation-failure" })
			: Object.freeze({ outcome: "timeout", clock: ATTEMPT_CLOCK_NO_PROGRESS });
	}
	if (at >= deadline) return Object.freeze({ outcome: "timeout", clock: ATTEMPT_CLOCK_DEADLINE });

	return null;
}

// ── The pieces ───────────────────────────────────────────────────────────────

/**
 * §6.5's attempt manifest, in the controller-owned location.
 *
 * It is a plain file rather than an effect or an artifact: like the bare clone
 * and the plugin cache it is **factory infrastructure**, derived from durable
 * state and rebuildable from it, and §12.1's artifact contents are a closed set
 * this is not in. What makes it evidence is the digest, which rides
 * `attempt.launched` — so the journal says which manifest, and the manifest
 * says what the worker was launched with.
 */
function writeAttemptManifest(
	storeDir,
	{ identity, role, runtime, profile, packageRev, worktreePath, branch, outboxPath, ticketSnapshot, prompt, at },
) {
	const snapshotDigest = digestOf(canonicalJson(ticketSnapshot));
	const content = {
		manifest_version: 1,
		run: identity.run,
		ticket: identity.ticket,
		phase: identity.phase,
		attempt: identity.attempt,
		role: role.name,
		entry_skill: role.entrySkill,
		closure: [...(role.closure ?? [])],
		runtime,
		profile: { name: profile.name, model: profile.model },
		package_rev: packageRev,
		worktree: worktreePath,
		branch,
		outbox: outboxPath,
		ticket_snapshot: ticketSnapshot,
		ticket_snapshot_digest: snapshotDigest,
		launched_at: at,
	};

	const serialised = canonicalJson(content);
	mkdirSync(attemptDir(storeDir, identity.attempt), { recursive: true });
	writeFileSync(attemptManifestPath(storeDir, identity.attempt), `${serialised}\n`, "utf8");
	writeFileSync(attemptPromptPath(storeDir, identity.attempt), prompt, "utf8");

	return Object.freeze({
		content: Object.freeze(content),
		digest: digestOf(serialised),
		promptDigest: digestOf(prompt),
		snapshotDigest,
	});
}

/**
 * §4.5's `agent-start`, as the one effect the launch performs.
 *
 * Three Herdr commands sit inside it — open the pane, stamp the token, start
 * the agent — because they are one mutation from the factory's side: *a worker
 * is running under this attempt's identity*, which is exactly what the effect's
 * probe asks (`pane list` matching the `FACTORY_ATTEMPT` token). Splitting them
 * into three effects would give reconcile two intermediate states it has no
 * question to ask about.
 *
 * The run's workspace is the one thing here that is **not** part of that
 * mutation and is its own effect (#156): it outlives this attempt, is shared by
 * every other attempt of the run, and is asked for by a different question —
 * *does this run have a workspace* rather than *is this worker running*. It is
 * opened before the pane because the pane is a tab inside it.
 */
async function startedAgent(
	store,
	{ hold, identity, herdr, agent, agentKind, worktreePath, sessionArgs, sessionEnv = {}, startupTimeoutMs, payload, actor, at },
) {
	const { run, ticket, phase, attempt } = identity;

	const requested = requestEffect(store, {
		operation: "agent-start",
		// The key already names the attempt, and the agent name is derived from it:
		// a segment repeating what the previous one said is noise in every key the
		// operator reads (§4.5).
		operand: null,
		run,
		ticket,
		phase,
		attempt,
		actor,
		fencingGeneration: hold.fence().generation,
		payload,
		at,
	});
	if (requested.state === "resolved") return requested.result;

	// #156: the run's workspace, opened by whichever attempt needs one first and
	// adopted by every attempt after it — including the ones a re-entering
	// controller launches, which read the committed id rather than opening a
	// second workspace. A refusal here is this attempt's automation failure, so
	// the lane answers for it under §8.10 like any other launch failure.
	const workspace = await openRunWorkspace(store, { hold, run, herdr, cwd: store.storeDir, actor, at });
	if (!workspace.ok) throw launchFailure(workspace, identity);

	const opened = await herdr.openTab({
		workspace: workspace.workspace,
		cwd: worktreePath,
		label: herdrTabLabel(attempt),
	});
	if (!opened.ok) throw workspaceTabFailure(opened, identity, workspace.workspace);

	// Before `agent start`, deliberately: a crash in between must leave a pane
	// this factory can still recognise, or reconcile concludes nothing started
	// while a worker runs on. The probe asks for the token *and* a live agent,
	// so an early stamp cannot make an unstarted agent look started.
	const stamped = await herdr.stamp(opened.pane, { attempt, title: herdrPaneTitle(attempt) });
	if (!stamped.ok) throw launchFailure(stamped, identity);

	// §6.5's second identity channel, into the shell the agent is about to
	// occupy — so the tuple is reachable from every process the worker starts
	// and not only from the prompt it was handed once. §6.8's session binding
	// rides the same export: the pane's shell is the multiplexer server's, not
	// this controller's, so the controller-owned config roots reach the worker
	// only by being written here. Identity is spread last — no declared value
	// may shadow it.
	const exported = await herdr.exportIdentity(opened.pane, {
		...sessionEnv,
		...attemptEnvironment({ identity, payload }),
	});
	if (!exported.ok) throw launchFailure(exported, identity);

	const started = await herdr.startAgent({
		name: agent,
		kind: agentKind,
		pane: opened.pane,
		args: [...sessionArgs],
		timeoutMs: startupTimeoutMs,
	});
	if (!started.ok) throw launchFailure(started, identity);

	const resolved = resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: hold.fence().generation,
		result: { workspace: opened.workspace, tab: opened.tab, pane: opened.pane, agent },
		at,
	});
	return resolved.result;
}

/**
 * §6.5's identity, as the worker's own environment carries it.
 *
 * The names are prefixed and the set is closed: this is a channel a worker
 * reads, so a variable added here is a promise to every future worker, and the
 * outbox path is in it because a worker that has to *find* where to write its
 * result has one more way to get it wrong. `FACTORY_ATTEMPT` deliberately
 * spells the same name the pane token does — one identity, one spelling,
 * whichever side you read it from (§5.5).
 */
function attemptEnvironment({ identity, payload }) {
	return {
		FACTORY_RUN: identity.run,
		FACTORY_TICKET: identity.ticket,
		FACTORY_PHASE: identity.phase,
		[FACTORY_ATTEMPT_TOKEN]: identity.attempt,
		FACTORY_OUTBOX: payload.outbox,
		FACTORY_WORKTREE: payload.worktree,
	};
}

/**
 * §6.4's first prompt, **delivered rather than merely submitted**.
 *
 * Herdr's `agent prompt` reports that the text was written into the pane, not
 * that the harness took it: an agent still initializing answers exit 0 and
 * swallows the submission whole — observed live, and the pane then sits idle
 * with nobody watching while §6.6's wait sees only a worker that never
 * starts. So each submission is followed by a short watch for the prompt
 * being *taken up* — the worker leaving its resting state, or the outbox
 * already existing (a turn can finish between two reads) — and the same
 * deterministic prompt is re-sent a bounded number of times, which is exactly
 * what a controller re-entry after a crash already does. A prompt never taken
 * up is a typed launch failure: the worker never worked, so the attempt is
 * the automation's to answer for, not the attempt's.
 *
 * @returns {Promise<number>} how many submissions delivery took
 */
async function submitFirstPrompt({ herdr, agent, identity, prompt, outboxPath, sleep }) {
	let last = null;

	for (let submission = 1; submission <= PROMPT_SUBMISSIONS; submission += 1) {
		const sent = await herdr.prompt({ target: agent, text: prompt });
		if (!sent.ok) throw launchFailure(sent, identity);

		for (const wait of PROMPT_ACCEPT_BACKOFF_MS) {
			if (existsSync(outboxPath)) return submission;

			const found = await herdr.paneForAttempt(identity.attempt);
			last = found.ok ? (found.pane?.agent_status ?? "no-pane") : "unanswerable";
			if (found.ok && found.pane !== null && !SETTLED_STATUSES.includes(found.pane.agent_status)) {
				return submission;
			}
			await sleep(wait);
		}
	}

	throw new FactoryWorkerError(
		"worker-launch-failed",
		`The first prompt was submitted ${PROMPT_SUBMISSIONS} times and never taken up: the pane still reads ` +
			`"${last}" and no outbox exists. The worker never worked, so attempt ${identity.attempt} is an automation ` +
			`failure rather than anything the attempt can be blamed for (§6.4). Nothing was closed (§13.B).`,
		{ ...identity, submissions: PROMPT_SUBMISSIONS, last_status: last },
	);
}

/**
 * §6.5's transcript pointer: **captured from Herdr, not computed**, by polling
 * with backoff for a few seconds after launch.
 *
 * Backoff rather than one read because the pointer is pushed by the agent's own
 * `SessionStart` hook, which fires after Herdr has already called the agent
 * ready. If it never arrives the attempt records `no-transcript-pointer` — and
 * that is final: Herdr drops the reference when the pane goes away, and integration
 * deletes the worktree pi's path is keyed on, so no later heuristic recovers it.
 */
async function captureTranscript({ herdr, attempt, sleep, now }) {
	for (const wait of TRANSCRIPT_BACKOFF_MS) {
		await sleep(wait);
		const found = await herdr.paneForAttempt(attempt);
		if (!found.ok) continue;

		const pointer = transcriptPointerOf(found.pane);
		if (pointer !== null) return Object.freeze({ ...pointer, captured_at: now() });
	}
	return null;
}

/**
 * The decision, made durable: stop the **agent**, then record the ending.
 *
 * The order is §6.6's — "after writing any status the worker ends its turn and
 * the controller stops the agent" — and the stop comes first so the record can
 * carry what actually happened to it. A worker still running afterwards is
 * **routine shutdown, not an error** (§13.B): the anomaly is recorded, the pane
 * is left exactly as it is, and `cleanup-plan` reclaims it later.
 */
async function settle(
	store,
	{
		hold,
		identity,
		herdr,
		agent,
		outcome,
		clock = null,
		lastProgress = null,
		outbox,
		liveness,
		cancellation = null,
		actor,
		now,
		sleep,
	},
) {
	const { run, ticket, phase, attempt } = identity;
	const stopped = await stopAgent(store, { hold, identity, herdr, agent, actor, at: now(), sleep });
	const anomaly = stopAnomalyOf(stopped);
	const at = now();

	hold.append({
		kind: "attempt.ended",
		source: "controller",
		run,
		ticket,
		phase,
		attempt,
		occurredAt: at,
		observedAt: at,
		payload: {
			outcome,
			// §6.6's two clocks, named rather than left for the operator to read
			// elapsed time as a diagnosis (§8.10, #150). `clock` is which one fired
			// a timeout — `no-progress` or `deadline` — and `last_progress` is the
			// last observed fact that kept the no-progress clock from firing.
			clock,
			last_progress: lastProgress,
			// §5.2: the outbox is **evidence**, so what it claimed rides the record
			// and never becomes the record. The controller's own rerun is the
			// attestation boundary (§14.16).
			result: outbox?.record ?? null,
			problems: outbox === null ? [] : [...outbox.problems],
			worker_status: liveness === null ? null : liveness.status,
			// **Payload v2's promise**: this is an observation, not a race. It is
			// what the bounded re-probe saw, and `null` where Herdr would not say.
			agent_stopped: stopped.stopped,
			// The wedged pane §13.B accepts: recorded as an anomaly naming it, never
			// escalated — a later reader is told which pane survived the run rather
			// than left to infer it from a bare false (§11.2).
			stop_anomaly: anomaly,
			cancelled_by: cancellation?.by ?? null,
			cancellation_reason: cancellation?.reason ?? null,
		},
	});

	return Object.freeze({
		outcome,
		clock,
		lastProgress,
		record: outbox?.record ?? null,
		problems: outbox === null ? Object.freeze([]) : outbox.problems,
		worker_status: liveness === null ? null : liveness.status,
		agent_stopped: stopped.stopped,
		stop_anomaly: anomaly,
		cancellation: cancellation === null ? null : Object.freeze({ ...cancellation }),
	});
}

/**
 * §13.B's stop, as §4.5's `agent-stop` effect: the agent's own quit keys, then
 * a read of the pane to see whether it went. **It never closes the pane** — the
 * controller stops agents and closes nothing, worker pane or its own.
 */
async function stopAgent(store, { hold, identity, herdr, agent, actor, at, sleep }) {
	const { run, ticket, phase, attempt } = identity;

	const requested = requestEffect(store, {
		operation: "agent-stop",
		operand: null,
		run,
		ticket,
		phase,
		attempt,
		actor,
		fencingGeneration: hold.fence().generation,
		payload: { agent },
		at,
	});
	if (requested.state === "resolved") return requested.result;

	// Whether the keys landed is this call's only answer (`herdr-control.mjs`),
	// and it is kept rather than discarded: a send that failed and a harness that
	// ignored the send both leave a live agent in the pane, so the re-probe below
	// cannot separate them and the record would name the wrong party.
	const sent = await herdr.stopAgent(agent);
	const confirmed = await confirmStopped({ herdr, agent, attempt, sleep });

	const resolved = resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: hold.fence().generation,
		result: { ...confirmed, quit_delivered: sent.ok },
		at,
	});
	return resolved.result;
}

/**
 * Whether the quit took, **observed rather than raced** (§5.2).
 *
 * The loop reads Herdr until the pane stops hosting a live agent or the bound
 * above runs out, and it returns on the *first* read that says the agent went —
 * a stop that took quickly costs one sleep, not the whole budget. What it never
 * does is treat an early sighting as an answer: the point of the bound is that
 * "still there" only means something once there was time for it not to be.
 *
 * `stopped` keeps three values on purpose. `true` and `false` are observations;
 * `null` is Herdr declining to answer, which is not evidence that the agent
 * stayed and must not be written down as though it were (§14.1).
 *
 * **A read that fails costs the answer, never the sighting.** The pane id and
 * status carry over from the last read that succeeded, because a stop whose
 * final probe went unanswered still knows which pane it was watching — and
 * §13.B's anomaly is only actionable if it names one.
 *
 * @returns {Promise<Readonly<{ stopped: boolean | null, pane: string | null, status: string | null, probes: number, agent: string }>>}
 */
async function confirmStopped({ herdr, agent, attempt, sleep }) {
	let last = { stopped: null, pane: null, status: null, probes: 0 };

	for (const [index, wait] of STOP_CONFIRM_BACKOFF_MS.entries()) {
		await sleep(wait);
		const found = await herdr.paneForAttempt(attempt);
		const probes = index + 1;
		if (!found.ok) {
			last = { ...last, stopped: null, probes };
			continue;
		}

		last = {
			stopped: !agentAlive(found.pane),
			pane: found.pane?.pane_id ?? last.pane,
			status: found.pane?.agent_status ?? null,
			probes,
		};
		if (last.stopped) break;
	}

	return Object.freeze({ ...last, agent });
}

/**
 * §13.B's wedge, **named on the record instead of left as a bare `false`**.
 *
 * A later reader asking "did this attempt leave a pane behind, and which one?"
 * gets the pane id, the status it was last seen in, and how many reads went
 * into saying so. Null is the ordinary case — the agent went — because an
 * anomaly slot that is always populated is a slot nobody scans for.
 *
 * **Every slot is defaulted, because the input may be a replay.** `agent-stop`
 * is idempotent, so a re-entry returns whatever the binary that resolved the
 * effect wrote — and a pre-#152 result carries no probe count at all. The
 * missing slots stay null rather than crediting that single raced read with a
 * bound it never spent, and rather than reaching the append as `undefined`,
 * which §4.3's canonical serialisation refuses outright. `quit_delivered`
 * defaults to `true` for the same reason: no pre-#152 result recorded it, and a
 * replay must not invent an undelivered quit out of a slot that did not exist.
 */
function stopAnomalyOf({ stopped, pane = null, status = null, probes = null, agent = null, quit_delivered = true }) {
	const anomaly = anomalyClassOf({ stopped, quit_delivered });
	if (anomaly === null) return null;

	return Object.freeze({ anomaly, pane, agent, status, probes, waited_ms: waitedMs(probes) });
}

/** Which of §13.B's three unknowns this stop is, or null when the agent simply went. */
function anomalyClassOf({ stopped, quit_delivered }) {
	// An undelivered quit outranks the pane read, and is an anomaly even when the
	// agent turns out to be gone: it went for some other reason, and "this
	// controller stopped it" would be the journal asserting what it never did.
	if (!quit_delivered) return STOP_ANOMALIES.undelivered;
	if (stopped === true) return null;
	return stopped === null ? STOP_ANOMALIES.unconfirmed : STOP_ANOMALIES.wedged;
}

/** How much of the bound `probes` reads actually spent, or null for a replay that counted none. */
function waitedMs(probes) {
	if (probes === null) return null;
	return STOP_CONFIRM_BACKOFF_MS.slice(0, probes).reduce((total, wait) => total + wait, 0);
}

/**
 * §5.1's recorder: one `observation.recorded` per observed transition, and one
 * `observation.degraded` when the socket could not carry them.
 *
 * **The foreign id is constructed, and it names the fact rather than the pane.**
 * Herdr's frames carry no id of their own — verified against protocol 19 — so
 * the alternative to constructing one is not recording the transitions at all.
 * Keying on the pane alone would let the first sighting suppress every later
 * one through §5.1's partial unique index, which is the exact failure that
 * index exists to prevent for the tracker; keying on the transition's ordinal
 * within the attempt makes a re-recorded transition a duplicate and a new one
 * a new fact. The ordinal is seeded from the journal, so a resubscription after
 * a Herdr server restart continues the count rather than colliding with it.
 */
function observationRecorder(store, { hold, identity, pane, actor, now }) {
	const { run, ticket, phase, attempt } = identity;
	let ordinal = recordedObservations(store, { run, attempt });
	let degradedOnce = false;
	const unrecognisedOnce = new Set();

	return {
		record(transition, at) {
			ordinal += 1;
			hold.append({
				kind: "observation.recorded",
				source: requireAuthority("worker.alive", "herdr"),
				run,
				ticket,
				phase,
				attempt,
				occurredAt: at,
				observedAt: at,
				foreignSourceId: `herdr:${pane}:${attempt}:${ordinal}`,
				payload: {
					fact: "worker.alive",
					pane,
					status: transition.status,
					from: transition.from,
					alive: transition.alive,
					agent: transition.agent,
					// Which half of §5.1 produced it: a run whose transitions all say
					// `poll` is a run whose operator should know the socket was down.
					observed_by: transition.source,
					event: transition.event,
				},
			});
		},

		/**
		 * Pane output that changed since the last sample — §6.6's progress half
		 * (#150). Recorded as its own fact, `worker.output`, under the same
		 * authority and the same foreign-id space as a status transition, because
		 * Herdr dates nothing and the fact is "this pane's output changed", never
		 * "this pane" (§5.1).
		 */
		output({ bytes, digest }, at) {
			ordinal += 1;
			hold.append({
				kind: "observation.recorded",
				source: requireAuthority("worker.output", "herdr"),
				run,
				ticket,
				phase,
				attempt,
				occurredAt: at,
				observedAt: at,
				foreignSourceId: `herdr:${pane}:${attempt}:${ordinal}`,
				payload: {
					fact: "worker.output",
					pane,
					bytes,
					digest,
					observed_by: "poll",
				},
			});
		},

		degraded(degradation, at) {
			// Once per attempt: the fallback is a state, not a stream of notices,
			// and repeating it would bury the transitions it exists to flag.
			if (degradedOnce) return;
			degradedOnce = true;
			hold.append({
				kind: "observation.degraded",
				// Our own assertion about our own observation, so `controller` and not
				// `herdr`: Herdr did not tell us this, its silence did.
				source: "controller",
				run,
				ticket,
				phase,
				attempt,
				occurredAt: at,
				observedAt: at,
				payload: { ...degradation, pane, actor },
			});
		},

		unrecognised(unrecognised, at) {
			// Once per distinct wire name per attempt: the diagnostic names what
			// was seen, and repeating it per frame would bury the transitions it
			// exists beside. Herdr states no id for the frame, so there is no
			// foreign id to dedupe on (§4.3).
			if (unrecognisedOnce.has(unrecognised.event)) return;
			unrecognisedOnce.add(unrecognised.event);
			hold.append({
				kind: "observation.unrecognised",
				// Our own assertion about our own gap: Herdr sent a valid frame for
				// this pane, and this build's vocabulary is what does not know its
				// name — so `controller`, never `herdr` (§5.1).
				source: "controller",
				run,
				ticket,
				phase,
				attempt,
				occurredAt: at,
				observedAt: at,
				payload: { pane, event: unrecognised.event, actor },
			});
		},
	};
}

/** How many observations this store has already recorded for the attempt. */
function recordedObservations(store, { run, attempt }) {
	return store
		.readEvents({ stream: runStream(run), kind: "observation.recorded" })
		.filter((event) => event.attempt === attempt).length;
}

/**
 * A transition, read as §6.6's liveness half.
 *
 * `alive` here is **not** "the process exists": an interactive harness does not
 * exit when a turn ends, it goes idle. So the question the state table asks is
 * whether the worker is *still working*, and a settled agent sitting at its
 * prompt with no outbox is silence rather than patience.
 */
export function readLiveness(transition, previous, at) {
	const settled = SETTLED_STATUSES.includes(transition.status);
	return {
		status: transition.status,
		alive: !settled,
		// The moment it settled, kept across further transitions in the same
		// state so the grace measures from the first one.
		settledAt: settled ? (previous.settledAt ?? at) : null,
	};
}

/** The last observed progress, as a status transition (§6.6, #150). */
function transitionProgress(transition, at) {
	return Object.freeze({
		fact: "worker.alive",
		source: "herdr",
		observed_at: at,
		status: transition.status,
		from: transition.from ?? null,
		observed_by: transition.source,
	});
}

/** The last observed progress, as pane output that changed (§6.6, #150). */
function outputProgress({ bytes, digest }, at) {
	return Object.freeze({
		fact: "worker.output",
		source: "herdr",
		observed_at: at,
		bytes,
		digest,
	});
}

function requireLaunched(store, identity) {
	if (launchedAttempt(store, identity.attempt) !== null) return;

	throw new FactoryWorkerError(
		"worker-not-launched",
		`Attempt ${identity.attempt} has no launch record in this store, so there is no worker to harvest or stop. ` +
			`Inventing one would be the controller establishing an external fact by reasoning (§14.1).`,
		{ run: identity.run, ticket: identity.ticket, attempt: identity.attempt },
	);
}

function launchFailure(answer, identity) {
	return new FactoryWorkerError(
		"worker-launch-failed",
		`${answer.message} The worker never ran, so attempt ${identity.attempt} is an automation failure rather than ` +
			`anything the attempt can be blamed for (§6.4). Nothing was closed, because nothing here closes a pane (§13.B).`,
		{ ...identity, command: answer.command, exit_code: answer.exit_code, stderr: answer.stderr },
	);
}

/**
 * The one launch failure that names a way out (#156).
 *
 * A run adopts the workspace it recorded and never opens a replacement, so a
 * workspace the operator closed — §6.4's accepted cost — leaves this run unable
 * to launch anything at all, and every further attempt fails here identically
 * until §8.6's breaker ends the run. The operator's recovery is a new run, and
 * a message that made them derive that from `workspace_not_found` would be the
 * lane failing quietly twice.
 */
function workspaceTabFailure(answer, identity, workspace) {
	return new FactoryWorkerError(
		"worker-launch-failed",
		`${answer.message} Workspace ${workspace} could not take a tab for attempt ${identity.attempt}. If it is gone, ` +
			`this run cannot launch into it again — a run adopts the workspace it opened and never opens a replacement ` +
			`(§6.4) — so a new run is what opens a new one. Nothing was closed (§13.B).`,
		{ ...identity, workspace, command: answer.command, exit_code: answer.exit_code, stderr: answer.stderr },
	);
}

function digestOf(content) {
	return createHash("sha256").update(content).digest("hex");
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
