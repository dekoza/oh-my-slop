import { AssertionError } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newUlid } from "../../../factory/lib/identity/ulid.mjs";
import { openStore } from "../../../factory/lib/state/store.mjs";
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

export function attemptLaunched(runId, ticket, ordinal = 1, { at = 1_770_000_100_000, phase = "implement" } = {}) {
	return {
		kind: "attempt.launched",
		source: "controller",
		run: runId,
		ticket,
		phase,
		attempt: `${runId}-t${ticket}-a${ordinal}`,
		occurredAt: at,
		observedAt: at,
		payload: { role: "implement" },
	};
}
