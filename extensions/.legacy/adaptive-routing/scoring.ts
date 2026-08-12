import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { DEFAULT_SCORING_CONFIG } from "./defaults.js";
import type {
	AdaptiveRoutingScoringConfig,
	ModelScoreRecord,
	ModelScoreStore,
	RouteEvidenceEntry,
} from "./types.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getModelScorePath(): string {
	return join(getAgentDir(), "extensions", "adaptive-routing", "model-scores.json");
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function readModelScores(): ModelScoreStore {
	const path = getModelScorePath();
	try {
		if (!existsSync(path)) return emptyStore();
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as ModelScoreStore;
		return parsed && typeof parsed === "object" ? parsed : emptyStore();
	} catch {
		return emptyStore();
	}
}

export function writeModelScores(store: ModelScoreStore): void {
	const path = getModelScorePath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
	} catch {
		// Non-critical persistence.
	}
}

function emptyStore(): ModelScoreStore {
	return {
		scores: {},
		penaltyThreshold: DEFAULT_SCORING_CONFIG.penaltyThreshold,
		headStart: DEFAULT_SCORING_CONFIG.headStart,
		updatedAt: Date.now(),
	};
}

// ── Score lookup ──────────────────────────────────────────────────────────────

/**
 * Normalises a model full-id to the bare model key used for scoring.
 * Strips the provider prefix (e.g. "github-copilot/claude-sonnet-4.6" → "claude-sonnet-4.6").
 * Keeps "claude-sonnet-4.6" and "claude-sonnet-4.5" separate.
 */
export function toModelKey(fullId: string): string {
	const slash = fullId.indexOf("/");
	return slash >= 0 ? fullId.slice(slash + 1) : fullId;
}

/**
 * Returns the score adjustment for a model, applying head-start for unknown models.
 * Positive = good, negative = penalised.
 */
export function getScoreAdjustment(
	modelKey: string,
	store: ModelScoreStore,
	config: AdaptiveRoutingScoringConfig,
): { adjustment: number; record: ModelScoreRecord | undefined } {
	const record = store.scores[modelKey];
	if (!record) {
		// Unknown model — give it a small head-start to encourage exploration
		return { adjustment: config.headStart, record: undefined };
	}
	return { adjustment: record.score, record };
}

/**
 * Returns true if this model's fix count exceeds the penalty threshold
 * AND it should NOT be given a chance trial this invocation.
 * Chance trials happen 1-in-N where N = config.chanceTrialRate (0 = never).
 */
export function shouldPenalise(
	record: ModelScoreRecord | undefined,
	config: AdaptiveRoutingScoringConfig,
): { penalised: boolean; isChanceTrial: boolean } {
	if (!record) return { penalised: false, isChanceTrial: false };
	if (record.fixCount < config.penaltyThreshold) return { penalised: false, isChanceTrial: false };

	// Model is over threshold — roll for a chance trial
	if (config.chanceTrialRate > 0 && Math.random() < 1 / config.chanceTrialRate) {
		return { penalised: false, isChanceTrial: true };
	}
	return { penalised: true, isChanceTrial: false };
}

// ── Evidence recording ────────────────────────────────────────────────────────

/**
 * Records a fix attribution for a model. Called when a fix commit is
 * attributed (via git blame) back to a commit made while using that model.
 */
export function recordFixAttribution(
	store: ModelScoreStore,
	modelKey: string,
	evidence: RouteEvidenceEntry,
	config: AdaptiveRoutingScoringConfig,
): ModelScoreStore {
	const record = getOrCreateRecord(store, modelKey, config);
	const updated: ModelScoreRecord = {
		...record,
		fixCount: record.fixCount + 1,
		score: record.score - config.penaltyPerFix,
		totalTrials: record.totalTrials + 1,
		evidence: trimEvidence([...record.evidence, evidence], config.maxEvidenceEntries),
		updatedAt: Date.now(),
	};
	return {
		...store,
		scores: { ...store.scores, [modelKey]: updated },
		updatedAt: Date.now(),
	};
}

/**
 * Records a successful session (commit with no fix attribution).
 * Score nudge is small — we need patterns, not single-session signals.
 */
export function recordSuccessfulSession(
	store: ModelScoreStore,
	modelKey: string,
	evidence: RouteEvidenceEntry,
	config: AdaptiveRoutingScoringConfig,
): ModelScoreStore {
	const record = getOrCreateRecord(store, modelKey, config);
	const updated: ModelScoreRecord = {
		...record,
		totalTrials: record.totalTrials + 1,
		// +1 per clean session, but never above headStart + threshold-worth of penalty
		score: Math.min(record.score + 1, config.headStart + config.penaltyThreshold * config.penaltyPerFix),
		evidence: trimEvidence([...record.evidence, evidence], config.maxEvidenceEntries),
		updatedAt: Date.now(),
	};
	return {
		...store,
		scores: { ...store.scores, [modelKey]: updated },
		updatedAt: Date.now(),
	};
}

// ── Internals ─────────────────────────────────────────────────────────────────

function getOrCreateRecord(
	store: ModelScoreStore,
	modelKey: string,
	config: AdaptiveRoutingScoringConfig,
): ModelScoreRecord {
	return (
		store.scores[modelKey] ?? {
			modelKey,
			score: config.headStart,
			totalTrials: 0,
			fixCount: 0,
			evidence: [],
			updatedAt: Date.now(),
		}
	);
}

function trimEvidence(evidence: RouteEvidenceEntry[], max: number): RouteEvidenceEntry[] {
	if (evidence.length <= max) return evidence;
	return evidence.slice(evidence.length - max);
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatScoreReport(store: ModelScoreStore): string[] {
	const lines = ["Model Routing Scores", ""];
	const entries = Object.values(store.scores).sort((a, b) => b.score - a.score);
	if (entries.length === 0) {
		lines.push("No model evidence recorded yet.");
	}
	for (const record of entries) {
		const penalised = record.fixCount >= store.penaltyThreshold ? " ⚠ penalised" : "";
		lines.push(
			`  ${record.modelKey}: score=${record.score} fixes=${record.fixCount}/${record.totalTrials}${penalised}`,
		);
	}
	lines.push("");
	lines.push(`Penalty threshold: ${store.penaltyThreshold} fixes`);
	lines.push(`Head-start for new models: +${store.headStart}`);
	return lines;
}
