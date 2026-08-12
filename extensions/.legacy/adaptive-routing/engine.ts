import { matchesModelRef } from "./normalize.js";
import { getScoreAdjustment, shouldPenalise, toModelKey } from "./scoring.js";
import type {
	AdaptiveRoutingConfig,
	ModelScoreStore,
	NormalizedRouteCandidate,
	PromptRouteClassification,
	ProviderUsageState,
	RouteCandidateScore,
	RouteDecision,
	RouteExplanation,
	RouteIntent,
	RouteLock,
	RouteQuotaSnapshot,
	RouteThinkingLevel,
	RouteTier,
} from "./types.js";

export interface RoutingDecisionInput {
	config: AdaptiveRoutingConfig;
	candidates: NormalizedRouteCandidate[];
	classification: PromptRouteClassification;
	currentModel?: string;
	currentThinking?: RouteThinkingLevel;
	usage?: ProviderUsageState;
	lock?: RouteLock;
	scoreStore?: ModelScoreStore;
}

export function decideRoute(input: RoutingDecisionInput): RouteDecision | undefined {
	const { config, candidates, classification, usage, lock } = input;
	if (candidates.length === 0) return undefined;

	if (lock) {
		const lockedCandidate = candidates.find((c) => matchesModelRef(lock.model, c));
		if (lockedCandidate) {
			const appliedThinking = clampThinking(lock.thinking, lockedCandidate.maxThinkingLevel);
			return {
				selectedModel: lockedCandidate.fullId,
				selectedThinking: appliedThinking,
				fallbacks: buildFallbacks(candidates, lockedCandidate.fullId, config, classification),
				isChanceTrial: false,
				explanation: {
					summary: `locked to ${lockedCandidate.fullId} · ${appliedThinking}`,
					codes: ["manual_lock_applied"],
					classification,
					clampedThinking:
						appliedThinking === lock.thinking ? undefined : { requested: lock.thinking, applied: appliedThinking },
					quota: buildQuotaSummary(usage),
				},
			};
		}
	}

	// Annotate candidates with scoring data
	const annotated = annotateCandidatesWithScores(candidates, input);

	const scores = annotated.map((candidate) => scoreCandidate(candidate, input));
	scores.sort(
		(a, b) => b.score - a.score || compareMultiplier(a.multiplier, b.multiplier) || a.model.localeCompare(b.model),
	);
	const best = scores[0];
	if (!best) return undefined;

	const selected = annotated.find((c) => c.fullId === best.model);
	if (!selected) return undefined;

	const selectedThinking = clampThinking(resolveRequestedThinking(config, classification), selected.maxThinkingLevel);
	const isChanceTrial = selected.isChanceTrialCandidate ?? false;
	const explanation = buildExplanation(selected, selectedThinking, best, scores.slice(0, 3), classification, config, usage);

	return {
		selectedModel: selected.fullId,
		selectedThinking,
		fallbacks: scores.slice(1, 4).map((s) => s.model),
		isChanceTrial,
		explanation,
	};
}

// ── Scoring annotation ────────────────────────────────────────────────────────

function annotateCandidatesWithScores(
	candidates: NormalizedRouteCandidate[],
	input: RoutingDecisionInput,
): NormalizedRouteCandidate[] {
	const { config, scoreStore } = input;
	if (!scoreStore) return candidates;

	return candidates.map((candidate) => {
		const modelKey = toModelKey(candidate.fullId);
		const { adjustment, record } = getScoreAdjustment(modelKey, scoreStore, config.scoring);
		const { penalised, isChanceTrial } = shouldPenalise(record, config.scoring);

		return {
			...candidate,
			scoreAdjustment: penalised ? -(config.scoring.penaltyPerFix * 3) : adjustment,
			isChanceTrialCandidate: isChanceTrial,
		};
	});
}

// ── Candidate scoring ─────────────────────────────────────────────────────────

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: candidate scoring combines multiple weighted routing signals intentionally.
function scoreCandidate(candidate: NormalizedRouteCandidate, input: RoutingDecisionInput): RouteCandidateScore {
	const reasons: string[] = [];
	let score = 0;
	const { config, classification, currentModel, usage } = input;
	const intentPolicy = config.intents[classification.intent];
	const multiplier = resolveModelMultiplier(config, candidate);
	const maxMultiplier = resolveMaxMultiplier(config, classification.intent);

	// Explicit ranking (user-defined order)
	const rankingIndex = config.models.ranked.findIndex((entry) => matchesModelRef(entry, candidate));
	if (rankingIndex >= 0) {
		score += Math.max(30 - rankingIndex * 3, 3);
		reasons.push(`rank:${rankingIndex + 1}`);
	}

	// Explicit per-intent preferred models
	if (intentPolicy?.preferredModels?.some((entry) => matchesModelRef(entry, candidate))) {
		score += 28;
		reasons.push("intent-model");
	}

	// Per-intent preferred provider
	if (intentPolicy?.preferredProviders?.includes(candidate.provider)) {
		score += 14;
		reasons.push("intent-provider");
	}

	// Tier alignment
	const tierDelta = Math.abs(tierOrder(candidate.tier) - tierOrder(classification.recommendedTier));
	if (tierDelta === 0) {
		score += 18;
		reasons.push(`tier:${candidate.tier}`);
	} else if (tierDelta === 1) {
		score += 8;
		reasons.push("tier-near");
	} else {
		score -= 8;
	}

	// Thinking capability fit
	if (supportsRequestedThinking(candidate.maxThinkingLevel, resolveRequestedThinking(config, classification))) {
		score += 6;
		reasons.push("thinking-fit");
	} else {
		score -= 5;
	}

	// Sticky model (avoid thrashing)
	if (currentModel && currentModel === candidate.fullId && config.stickyTurns > 0) {
		score += 5;
		reasons.push("sticky");
	}

	// Provider quota reserve
	const reserve = config.providerReserves[candidate.provider];
	const providerQuota = usage?.providers[candidate.provider];
	if (reserve && shouldApplyReserve(reserve.applyToTiers, candidate.tier)) {
		if (typeof providerQuota?.remainingPct === "number") {
			if (providerQuota.remainingPct < reserve.minRemainingPct) {
				score -= reserve.allowOverrideForPeak && classification.recommendedTier === "peak" ? 20 : 80;
				reasons.push("reserve-low");
			} else {
				score += 4;
				reasons.push("reserve-ok");
			}
		} else if (providerQuota?.confidence === "unknown" || !providerQuota) {
			reasons.push("quota-unknown");
		}
	}

	// Risk alignment
	if (classification.risk === "high" && (candidate.tier === "premium" || candidate.tier === "peak")) {
		score += 8;
		reasons.push("risk-fit");
	}

	// Cheap-tier boost for quick tasks
	if (classification.intent === "quick-qna" && candidate.tier === "cheap") {
		score += 8;
		reasons.push("cheap-fit");
	}

	// Context window fit
	const contextAdjustment = scoreContextWindow(candidate.contextWindow, classification.contextBreadth);
	score += contextAdjustment.score;
	if (contextAdjustment.reason) reasons.push(contextAdjustment.reason);

	// Cost multiplier scoring
	if (typeof multiplier === "number") {
		if (multiplier === 0) {
			score += 12;
			reasons.push("cost-free");
		} else if (multiplier <= 0.33) {
			score += 8;
			reasons.push("cost-low");
		} else if (multiplier <= 1) {
			score += 3;
			reasons.push("cost-standard");
		} else if (multiplier <= 3) {
			score -= 6;
			reasons.push("cost-expensive");
		} else {
			score -= 35;
			reasons.push("cost-avoid");
		}

		if (typeof maxMultiplier === "number" && multiplier > maxMultiplier) {
			score -= 24 + Math.min(20, (multiplier - maxMultiplier) * 10);
			reasons.push("cost-over-budget");
		}

		if (classification.recommendedTier === "cheap") {
			if (multiplier === 0) {
				score += 10;
				reasons.push("cost-free-cheap-fit");
			} else if (multiplier <= 0.33) {
				score += 4;
				reasons.push("cost-low-cheap-fit");
			}
		}
	}

	// SwampCastle evidence score adjustment
	if (typeof candidate.scoreAdjustment === "number") {
		score += candidate.scoreAdjustment;
		if (candidate.scoreAdjustment > 0) reasons.push("score-boosted");
		else if (candidate.scoreAdjustment < 0) reasons.push("score-penalised");
	}

	// Chance trial — restore score so the candidate can actually win
	if (candidate.isChanceTrialCandidate) {
		score += config.scoring.penaltyPerFix * 3;
		reasons.push("chance-trial");
	}

	return { model: candidate.fullId, score, reasons, multiplier };
}

// ── Explanation builder ───────────────────────────────────────────────────────

function buildExplanation(
	selected: NormalizedRouteCandidate,
	selectedThinking: RouteThinkingLevel,
	best: RouteCandidateScore,
	topCandidates: RouteCandidateScore[],
	classification: PromptRouteClassification,
	config: AdaptiveRoutingConfig,
	usage?: ProviderUsageState,
): RouteExplanation {
	const requestedThinking = classification.recommendedThinking;
	const codes = new Set<RouteExplanation["codes"][number]>();

	for (const reason of best.reasons) {
		if (reason === "sticky") codes.add("current_model_sticky");
		if (reason === "reserve-ok") codes.add("premium_allowed");
		if (reason === "quota-unknown") codes.add("quota_unknown");
		if (reason === "cost-free") codes.add("cost_free_bias");
		if (reason === "cost-low") codes.add("cost_low_bias");
		if (reason === "cost-over-budget") codes.add("cost_over_budget");
		if (reason === "context-fit") codes.add("context_window_fit");
		if (reason === "score-boosted") codes.add("score_boosted");
		if (reason === "score-penalised") codes.add("score_penalised");
		if (reason === "chance-trial") codes.add("chance_trial");
	}
	if (topCandidates.some((c) => c.reasons.includes("cost-over-budget"))) codes.add("cost_budget_applied");
	if (topCandidates.some((c) => c.reasons.includes("reserve-low"))) codes.add("premium_reserved");
	if (selectedThinking !== requestedThinking) codes.add("thinking_clamped");
	if (selected.fallbackGroups.length > 0) codes.add("fallback_group_applied");

	const selectedMultiplier = best.multiplier;
	const maxMultiplier = resolveMaxMultiplier(config, classification.intent);

	const chanceLabel = selected.isChanceTrialCandidate ? " [chance]" : "";

	return {
		summary: `${selected.fullId}${chanceLabel} · ${selectedThinking} · ${classification.intent} · ${classification.recommendedTier}${typeof selectedMultiplier === "number" ? ` · x${selectedMultiplier}` : ""}`,
		codes: Array.from(codes),
		classification,
		clampedThinking:
			selectedThinking === requestedThinking ? undefined : { requested: requestedThinking, applied: selectedThinking },
		quota: buildQuotaSummary(usage),
		cost:
			typeof selectedMultiplier === "number" || typeof maxMultiplier === "number"
				? { selectedMultiplier, maxMultiplier }
				: undefined,
		candidates: topCandidates,
	};
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function buildFallbacks(
	candidates: NormalizedRouteCandidate[],
	excludedModel: string,
	config: AdaptiveRoutingConfig,
	classification: PromptRouteClassification,
): string[] {
	return candidates
		.filter((c) => c.fullId !== excludedModel)
		.sort((a, b) => tierOrder(b.tier) - tierOrder(a.tier) || a.fullId.localeCompare(b.fullId))
		.filter((c) => !config.models.excluded.some((entry) => matchesModelRef(entry, c)))
		.filter((c) => matchesTier(c.tier, classification.recommendedTier) || c.fallbackGroups.length > 0)
		.slice(0, 3)
		.map((c) => c.fullId);
}

export function resolveRequestedThinking(
	config: AdaptiveRoutingConfig,
	classification: PromptRouteClassification,
): RouteThinkingLevel {
	return config.intents[classification.intent]?.defaultThinking ?? classification.recommendedThinking;
}

function resolveModelMultiplier(
	config: AdaptiveRoutingConfig,
	candidate: Pick<NormalizedRouteCandidate, "fullId" | "modelId">,
): number | undefined {
	const direct = config.costs.modelMultipliers[candidate.fullId];
	if (typeof direct === "number") return direct;
	const byModelId = config.costs.modelMultipliers[candidate.modelId];
	return typeof byModelId === "number" ? byModelId : undefined;
}

function resolveMaxMultiplier(config: AdaptiveRoutingConfig, intent: RouteIntent): number | undefined {
	return config.intents[intent]?.maxMultiplier ?? config.costs.defaultMaxMultiplier;
}

function compareMultiplier(left: number | undefined, right: number | undefined): number {
	if (left === right) return 0;
	if (left === undefined) return 1;
	if (right === undefined) return -1;
	return left - right;
}

function scoreContextWindow(
	contextWindow: number | undefined,
	contextBreadth: PromptRouteClassification["contextBreadth"],
): { score: number; reason?: string } {
	if (!contextWindow) return { score: 0 };
	if (contextBreadth === "large") {
		if (contextWindow >= 500_000) return { score: 12, reason: "context-fit" };
		if (contextWindow >= 200_000) return { score: 4, reason: "context-fit" };
		return { score: -8 };
	}
	if (contextBreadth === "medium") {
		if (contextWindow >= 200_000) return { score: 5, reason: "context-fit" };
		if (contextWindow >= 128_000) return { score: 2 };
		return { score: -3 };
	}
	return { score: 0 };
}

export function clampThinking(requested: RouteThinkingLevel, maxSupported: RouteThinkingLevel): RouteThinkingLevel {
	const order: RouteThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
	return order[Math.min(order.indexOf(requested), order.indexOf(maxSupported))] ?? maxSupported;
}

function supportsRequestedThinking(maxSupported: RouteThinkingLevel, requested: RouteThinkingLevel): boolean {
	return clampThinking(requested, maxSupported) === requested;
}

function buildQuotaSummary(usage?: ProviderUsageState): Record<string, RouteQuotaSnapshot> | undefined {
	if (!usage) return undefined;
	const summary: Record<string, RouteQuotaSnapshot> = {};
	for (const [provider, state] of Object.entries(usage.providers)) {
		summary[provider] = { confidence: state.confidence, remainingPct: state.remainingPct };
	}
	return summary;
}

function shouldApplyReserve(applyToTiers: RouteTier[] | undefined, recommendedTier: RouteTier): boolean {
	return !applyToTiers || applyToTiers.includes(recommendedTier);
}

function tierOrder(tier: RouteTier): number {
	switch (tier) {
		case "cheap": return 0;
		case "balanced": return 1;
		case "premium": return 2;
		case "peak": return 3;
	}
}

function matchesTier(candidateTier: RouteTier, requestedTier: RouteTier): boolean {
	return Math.abs(tierOrder(candidateTier) - tierOrder(requestedTier)) <= 1;
}

export function buildFallbackClassification(intent: RouteIntent): PromptRouteClassification {
	const isHeavy = ["design", "architecture", "autonomous", "migration"].includes(intent);
	const isCheap = ["quick-qna", "explain"].includes(intent);
	return {
		intent,
		complexity: isHeavy ? 4 : isCheap ? 1 : 3,
		risk: isCheap ? "low" : isHeavy ? "high" : "medium",
		expectedTurns: isCheap ? "one" : isHeavy ? "many" : "few",
		toolIntensity: ["implementation", "debugging", "test-writing", "migration", "autonomous"].includes(intent)
			? "high"
			: isCheap
				? "low"
				: "medium",
		contextBreadth: ["architecture", "autonomous"].includes(intent) ? "large" : isCheap ? "small" : "medium",
		recommendedTier: isHeavy ? "premium" : isCheap ? "cheap" : "balanced",
		recommendedThinking: isCheap ? "minimal" : isHeavy ? "high" : "medium",
		confidence: 0.35,
		reason: "Fallback classification applied.",
		classifierMode: "heuristic",
	};
}
