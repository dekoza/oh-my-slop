import test from "node:test";
import assert from "node:assert/strict";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { canonicalJson, digest } from "../../factory/lib/state/events.mjs";
import { FactoryEffectError } from "../../factory/lib/effects/errors.mjs";
import { requestEffect, resolveEffect, unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §4.5's requested/resolved pair: the canonical `effect` row the database
 * enforces unique, and the journal records that ride the same transaction.
 */

/** A store with a live run, which is what an effect is nearly always scoped to. */
async function storeWithRun(t) {
	const store = await openTestStore(t);
	const run = newUlid();
	store.append(runStarted(run));
	return { store, run };
}

test("requesting an effect writes the canonical row and its event in one transaction", async (t) => {
	const { store, run } = await storeWithRun(t);

	const requested = requestEffect(store, {
		run,
		ticket: 92,
		phase: "preflight",
		operation: "label-add",
		operand: "in-progress",
		actor: "controller",
		fencingGeneration: 1,
		payload: { label: "in-progress" },
		at: 1_770_000_100_000,
	});

	assert.equal(requested.key, `${run}/92/preflight/-/label-add/in-progress`);
	assert.equal(requested.outcome, "requested");

	const row = store.read((db) => db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(requested.key));
	assert.equal(row.state, "requested");
	assert.equal(row.actor, "controller");
	assert.equal(row.fencing_generation, 1);
	assert.equal(row.operation, "label-add");
	assert.equal(row.operand, "in-progress");

	const events = store.readEvents({ stream: `run:${run}` }).filter((event) => event.kind === "effect.requested");
	assert.equal(events.length, 1);
	assert.equal(events[0].payload.effect_key, requested.key);
	assert.equal(events[0].seq, row.requested_seq, "the row does not name the event it committed with");
});

test("the same key with the same payload is the same effect, and the database enforces it", async (t) => {
	const { store, run } = await storeWithRun(t);
	const request = {
		run,
		ticket: 92,
		phase: "preflight",
		operation: "comment-post",
		operand: "claim",
		actor: "controller",
		fencingGeneration: 1,
		payload: { body: "Claimed by run " + run },
		at: 1_770_000_100_000,
	};

	const first = requestEffect(store, request);
	const second = requestEffect(store, { ...request, at: 1_770_000_200_000 });

	assert.equal(second.key, first.key);
	assert.equal(second.outcome, "already-requested");

	const rows = store.read((db) => db.prepare("SELECT * FROM effect").all());
	assert.equal(rows.length, 1, "a duplicate request became a second row");
	assert.equal(rows[0].requested_at, 1_770_000_100_000, "the duplicate overwrote the original request");

	const requests = store.readEvents({}).filter((event) => event.kind === "effect.requested");
	assert.equal(requests.length, 1, "a duplicate request emitted a second intent record");
});

test("the same key with a different payload is a typed conflict, never a second mutation", async (t) => {
	const { store, run } = await storeWithRun(t);
	const request = {
		run,
		ticket: 92,
		phase: "integrate",
		operation: "pr-body-update",
		actor: "controller",
		fencingGeneration: 1,
		payload: { body: "attempt 1" },
		at: 1_770_000_100_000,
	};

	requestEffect(store, request);

	assert.throws(
		() => requestEffect(store, { ...request, payload: { body: "attempt 2" } }),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-payload-conflict",
	);

	// The refusal rolled back whole: no orphan event, no half-written row.
	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM effect").get().n), 1);
	assert.equal(store.readEvents({}).filter((event) => event.kind === "effect.requested").length, 1);
});

test("resolving commits the result, and re-issuing the effect returns it rather than mutating again", async (t) => {
	const { store, run } = await storeWithRun(t);
	const request = {
		run,
		ticket: 92,
		phase: "preflight",
		operation: "comment-post",
		operand: "claim",
		actor: "controller",
		fencingGeneration: 1,
		payload: { body: "Claimed." },
		at: 1_770_000_100_000,
	};

	const { key } = requestEffect(store, request);
	const resolved = resolveEffect(store, {
		key,
		actor: "controller",
		fencingGeneration: 1,
		result: { comment_id: 4171 },
		at: 1_770_000_150_000,
	});

	assert.equal(resolved.outcome, "resolved");

	const row = store.read((db) => db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(key));
	assert.equal(row.state, "resolved");
	assert.equal(row.resolved_at, 1_770_000_150_000);
	assert.deepEqual(JSON.parse(row.result), { comment_id: 4171 });

	const events = store.readEvents({}).filter((event) => event.kind === "effect.resolved");
	assert.equal(events.length, 1);
	assert.equal(events[0].seq, row.resolved_seq);

	// §4.5: identical payload ⇒ the committed result, not a second comment.
	const reissued = requestEffect(store, { ...request, at: 1_770_000_300_000 });
	assert.equal(reissued.outcome, "already-resolved");
	assert.deepEqual(reissued.result, { comment_id: 4171 });
	assert.equal(store.readEvents({}).filter((event) => event.kind === "effect.requested").length, 1);
});

test("a repo-scoped effect is a whole effect: nullable segments, controller stream", async (t) => {
	const store = await openTestStore(t);

	// An orphaned artifact blob belongs to no run and no ticket (§4.5), and
	// cleanup's own actions land on the controller stream (§12.8) — a run stream
	// would be a record about to be deleted by the thing it documents.
	const requested = requestEffect(store, {
		phase: "cleanup",
		operation: "cleanup-artifact",
		operand: "orphan-blob",
		actor: "operator:cleanup-execute",
		fencingGeneration: 1,
		payload: { digest_count: 3 },
		at: 1_770_000_100_000,
	});

	assert.equal(requested.key, "-/-/cleanup/-/cleanup-artifact/orphan-blob");

	const row = store.read((db) => db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(requested.key));
	assert.equal(row.run_id, null);
	assert.equal(row.ticket, null);
	assert.equal(row.attempt_id, null);
	assert.equal(row.actor, "operator:cleanup-execute");

	const events = store.readEvents({ stream: "controller" });
	assert.equal(events.length, 1);
	assert.equal(events[0].source, "operator", "an operator verb's effect was recorded as the controller's");
});

test("an effect names an actor, and the slot is an identity rather than a free-text note", async (t) => {
	const { store, run } = await storeWithRun(t);
	const request = {
		run,
		ticket: 92,
		phase: "preflight",
		operation: "issue-assign",
		actor: "controller",
		fencingGeneration: 1,
		payload: { assignee: "minder" },
		at: 1_770_000_100_000,
	};

	// Monitor O6, carried by §13.D: who asked for this. The read-only first
	// release enumerates no operator verbs, but the slot is on the pair now so a
	// write path is additive rather than a redesign.
	for (const actor of [undefined, null, "", "the controller", "operator", "Operator:Stop"]) {
		assert.throws(
			() => requestEffect(store, { ...request, actor }),
			(error) => error instanceof FactoryEffectError && error.details.at === "actor",
			`${JSON.stringify(actor ?? null)} was accepted as an actor`,
		);
	}

	assert.doesNotThrow(() => requestEffect(store, { ...request, actor: "operator:stop" }));
});

test("an operand that is the payload's own digest is refused (§14.4)", async (t) => {
	const { store, run } = await storeWithRun(t);
	const payload = { body: "Claimed." };
	const payloadDigest = digest(canonicalJson(payload));

	// The digest sits *beside* the key. Keyed by it instead, a conflicting
	// duplicate would silently become a *different* key and the typed conflict
	// above would never fire — so the check is against the payload actually in
	// hand, prefix included, not just the shape of a full sha256.
	for (const operand of [payloadDigest, payloadDigest.slice(0, 12)]) {
		assert.throws(
			() =>
				requestEffect(store, {
					run,
					ticket: 92,
					phase: "preflight",
					operation: "comment-post",
					operand,
					actor: "controller",
					fencingGeneration: 1,
					payload,
					at: 1_770_000_100_000,
				}),
			(error) => error instanceof FactoryEffectError && error.details.at === "operand",
			`${operand} was accepted as an operand`,
		);
	}
});

test("an unregistered operation cannot be requested — there would be no probe to settle it", async (t) => {
	const { store, run } = await storeWithRun(t);

	assert.throws(
		() =>
			requestEffect(store, {
				run,
				ticket: 92,
				phase: "integrate",
				operation: "pr-merge",
				actor: "controller",
				fencingGeneration: 1,
				payload: {},
				at: 1_770_000_100_000,
			}),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-kind-unknown",
	);

	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM effect").get().n), 0);
});

test("an effect row and its event are never committed separately", async (t) => {
	const store = await openTestStore(t);

	// §14.8, from the effect side: the event is refused — no run was ever
	// started — so the row must not exist either.
	assert.throws(() =>
		requestEffect(store, {
			run: newUlid(),
			ticket: 92,
			phase: "implement",
			operation: "label-add",
			operand: "in-progress",
			actor: "controller",
			fencingGeneration: 1,
			payload: { label: "in-progress" },
			at: 1_770_000_100_000,
		}),
	);

	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM effect").get().n), 0);
	assert.equal(store.head().seq, 0, "an event survived the rollback that dropped its effect row");
});

test("unresolved effects are the reconcile scope, oldest first", async (t) => {
	const { store, run } = await storeWithRun(t);
	const base = {
		run,
		ticket: 92,
		phase: "implement",
		actor: "controller",
		fencingGeneration: 1,
		at: 1_770_000_100_000,
	};

	const first = requestEffect(store, { ...base, operation: "branch-create", operand: "factory/t92/a1", payload: {} });
	const second = requestEffect(store, { ...base, operation: "worktree-create", operand: "t92-a1", payload: {} });
	resolveEffect(store, { key: first.key, actor: "controller", fencingGeneration: 1, result: {}, at: 1_770_000_200_000 });

	assert.deepEqual(
		unresolvedEffects(store).map((row) => row.effect_key),
		[second.key],
	);
	assert.deepEqual(unresolvedEffects(store, { run: newUlid() }), []);
});

// ── Fencing (§14.5) ──────────────────────────────────────────────────────────

/**
 * The `controller` lease row, held at `generation`. Writing it belongs to the
 * lease primitive; this test only needs a current holder to exist.
 */
function holdControllerLease(store, generation) {
	store.read((db) =>
		db
			.prepare(
				`INSERT INTO lease(name, holder_token, fencing_generation, expires_at, renewed_at, identity)
				 VALUES ('controller', ?, ?, ?, ?, NULL)
				 ON CONFLICT(name) DO UPDATE SET holder_token = excluded.holder_token,
				                                 fencing_generation = excluded.fencing_generation`,
			)
			.run(`token-${generation}`, generation, 1_770_000_900_000, 1_770_000_100_000),
	);
}

test("an effect resolving under a superseded generation is rejected", async (t) => {
	const { store, run } = await storeWithRun(t);
	holdControllerLease(store, 2);

	const { key } = requestEffect(store, {
		run,
		ticket: 92,
		phase: "implement",
		operation: "branch-create",
		operand: "factory/t92/a1",
		actor: "controller",
		fencingGeneration: 2,
		payload: { branch: "factory/t92/a1" },
		at: 1_770_000_100_000,
	});

	// The lease moved on: another controller adopted this repository. The old one
	// may still be mid-call to git, and its resolution must not land — that is
	// what lets a controller which lost its lease just exit (§4.6) instead of
	// having to win the race.
	holdControllerLease(store, 3);

	assert.throws(
		() => resolveEffect(store, { key, actor: "controller", fencingGeneration: 2, result: {}, at: 1_770_000_200_000 }),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-superseded-generation",
	);

	const row = store.read((db) => db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(key));
	assert.equal(row.state, "requested", "a superseded resolution was honoured");
	assert.equal(store.readEvents({}).filter((event) => event.kind === "effect.resolved").length, 0);

	// The current holder settles it, which is the whole point of the pair
	// surviving the controller that requested it.
	const resolved = resolveEffect(store, {
		key,
		actor: "controller",
		fencingGeneration: 3,
		result: { sha: "9b27b20" },
		at: 1_770_000_300_000,
	});
	assert.equal(resolved.outcome, "resolved");
});

test("acquiring another lease does not fence a controller out of its own effects", async (t) => {
	const { store, run } = await storeWithRun(t);
	holdControllerLease(store, 2);

	const { key } = requestEffect(store, {
		run,
		ticket: 92,
		phase: "integrate",
		operation: "push",
		operand: "factory/t92/a1",
		actor: "controller",
		fencingGeneration: 2,
		payload: { branch: "factory/t92/a1" },
		at: 1_770_000_100_000,
	});

	// §4.6's counter is DB-wide, so the *same* controller taking the integration
	// lease advances it past 2. Comparing against the counter rather than the
	// controller lease's holder would fence a live controller out of its own
	// work mid-integration.
	store.read((db) => db.prepare("UPDATE fencing_generation SET value = 7 WHERE id = 1").run());

	assert.equal(
		resolveEffect(store, { key, actor: "controller", fencingGeneration: 2, result: {}, at: 1_770_000_200_000 }).outcome,
		"resolved",
	);
});

test("a resolution for an effect nobody requested is refused", async (t) => {
	const { store, run } = await storeWithRun(t);

	// §14.1: the journal never establishes an external fact. A resolution with no
	// request would be recording an outcome for an intent nothing recorded.
	assert.throws(
		() =>
			resolveEffect(store, {
				key: `${run}/92/preflight/-/label-add/in-progress`,
				actor: "controller",
				fencingGeneration: 1,
				result: {},
				at: 1_770_000_150_000,
			}),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-unrequested",
	);
});
