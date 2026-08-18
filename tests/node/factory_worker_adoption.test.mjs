import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { ADOPTION_VERDICTS } from "../../factory/lib/domain/vocabulary.mjs";
import { attemptDir, attemptOutboxPath } from "../../factory/lib/worker/attempt.mjs";
import {
	candidateAttempt,
	createAdoptionProbe,
	NO_CANDIDATE,
	proveAdoption,
	TEST_RESULTS,
} from "../../factory/lib/worker/adoption.mjs";
import { FIXED_NOW as T0, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §5.5: **adopt when identity is provable; declare dead otherwise** — and the
 * five tests that decide which, each of them able to prevent adoption on its
 * own.
 *
 * The third verdict is what the suite spends most of its assertions on: a Herdr
 * that would not answer and a path that could not be read are not evidence of
 * absence, and settling a row on either would evict a worker still holding the
 * resource §9.4's row exists to protect.
 */

const TICKET = 42;

/** A pane as `pane list` renders it, carrying this attempt's token. */
function paneFor(attempt, { agent = "pi", status = "working", id = "w1:p2" } = {}) {
	return {
		pane_id: id,
		workspace_id: "w1",
		agent_status: status,
		tokens: { FACTORY_ATTEMPT: attempt },
		...(agent === null ? {} : { agent }),
	};
}

/** The one read this module makes of the world, and nothing else. */
function herdrShowing(pane, { ok = true, message = "Herdr refused `pane list` (exit 1)." } = {}) {
	const calls = [];
	return {
		calls,
		paneForAttempt: async (attempt) => {
			calls.push(attempt);
			return ok ? { ok: true, pane } : { ok: false, message };
		},
	};
}

/**
 * A store holding one launched, correlated, unfinished attempt — the state a
 * controller that died mid-implement leaves behind.
 */
async function orphaned(
	t,
	{ correlated = true, ended = false, runtime = "pi", kind = "pi", worktree = "present", outbox = "designated" } = {},
) {
	const store = await openTestStore(t);
	const run = runStarted().run;
	store.append(runStarted(run));

	const attempt = `${run}-t${TICKET}-a1`;
	const worktreePath = join(store.storeDir, "worktrees", attempt);
	if (worktree === "present") mkdirSync(worktreePath, { recursive: true });
	mkdirSync(attemptDir(store.storeDir, attempt), { recursive: true });

	store.append({
		kind: "attempt.launched",
		source: "controller",
		run,
		ticket: TICKET,
		phase: "implement",
		attempt,
		occurredAt: T0,
		observedAt: T0,
		payload: {
			role: "implement",
			runtime,
			profile: "builder",
			worktree: worktreePath,
			outbox:
				outbox === "designated" ? attemptOutboxPath(store.storeDir, attempt) : "/somewhere/else/outbox.json",
		},
	});

	if (correlated) {
		store.append({
			kind: "attempt.correlated",
			source: "controller",
			run,
			ticket: TICKET,
			phase: "implement",
			attempt,
			occurredAt: T0 + 1,
			observedAt: T0 + 1,
			payload: {
				runtime,
				herdr: { workspace: "w1", tab: "w1:t2", pane: "w1:p2", agent: "agent-name", ...(kind === null ? {} : { kind }) },
				transcript: null,
			},
		});
	}

	if (ended) {
		store.append({
			kind: "attempt.ended",
			source: "controller",
			run,
			ticket: TICKET,
			phase: "implement",
			attempt,
			occurredAt: T0 + 2,
			observedAt: T0 + 2,
			payload: { outcome: "no-result" },
		});
	}

	const mint = store.readEvents({ kind: "attempt.launched" }).find((event) => event.attempt === attempt);
	return { store, run, attempt, mint, worktreePath };
}

// ── All five, and each of them alone (§5.5) ──────────────────────────────────

test("all five tests passing is the whole of provable", async (t) => {
	const { store, mint, attempt } = await orphaned(t);

	const proved = await proveAdoption({ store, herdr: herdrShowing(paneFor(attempt)), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.provable);
	assert.deepEqual(proved.tests, {
		token: TEST_RESULTS.pass,
		"pane-alive": TEST_RESULTS.pass,
		"agent-kind": TEST_RESULTS.pass,
		worktree: TEST_RESULTS.pass,
		outbox: TEST_RESULTS.pass,
	});
	assert.equal(proved.attempt, attempt);
	assert.equal(proved.detail.pane, "w1:p2");
});

test("no pane carries the token: nothing is adopted, and Herdr said so", async (t) => {
	const { store, mint } = await orphaned(t);

	const proved = await proveAdoption({ store, herdr: herdrShowing(null), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(proved.tests.token, TEST_RESULTS.fail);
	assert.equal(proved.tests["pane-alive"], TEST_RESULTS.fail, "there is no live agent of any kind to adopt");
});

test("a stamped pane back at its shell prompt is not a live worker", async (t) => {
	const { store, mint, attempt } = await orphaned(t);

	const proved = await proveAdoption({
		store,
		herdr: herdrShowing(paneFor(attempt, { agent: null, status: "unknown" })),
		mint,
	});

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(proved.tests.token, TEST_RESULTS.pass, "the token survived the agent");
	assert.equal(proved.tests["pane-alive"], TEST_RESULTS.fail);
});

test("a different harness in this attempt's pane is not this attempt's worker", async (t) => {
	const { store, mint, attempt } = await orphaned(t, { runtime: "pi", kind: "pi" });

	const proved = await proveAdoption({ store, herdr: herdrShowing(paneFor(attempt, { agent: "claude" })), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(proved.tests["agent-kind"], TEST_RESULTS.fail);
	assert.equal(proved.detail.agent_expected, "pi");
	assert.equal(proved.detail.agent, "claude");
});

test("a worktree integration already reclaimed leaves nowhere for the worker to have been working", async (t) => {
	const { store, mint, attempt, worktreePath } = await orphaned(t);
	rmSync(worktreePath, { recursive: true });

	const proved = await proveAdoption({ store, herdr: herdrShowing(paneFor(attempt)), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(proved.tests.worktree, TEST_RESULTS.fail);
});

test("an outbox path that is not the one this store reads is a worker writing where nobody looks", async (t) => {
	const { store, mint, attempt } = await orphaned(t, { outbox: "elsewhere" });

	const proved = await proveAdoption({ store, herdr: herdrShowing(paneFor(attempt)), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(proved.tests.outbox, TEST_RESULTS.fail);
});

test("the controller-owned attempt directory going away disproves the outbox too", async (t) => {
	const { store, mint, attempt } = await orphaned(t);
	rmSync(attemptDir(store.storeDir, attempt), { recursive: true });

	const proved = await proveAdoption({ store, herdr: herdrShowing(paneFor(attempt)), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(proved.tests.outbox, TEST_RESULTS.fail);
});

// ── Unanswerable is not absent (§5.2, §12.4) ─────────────────────────────────

test("a Herdr that will not answer leaves three tests unknown and adopts nothing", async (t) => {
	const { store, mint } = await orphaned(t);

	const proved = await proveAdoption({ store, herdr: herdrShowing(null, { ok: false }), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.unanswerable);
	assert.deepEqual(
		[proved.tests.token, proved.tests["pane-alive"], proved.tests["agent-kind"]],
		[TEST_RESULTS.unknown, TEST_RESULTS.unknown, TEST_RESULTS.unknown],
	);
	assert.equal(proved.tests.worktree, TEST_RESULTS.pass, "the filesystem still answered");
	assert.equal(proved.detail.herdr_answered, false);
	assert.match(proved.detail.herdr_message, /pane list/);
});

test("a path that could not be read is unknown, and only ENOENT is absence", async (t) => {
	const { store, mint, attempt } = await orphaned(t);

	const proved = await proveAdoption({
		store,
		herdr: herdrShowing(paneFor(attempt)),
		mint,
		// A permission, an unmounted share, an IO error: reading any of them as
		// "gone" would evict a live worker over a mount that was slow to come back.
		pathState: () => TEST_RESULTS.unknown,
	});

	assert.equal(proved.verdict, ADOPTION_VERDICTS.unanswerable);
});

test("an authoritative negative outranks an unanswerable read", async (t) => {
	const { store, mint, worktreePath } = await orphaned(t);
	rmSync(worktreePath, { recursive: true });

	// Herdr said nothing at all, and the worktree is provably gone. One proof of
	// absence is enough, whatever else went unanswered.
	const proved = await proveAdoption({ store, herdr: herdrShowing(null, { ok: false }), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.disproved);
});

// ── The candidate: unfinished *and* correlated ───────────────────────────────

test("an attempt the projections already settled is no candidate, whatever its pane looks like", async (t) => {
	const { store, run, attempt } = await orphaned(t, { ended: true });

	assert.deepEqual(candidateAttempt(store, { run, ticket: TICKET, attempt }), {
		mint: null,
		refusal: NO_CANDIDATE.ended,
	});

	// And through the probe a capacity row reaches: disproved, naming no attempt
	// to settle — a second ending is the one the projector refuses.
	const answered = await createAdoptionProbe({ store, herdr: herdrShowing(paneFor(attempt)) })({
		identity: { run, ticket: TICKET, attempt },
	});
	assert.equal(answered.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(answered.attempt, null);
	assert.equal(answered.detail.refusal, NO_CANDIDATE.ended);
	assert.equal(answered.detail.named_attempt, attempt);
});

test("an uncorrelated attempt is a launch to finish, never a worker to adopt", async (t) => {
	const { store, run, attempt } = await orphaned(t, { correlated: false });

	assert.equal(candidateAttempt(store, { run, ticket: TICKET, attempt }).refusal, NO_CANDIDATE.uncorrelated);
});

test("a lane row names a ticket and no attempt, and the ticket execution's live attempt is what it stands for", async (t) => {
	const { store, run, attempt } = await orphaned(t);

	assert.equal(candidateAttempt(store, { run, ticket: TICKET, attempt: null }).mint.attempt, attempt);
	assert.equal(
		candidateAttempt(store, { run, ticket: TICKET + 1, attempt: null }).refusal,
		NO_CANDIDATE.unlaunched,
		"another ticket's row must not adopt this lane's worker",
	);
});

test("a row addressing neither an attempt nor a ticket stands for no work at all", async (t) => {
	const { store, run } = await orphaned(t);

	assert.equal(candidateAttempt(store, { run, ticket: null, attempt: null }).refusal, NO_CANDIDATE.unaddressed);
	assert.equal(candidateAttempt(store, {}).refusal, NO_CANDIDATE.unaddressed);
});

test("an attempt this store never minted is no candidate", async (t) => {
	const { store, run } = await orphaned(t);

	assert.equal(
		candidateAttempt(store, { run, ticket: TICKET, attempt: `${run}-t${TICKET}-a9` }).refusal,
		NO_CANDIDATE.unlaunched,
	);
});

// ── Compatibility, and what this module refuses to do ────────────────────────

test("a correlation written before the kind existed falls back to the mint's runtime", async (t) => {
	const { store, mint, attempt } = await orphaned(t, { kind: null, runtime: "claude" });

	const proved = await proveAdoption({ store, herdr: herdrShowing(paneFor(attempt, { agent: "claude" })), mint });

	assert.equal(proved.verdict, ADOPTION_VERDICTS.provable);
	assert.equal(proved.detail.agent_expected, "claude");
});

test("proving identity reads Herdr and nothing else — no keys, no eviction, no pid (§5.5, §13.B)", () => {
	// Comments stripped, as every grep of the shipped tree in this suite does:
	// the prose is where a module explains what it refuses to do, and matching it
	// would fail on the explanation rather than on the code.
	const code = readFileSync(fileURLToPath(new URL("../../factory/lib/worker/adoption.mjs", import.meta.url)), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, "")
		.replaceAll(/\/\/[^\n]*/g, "");

	// §5.5 settles two controllers with the lease and its fencing generation,
	// **not** by killing the worker — so none of the ways to kill one may appear
	// here at all.
	for (const forbidden of [/stopAgent/, /send-keys/, /AGENT_STOP_KEYS/, /process\.kill/, /\bpid\b/]) {
		assert.doesNotMatch(code, forbidden, `adoption.mjs reaches for ${forbidden}`);
	}
});

test("a disproved verdict is data: the probe writes nothing", async (t) => {
	const { store, run, attempt } = await orphaned(t);
	const before = store.readEvents({}).length;

	await createAdoptionProbe({ store, herdr: herdrShowing(null) })({ identity: { run, ticket: TICKET, attempt } });

	assert.equal(store.readEvents({}).length, before, "acting on the verdict belongs to the modules that own the writes");
});
