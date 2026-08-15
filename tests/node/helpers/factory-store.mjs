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
export function runStarted(runId = newUlid(), { at = 1_770_000_000_000 } = {}) {
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
