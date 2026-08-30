import test from "node:test";
import assert from "node:assert/strict";

import {
	capacityModelSlot,
	capacityTicketSlot,
	CONTROLLER_LEASE_TTL_MS,
	isSuperseded,
	LEASE_NAMES,
	openLeases,
	parseCapacitySlot,
} from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { factorySources, makeRepo } from "./helpers/factory-repo.mjs";
import {
	FIXED_NOW as T0,
	leaseIdentity,
	makeAgentDir,
	openTestStore,
	refusalOf,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §4.6's one primitive: rows in the database, compare-and-swap, and a fencing
 * generation from a single DB-wide counter.
 */

// ── The row (§4.6) ───────────────────────────────────────────────────────────

test("an acquired lease row carries name, token, generation, expiry, renewal, and identity", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	const held = leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });

	assert.equal(held.name, "controller");
	assert.match(held.token, /^[0-9a-f]{32}$/, "the holder token is 128 random bits");
	assert.equal(held.fencingGeneration, 1);
	assert.equal(held.expiresAt, T0 + CONTROLLER_LEASE_TTL_MS);
	assert.equal(held.renewedAt, T0);

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.deepEqual(row, {
		name: "controller",
		token: held.token,
		fencingGeneration: 1,
		expiresAt: T0 + CONTROLLER_LEASE_TTL_MS,
		renewedAt: T0,
		identity: leaseIdentity(),
	});
});

test("two holders never share a token", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	const tokens = new Set(
		[LEASE_NAMES.controller, LEASE_NAMES.integration, capacityTicketSlot(0), capacityTicketSlot(1)].map(
			(name) => leases.acquire({ name, identity: leaseIdentity() }).token,
		),
	);

	assert.equal(tokens.size, 4);
});

// ── Exclusion (§10.5) ────────────────────────────────────────────────────────

test("a second controller cannot acquire the controller lease, and the refusal names the holding run and pane", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const first = leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });

	const refusal = refusalOf(() =>
		leases.acquire({
			name: LEASE_NAMES.controller,
			identity: leaseIdentity({ pid: 5151, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
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
	const held = leases.acquire({ name: LEASE_NAMES.integration, identity: leaseIdentity() });

	assert.equal(leases.release(held), true);
	assert.equal(leases.inspect(LEASE_NAMES.integration), null);

	const successor = leases.acquire({ name: LEASE_NAMES.integration, identity: leaseIdentity() });
	assert.notEqual(successor.token, held.token);
	assert.ok(successor.fencingGeneration > held.fencingGeneration, "a re-acquired lease reused its generation");
});

// ── Renewal and expiry (§4.8, §10.4) ─────────────────────────────────────────

test("renewal moves expiry and the renewal stamp forward, and keeps the generation", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });
	const held = leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });

	clock = T0 + 10_000;
	const renewed = leases.renew(held);

	assert.equal(renewed.token, held.token);
	assert.equal(renewed.fencingGeneration, held.fencingGeneration, "renewal minted a generation");
	assert.equal(renewed.renewedAt, T0 + 10_000);
	assert.equal(renewed.expiresAt, T0 + 10_000 + CONTROLLER_LEASE_TTL_MS);

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(row.renewedAt, renewed.renewedAt);
	assert.equal(row.expiresAt, renewed.expiresAt);
	assert.equal(row.token, held.token);
});

test("an expired controller lease is adopted without anyone testing a process, under a newer generation", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });
	const abandoned = leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });

	clock = T0 + CONTROLLER_LEASE_TTL_MS + 1;
	const adopter = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: leaseIdentity({ pid: 5151, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
	});

	assert.notEqual(adopter.token, abandoned.token);
	assert.ok(adopter.fencingGeneration > abandoned.fencingGeneration, "the adopter did not fence the dead holder out");
	assert.equal(leases.inspect(LEASE_NAMES.controller).identity.pane, "herdr:9");
});

// ── No clock frees anything else (§9.4, invariant 22) ────────────────────────

test("the controller lease is the only timed one; integration and capacity carry no expiry", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	for (const name of [LEASE_NAMES.integration, capacityTicketSlot(0), capacityModelSlot("rico", 0)]) {
		assert.equal(leases.acquire({ name, identity: leaseIdentity() }).expiresAt, null, `${name} was given a TTL`);
		assert.equal(leases.inspect(name).expiresAt, null);
	}
});

test("no elapsed time frees a capacity slot or an integration lease", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });
	const slot = leases.acquire({ name: capacityTicketSlot(0), identity: leaseIdentity() });
	const integration = leases.acquire({ name: LEASE_NAMES.integration, identity: leaseIdentity() });

	// A year later the pane may well still be alive and still holding the GPU,
	// and a crashed integration is settled by probing git, never by a clock.
	clock = T0 + 365 * 24 * 60 * 60 * 1000;

	for (const name of [capacityTicketSlot(0), LEASE_NAMES.integration]) {
		assert.equal(refusalOf(() => leases.acquire({ name, identity: leaseIdentity() })).reason, "lease-held");
	}
	assert.equal(leases.inspect(capacityTicketSlot(0)).token, slot.token);
	assert.equal(leases.inspect(LEASE_NAMES.integration).token, integration.token);
});

test("capacity slots are discrete named rows", () => {
	assert.equal(capacityTicketSlot(0), "capacity:ticket:0");
	assert.equal(capacityModelSlot("local", 2), "capacity:model:local:2");
});

test("a pool is read in one query, and each row still names its own holder", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });
	leases.acquire({ name: capacityTicketSlot(1), identity: leaseIdentity({ ticket: 42 }) });
	leases.acquire({ name: capacityModelSlot("local", 0), identity: leaseIdentity({ ticket: 42 }) });

	assert.deepEqual(
		leases.list("capacity:").map((row) => [row.name, row.identity.ticket]),
		[
			["capacity:model:local:0", 42],
			["capacity:ticket:1", 42],
		],
		"the controller lease is not a capacity row, and a counter could name no holder at all",
	);
	assert.deepEqual(leases.list("capacity:model:local:"), [leases.inspect(capacityModelSlot("local", 0))]);
});

// ── The DB-wide fencing counter (§4.6) ───────────────────────────────────────

test("fencing generations come from one counter, so they are totally ordered across all leases", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });

	const generations = [LEASE_NAMES.controller, LEASE_NAMES.integration, capacityTicketSlot(0)].map(
		(name) => leases.acquire({ name, identity: leaseIdentity() }).fencingGeneration,
	);

	assert.deepEqual(generations, [1, 2, 3], "the counter is not shared by every lease in the database");
});

test("a crash mid-integration leaves the lease held by a generation the next controller can see is dead", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	let clock = T0;

	const crashed = await openStore({ repoRoot, agentDir });
	const before = openLeases(crashed, { now: () => clock });
	before.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });
	const integration = before.acquire({ name: LEASE_NAMES.integration, identity: leaseIdentity() });
	// The controller dies mid-rebase: no release runs, and an in-process mutex
	// would simply have vanished with it.
	crashed.close();

	clock = T0 + CONTROLLER_LEASE_TTL_MS + 1;
	const store = await openTestStore(t, { repoRoot, agentDir });
	const leases = openLeases(store, { now: () => clock });
	const adopter = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: leaseIdentity({ pid: 5151, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
	});

	const stale = leases.inspect(LEASE_NAMES.integration);
	assert.equal(stale.token, integration.token, "the integration lease did not survive the crash");
	assert.equal(isSuperseded(stale, adopter.fencingGeneration), true, "the dead holder's generation reads as live");
	assert.equal(isSuperseded(leases.inspect(LEASE_NAMES.controller), adopter.fencingGeneration), false);
});

// ── The row and its event commit together (§4.4) ─────────────────────────────

test("a capacity row and the event announcing it commit in one transaction", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const run = "01JRUN0000000000000000000A";
	store.append(runStarted(run));

	leases.acquire({
		name: capacityTicketSlot(0),
		identity: leaseIdentity(),
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
	refusalOf(() =>
		leases.acquire({
			name: capacityTicketSlot(1),
			identity: leaseIdentity(),
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
	const refusal = refusalOf(() =>
		leases.acquire({ name: "worktree:01JRUN0000000000000000000A-t93-a1", identity: leaseIdentity() }),
	);
	assert.equal(refusal.reason, "invalid-lease-name");

	const acceptable = [LEASE_NAMES.controller, LEASE_NAMES.integration, capacityTicketSlot(3), capacityModelSlot("rico", 0)];
	for (const name of acceptable) {
		assert.ok(leases.acquire({ name, identity: leaseIdentity() }), `${name} was refused`);
	}
});

// ── The two legacy failures, as regressions (§4.6) ───────────────────────────

test("regression: a non-owner releasing a lock leaves the owner holding it", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const owner = leases.acquire({ name: LEASE_NAMES.integration, identity: leaseIdentity() });

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
	leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity({ pid: 3852874 }) });
	assert.equal(
		refusalOf(() => leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() })).reason,
		"lease-held",
	);

	// And the converse: a pid that is unmistakably alive — this test process —
	// does not keep a lapsed lease alive for one millisecond longer.
	clock = T0 + CONTROLLER_LEASE_TTL_MS + 1;
	const live = leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity({ pid: process.pid }) });
	clock += CONTROLLER_LEASE_TTL_MS + 1;
	const adopter = leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity() });

	assert.ok(adopter.fencingGeneration > live.fencingGeneration);
});

test("§15's PID reuse and replacement, injected: the recycled pid decides nothing either way", async (t) => {
	const store = await openTestStore(t);
	let clock = T0;
	const leases = openLeases(store, { now: () => clock });

	// A controller records its identity and dies. The host reboots, the kernel
	// hands the same pid to something else, and that process is alive right now —
	// the exact confusion §4.6's blob exists to make visible and to decide
	// nothing by.
	const dead = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: leaseIdentity({ pid: 4242, boot_id: "boot-one", process_start_time: T0 - 5_000 }),
	});

	// Before the TTL, the row is held — and it is the clock that says so, not the
	// pid: the recycled process being alive changes nothing.
	assert.equal(
		refusalOf(() =>
			leases.acquire({
				name: LEASE_NAMES.controller,
				identity: leaseIdentity({ pid: 4242, boot_id: "boot-two", process_start_time: T0 + 1_000 }),
			}),
		).reason,
		"lease-held",
	);

	// After it, the successor adopts without asking anything about the pid, and
	// its generation strictly supersedes the dead holder's.
	clock = T0 + CONTROLLER_LEASE_TTL_MS + 1;
	const successor = leases.acquire({
		name: LEASE_NAMES.controller,
		identity: leaseIdentity({ pid: 4242, boot_id: "boot-two", process_start_time: T0 + 1_000 }),
	});
	assert.ok(successor.fencingGeneration > dead.fencingGeneration);

	// **Replacement**: the row now names the same pid under a different boot, and
	// the blob is what makes the reuse readable while the token is what decides.
	// The predecessor's hold, whose blob is indistinguishable by pid, is gone.
	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(row.identity.pid, 4242);
	assert.equal(row.identity.boot_id, "boot-two");
	assert.notEqual(row.token, dead.token);
	assert.equal(refusalOf(() => leases.renew(dead)).reason, "lease-lost");
	assert.equal(leases.release(dead), false, "a recycled pid does not release its namesake's row");
	assert.equal(leases.inspect(LEASE_NAMES.controller).token, successor.token);
});

// ── §5.5's adoption: rows move, they are never freed and re-taken ────────────

test("adoption swaps a capacity row onto a new token and generation, on the predecessor's own token", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const slot = capacityTicketSlot(0);
	const dead = leases.acquire({ name: slot, fencedTo: 1, identity: { run: "R", ticket: 42, pool: "ticket" } });

	const [adopted] = leases.adoptAll(
		[{ row: leases.inspect(slot), identity: { run: "R", ticket: 42, pool: "ticket", attempt: "R-t42-a1" } }],
		{ fencedTo: 9, at: T0 + 1 },
	);

	assert.equal(adopted.name, slot);
	assert.equal(adopted.fencingGeneration, 9);
	assert.notEqual(adopted.token, dead.token);
	assert.equal(adopted.expiresAt, null, "a capacity row carries no TTL, and adoption does not give it one");

	const row = leases.inspect(slot);
	assert.equal(row.token, adopted.token);
	assert.equal(row.identity.attempt, "R-t42-a1");
	assert.equal(leases.release(dead), false, "the predecessor's token no longer holds the row");
	assert.equal(leases.release(adopted), true);
});

test("a lane's rows move together or not at all: half a lane is a row nothing can resume", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	const ticket = capacityTicketSlot(0);
	const model = capacityModelSlot("local", 0);
	leases.acquire({ name: ticket, fencedTo: 1, identity: { run: "R", ticket: 42, pool: "ticket" } });
	leases.acquire({ name: model, fencedTo: 1, identity: { run: "R", ticket: 42, pool: "model" } });
	const rows = [leases.inspect(ticket), leases.inspect(model)];

	// The model row moves under the transfer — a third party took it — so the
	// whole adoption is refused and the ticket row is untouched.
	leases.release(rows[1]);
	const refused = refusalOf(() =>
		leases.adoptAll(
			rows.map((row) => ({ row, identity: { ...row.identity } })),
			{ fencedTo: 9, at: T0 + 1 },
		),
	);

	assert.equal(refused.reason, "lease-adoption-refused");
	assert.equal(leases.inspect(ticket).fencingGeneration, 1, "the first row was rolled back with the second");
	assert.equal(leases.inspect(ticket).token, rows[0].token);
});

test("adoption moves capacity rows only: the two singleton objects have their own settlements", async (t) => {
	const store = await openTestStore(t);
	const leases = openLeases(store, { now: () => T0 });
	leases.acquire({ name: LEASE_NAMES.integration, identity: leaseIdentity() });

	const refused = refusalOf(() =>
		leases.adoptAll([{ row: leases.inspect(LEASE_NAMES.integration), identity: {} }], { fencedTo: 9 }),
	);

	assert.equal(refused.reason, "invalid-lease-name");
	assert.match(refused.message, /§9.5/, "an integration lease is settled by probing git, never transferred");
});

test("a capacity row's pool, class, and index are read off its name, never off the advisory blob", () => {
	assert.deepEqual({ ...parseCapacitySlot(capacityTicketSlot(3)) }, { pool: "ticket", class: null, index: 3 });
	assert.deepEqual({ ...parseCapacitySlot(capacityModelSlot("claude-code", 2)) }, {
		pool: "model",
		class: "claude-code",
		index: 2,
	});
	assert.equal(parseCapacitySlot(LEASE_NAMES.controller), null);
	assert.equal(parseCapacitySlot("capacity:ticket:x"), null);
});

test("no lease leaves the database without its token compared, and no source tests a process", () => {
	for (const [path, source] of factorySources()) {
		// **Every** statement, not only the deletions: §5.5's adoption writes a row
		// somebody else holds, and a transfer that compared no token would be the
		// unconditional removal path this module exists not to have.
		for (const statement of source.match(/(DELETE FROM|UPDATE) lease[^"'`]*/g) ?? []) {
			assert.match(
				statement,
				/WHERE name = \? AND holder_token = \?/,
				`${path} writes a lease row without comparing the token`,
			);
		}
		// Signalling a pid is banned as a **liveness test** — §4.6's identity blob
		// is advisory, and both legacy systems decided ownership from a pid they
		// found in a file — not as the way a process stops a child it started
		// itself. What tells the two apart is what is being signalled: a pid read
		// out of a record, or the `child.pid` a spawn in the same scope returned.
		for (const call of source.match(/process\.kill\([^)]*\)/g) ?? []) {
			assert.doesNotMatch(call, /,\s*0\s*\)/, `${path} tests a pid for liveness; §4.6's identity blob is advisory`);
			assert.match(call, /-?child\.pid/, `${path} signals a process it did not spawn`);
		}
	}
});
