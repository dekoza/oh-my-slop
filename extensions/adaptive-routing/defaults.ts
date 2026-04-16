import type {
	AdaptiveRoutingConfig,
	AdaptiveRoutingExplanationCode,
	DelegatedRoutingConfig,
	FallbackGroupPolicy,
	IntentRoutingPolicy,
	RouteIntent,
} from "./types.js";

export const ADAPTIVE_ROUTING_EXPLANATION_CODES: AdaptiveRoutingExplanationCode[] = [
	"intent_design_bias",
	"intent_architecture_bias",
	"premium_allowed",
	"premium_reserved",
	"quota_low",
	"quota_unknown",
	"thinking_clamped",
	"current_model_sticky",
	"fallback_group_applied",
	"cost_free_bias",
	"cost_low_bias",
	"cost_budget_applied",
	"cost_over_budget",
	"context_window_fit",
];

export const DEFAULT_INTENT_POLICIES: Record<RouteIntent, IntentRoutingPolicy> = {
	"quick-qna": {
		preferredTier: "cheap",
		defaultThinking: "minimal",
		fallbackGroup: "cheap-router",
	},
	planning: {
		preferredTier: "balanced",
		defaultThinking: "medium",
	},
	research: {
		preferredTier: "balanced",
		defaultThinking: "medium",
	},
	implementation: {
		preferredTier: "balanced",
		defaultThinking: "medium",
	},
	debugging: {
		preferredTier: "premium",
		defaultThinking: "high",
	},
	design: {
		preferredTier: "premium",
		defaultThinking: "high",
		preferredProviders: ["anthropic"],
		fallbackGroup: "design-premium",
	},
	architecture: {
		preferredTier: "peak",
		defaultThinking: "xhigh",
		preferredProviders: ["openai"],
		fallbackGroup: "peak-reasoning",
	},
	review: {
		preferredTier: "balanced",
		defaultThinking: "medium",
	},
	refactor: {
		preferredTier: "premium",
		defaultThinking: "high",
	},
	autonomous: {
		preferredTier: "peak",
		defaultThinking: "xhigh",
		fallbackGroup: "peak-reasoning",
	},
};

export const DEFAULT_FALLBACK_GROUPS: Record<string, FallbackGroupPolicy> = {
	"cheap-router": {
		candidates: ["google/gemini-2.5-flash", "openai/gpt-5-mini"],
		description: "Low-cost classifier and quick-turn routing pool.",
	},
	"design-premium": {
		candidates: ["google/gemini-3.1-pro-preview", "google/gemini-2.5-pro", "anthropic/claude-opus-4.6"],
		description: "Visual and design-focused routing pool.",
	},
	"peak-reasoning": {
		candidates: ["openai/gpt-5.4", "anthropic/claude-opus-4.6", "cursor-agent/<best-available>"],
		description: "Peak reasoning pool with premium cross-provider fallbacks.",
	},
	"standard-coding": {
		candidates: ["anthropic/claude-sonnet-4.6", "openai/gpt-5-mini", "google/gemini-2.5-pro"],
		description: "Balanced coding pool for delegated implementation work.",
	},
};

export const DEFAULT_DELEGATED_ROUTING_CONFIG: DelegatedRoutingConfig = {
	enabled: false,
	categories: {
		"quick-discovery": { taskClass: "quick" },
		"balanced-execution": { fallbackGroup: "standard-coding", defaultThinking: "medium" },
		"review-critical": { fallbackGroup: "peak-reasoning", defaultThinking: "high" },
		"peak-reasoning": { taskClass: "peak", defaultThinking: "xhigh" },
		"visual-engineering": { fallbackGroup: "design-premium", defaultThinking: "high" },
	},
};

export const DEFAULT_ADAPTIVE_ROUTING_CONFIG: AdaptiveRoutingConfig = {
	mode: "shadow",
	routerModels: ["google/gemini-2.5-flash", "openai/gpt-5-mini"],
	stickyTurns: 1,
	telemetry: {
		mode: "local",
		privacy: "minimal",
	},
	models: {
		ranked: [],
		excluded: [],
	},
	costs: {
		modelMultipliers: {},
	},
	intents: DEFAULT_INTENT_POLICIES,
	taskClasses: {
		quick: {
			defaultThinking: "minimal",
			candidates: ["google/gemini-2.5-flash", "openai/gpt-5-mini"],
			fallbackGroup: "cheap-router",
		},
		"design-premium": {
			defaultThinking: "high",
			candidates: ["anthropic/claude-opus-4.6", "openai/gpt-5.4"],
			fallbackGroup: "design-premium",
		},
		peak: {
			defaultThinking: "xhigh",
			candidates: ["openai/gpt-5.4", "anthropic/claude-opus-4.6", "cursor-agent/<best-available>"],
			fallbackGroup: "peak-reasoning",
		},
	},
	providerReserves: {
		openai: { minRemainingPct: 15, applyToTiers: ["premium", "peak"], allowOverrideForPeak: true },
		anthropic: { minRemainingPct: 15, applyToTiers: ["premium", "peak"], allowOverrideForPeak: true },
		"cursor-agent": {
			minRemainingPct: 20,
			applyToTiers: ["premium", "peak"],
			allowOverrideForPeak: true,
			confidence: "estimated",
		},
	},
	fallbackGroups: DEFAULT_FALLBACK_GROUPS,
	delegatedRouting: DEFAULT_DELEGATED_ROUTING_CONFIG,
};
