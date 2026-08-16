import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
	attemptDir,
	attemptIdOf,
	attemptManifestPath,
	attemptOutboxPath,
	attemptPromptPath,
	attemptsRoot,
	herdrAgentName,
	herdrPaneTitle,
	launchedAttempt,
	ordinalOf,
	requireAttemptIdentity,
	runOf,
	ticketOf,
} from "../../factory/lib/worker/attempt.mjs";
import { worktreesRoot } from "../../factory/lib/git/isolation.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { attemptLaunched, makeAgentDir, openTestStore, refusalOf, runStarted } from "./helpers/factory-store.mjs";

/**
 * §6.5's correlation, as names and locations. Everything an attempt is
 * addressed by is **derived from the minted tuple**, which is what lets a
 * controller that died mid-launch re-find what it started.
 */

const RUN = "01JRUN0000000000000000000A";
const ATTEMPT = `${RUN}-t42-a1`;

// ── The minted tuple (§2.1, §6.5) ────────────────────────────────────────────

test("an attempt id is built from its parts, never spelled by a caller", () => {
	assert.equal(attemptIdOf({ run: RUN, ticket: 42, ordinal: 1 }), ATTEMPT);

	for (const broken of [
		{ run: null, ticket: 42, ordinal: 1 },
		{ run: RUN, ticket: 0, ordinal: 1 },
		{ run: RUN, ticket: 42, ordinal: 0 },
		{ run: RUN, ticket: "42", ordinal: 1 },
	]) {
		const error = refusalOf(() => attemptIdOf(broken));
		assert.ok(error instanceof FactoryWorkerError);
		assert.equal(error.reason, "attempt-identity-invalid");
	}
});

test("a tuple whose parts disagree is refused where it is first noticed", () => {
	assert.deepEqual({ ...requireAttemptIdentity({ run: RUN, ticket: 42, phase: "implement", attempt: ATTEMPT }) }, {
		run: RUN,
		ticket: 42,
		phase: "implement",
		attempt: ATTEMPT,
		ordinal: 1,
	});

	// The ticket in the id and the ticket beside it must be the same ticket, or
	// one ticket's identity ends up on another's branch, pane, and outbox.
	const crossed = refusalOf(() =>
		requireAttemptIdentity({ run: RUN, ticket: 43, phase: "implement", attempt: ATTEMPT }),
	);
	assert.equal(crossed.reason, "attempt-identity-invalid");
	assert.match(crossed.message, /does not name run/);

	const phaseless = refusalOf(() =>
		requireAttemptIdentity({ run: RUN, ticket: 42, phase: "claim", attempt: ATTEMPT }),
	);
	assert.match(phaseless.message, /§2.2's phases/);
});

test("the parts read back off an attempt id, and nothing else does", () => {
	assert.equal(runOf(ATTEMPT), RUN);
	assert.equal(ticketOf(ATTEMPT), 42);
	assert.equal(ordinalOf(ATTEMPT), 1);

	for (const notAnAttempt of ["", "nonsense", `${RUN}-t42`, `${RUN}-a1`, null]) {
		assert.equal(runOf(notAnAttempt), null);
		assert.equal(ticketOf(notAnAttempt), null);
		assert.equal(ordinalOf(notAnAttempt), null);
	}
});

// ── The controller-owned location (§6.6) ─────────────────────────────────────

test("the outbox sits outside the worktree, by construction rather than by rule", (t) => {
	const store = makeAgentDir(t);

	assert.equal(attemptOutboxPath(store, ATTEMPT), join(store, "attempts", ATTEMPT, "outbox.json"));
	assert.equal(attemptManifestPath(store, ATTEMPT), join(store, "attempts", ATTEMPT, "manifest.json"));
	assert.equal(attemptPromptPath(store, ATTEMPT), join(store, "attempts", ATTEMPT, "prompt.md"));

	// The two roots are siblings, so a `git clean` in the worktree — or §12.7's
	// eager deletion of an integrated attempt's worktree — cannot take the
	// result with it.
	assert.ok(!attemptsRoot(store).startsWith(worktreesRoot(store)));
	assert.ok(!worktreesRoot(store).startsWith(attemptsRoot(store)));
});

test("an attempt directory is contained by charset and by canonical prefix, both", (t) => {
	const store = makeAgentDir(t);

	const escaping = refusalOf(() => attemptDir(store, "../../etc"));
	assert.equal(escaping.reason, "attempt-identity-invalid");
	assert.match(escaping.message, /identity segment/);

	// A symlink planted as the attempt's own entry must not launder the path out
	// of the root: the charset check passes and the prefix assertion is what holds.
	mkdirSync(attemptsRoot(store), { recursive: true });
	symlinkSync("/tmp", join(attemptsRoot(store), "escapee"));
	const laundered = refusalOf(() => attemptDir(store, "escapee"));
	assert.match(laundered.message, /outside/);
});

// ── Herdr's own naming rules (§6.5) ──────────────────────────────────────────

test("the Herdr agent name is derived, deterministic, and inside Herdr's charset", () => {
	const name = herdrAgentName(ATTEMPT);

	assert.equal(name, herdrAgentName(ATTEMPT), "derivation, not allocation");
	assert.match(name, /^[a-z][a-z0-9_-]{0,31}$/, "Herdr refuses any other shape for a live agent name");
	assert.notEqual(name, ATTEMPT, "the attempt id itself leads with a digit and runs past 32 characters");

	// The ticket and the ordinal survive into the name, so an operator reading
	// `agent list` can tell two attempts on one ticket apart.
	assert.ok(name.endsWith("t42a1"));
	assert.notEqual(herdrAgentName(`${RUN}-t42-a2`), name);
	assert.equal(herdrPaneTitle(ATTEMPT), `factory ${ATTEMPT}`);
});

test("an attempt id Herdr could not name is a refusal, never a silent mangling", () => {
	const enormous = refusalOf(() => herdrAgentName(`${RUN}-t${"9".repeat(30)}-a1`));
	assert.equal(enormous.reason, "attempt-identity-invalid");
	assert.match(enormous.message, /Herdr's own rule/);
});

// ── The durable record of a mint (§2.1) ──────────────────────────────────────

test("a launched attempt is findable by its id alone", async (t) => {
	const store = await openTestStore(t);
	const opened = runStarted();
	store.append(opened);

	assert.equal(launchedAttempt(store, `${opened.run}-t42-a1`), null);
	store.append(attemptLaunched(opened.run, 42, 1));
	assert.equal(launchedAttempt(store, `${opened.run}-t42-a1`).ordinal, 1);
	assert.equal(launchedAttempt(store, `${opened.run}-t42-a2`), null);
});
