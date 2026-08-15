import { mkdtempSync, rmSync } from "node:fs";
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
