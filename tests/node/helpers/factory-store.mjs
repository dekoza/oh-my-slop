import { AssertionError } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openCapacity } from "../../../factory/lib/capacity/slots.mjs";
import { holdControllerLease } from "../../../factory/lib/controller/lease-guard.mjs";
import { newUlid } from "../../../factory/lib/identity/ulid.mjs";
import { openLeases } from "../../../factory/lib/state/leases.mjs";
import {
	canonicalJson,
	digest,
	envelopeHash,
	GENESIS_PREV_HASH,
	streamFor,
} from "../../../factory/lib/state/events.mjs";
import { openStore } from "../../../factory/lib/state/store.mjs";
import { herdrIntegration } from "./factory-package.mjs";
import { makeRepo } from "./factory-repo.mjs";

/**
 * Store fixtures for the §4 durable-state tests. Every one of them opens a real
 * database in a real temporary agent directory — the substrate's guarantees
 * (WAL, one transaction, a fail-closed head compare) are not observable through
 * a mock.
 *
 * This file lives one level down so `node --test tests/node/*.mjs` does not pick
 * it up as a test file of its own.
 */

/** The fixed instant these tests date their records from. */
export const FIXED_NOW = 1_770_000_000_000;

/**
 * A holder's advisory identity blob (§4.6). It is deliberately a literal rather
 * than `processIdentity()`: the point of the blob is that nothing reads it as
 * proof, so a test's holder is as valid as a real one.
 */
export function leaseIdentity(overrides = {}) {
	return {
		host: "workshop",
		boot_id: "6a1c9c0e-0b1e-4a5b-9a5f-3a0b6f5c1d22",
		pid: 4242,
		process_start_time: FIXED_NOW - 5_000,
		run: "01JRUN0000000000000000000A",
		pane: "herdr:2",
		...overrides,
	};
}

/** A throwaway agent directory, standing in for `getAgentDir()`. */
export function makeAgentDir(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-agent-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/**
 * An empty home directory for a test's `env.HOME`.
 *
 * §6.8's config environment promotes capability artifacts out of the operator's
 * own `~/.pi` and `~/.claude`, so a suite that let `HOME` fall through to the
 * real one would copy the developer's credentials into a temp directory to
 * prove a point about isolation.
 */
/**
 * An operator's home on a host where herdr is installed: §6.5's agent-state
 * integration sits in the operator's config roots at the version the factory
 * is written against. Every full-path suite drives a preflight, and a host
 * without the integration would make them red for a reason the suite is not
 * about; a test that needs the absence deletes the file it wants gone.
 */
export function makeHome(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-home-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	for (const [path, content] of Object.entries(herdrInstalledIntegrations())) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	return dir;
}

/** The §6.5 integrations a herdr-installed host carries, by path and content. */
export function herdrInstalledIntegrations() {
	return {
		".pi/agent/extensions/herdr-agent-state.ts": herdrIntegration("pi", 8),
		".claude/hooks/herdr-agent-state.sh": herdrIntegration("claude", 7),
	};
}

/**
 * @param {import("node:test").TestContext} t
 * @param {{ repoRoot?: string, agentDir?: string }} [options]
 */
export async function openTestStore(t, { repoRoot, agentDir } = {}) {
	const store = await openStore({
		repoRoot: repoRoot ?? makeRepo(t),
		agentDir: agentDir ?? makeAgentDir(t),
	});
	t.after(() => store.close());
	return store;
}

/**
 * The refusal a call was expected to make. A test that let the call succeed
 * would otherwise read its own `undefined` as the error's fields and pass.
 *
 * @param {() => unknown} body
 * @returns {Error}
 */
export function refusalOf(body) {
	try {
		body();
	} catch (error) {
		return error;
	}
	throw new AssertionError({ message: "expected a refusal" });
}

/** The same, for the paths that open a store — every one of them is async. */
export async function refusalOfAsync(body) {
	try {
		await body();
	} catch (error) {
		return error;
	}
	throw new AssertionError({ message: "expected a refusal" });
}

/**
 * Damage a closed database the way a bad sector does: every page but the first
 * overwritten, so the file is still a SQLite file and its schema still reads —
 * and `PRAGMA integrity_check` reports a malformed disk image.
 */
export function corruptDatabaseFile(dbPath) {
	const file = readFileSync(dbPath);
	const pageSize = file.readUInt16BE(16) || 65_536;
	file.fill(0xff, pageSize, file.length);
	writeFileSync(dbPath, file);
	return file;
}

/** Damage of the other kind: the file is no longer a database at all. */
export function trashDatabaseHeader(dbPath) {
	const file = readFileSync(dbPath);
	file.write("this is not a database", 0);
	writeFileSync(dbPath, file);
	return file;
}

/** A run id, and the events that open and close a run around it. */
export function runStarted(runId = newUlid(), { at = FIXED_NOW } = {}) {
	return {
		kind: "run.started",
		source: "controller",
		run: runId,
		occurredAt: at,
		observedAt: at,
		payload: { scope: { kind: "direct-ticket", tickets: [90] } },
	};
}

/** §10.3's four lifecycles, moved between — `ended` is `runEnded`'s alone. */
export function runMoved(runId, lifecycle, { at = 1_770_000_300_000 } = {}) {
	return {
		kind: "run.lifecycle-changed",
		source: "controller",
		run: runId,
		occurredAt: at,
		observedAt: at,
		payload: { lifecycle },
	};
}

export function runEnded(runId, { at = 1_770_000_600_000, endReason = "drained" } = {}) {
	return {
		kind: "run.ended",
		source: "controller",
		run: runId,
		occurredAt: at,
		observedAt: at,
		payload: { end_reason: endReason },
	};
}

/** §4.8's every-60s record, on the one stream that front-truncates (§12.2). */
export function heartbeat({ at = 1_770_000_010_000, watching = 0 } = {}) {
	return {
		kind: "controller.heartbeat",
		source: "controller",
		occurredAt: at,
		observedAt: at,
		payload: { watching },
	};
}

export function attemptLaunched(
	runId,
	ticket,
	ordinal = 1,
	{ at = 1_770_000_100_000, phase = "implement", role = "implement", profile = "builder" } = {},
) {
	return {
		kind: "attempt.launched",
		source: "controller",
		run: runId,
		ticket,
		phase,
		attempt: `${runId}-t${ticket}-a${ordinal}`,
		occurredAt: at,
		observedAt: at,
		// The profile is on it because the claim always records one, and §8.5 pins a
		// repair to the originating attempt's: a fixture that left it out would make
		// every repair unplannable for a reason production never has.
		payload: { role, profile },
	};
}

/**
 * Append a journal record **as an older binary wrote it** — a chosen
 * `payload_version`, a valid hash chain, and no projector applied.
 *
 * The write path cannot produce this: `buildEnvelope` stamps every kind with
 * the version this binary declares, which is exactly why a compatibility test
 * needs a forgery. The row is hashed the same way `verifyJournal` re-hashes it,
 * so the forged journal verifies; the projection heads are left where they
 * were, because what an old journal needs from the current binary is a
 * **recorded rebuild**, and that is the path under test.
 */
export function appendLegacyEvent(
	store,
	{ kind, source = "controller", run = null, ticket = null, at = FIXED_NOW, payload, payloadVersion = 1 },
) {
	// Through the store's write-side escape, not `read`: the row and the head
	// move together or not at all, exactly as the old binary would have left them.
	return store.transaction(({ db }) => {
		const stream = streamFor(kind, run);
		const head = db.prepare("SELECT last_seq FROM journal_head WHERE id = 1").get();
		const previous = db.prepare("SELECT hash FROM event WHERE stream = ? ORDER BY seq DESC LIMIT 1").get(stream);

		const withoutHash = {
			seq: head.last_seq + 1,
			event_id: newUlid(),
			envelope_version: 1,
			kind,
			payload_version: payloadVersion,
			visibility: "operator",
			stream,
			run,
			ticket,
			phase: null,
			attempt: null,
			causal_command_id: null,
			source,
			occurred_at: at,
			observed_at: at,
			foreign_source_id: null,
			payload,
			payload_digest: digest(canonicalJson(payload)),
			prev_hash: previous === undefined ? GENESIS_PREV_HASH : previous.hash,
		};
		const hash = envelopeHash(withoutHash);

		db.prepare(
			`INSERT INTO event(seq, event_id, envelope_version, kind, payload_version, visibility, stream, run,
			                   ticket, phase, attempt, causal_command_id, source, occurred_at, observed_at,
			                   foreign_source_id, payload, payload_digest, prev_hash, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			withoutHash.seq,
			withoutHash.event_id,
			withoutHash.envelope_version,
			withoutHash.kind,
			withoutHash.payload_version,
			withoutHash.visibility,
			withoutHash.stream,
			withoutHash.run,
			withoutHash.ticket,
			withoutHash.phase,
			withoutHash.attempt,
			withoutHash.causal_command_id,
			withoutHash.source,
			withoutHash.occurred_at,
			withoutHash.observed_at,
			withoutHash.foreign_source_id,
			canonicalJson(withoutHash.payload),
			withoutHash.payload_digest,
			withoutHash.prev_hash,
			hash,
		);
		db.prepare("UPDATE journal_head SET last_seq = ?, last_hash = ? WHERE id = 1").run(withoutHash.seq, hash);

		return Object.freeze({ ...withoutHash, hash });
	});
}

/**
 * Interval timers a test fires by hand, so no suite waits on a clock.
 *
 * `tick(ms)` fires the intervals registered at that period — the controller
 * runs two at once (§4.8's 10-second renewal and 60-second heartbeat), and a
 * tick that fired both could not tell you which cadence did the work. `tick()`
 * with no period fires every live interval, which is what a test wants when it
 * is driving the whole hold rather than one of its clocks.
 */
export function manualTimers() {
	const scheduled = [];
	const timeouts = [];

	return {
		api: {
			setInterval: (fn, ms) => {
				const handle = { fn, ms, cleared: false };
				scheduled.push(handle);
				return handle;
			},
			clearInterval: (handle) => {
				handle.cleared = true;
			},
			// One-shot timers are a **separate list, fired separately**. The watch's
			// re-subscription backoff (#114) and the degraded poll interval can
			// coincide on a period, and a `tick` that fired both would make a test
			// unable to say which clock did the work — the same reason `tick` takes
			// a period at all.
			setTimeout: (fn, ms) => {
				const handle = { fn, ms, cleared: false, fired: false };
				timeouts.push(handle);
				return handle;
			},
			clearTimeout: (handle) => {
				handle.cleared = true;
			},
		},
		tick: (ms = null) => {
			for (const handle of scheduled.filter((live) => !live.cleared && (ms === null || live.ms === ms))) {
				handle.fn();
			}
		},
		/** Fire the one-shot timers due at `ms` — or every pending one. */
		fire: (ms = null) => {
			for (const handle of timeouts.filter(
				(live) => !live.cleared && !live.fired && (ms === null || live.ms === ms),
			)) {
				handle.fired = true;
				handle.fn();
			}
		},
		intervals: () => scheduled.filter((handle) => !handle.cleared).map((handle) => handle.ms),
		timeouts: () => timeouts.filter((handle) => !handle.cleared && !handle.fired).map((handle) => handle.ms),
	};
}

/**
 * §9.1's capacity plan, without going through a config file — so a suite can
 * instantiate the pools at any size. There is no override seam to reach for:
 * §9.3's ceiling is enforced in the loader, and the plan is ordinary numbers.
 *
 * @param {{ ticketSlots?: number, classes?: Array<{ class: string, size: number, profiles: string[] }> }} [shape]
 */
export function capacityPlanOf({
	ticketSlots = 1,
	classes = [{ class: "local", size: 1, profiles: ["builder"] }],
	implementClasses = null,
} = {}) {
	const total = (names) =>
		classes.filter((entry) => names === null || names.includes(entry.class)).reduce((sum, entry) => sum + entry.size, 0);
	const implementSlots = total(implementClasses);

	return Object.freeze({
		declaredCeiling: ticketSlots,
		ticketSlots,
		classes: Object.freeze(classes),
		resourceSlots: total(null),
		implementSlots,
		effectiveConcurrency: Math.min(ticketSlots, implementSlots),
		paneBound: ticketSlots * 2,
	});
}

/**
 * A store with a run open, a controller holding its lease, and §9.4's pools over
 * both — the fixture every capacity and scheduler suite starts from.
 *
 * @param {import("node:test").TestContext} t
 * @param {{ plan?: object, now?: () => number }} [options]
 */
export async function openCapacityPool(t, { plan = capacityPlanOf(), now = () => FIXED_NOW, probeClass = null } = {}) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const run = runStarted().run;

	store.append(runStarted(run));
	hold.recordStartupReconcile();
	hold.adopt(run);

	return { store, run, hold, leases, capacity: openCapacity(store, { leases, plan, run, hold, now, probeClass }) };
}

/**
 * A capacity row as a **previous** controller left it: fenced to a generation
 * below the live hold's, which is what makes it superseded (§9.4).
 *
 * It is written through the store's transaction surface rather than its read
 * handle, because that is the surface a writer has.
 */
export function leaveSupersededSlot(store, hold, { slot, ticket, run = "01JRUNDEAD000000000000000", pool = "ticket", at = FIXED_NOW - 60_000 }) {
	return store.transaction(({ db }) =>
		db
			.prepare(
				`INSERT INTO lease(name, holder_token, fencing_generation, expires_at, renewed_at, identity)
				 VALUES (?, ?, ?, NULL, ?, ?)`,
			)
			.run(slot, `dead-${slot}`, hold.fencingGeneration - 1, at, JSON.stringify({ run, ticket, pool })),
	);
}

/**
 * §10.3's Herdr availability answer, as a probe a test injects.
 *
 * The real probe connects to the operator's multiplexer socket, so a suite that
 * used it would pass or fail on whether the machine happens to be running one.
 * `herdr.mjs`'s own tests drive the real connect against a real socket; every
 * other suite says which answer it wants and moves on.
 *
 * @param {boolean} [available]
 */
export function herdrAnswering(available = true) {
	return async () =>
		Object.freeze({
			available,
			binary: "/usr/bin/herdr",
			socket: "/run/herdr.sock",
			reason: available ? null : "herdr-server-down",
			command: available ? null : "herdr",
			message: available
				? "Herdr answers on /run/herdr.sock."
				: "Nothing answers on /run/herdr.sock. Start it with `herdr`.",
		});
}
