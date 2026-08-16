import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { agentAlive, FACTORY_ATTEMPT_TOKEN, transcriptPointerOf } from "../controller/herdr-control.mjs";
import { fromPane, watchPane } from "../controller/herdr-events.mjs";
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
	launchedAttempt,
	requireAttemptIdentity,
} from "./attempt.mjs";
import { assertClosureResolvable } from "./closure.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { readOutbox } from "./outbox.mjs";
import { renderAttemptPrompt } from "./prompt.mjs";
import { attemptRecheck } from "./recheck.mjs";

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

/**
 * How long a settled worker gets before its silence is called silent-completion.
 *
 * A worker writes the outbox during its turn and settles a moment later, so the
 * file is normally there first. The grace covers the reverse order rather than
 * assuming it cannot happen: calling `no-result` on a worker whose write is
 * one filesystem beat behind would burn a repair budget on a completed attempt.
 */
export const SETTLE_GRACE_MS = 2_000;

/** The agent statuses that mean the turn is over (§6.6's liveness half). */
const SETTLED_STATUSES = Object.freeze(["idle", "done", "released", "exited"]);

/** The two that mean the worker is gone rather than waiting for input. */
const GONE_STATUSES = Object.freeze(["released", "exited"]);

/**
 * §6.6's deadline when nobody declared one. Thirty minutes: an order of
 * magnitude over the longest attempt observed live (~3 minutes), and short
 * enough that a worker hung mid-turn surrenders its lane the same night
 * rather than never. A profile declares `attemptTimeoutMs` to move it.
 */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 1_800_000;

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
 * 3. the pane is opened, **stamped**, given §6.5's identity variables, and the
 *    agent started — one effect, because a pane carrying no token is a pane
 *    reconcile cannot recognise and §14.27 will not clean up;
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

/**
 * §6.6's wait: **first-signal-wins**, over the outbox and the worker's liveness.
 *
 * Neither signal is polled the same way, and that asymmetry is §5.1's. Herdr is
 * **subscribed** to, because a poll structurally cannot see `working → blocked
 * → working` between two samples, and the transitions are recorded as events.
 * The outbox is a file this controller designated and is re-read on a short
 * interval — there is nothing to subscribe to and no transition to miss, only a
 * file that appears once.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold
 * @param {{ run: string, ticket: number, phase: string, attempt: string }} context.identity
 * @param {string} context.pane the pane this attempt runs in
 * @param {string} context.agent the Herdr agent name
 * @param {string} context.socket the Herdr socket path
 * @param {object} context.herdr the Herdr control surface
 * @param {number} context.timeoutMs the attempt's deadline
 * @param {string} context.actor
 * @param {() => number} context.now
 * @param {(ms: number) => Promise<void>} [context.sleep]
 * @param {Function} [context.watch] injectable subscription opener
 * @param {number} [context.pollIntervalMs]
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
		actor,
		now,
		sleep = delay,
		watch = watchPane,
		pollIntervalMs = OUTBOX_POLL_INTERVAL_MS,
		settleGraceMs = SETTLE_GRACE_MS,
	},
) {
	const identity = requireAttemptIdentity(minted);
	requireLaunched(store, identity);

	const outboxPath = attemptOutboxPath(store.storeDir, identity.attempt);
	const deadline = now() + timeoutMs;
	const observer = observationRecorder(store, { hold, identity, pane, actor, now });

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
	});

	try {
		for (;;) {
			while (pending.length > 0) {
				const entry = pending.shift();
				if (entry.degradation !== undefined) {
					observer.degraded(entry.degradation, entry.at);
					continue;
				}
				liveness = readLiveness(entry.transition, liveness, entry.at);
				observer.record(entry.transition, entry.at);
			}

			// First schema-valid content wins: the loop keeps the first valid read
			// and never re-reads for state, so a worker writing again after the
			// harvest is writing evidence (§6.6).
			const outbox = readOutbox(outboxPath, identity);
			const decided = decideOutcome({ outbox, liveness, at: now(), deadline, settleGraceMs });
			if (decided !== null) {
				return await settle(store, {
					hold,
					identity,
					herdr,
					agent,
					outcome: decided.outcome,
					outbox,
					liveness,
					actor,
					now,
				});
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
export async function cancelAttempt(store, { hold, identity: minted, herdr, agent, by, reason, actor, now }) {
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
	});
}

/**
 * §6.6's state table, as one function: **(outbox validity × worker liveness)**.
 *
 * | outbox | worker | outcome |
 * |---|---|---|
 * | schema-valid | settled | the worker's own status |
 * | schema-valid | still working | `wrote-but-hung` — harvest it anyway (§8.10) |
 * | present, invalid | either | `invalid-result` |
 * | valid, foreign tuple | either | `automation-failure` (§6.5) |
 * | absent | gone | `dead-worker` |
 * | absent | settled past the grace | `no-result` — silent completion |
 * | absent | working, past the deadline | `timeout` |
 * | absent | working | undecided; keep waiting |
 *
 * The two absences are different faults and route to different budgets (§8.10):
 * a worker that ended its turn without writing failed at its own job, while a
 * pane that died under it is the automation's failure.
 *
 * @returns {Readonly<{ outcome: string }> | null} null while nothing has decided
 */
export function decideOutcome({ outbox, liveness, at, deadline, settleGraceMs = SETTLE_GRACE_MS }) {
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
	if (at >= deadline) return Object.freeze({ outcome: "timeout" });

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

	const opened = await herdr.openPane({ cwd: worktreePath, label: `factory-${attempt}` });
	if (!opened.ok) throw launchFailure(opened, identity);

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
async function settle(store, { hold, identity, herdr, agent, outcome, outbox, liveness, cancellation = null, actor, now }) {
	const { run, ticket, phase, attempt } = identity;
	const stopped = await stopAgent(store, { hold, identity, herdr, agent, actor, at: now() });
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
			// §5.2: the outbox is **evidence**, so what it claimed rides the record
			// and never becomes the record. The controller's own rerun is the
			// attestation boundary (§14.16).
			result: outbox?.record ?? null,
			problems: outbox === null ? [] : [...outbox.problems],
			worker_status: liveness === null ? null : liveness.status,
			// The wedged pane §13.B accepts: recorded as an anomaly, never escalated.
			agent_stopped: stopped.stopped,
			cancelled_by: cancellation?.by ?? null,
			cancellation_reason: cancellation?.reason ?? null,
		},
	});

	return Object.freeze({
		outcome,
		record: outbox?.record ?? null,
		problems: outbox === null ? Object.freeze([]) : outbox.problems,
		worker_status: liveness === null ? null : liveness.status,
		agent_stopped: stopped.stopped,
		cancellation: cancellation === null ? null : Object.freeze({ ...cancellation }),
	});
}

/**
 * §13.B's stop, as §4.5's `agent-stop` effect: the agent's own quit keys, then
 * a read of the pane to see whether it went. **It never closes the pane** — the
 * controller stops agents and closes nothing, worker pane or its own.
 */
async function stopAgent(store, { hold, identity, herdr, agent, actor, at }) {
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

	await herdr.stopAgent(agent);
	const after = await herdr.paneForAttempt(attempt);
	const stopped = after.ok ? !agentAlive(after.pane) : null;

	const resolved = resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: hold.fence().generation,
		result: { agent, stopped, pane: after.ok ? (after.pane?.pane_id ?? null) : null },
		at,
	});
	return resolved.result;
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
	let ordinal = recordedTransitions(store, { run, attempt });
	let degradedOnce = false;

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
	};
}

/** How many transitions this store has already recorded for the attempt. */
function recordedTransitions(store, { run, attempt }) {
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

function digestOf(content) {
	return createHash("sha256").update(content).digest("hex");
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
