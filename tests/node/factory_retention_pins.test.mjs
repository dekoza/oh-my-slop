import test from "node:test";
import assert from "node:assert/strict";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { requestEffect, resolveEffect } from "../../factory/lib/effects/records.mjs";
import { PINS, pinsForRun } from "../../factory/lib/retention/pins.mjs";
import { openTestStore, runEnded, runStarted } from "./helpers/factory-store.mjs";

/**
 * §12.4's pins — **three classes, and they govern cleanup too**.
 *
 * A run never leaves tier 1 while it has an open PR, a member ticket carrying
 * `factory:failed` or `factory:needs-human`, or an unresolved effect. Every one
 * of them is read from durable state, because expiry runs unattended under the
 * controller lease and a pin that needed the network would be a pin that fails
 * open the first time Gitea is down.
 */

const AT = 1_770_000_000_000;
const GENERATION = 1;

/** A store holding one ended run, which is the only shape expiry ever considers. */
async function storeWithEndedRun(t) {
	const store = await openTestStore(t);
	const run = newUlid();
	store.append(runStarted(run, { at: AT }));
	store.append(runEnded(run, { at: AT + 1000 }));
	return { store, run };
}

/** A member ticket that settled at the given disposition, so the run has one to pin on. */
function settleTicket(store, run, ticket, disposition) {
	store.append({
		kind: "attempt.launched",
		source: "controller",
		run,
		ticket,
		phase: "implement",
		attempt: `${run}-t${ticket}-a1`,
		occurredAt: AT,
		observedAt: AT,
		payload: { role: "implement", profile: "builder" },
	});
	store.append({
		kind: "ticket.disposition-changed",
		source: "controller",
		run,
		ticket,
		occurredAt: AT,
		observedAt: AT,
		payload: { disposition, reason_class: "worker-paused", fault: "product" },
	});
}

/**
 * §5.1's issue fact **and the `observed_issue` row it upserts** — both halves,
 * because both are what a real poll leaves behind and the pins read one of each.
 */
function observeLabels(store, ticket, labels, { state = "open", run = null, at = AT } = {}) {
	store.transaction(({ db }) =>
		db
			.prepare(
				`INSERT INTO observed_issue(ticket, content_version, state, updated_at, observed_at, last_seq)
				 VALUES (?, NULL, ?, ?, ?, 0)
				 ON CONFLICT(ticket) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
			)
			.run(ticket, state, at, at),
	);
	store.append({
		kind: "observation.recorded",
		source: "gitea",
		run,
		ticket,
		occurredAt: at,
		observedAt: at,
		foreignSourceId: `gitea:issue:${ticket}@${at}`,
		payload: {
			fact_classes: ["ticket.state", "ticket.labels"],
			kind: "issue",
			foreign_id: `gitea:issue:${ticket}@${at}`,
			occurred_at_raw: new Date(at).toISOString(),
			observed: { ticket, state, labels },
		},
	});
}

/**
 * An observation of the same ticket that states **no labels** — a herdr liveness
 * fact, a probe answer. Most `observation.recorded` records are this shape:
 * §5.2's authority table is per fact class, and only Gitea's issue snapshot
 * establishes `ticket.labels`.
 */
function observeLiveness(store, ticket, { run = null, at = AT } = {}) {
	store.append({
		kind: "observation.recorded",
		source: "herdr",
		run,
		ticket,
		// Herdr states no time of its own (§4.3), so receipt is the only moment
		// anyone observed and both stamps are ours.
		occurredAt: at,
		observedAt: at,
		foreignSourceId: `herdr:worker-alive:${ticket}@${at}`,
		payload: {
			fact_classes: ["worker.alive"],
			kind: "worker",
			foreign_id: `herdr:worker-alive:${ticket}@${at}`,
			observed: { alive: true },
		},
	});
}

test("an unresolved effect pins its run (§12.4)", async (t) => {
	const { store, run } = await storeWithEndedRun(t);

	const requested = requestEffect(store, {
		operation: "branch-delete",
		operand: "factory/t90/a1",
		run,
		ticket: 90,
		phase: "cleanup",
		actor: "controller",
		fencingGeneration: GENERATION,
		payload: { branch: "factory/t90/a1" },
	});

	assert.deepEqual(
		pinsForRun(store, run, { at: AT }).map((pin) => pin.pin),
		[PINS.unresolvedEffect],
	);

	resolveEffect(store, { key: requested.key, actor: "controller", fencingGeneration: GENERATION, result: { gone: true } });

	assert.deepEqual(pinsForRun(store, run, { at: AT }), []);
});

test("a member ticket carrying factory:failed pins its run, and an observation clearing it lets go (§12.4)", async (t) => {
	const { store, run } = await storeWithEndedRun(t);
	settleTicket(store, run, 90, "failed");
	observeLabels(store, 90, ["workflow:implement", "factory:failed"]);

	assert.deepEqual(
		pinsForRun(store, run, { at: AT }).map((entry) => [entry.pin, entry.ticket, entry.detail.labels]),
		[[PINS.attentionLabel, 90, ["factory:failed"]]],
	);

	// A human cleared the label; §5.1's next repository-wide poll is what says so.
	observeLabels(store, 90, ["workflow:implement"], { at: AT + 60_000 });

	assert.deepEqual(pinsForRun(store, run, { at: AT + 60_000 }), []);
});

test("a released label pin stays released when a later observation of the ticket states no labels", async (t) => {
	const { store, run } = await storeWithEndedRun(t);
	settleTicket(store, run, 90, "failed");
	observeLabels(store, 90, ["workflow:implement"], { at: AT + 60_000 });

	// A later run retries the ticket, and its worker's liveness is recorded
	// against the same ticket. It establishes nothing about labels (§5.2), so it
	// must not be what the pin reads — falling back to this run's own settled
	// disposition here would re-engage the pin permanently, since §8.9 never
	// changes a disposition on an ended run.
	observeLiveness(store, 90, { at: AT + 120_000 });

	assert.deepEqual(pinsForRun(store, run, { at: AT + 120_000 }), []);
});

test("with no observation at all the run's own disposition pins it, and says which basis answered", async (t) => {
	const { store, run } = await storeWithEndedRun(t);
	settleTicket(store, run, 91, "paused");

	assert.deepEqual(
		pinsForRun(store, run, { at: AT }).map((entry) => [entry.pin, entry.detail.labels, entry.detail.basis]),
		[[PINS.attentionLabel, ["factory:needs-human"], "disposition"]],
	);
});

test("a published ticket's pull request pins its run until the tracker reports the ticket closed (§12.4, §7.5)", async (t) => {
	const { store, run } = await storeWithEndedRun(t);
	settleTicket(store, run, 92, "published");
	const created = requestEffect(store, {
		operation: "pr-create",
		run,
		ticket: 92,
		phase: "integrate",
		actor: "controller",
		fencingGeneration: GENERATION,
		payload: { head: "factory/t92/a1" },
	});
	resolveEffect(store, {
		key: created.key,
		actor: "controller",
		fencingGeneration: GENERATION,
		result: { number: 7, url: "http://tracker/pulls/7" },
	});
	observeLabels(store, 92, ["factory:awaiting-merge"], { state: "open" });

	assert.deepEqual(
		pinsForRun(store, run, { at: AT }).map((entry) => entry.pin),
		[PINS.openPr],
	);

	// The human merged: §7.5's `Closes #N` discharges the ticket, and that is the
	// durable fact the pin reads.
	observeLabels(store, 92, ["factory:awaiting-merge"], { state: "closed", at: AT + 60_000 });

	assert.deepEqual(pinsForRun(store, run, { at: AT + 60_000 }), []);
});

test("a requested pull request nobody resolved pins as an unresolved effect, not as an open PR", async (t) => {
	const { store, run } = await storeWithEndedRun(t);
	settleTicket(store, run, 93, "published");
	requestEffect(store, {
		operation: "pr-create",
		run,
		ticket: 93,
		phase: "integrate",
		actor: "controller",
		fencingGeneration: GENERATION,
		payload: { head: "factory/t93/a1" },
	});
	observeLabels(store, 93, ["factory:awaiting-merge"]);

	assert.deepEqual(
		pinsForRun(store, run, { at: AT }).map((entry) => entry.pin),
		[PINS.unresolvedEffect],
		"a PR the world may never have seen was reported as open",
	);
});
