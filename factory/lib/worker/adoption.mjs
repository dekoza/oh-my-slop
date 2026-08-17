import { statSync } from "node:fs";
import { dirname } from "node:path";

import { agentAlive, FACTORY_ATTEMPT_TOKEN } from "../controller/herdr-control.mjs";
import { ADOPTION_VERDICTS } from "../domain/vocabulary.mjs";
import { runStream } from "../state/events.mjs";
import { attemptOutboxPath } from "./attempt.mjs";

/**
 * §5.5: **adopting a live worker.**
 *
 * > Herdr runs in its own server process, so a resumed controller routinely
 * > finds a live worker session well into an implement phase. **Adopt when
 * > identity is provable; declare dead otherwise.** Discarding it would throw
 * > away real model work because the *controller* died.
 *
 * This module answers exactly one question — *may this attempt's worker be
 * adopted?* — and answers it with **three** outcomes rather than the two §5.5
 * names. Provable and disproved are the specification's; the third is what
 * makes them safe. A Herdr that will not answer and a filesystem path that
 * cannot be read both taught this process **nothing**, and "unanswerable" is not
 * "absent" (§5.2, §12.4): settling a row on a read that failed would evict a
 * pane still talking to the resource §9.4's row exists to protect.
 *
 * Nothing here mutates. The verdict is data; acting on it — moving a capacity
 * row (`capacity/slots.mjs`), settling a disproved attempt
 * (`worker/lifecycle.mjs`) — belongs to the modules that own those writes.
 *
 * **Two controllers both adopting is prevented by the controller lease and its
 * fencing generation, not by killing the worker** (§5.5). There is therefore no
 * eviction, no quit sequence, and no pid anywhere in this file.
 */

/**
 * §5.5's adoption test — **all five**: token matches **and** pane alive **and**
 * agent kind matches **and** recorded worktree exists **and** outbox path
 * intact. The list is the order they are reported in, and every one of them
 * independently prevents adoption.
 */
export const ADOPTION_TESTS = Object.freeze(["token", "pane-alive", "agent-kind", "worktree", "outbox"]);

/**
 * What one test answered. `unknown` is the third value everywhere in this
 * module: a test that could not be run is not a test that failed (§11.2).
 */
export const TEST_RESULTS = Object.freeze({ pass: "pass", fail: "fail", unknown: "unknown" });

/**
 * Why no attempt was even a candidate. A row can name an attempt that has
 * already ended, or a ticket execution that never got a worker up — and both
 * are *disproved* rather than unanswerable, because durable state answered
 * them outright.
 */
export const NO_CANDIDATE = Object.freeze({
	ended: "attempt-already-ended",
	uncorrelated: "attempt-never-correlated",
	unlaunched: "attempt-never-launched",
	unaddressed: "row-names-no-work",
});

/**
 * **The attempt a capacity row may be adopted for, or null.**
 *
 * The row's identity blob is advisory (§4.6), so the attempt it names is a
 * *lead* rather than an answer: this function re-derives from the journal
 * whether that attempt is still work a controller may resume. Both halves are
 * needed and neither implies the other:
 *
 * - **correlated** — its launch finished (§6.5). An attempt with a mint and no
 *   correlation is one a controller died in the middle of launching, and §6.4's
 *   re-entry *finishes* that launch rather than adopting a worker that may
 *   never have been prompted.
 * - **unfinished** — no `attempt.ended`. One the projections already settled has
 *   ended whatever its pane looks like, and a wedged pane that still passes all
 *   five tests would otherwise be adopted for it, reaching the projector's
 *   refusal of a second ending as an automation failure instead of the row being
 *   released.
 *
 * @param {object} store an open store
 * @param {{ run: string | null, ticket: number | null, attempt: string | null }} identity
 *   a capacity row's advisory blob
 * @returns {Readonly<{ mint: object | null, refusal: string | null }>} the
 *   `attempt.launched` record to prove against, or why there is none
 */
export function candidateAttempt(store, { run = null, ticket = null, attempt = null } = {}) {
	// A row naming neither an attempt nor a ticket addresses no work at all.
	// Scanning the run for *any* unfinished attempt would adopt one lane's
	// worker on another lane's row (§2.1).
	if (run === null || (ticket === null && attempt === null)) {
		return Object.freeze({ mint: null, refusal: NO_CANDIDATE.unaddressed });
	}

	const stream = runStream(run);
	const minted = store.readEvents({ stream, kind: "attempt.launched" });
	const correlated = new Set(store.readEvents({ stream, kind: "attempt.correlated" }).map((event) => event.attempt));
	const ended = new Set(store.readEvents({ stream, kind: "attempt.ended" }).map((event) => event.attempt));

	if (attempt !== null) {
		const mint = minted.find((event) => event.attempt === attempt) ?? null;
		if (mint === null) return Object.freeze({ mint: null, refusal: NO_CANDIDATE.unlaunched });
		if (ended.has(attempt)) return Object.freeze({ mint: null, refusal: NO_CANDIDATE.ended });
		if (!correlated.has(attempt)) return Object.freeze({ mint: null, refusal: NO_CANDIDATE.uncorrelated });
		return Object.freeze({ mint, refusal: null });
	}

	// §9.4's lane rows are taken **before the claim**, so they name a ticket and
	// no attempt at all. The ticket execution's own attempts are what the row
	// stands for, and the latest correlated-and-unfinished one is the worker a
	// resumed lane would be resuming — the earlier ones have ended, or the walk
	// would not have minted a later one.
	const candidates = minted.filter((event) => event.ticket === ticket);
	if (candidates.length === 0) return Object.freeze({ mint: null, refusal: NO_CANDIDATE.unlaunched });

	const live = candidates.filter((event) => correlated.has(event.attempt) && !ended.has(event.attempt));
	if (live.length === 0) {
		return Object.freeze({
			mint: null,
			refusal: candidates.some((event) => ended.has(event.attempt))
				? NO_CANDIDATE.ended
				: NO_CANDIDATE.uncorrelated,
		});
	}

	return Object.freeze({ mint: live.at(-1), refusal: null });
}

/**
 * §5.5's five tests, asked together, about one attempt.
 *
 * @param {object} input
 * @param {object} input.store an open store — the outbox path this store
 *   designates is what "intact" is measured against
 * @param {object} input.herdr the Herdr control surface
 * @param {object} input.mint the attempt's `attempt.launched` record
 * @param {object | null} [input.correlation] its `attempt.correlated` record,
 *   which carries the agent kind Herdr was asked to start
 * @param {(path: string) => "pass" | "fail" | "unknown"} [input.pathState]
 *   injectable filesystem read, for the same reason the Herdr surface is
 * @returns {Promise<Readonly<object>>} the verdict, its five tests, and the
 *   evidence a record can carry
 */
export async function proveAdoption({ store, herdr, mint, correlation = null, pathState = statePathState }) {
	const attempt = mint.attempt;
	const listed = await herdr.paneForAttempt(attempt);
	const pane = listed.ok ? listed.pane : null;
	const expectedKind = agentKindOf(mint, correlation);

	const tests = {};

	// 1 and 2. **The token, and a live agent under it** — the same pair the
	// `agent-start` probe asks (§5.3), because a pane stamped with this
	// attempt's token whose agent never started is precisely the crash §6.4
	// orders its steps to make visible.
	if (!listed.ok) {
		tests.token = TEST_RESULTS.unknown;
		tests["pane-alive"] = TEST_RESULTS.unknown;
		tests["agent-kind"] = TEST_RESULTS.unknown;
	} else if (pane === null) {
		// Herdr answered, and no pane carries the token. That is an authoritative
		// negative about all three: there is no live agent of any kind to adopt.
		tests.token = TEST_RESULTS.fail;
		tests["pane-alive"] = TEST_RESULTS.fail;
		tests["agent-kind"] = TEST_RESULTS.fail;
	} else {
		tests.token = TEST_RESULTS.pass;
		tests["pane-alive"] = agentAlive(pane) ? TEST_RESULTS.pass : TEST_RESULTS.fail;
		// 3. **The agent kind.** A pane that kept this attempt's token while a
		// different harness came up in it is not this attempt's worker, and
		// prompting it would be the controller talking to a session it never
		// launched.
		tests["agent-kind"] =
			expectedKind === null
				? TEST_RESULTS.unknown
				: pane.agent === expectedKind
					? TEST_RESULTS.pass
					: TEST_RESULTS.fail;
	}

	// 4. **The recorded worktree.** §7.3's one-worktree-per-attempt is what makes
	// a resumed lane's commits attributable; a worker whose worktree integration
	// already reclaimed has nowhere to have been working.
	tests.worktree = pathState(mint.payload.worktree);

	// 5. **The outbox path, intact.** Two things, and both are the same fact from
	// different ends: the path the worker was told to write is still the one this
	// store reads, and the controller-owned directory holding it is still there.
	// A store that moved leaves a worker writing where nobody is looking (§6.4).
	tests.outbox = outboxState(store, mint, pathState);

	const answered = ADOPTION_TESTS.map((name) => tests[name]);
	const verdict = answered.includes(TEST_RESULTS.fail)
		? ADOPTION_VERDICTS.disproved
		: answered.includes(TEST_RESULTS.unknown)
			? ADOPTION_VERDICTS.unanswerable
			: ADOPTION_VERDICTS.provable;

	return Object.freeze({
		verdict,
		attempt,
		run: mint.run,
		ticket: mint.ticket,
		// The phase the mint recorded, so a caller that has to settle this attempt
		// has §2.1's whole identity tuple without reading the journal a second time.
		phase: mint.phase,
		tests: Object.freeze(tests),
		detail: Object.freeze({
			token: FACTORY_ATTEMPT_TOKEN,
			pane: pane?.pane_id ?? null,
			agent: pane?.agent ?? null,
			agent_expected: expectedKind,
			agent_status: pane?.agent_status ?? null,
			worktree: mint.payload.worktree,
			outbox: mint.payload.outbox,
			// Named rather than left as a silent `unknown`: an operator reading a
			// retained row needs to know it was Herdr that would not answer.
			herdr_answered: listed.ok,
			herdr_message: listed.ok ? null : (listed.message ?? null),
		}),
	});
}

/**
 * The probe `capacity/slots.mjs` calls over one superseded row: **which attempt
 * this row stands for, and whether that attempt's worker is provably alive.**
 *
 * It is injected there for the reason every other external read is (§5.3): the
 * pool owns the row, and the runtime that can ask a multiplexer a question is
 * wired in from outside.
 *
 * @param {{ store: object, herdr: object, pathState?: Function }} where
 * @returns {(row: { identity: object }) => Promise<Readonly<object>>}
 */
export function createAdoptionProbe({ store, herdr, pathState = statePathState }) {
	return async ({ identity = {} } = {}) => {
		const candidate = candidateAttempt(store, {
			run: identity.run ?? null,
			ticket: identity.ticket ?? null,
			attempt: identity.attempt ?? null,
		});

		if (candidate.mint === null) {
			// Durable state answered outright: there is no unfinished, correlated
			// attempt behind this row. Nothing external is asked, because nothing
			// external could change the answer — and the row is settled on that
			// evidence rather than left for a clock (§9.4, §14.1).
			//
			// **`attempt` is null, and that is what says "nothing to settle"**: the
			// attempt this row named has already ended, or never got a worker up, so
			// an ending written for it now would be the second one the projector
			// refuses. The name it carried is evidence, and rides the detail.
			return Object.freeze({
				verdict: ADOPTION_VERDICTS.disproved,
				attempt: null,
				run: identity.run ?? null,
				ticket: identity.ticket ?? null,
				phase: null,
				tests: Object.freeze({}),
				detail: Object.freeze({
					refusal: candidate.refusal,
					basis: "durable-state",
					named_attempt: identity.attempt ?? null,
				}),
			});
		}

		return proveAdoption({
			store,
			herdr,
			mint: candidate.mint,
			correlation: correlationOf(store, candidate.mint),
			pathState,
		});
	};
}

/** The `attempt.correlated` record for a mint, or null when the launch never finished. */
function correlationOf(store, mint) {
	return (
		store
			.readEvents({ stream: runStream(mint.run), kind: "attempt.correlated" })
			.find((event) => event.attempt === mint.attempt) ?? null
	);
}

/**
 * The Herdr agent kind this attempt was started as.
 *
 * From **payload v2 of `attempt.correlated`** it is recorded outright, because
 * §5.5's third test compares against it and comparing against a value nobody
 * wrote down would be inference. A v1 record predates the field, and the
 * runtime on the mint is the honest fallback: both shipped runtimes start under
 * their own name (`pi.mjs`, `claude.mjs`), so for every record written before
 * the field existed the two are the same value.
 */
function agentKindOf(mint, correlation) {
	return correlation?.payload?.herdr?.kind ?? mint.payload?.runtime ?? null;
}

/**
 * The outbox half of test 5. Both readings have to hold: the recorded path is
 * the one this store designates for the attempt, and the directory it lands in
 * is still there.
 */
function outboxState(store, mint, pathState) {
	const designated = attemptOutboxPath(store.storeDir, mint.attempt);
	if (mint.payload.outbox !== designated) return TEST_RESULTS.fail;
	return pathState(dirname(designated));
}

/**
 * A path, as one of the three answers. **`ENOENT` is the only absence**;
 * everything else a filesystem can refuse with — a permission, an unmounted
 * share, an IO error — taught this process nothing, and reading it as "gone"
 * would evict a live worker over a mount that was slow to come back (§12.4).
 */
function statePathState(path) {
	if (typeof path !== "string" || path === "") return TEST_RESULTS.fail;
	try {
		statSync(path);
		return TEST_RESULTS.pass;
	} catch (error) {
		return error.code === "ENOENT" || error.code === "ENOTDIR" ? TEST_RESULTS.fail : TEST_RESULTS.unknown;
	}
}
