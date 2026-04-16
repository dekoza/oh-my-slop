import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { CommitTrailEntry, RouteDecision, RouteThinkingLevel } from "./types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getCommitTrailPath(): string {
	return join(getAgentDir(), "extensions", "adaptive-routing", "commit-trail.jsonl");
}

// ── Trail persistence ─────────────────────────────────────────────────────────

export function appendCommitTrail(entry: CommitTrailEntry): void {
	const path = getCommitTrailPath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		const line = `${JSON.stringify(entry)}\n`;
		if (existsSync(path)) {
			writeFileSync(path, readFileSync(path, "utf-8") + line, "utf-8");
		} else {
			writeFileSync(path, line, "utf-8");
		}
	} catch {
		// Best-effort only.
	}
}

export function readCommitTrail(): CommitTrailEntry[] {
	const path = getCommitTrailPath();
	try {
		if (!existsSync(path)) return [];
		return readFileSync(path, "utf-8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as CommitTrailEntry);
	} catch {
		return [];
	}
}

/** Find the trail entry for a given short or full commit hash. */
export function findTrailEntry(hash: string): CommitTrailEntry | undefined {
	const entries = readCommitTrail();
	return entries.find((e) => e.hash === hash || e.hash.startsWith(hash) || hash.startsWith(e.hash));
}

// ── Git commit detection ──────────────────────────────────────────────────────

/** Regex matching successful git commit output — extracts the short hash. */
const COMMIT_SUCCESS_RE = /\[[\w/.-]+ ([0-9a-f]{6,12})\]/;

/** Regex matching conventional fix commit types. */
const FIX_COMMIT_RE = /^(fix|bugfix|bug|hotfix)[\s(:]/i;

/**
 * Attempts to parse a git commit short hash from the combined stdout/stderr
 * of a `git commit` invocation (via BashToolResultEvent).
 */
export function extractCommitHash(bashOutput: string): string | undefined {
	const match = bashOutput.match(COMMIT_SUCCESS_RE);
	return match?.[1];
}

/**
 * Returns true when a commit message looks like a fix commit
 * (conventional type `fix:`, `bugfix:`, etc.).
 */
export function isFixCommit(command: string): boolean {
	// Grab the message from -m "..." in the commit command
	const mMatch = command.match(/-m\s+["']([^"']+)["']/);
	if (!mMatch) return false;
	return FIX_COMMIT_RE.test(mMatch[1]);
}

/**
 * Uses `git blame` to attribute changed lines in a fix commit back to their
 * original commit hashes. Runs against the parent of `fixHash` so the blame
 * shows the state before the fix.
 *
 * Returns a deduplicated list of blamed commit short hashes.
 */
export function attributeFixToOriginalCommits(fixHash: string, cwd: string): string[] {
	try {
		// Get the list of files changed by the fix commit
		const diffOutput = execSync(`git diff --name-only ${fixHash}^..${fixHash}`, {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
		}).trim();

		if (!diffOutput) return [];
		const files = diffOutput.split("\n").filter(Boolean);

		// For each file, blame the lines that changed in the fix commit
		const blamed = new Set<string>();
		for (const file of files) {
			try {
				// Get the hunks that changed in the fix commit for this file
				const patchOutput = execSync(
					`git diff -U0 ${fixHash}^..${fixHash} -- "${file}"`,
					{ cwd, encoding: "utf-8", timeout: 5000 },
				).trim();

				// Extract changed line numbers from unified diff hunk headers
				const lineNumbers = extractChangedLines(patchOutput);
				if (lineNumbers.length === 0) continue;

				// Blame those specific lines in the parent commit
				const lineArgs = lineNumbers.map((n) => `-L ${n},${n}`).join(" ");
				const blameOutput = execSync(
					`git blame ${fixHash}^ --porcelain ${lineArgs} -- "${file}" 2>/dev/null`,
					{ cwd, encoding: "utf-8", timeout: 5000 },
				).trim();

				// Extract commit hashes from porcelain blame output (first 40 chars of each entry line)
				for (const line of blameOutput.split("\n")) {
					const hashMatch = line.match(/^([0-9a-f]{40})/);
					if (hashMatch) blamed.add(hashMatch[1].slice(0, 8)); // short hash
				}
			} catch {
				// Skip files that can't be blamed (deleted, binary, etc.)
			}
		}

		return Array.from(blamed);
	} catch {
		return [];
	}
}

/**
 * Extracts the first line number from each hunk header in a unified diff.
 * Hunk headers look like: @@ -old_start,old_count +new_start,new_count @@
 * We want the OLD line numbers (what existed before the fix).
 */
function extractChangedLines(patchOutput: string): number[] {
	const lines: number[] = [];
	const hunkRe = /^@@\s+-(\d+)(?:,(\d+))?\s+\+\d+/gm;
	let match: RegExpExecArray | null;
	while ((match = hunkRe.exec(patchOutput)) !== null) {
		const start = Number(match[1]);
		const count = match[2] !== undefined ? Number(match[2]) : 1;
		// Add each line in the old hunk, capped at 10 per hunk to avoid blame explosions
		for (let i = 0; i < Math.min(count, 10); i++) {
			if (start + i > 0) lines.push(start + i);
		}
	}
	return lines;
}

// ── Pi-Route trailer ──────────────────────────────────────────────────────────

/**
 * Parses a `Pi-Route:` git commit trailer into its components.
 * Format: Pi-Route: model=<id> intent=<intent> complexity=<n> thinking=<level> turns=<n>
 */
export interface PiRouteTrailer {
	model?: string;
	intent?: string;
	complexity?: number;
	thinking?: RouteThinkingLevel;
	turns?: number;
}

export function parsePiRouteTrailer(commitMessage: string): PiRouteTrailer {
	const trailerLine = commitMessage.split("\n").find((line) => line.startsWith("Pi-Route:"));
	if (!trailerLine) return {};

	const kv: PiRouteTrailer = {};
	const kvRe = /(\w+)=(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = kvRe.exec(trailerLine)) !== null) {
		const [, key, value] = match;
		switch (key) {
			case "model":
				kv.model = value;
				break;
			case "intent":
				kv.intent = value;
				break;
			case "complexity":
				kv.complexity = Number(value) || undefined;
				break;
			case "thinking":
				kv.thinking = value as RouteThinkingLevel;
				break;
			case "turns":
				kv.turns = Number(value) || undefined;
				break;
		}
	}
	return kv;
}

// ── Trail entry construction ──────────────────────────────────────────────────

export function buildTrailEntry(
	hash: string,
	decision: RouteDecision,
	actualModel: string,
	actualThinking: RouteThinkingLevel,
	turns: number,
): CommitTrailEntry {
	return {
		hash,
		decisionId: decision.id,
		actualModel,
		actualThinking,
		routedModel: decision.selectedModel,
		routedThinking: decision.selectedThinking,
		intent: decision.explanation.classification?.intent ?? "implementation",
		complexity: decision.explanation.classification?.complexity ?? 3,
		turns,
		isChanceTrial: decision.isChanceTrial,
		timestamp: Date.now(),
	};
}
