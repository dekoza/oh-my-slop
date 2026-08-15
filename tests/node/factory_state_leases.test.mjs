import test from "node:test";
import assert from "node:assert/strict";

import { FactoryStateError } from "../../factory/lib/state/errors.mjs";
import {
	capacityModelSlot,
	capacityTicketSlot,
	isSuperseded,
	LEASE_NAMES,
	openLeases,
} from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { factorySources, makeRepo } from "./helpers/factory-repo.mjs";
import { makeAgentDir, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §4.6's one primitive: rows in the database, compare-and-swap, and a fencing
 * generation from a single DB-wide counter.
 */

const T0 = 1_770_000_000_000;

/** A controller's advisory identity blob — operator's eyes only (§4.6). */
function controllerIdentity(overrides = {}) {
	return {
		host: "workshop",
		boot_id: "6a1c9c0e-0b1e-4a5b-9a5f-3a0b6f5c1d22",
		pid: 4242,
		process_start_time: T0 - 5_000,
		run: "01JRUN0000000000000000000A",
		pane: "herdr:2",
		...overrides,
	};
}

/** The refusal a call throws, so its reason and details can be read. */
function refusalFrom(body) {
	try {
		body();
	} catch (error) {
		assert.ok(error instanceof FactoryStateError, `expected a FactoryStateError, got ${error}`);
		return error;
	}
	assert.fail("the call was expected to refuse, and returned");
}

// ── The row (§4.6) ───────────────────────────────────────────────────────────

test("an acquired lease row carries name, token, generation, expiry, renewal, and identity", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	const held = leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 });

	assert.equal(held.name, "controller");
	assert.match(held.token, /^[0-9a-f]{32}$/, "the holder token is 128 random bits");
	assert.equal(held.fencingGeneration, 1);
	assert.equal(held.expiresAt, T0 + 30_000);
	assert.equal(held.renewedAt, T0);

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.deepEqual(row, {
		name: "controller",
		token: held.token,
		fencingGeneration: 1,
		expiresAt: T0 + 30_000,
		renewedAt: T0,
		identity: controllerIdentity(),
	});
});

// ── Exclusion (§10.5) ────────────────────────────────────────────────────────

test("a second controller cannot acquire the controller lease, and the refusal names the holding run and pane", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const first = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: controllerIdentity(),
		ttlMs: 30_000,
	});

	const refusal = refusalFrom(() =>
		leases.acquire({
			name: LEASE_NAMES.controller,
			identity: controllerIdentity({ pid: 5151, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
			ttlMs: 30_000,
		}),
	);

	assert.equal(refusal.reason, "lease-held");
	assert.match(refusal.message, /01JRUN0000000000000000000A/, "the refusal does not name the holding run");
	assert.match(refusal.message, /herdr:2/, "the refusal does not name the holding pane");
	assert.equal(refusal.details.run, "01JRUN0000000000000000000A");
	assert.equal(refusal.details.pane, "herdr:2");

	assert.equal(leases.inspect(LEASE_NAMES.controller).token, first.token, "the refusal disturbed the holder");
});

// ── Release: compare-and-delete, never unconditional (§4.6) ──────────────────

test("the holder releases with its own token, and the lease is then free", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const held = leases.acquire({ name: LEASE_NAMES.integration, identity: controllerIdentity(), ttlMs: 300_000 });

	assert.equal(leases.release(held), true);
	assert.equal(leases.inspect(LEASE_NAMES.integration), null);

	const successor = leases.acquire({
		name: LEASE_NAMES.integration,
		identity: controllerIdentity(),
		ttlMs: 300_000,
	});
	assert.notEqual(successor.token, held.token);
	assert.ok(successor.fencingGeneration > held.fencingGeneration, "a re-acquired lease reuses its generation");
});

// ── Renewal and expiry (§4.8, §10.4) ─────────────────────────────────────────

test("renewal moves expiry and the renewal stamp forward, and keeps the generation", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });
	const held = leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 });

	clock = T0 + 10_000;
	const renewed = leases.renew(held);

	assert.equal(renewed.token, held.token);
	assert.equal(renewed.fencingGeneration, held.fencingGeneration, "renewal minted a generation");
	assert.equal(renewed.renewedAt, T0 + 10_000);
	assert.equal(renewed.expiresAt, T0 + 40_000);

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(row.renewedAt, renewed.renewedAt);
	assert.equal(row.expiresAt, renewed.expiresAt);
	assert.equal(row.token, held.token);
});

test("an expired lease is adopted without anyone testing a process, under a newer generation", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });
	const abandoned = leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 });

	clock = T0 + 30_001;
	const adopter = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: controllerIdentity({ pid: 5151, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
		ttlMs: 30_000,
	});

	assert.notEqual(adopter.token, abandoned.token);
	assert.ok(adopter.fencingGeneration > abandoned.fencingGeneration, "the adopter did not fence the dead holder out");
	assert.equal(leases.inspect(LEASE_NAMES.controller).identity.pane, "herdr:9");
});

// ── capacity:* — the same primitive, with no clock (§9.4) ────────────────────

test("capacity slots are discrete named rows", () => {
	assert.equal(capacityTicketSlot(0), "capacity:ticket:0");
	assert.equal(capacityModelSlot("local", 2), "capacity:model:local:2");
});

test("a capacity slot has no expiry, and no elapsed time ever frees it", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });
	const slot = leases.acquire({
		name: capacityTicketSlot(0),
		identity: controllerIdentity(),
		ttlMs: null,
	});

	assert.equal(slot.expiresAt, null);
	assert.equal(leases.inspect(capacityTicketSlot(0)).expiresAt, null);

	// A year later the pane may well still be alive and still holding the GPU.
	clock = T0 + 365 * 24 * 60 * 60 * 1000;
	const refusal = refusalFrom(() =>
		leases.acquire({ name: capacityTicketSlot(0), identity: controllerIdentity(), ttlMs: null }),
	);
	assert.equal(refusal.reason, "lease-held");
	assert.equal(leases.inspect(capacityTicketSlot(0)).token, slot.token);
});

// ── The DB-wide fencing counter (§4.6) ───────────────────────────────────────

test("fencing generations come from one counter, so they are totally ordered across all leases", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	const generations = [LEASE_NAMES.controller, LEASE_NAMES.integration, capacityTicketSlot(0)].map(
		(name) => leases.acquire({ name, identity: controllerIdentity(), ttlMs: null }).fencingGeneration,
	);

	assert.deepEqual(generations, [1, 2, 3], "the counter is not shared by every lease in the database");
});

test("a crash mid-integration leaves the lease held by a generation the next controller can see is dead", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	let clock = T0;

	const crashed = await openStore({ repoRoot, agentDir });
	const before = openLeases(crashed, { now: () => clock });
	before.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 });
	const integration = before.acquire({
		name: LEASE_NAMES.integration,
		identity: controllerIdentity(),
		ttlMs: 300_000,
	});
	// The controller dies mid-rebase: no release runs, and an in-process mutex
	// would simply have vanished with it.
	crashed.close();

	clock = T0 + 30_001;
	const store = await openTestStore(t, { repoRoot, agentDir });
	const leases = openLeases(store, { now: () => clock });
	const adopter = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: controllerIdentity({ pid: 5151, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
		ttlMs: 30_000,
	});

	const stale = leases.inspect(LEASE_NAMES.integration);
	assert.equal(stale.token, integration.token, "the integration lease did not survive the crash");
	assert.equal(isSuperseded(stale, adopter.fencingGeneration), true);
	// Not expired: the clock says nothing about it, and reconcile probes git.
	assert.ok(stale.expiresAt > clock);
});

// ── Reclaiming a dead holder's row — still compare-and-swap (§4.6, §9.4) ─────

test("a superseded row is reclaimed on its observed token, and a live one is not", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const slot = leases.acquire({ name: capacityTicketSlot(0), identity: controllerIdentity(), ttlMs: null });
	const live = leases.acquire({ name: capacityTicketSlot(1), identity: controllerIdentity(), ttlMs: null });
	const adopter = leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 });

	const wrongToken = refusalFrom(() =>
		leases.reclaim({ name: capacityTicketSlot(0), token: "f".repeat(32), generation: adopter.fencingGeneration }),
	);
	assert.equal(wrongToken.reason, "lease-lost");
	assert.equal(leases.inspect(capacityTicketSlot(0)).token, slot.token);

	const stillLive = refusalFrom(() =>
		leases.reclaim({ name: capacityTicketSlot(1), token: live.token, generation: live.fencingGeneration }),
	);
	assert.equal(stillLive.reason, "lease-held");
	assert.equal(leases.inspect(capacityTicketSlot(1)).token, live.token);

	leases.reclaim({ name: capacityTicketSlot(0), token: slot.token, generation: adopter.fencingGeneration });
	assert.equal(leases.inspect(capacityTicketSlot(0)), null);
});

// ── The row and its event commit together (§4.4) ─────────────────────────────

test("a capacity row and the event announcing it commit in one transaction", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const run = "01JRUN0000000000000000000A";
	store.append(runStarted(run));

	leases.acquire({
		name: capacityTicketSlot(0),
		identity: controllerIdentity(),
		ttlMs: null,
		event: {
			kind: "capacity.granted",
			source: "controller",
			run,
			occurredAt: T0,
			observedAt: T0,
			payload: { slot: capacityTicketSlot(0) },
		},
	});

	const events = store.readEvents({ stream: `run:${run}` });
	assert.deepEqual(
		events.map((event) => event.kind),
		["run.started", "capacity.granted"],
	);
	assert.equal(store.head().seq, 2);

	// A refused event takes the row down with it: there is no half of this.
	refusalFrom(() =>
		leases.acquire({
			name: capacityTicketSlot(1),
			identity: controllerIdentity(),
			ttlMs: null,
			event: { kind: "capacity.invented", source: "controller", run, occurredAt: T0, observedAt: T0, payload: {} },
		}),
	);
	assert.equal(leases.inspect(capacityTicketSlot(1)), null, "a row survived the event that was refused beside it");
	assert.equal(store.head().seq, 2);
});

// ── The closed set of lease objects (§4.6) ───────────────────────────────────

test("there is no worktree lease, and no other name can be acquired either", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	assert.deepEqual(Object.values(LEASE_NAMES), ["controller", "integration"]);

	// Attempt identity already makes a worktree single-writer (§4.6), so this is
	// not a lease that has been left out — it is one that cannot exist.
	const refusal = refusalFrom(() =>
		leases.acquire({
			name: "worktree:01JRUN0000000000000000000A-t93-a1",
			identity: controllerIdentity(),
			ttlMs: 30_000,
		}),
	);
	assert.equal(refusal.reason, "invalid-lease-name");

	for (const name of [LEASE_NAMES.controller, LEASE_NAMES.integration, capacityTicketSlot(3), capacityModelSlot("rico", 0)]) {
		assert.ok(leases.acquire({ name, identity: controllerIdentity(), ttlMs: null }), `${name} was refused`);
	}
});

// ── The two legacy failures, as regressions (§4.6) ───────────────────────────

test("regression: a non-owner releasing a lock leaves the owner holding it", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const owner = leases.acquire({ name: LEASE_NAMES.integration, identity: controllerIdentity(), ttlMs: 300_000 });

	// `job-pipeline`'s releaseJobLock was an unconditional rmSync: this call is
	// the same intent, made by a process that never held the lease.
	const intruder = { ...owner, token: "0".repeat(32) };
	assert.equal(leases.release(intruder), false);

	assert.equal(leases.inspect(LEASE_NAMES.integration).token, owner.token, "an intruder dropped the owner's lock");
	assert.equal(leases.renew(owner).token, owner.token, "the owner lost a lease it never released");
});

test("regression: a recorded pid is advisory — it neither holds a lapsed lease nor frees a live one", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });

	// `software-factory` recorded a pid it never tested, and its store still
	// holds a lock naming dead pid 3852874 — escapable only by hand-renaming the
	// file to `.lock.stale`. Here the same dead pid holds an unexpired lease, and
	// the dead pid is not what keeps it held.
	leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity({ pid: 3852874 }), ttlMs: 30_000 });
	assert.equal(
		refusalFrom(() =>
			leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 }),
		).reason,
		"lease-held",
	);

	// And the converse: a pid that is unmistakably alive — this test process —
	// does not keep a lapsed lease alive for one millisecond longer.
	clock = T0 + 30_001;
	leases.reclaim({ name: LEASE_NAMES.controller, token: leases.inspect(LEASE_NAMES.controller).token, generation: 1 });
	const live = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: controllerIdentity({ pid: process.pid }),
		ttlMs: 30_000,
	});
	clock = T0 + 60_002;
	const adopter = leases.acquire({ name: LEASE_NAMES.controller, identity: controllerIdentity(), ttlMs: 30_000 });
	assert.ok(adopter.fencingGeneration > live.fencingGeneration);
});

test("no lease leaves the database without its token compared, and no source tests a process", () => {
	for (const [path, source] of factorySources()) {
		for (const statement of source.match(/DELETE FROM lease[^"'`]*/g) ?? []) {
			assert.match(statement, /holder_token = \?/, `${path} deletes a lease without comparing the token`);
		}
		assert.doesNotMatch(source, /process\.kill\(/, `${path} tests a pid; §4.6's identity blob is advisory`);
	}
});
