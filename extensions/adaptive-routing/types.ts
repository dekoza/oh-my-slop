import type { Api, Model } from "@mariozechner/pi-ai";

export type AdaptiveRoutingMode = "off" | "shadow" | "auto";
export type AdaptiveRoutingTelemetryMode = "off" | "local" | "export";
export type AdaptiveRoutingPrivacyLevel = "minimal" | "redacted" | "full-local";
export type QuotaConfidence = "authoritative" | "estimated" | "unknown";

export type RouteIntent =
	| "quick-qna"
	| "explain"
	| "planning"
	| "research"
	| "implementation"
	| "test-writing"
	| "debugging"
	| "review"
	| "refactor"
	| "migration"
	| "optimization"
	| "documentation"
	| "design"
	| "architecture"
	| "autonomous";

export type RouteComplexity = 1 | 2 | 3 | 4 | 5;
export type RouteRisk = "low" | "medium" | "high";
export type RouteExpectedTurns = "one" | "few" | "many";
export type RouteToolIntensity = "low" | "medium" | "high";
export type RouteContextBreadth = "small" | "medium" | "large";
export type RouteTier = "cheap" | "balanced" | "premium" | "peak";
export type RouteThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type RouteFeedbackCategory =
	| "good"
	| "bad"
	| "wrong-intent"
	| "overkill"
	| "underpowered"
	| "wrong-provider"
	| "wrong-thinking";

export interface AdaptiveRoutingTelemetryConfig {
	mode: AdaptiveRoutingTelemetryMode;
	privacy: AdaptiveRoutingPrivacyLevel;
}

export interface AdaptiveRoutingModelPreferences {
	ranked: string[];
	excluded: string[];
}

export interface IntentRoutingPolicy {
	preferredModels?: string[];
	preferredProviders?: string[];
	defaultThinking?: RouteThinkingLevel;
	preferredTier?: RouteTier;
	fallbackGroup?: string;
	maxMultiplier?: number;
}

export interface TaskClassPolicy {
	defaultThinking: RouteThinkingLevel;
	candidates: string[];
	fallbackGroup?: string;
}

export interface ProviderReservePolicy {
	minRemainingPct: number;
	applyToTiers?: RouteTier[];
	allowOverrideForPeak?: boolean;
	confidence?: QuotaConfidence;
}

export interface FallbackGroupPolicy {
	candidates: string[];
	description?: string;
}

export interface DelegatedCategoryPolicy {
	candidates?: string[];
	taskClass?: string;
	fallbackGroup?: string;
	defaultThinking?: RouteThinkingLevel;
}

export interface DelegatedRoutingConfig {
	enabled: boolean;
	categories: Record<string, DelegatedCategoryPolicy>;
}

export interface AdaptiveRoutingCostPolicy {
	modelMultipliers: Record<string, number>;
	defaultMaxMultiplier?: number;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** One piece of evidence tied to a specific commit. */
export interface RouteEvidenceEntry {
	/** The commit hash that produced this evidence (e.g. the fix commit). */
	commitHash: string;
	/** Hash of the commit being blamed (the one that introduced the defect). */
	fixedHash?: string;
	intent: RouteIntent;
	thinking: RouteThinkingLevel;
	/** Number of turns in the session that produced this commit. */
	turns: number;
	/** True when this trial was a "give it a chance" exploration slot. */
	isChanceTrial: boolean;
	/** Unix ms. */
	timestamp: number;
}

/** Persistent score record for a single model. */
export interface ModelScoreRecord {
	/** e.g. "claude-sonnet-4.6" (without provider prefix). */
	modelKey: string;
	/** Cumulative adjusted score. Starts at headStart. */
	score: number;
	/** Total evidence entries. */
	totalTrials: number;
	/** Evidence entries that are fix attributions (fixedHash set). */
	fixCount: number;
	/** Evidence list (kept for auditing; may be trimmed to last N). */
	evidence: RouteEvidenceEntry[];
	/** Unix ms of last update. */
	updatedAt: number;
}

export interface ModelScoreStore {
	/** Map of modelKey → record. */
	scores: Record<string, ModelScoreRecord>;
	/** Threshold of fix attributions before penalty applies. Default 3. */
	penaltyThreshold: number;
	/** Head-start score for unknown models. Default 2. */
	headStart: number;
	updatedAt: number;
}

// ── Commit trail ─────────────────────────────────────────────────────────────

/** One entry written when a successful git commit is detected. */
export interface CommitTrailEntry {
	/** Resolved git hash (short). */
	hash: string;
	/** Decision ID from the routing engine. */
	decisionId?: string;
	/** The model that actually ran this session (may differ from routed model). */
	actualModel: string;
	actualThinking: RouteThinkingLevel;
	/** The model the router originally chose. */
	routedModel?: string;
	routedThinking?: RouteThinkingLevel;
	intent: RouteIntent;
	complexity: RouteComplexity;
	turns: number;
	isChanceTrial: boolean;
	timestamp: number;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface AdaptiveRoutingConfig {
	mode: AdaptiveRoutingMode;
	routerModels: string[];
	stickyTurns: number;
	telemetry: AdaptiveRoutingTelemetryConfig;
	models: AdaptiveRoutingModelPreferences;
	costs: AdaptiveRoutingCostPolicy;
	intents: Partial<Record<RouteIntent, IntentRoutingPolicy>>;
	taskClasses: Record<string, TaskClassPolicy>;
	providerReserves: Partial<Record<string, ProviderReservePolicy>>;
	fallbackGroups: Record<string, FallbackGroupPolicy>;
	delegatedRouting: DelegatedRoutingConfig;
	scoring: AdaptiveRoutingScoringConfig;
}

export interface AdaptiveRoutingScoringConfig {
	/** Penalty threshold (number of fix attributions before score penalty). */
	penaltyThreshold: number;
	/** Head-start score for models with no evidence. */
	headStart: number;
	/** Score penalty applied per fix attribution above threshold. */
	penaltyPerFix: number;
	/** 1-in-N chance to trial a penalised model anyway. 0 = never. */
	chanceTrialRate: number;
	/** Max evidence entries retained per model. */
	maxEvidenceEntries: number;
}

// ── Classification ────────────────────────────────────────────────────────────

export interface PromptRouteClassification {
	intent: RouteIntent;
	complexity: RouteComplexity;
	risk: RouteRisk;
	expectedTurns: RouteExpectedTurns;
	toolIntensity: RouteToolIntensity;
	contextBreadth: RouteContextBreadth;
	recommendedTier: RouteTier;
	recommendedThinking: RouteThinkingLevel;
	confidence: number;
	reason: string;
	classifierModel?: string;
	classifierMode?: "heuristic" | "llm";
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface RouteCandidateScore {
	model: string;
	score: number;
	reasons: string[];
	multiplier?: number;
}

export interface RouteQuotaSnapshot {
	confidence: QuotaConfidence;
	remainingPct?: number;
}

export type AdaptiveRoutingExplanationCode =
	| "intent_design_bias"
	| "intent_architecture_bias"
	| "premium_allowed"
	| "premium_reserved"
	| "quota_low"
	| "quota_unknown"
	| "thinking_clamped"
	| "current_model_sticky"
	| "fallback_group_applied"
	| "manual_lock_applied"
	| "shadow_disagreement"
	| "classifier_fallback"
	| "cost_free_bias"
	| "cost_low_bias"
	| "cost_budget_applied"
	| "cost_over_budget"
	| "context_window_fit"
	| "score_penalised"
	| "score_boosted"
	| "chance_trial";

export interface RouteExplanation {
	summary: string;
	codes: AdaptiveRoutingExplanationCode[];
	classification?: PromptRouteClassification;
	clampedThinking?: {
		requested: RouteThinkingLevel;
		applied: RouteThinkingLevel;
	};
	quota?: Record<string, RouteQuotaSnapshot>;
	cost?: {
		selectedMultiplier?: number;
		maxMultiplier?: number;
	};
	candidates?: RouteCandidateScore[];
}

export interface RouteDecision {
	id?: string;
	selectedModel: string;
	selectedThinking: RouteThinkingLevel;
	fallbacks: string[];
	isChanceTrial: boolean;
	explanation: RouteExplanation;
}

export interface RouteLock {
	model: string;
	thinking: RouteThinkingLevel;
	setAt: number;
}

export interface AdaptiveRoutingState {
	mode?: AdaptiveRoutingMode;
	lock?: RouteLock;
	lastDecision?: RouteDecision;
}

export interface ProviderUsageState {
	providers: Record<
		string,
		{
			confidence: QuotaConfidence;
			remainingPct?: number;
		}
	>;
	sessionCost?: number;
	rolling30dCost?: number;
	perModel?: Record<string, unknown>;
	perSource?: Record<string, unknown>;
	updatedAt: number;
}

export interface NormalizedRouteCandidate {
	fullId: string;
	provider: string;
	modelId: string;
	label: string;
	reasoning: boolean;
	maxThinkingLevel: RouteThinkingLevel;
	tier: RouteTier;
	contextWindow?: number;
	maxTokens?: number;
	input: ("text" | "image")[];
	costKnown: boolean;
	tags: string[];
	family?: string;
	fallbackGroups: string[];
	available: boolean;
	authenticated: boolean;
	model: Model<Api>;
	/** Score adjustment from SwampCastle evidence. Undefined = no data. */
	scoreAdjustment?: number;
	isChanceTrialCandidate?: boolean;
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

interface TelemetryEventBase {
	type: string;
	timestamp: number;
	decisionId?: string;
	sessionId?: string;
	promptHash?: string;
}

export interface RouteDecisionTelemetryEvent extends TelemetryEventBase {
	type: "route_decision";
	mode: AdaptiveRoutingMode;
	selected: {
		model: string;
		thinking: RouteThinkingLevel;
	};
	fallbacks: string[];
	classifier?: PromptRouteClassification;
	quota?: Record<string, RouteQuotaSnapshot>;
	candidates?: RouteCandidateScore[];
	explanationCodes: AdaptiveRoutingExplanationCode[];
	isChanceTrial: boolean;
}

export interface RouteOverrideTelemetryEvent extends TelemetryEventBase {
	type: "route_override";
	from: {
		model: string;
		thinking: RouteThinkingLevel;
	};
	to: {
		model: string;
		thinking: RouteThinkingLevel;
	};
	reason: "manual" | "lock" | "shadow-disagreement";
}

export interface RouteFeedbackTelemetryEvent extends TelemetryEventBase {
	type: "route_feedback";
	category: RouteFeedbackCategory;
}

export interface RouteOutcomeTelemetryEvent extends TelemetryEventBase {
	type: "route_outcome";
	turnCount: number;
	completed: boolean;
	userOverrideOccurred: boolean;
}

export type AdaptiveRoutingTelemetryEvent =
	| RouteDecisionTelemetryEvent
	| RouteOverrideTelemetryEvent
	| RouteFeedbackTelemetryEvent
	| RouteOutcomeTelemetryEvent;

export interface AdaptiveRoutingStats {
	decisions: number;
	feedback: Partial<Record<RouteFeedbackCategory, number>>;
	overrides: number;
	lastDecisionAt?: number;
}
