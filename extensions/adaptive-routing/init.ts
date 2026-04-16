import { DEFAULT_SCORING_CONFIG } from "./defaults.js";
import type {
	AdaptiveRoutingConfig,
	DelegatedCategoryPolicy,
	IntentRoutingPolicy,
	RouteThinkingLevel,
} from "./types.js";

export interface InitModelInfo {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	cost: { input: number };
}

type ModelTier = "cheap" | "balanced" | "premium" | "peak";

type GeneratedInitConfig = Pick<AdaptiveRoutingConfig, "mode" | "delegatedRouting"> &
	Partial<Pick<AdaptiveRoutingConfig, "routerModels" | "stickyTurns" | "models" | "costs" | "intents" | "scoring">>;

function classifyModelTier(model: InitModelInfo): ModelTier {
	const id = model.id.toLowerCase();
	if (id.includes("gpt-5.4") || id.includes("opus-4.6") || id.includes("opus-4-6")) {
		return "peak";
	}
	if (id.includes("opus") || id.includes("sonnet") || id.includes("pro") || id.includes("gpt-5")) {
		return "premium";
	}
	if (id.includes("flash") || id.includes("mini")) {
		return "cheap";
	}
	return "balanced";
}

function toFullId(model: InitModelInfo): string {
	return `${model.provider}/${model.id}`;
}

function hasProvider(models: InitModelInfo[], provider: string): boolean {
	return models.some((model) => model.provider === provider);
}

function availableSet(models: InitModelInfo[]): Set<string> {
	return new Set(models.map(toFullId));
}

function filterAvailable(preferred: string[], available: Set<string>): string[] {
	return preferred.filter((model) => available.has(model));
}

function filterMultiplierMap(map: Record<string, number>, available: Set<string>): Record<string, number> {
	const filtered: Record<string, number> = {};
	for (const [model, multiplier] of Object.entries(map)) {
		if (available.has(model)) {
			filtered[model] = multiplier;
		}
	}
	return filtered;
}

interface CategorySpec {
	tiers: ModelTier[];
	thinking: RouteThinkingLevel;
	preferred?: string[];
}

const CATEGORY_SPECS: Record<string, CategorySpec> = {
	"quick-discovery": { tiers: ["cheap", "balanced"], thinking: "minimal" },
	"balanced-execution": { tiers: ["balanced", "premium", "cheap"], thinking: "medium" },
	"review-critical": { tiers: ["premium", "peak", "balanced"], thinking: "high" },
	"visual-engineering": {
		tiers: ["premium", "peak"],
		thinking: "high",
		preferred: ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro"],
	},
	"peak-reasoning": { tiers: ["peak", "premium"], thinking: "xhigh" },
};

const GENERIC_EXCLUDED_MODELS = [
	"ollama/bge-m3:latest",
	"ollama/nomic-embed-text:latest",
	"ollama/snowflake-arctic-embed2:latest",
];

const COPILOT_EXCLUDED_MODELS = ["github-copilot/raptor-mini", "github-copilot/goldeneye"];

const COPILOT_ROUTER_MODELS = [
	"github-copilot/gpt-5-mini",
	"github-copilot/gpt-4.1",
	"github-copilot/gemini-3-flash-preview",
	"github-copilot/claude-haiku-4.5",
	"github-copilot/gpt-4o",
];

const COPILOT_RANKED_MODELS = [
	"github-copilot/claude-sonnet-4.6",
	"github-copilot/gemini-3.1-pro-preview",
	"github-copilot/gpt-5.2-codex",
	"github-copilot/gpt-5.3-codex",
	"github-copilot/gpt-5-mini",
	"github-copilot/gpt-5.4",
	"github-copilot/gemini-2.5-pro",
	"github-copilot/gpt-4.1",
	"github-copilot/gemini-3-flash-preview",
	"github-copilot/claude-haiku-4.5",
	"github-copilot/gpt-4o",
	"github-copilot/grok-code-fast-1",
	"github-copilot/claude-opus-4.6",
	"github-copilot/claude-opus-4.5",
	"ollama/qwen3-coder:30b",
	"ollama/deepseek-coder-v2:latest",
	"ollama/glm-4.7-flash:latest",
	"ollama/gemma3:12b",
];

const COPILOT_MODEL_MULTIPLIERS: Record<string, number> = {
	"github-copilot/gpt-5-mini": 0,
	"github-copilot/gpt-4.1": 0,
	"github-copilot/gpt-4o": 0,
	"github-copilot/grok-code-fast-1": 0.25,
	"github-copilot/claude-haiku-4.5": 0.33,
	"github-copilot/gemini-3-flash-preview": 0.33,
	"github-copilot/gpt-5.4-mini": 0.33,
	"github-copilot/claude-sonnet-4": 1,
	"github-copilot/claude-sonnet-4.5": 1,
	"github-copilot/claude-sonnet-4.6": 1,
	"github-copilot/gemini-2.5-pro": 1,
	"github-copilot/gemini-3.1-pro-preview": 1,
	"github-copilot/gpt-5.2": 1,
	"github-copilot/gpt-5.2-codex": 1,
	"github-copilot/gpt-5.3-codex": 1,
	"github-copilot/gpt-5.4": 1,
	"github-copilot/claude-opus-4.5": 3,
	"github-copilot/claude-opus-4.6": 3,
};

const COPILOT_INTENT_POLICIES: Record<string, IntentRoutingPolicy> = {
	explain: {
		preferredTier: "cheap",
		defaultThinking: "minimal",
		preferredModels: [
			"github-copilot/gpt-5-mini",
			"github-copilot/gemini-3-flash-preview",
			"github-copilot/claude-haiku-4.5",
			"github-copilot/gpt-4.1",
		],
		maxMultiplier: 0.33,
	},
	"test-writing": {
		preferredTier: "balanced",
		defaultThinking: "medium",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.3-codex",
		],
		maxMultiplier: 1,
	},
	migration: {
		preferredTier: "premium",
		defaultThinking: "high",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.4",
		],
		maxMultiplier: 1,
	},
	optimization: {
		preferredTier: "premium",
		defaultThinking: "high",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.3-codex",
			"github-copilot/gpt-5.4",
		],
		maxMultiplier: 1,
	},
	documentation: {
		preferredTier: "balanced",
		defaultThinking: "medium",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gpt-5-mini",
			"github-copilot/gemini-3-flash-preview",
		],
		maxMultiplier: 0.33,
	},
	"quick-qna": {
		preferredTier: "cheap",
		defaultThinking: "minimal",
		preferredModels: [
			"github-copilot/gpt-5-mini",
			"github-copilot/gpt-4.1",
			"github-copilot/gemini-3-flash-preview",
			"github-copilot/claude-haiku-4.5",
			"github-copilot/gpt-4o",
			"github-copilot/grok-code-fast-1",
		],
		maxMultiplier: 0.33,
	},
	planning: {
		preferredTier: "balanced",
		defaultThinking: "medium",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5-mini",
			"github-copilot/gemini-2.5-pro",
		],
		maxMultiplier: 1,
	},
	research: {
		preferredTier: "balanced",
		defaultThinking: "medium",
		preferredModels: [
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gemini-2.5-pro",
			"github-copilot/gpt-4.1",
			"github-copilot/gpt-5.4",
		],
		maxMultiplier: 1,
	},
	implementation: {
		preferredTier: "premium",
		defaultThinking: "medium",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.2-codex",
			"github-copilot/gpt-5.3-codex",
			"github-copilot/gpt-5-mini",
		],
		maxMultiplier: 1,
	},
	debugging: {
		preferredTier: "premium",
		defaultThinking: "high",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.2-codex",
			"github-copilot/gpt-5.3-codex",
			"github-copilot/gpt-5.4",
		],
		maxMultiplier: 1,
	},
	design: {
		preferredTier: "premium",
		defaultThinking: "high",
		preferredModels: [
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
			"github-copilot/gpt-5.4",
			"github-copilot/gemini-2.5-pro",
		],
		maxMultiplier: 1,
	},
	architecture: {
		preferredTier: "peak",
		defaultThinking: "xhigh",
		preferredModels: [
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.4",
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
		],
		maxMultiplier: 1,
	},
	review: {
		preferredTier: "premium",
		defaultThinking: "medium",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.4",
			"github-copilot/gpt-5.2-codex",
		],
		maxMultiplier: 1,
	},
	refactor: {
		preferredTier: "premium",
		defaultThinking: "high",
		preferredModels: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.3-codex",
			"github-copilot/gpt-5.2-codex",
			"github-copilot/gpt-5.4",
		],
		maxMultiplier: 1,
	},
	autonomous: {
		preferredTier: "peak",
		defaultThinking: "xhigh",
		preferredModels: [
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.4",
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
		],
		maxMultiplier: 1,
	},
};

const COPILOT_DELEGATED_CATEGORIES: Record<string, { candidates: string[]; defaultThinking: RouteThinkingLevel }> = {
	"quick-discovery": {
		candidates: [
			"github-copilot/gpt-5-mini",
			"github-copilot/gpt-4.1",
			"github-copilot/gemini-3-flash-preview",
			"github-copilot/claude-haiku-4.5",
			"github-copilot/gpt-4o",
			"github-copilot/grok-code-fast-1",
			"ollama/glm-4.7-flash:latest",
		],
		defaultThinking: "minimal",
	},
	"balanced-execution": {
		candidates: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.2-codex",
			"github-copilot/gpt-5.3-codex",
			"github-copilot/gpt-5-mini",
			"github-copilot/gemini-2.5-pro",
			"ollama/qwen3-coder:30b",
			"ollama/deepseek-coder-v2:latest",
		],
		defaultThinking: "medium",
	},
	"review-critical": {
		candidates: [
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.4",
			"github-copilot/gpt-5.2-codex",
		],
		defaultThinking: "high",
	},
	"visual-engineering": {
		candidates: [
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
			"github-copilot/gpt-5.4",
			"github-copilot/gemini-2.5-pro",
		],
		defaultThinking: "high",
	},
	"peak-reasoning": {
		candidates: [
			"github-copilot/gemini-3.1-pro-preview",
			"github-copilot/gpt-5.4",
			"github-copilot/claude-sonnet-4.6",
			"github-copilot/claude-opus-4.6",
		],
		defaultThinking: "xhigh",
	},
};

function selectCandidates(models: InitModelInfo[], preferredTiers: ModelTier[], preferred?: string[]): string[] {
	const tierBuckets = new Map<ModelTier, string[]>();
	for (const model of models) {
		const tier = classifyModelTier(model);
		const bucket = tierBuckets.get(tier) ?? [];
		bucket.push(toFullId(model));
		tierBuckets.set(tier, bucket);
	}

	const candidates: string[] = [];
	const seen = new Set<string>();

	if (preferred) {
		const allFullIds = models.map(toFullId);
		for (const hint of preferred) {
			const match = allFullIds.find((id) => id.endsWith(`/${hint}`) || id === hint);
			if (match && !seen.has(match)) {
				candidates.push(match);
				seen.add(match);
			}
		}
	}

	for (const tier of preferredTiers) {
		for (const fullId of tierBuckets.get(tier) ?? []) {
			if (!seen.has(fullId)) {
				candidates.push(fullId);
				seen.add(fullId);
			}
		}
	}

	if (candidates.length === 0) {
		for (const model of models) {
			const fullId = toFullId(model);
			if (!seen.has(fullId)) {
				candidates.push(fullId);
				seen.add(fullId);
			}
		}
	}

	return candidates;
}

function buildGenericDelegatedCategories(models: InitModelInfo[]): Record<string, DelegatedCategoryPolicy> {
	const categories: Record<string, DelegatedCategoryPolicy> = {};
	for (const [name, spec] of Object.entries(CATEGORY_SPECS)) {
		const candidates = selectCandidates(models, spec.tiers, spec.preferred);
		categories[name] = {
			candidates,
			defaultThinking: spec.thinking,
		};
	}
	return categories;
}

function buildCopilotAwareConfig(availableModels: InitModelInfo[]): GeneratedInitConfig {
	const available = availableSet(availableModels);
	const categories: Record<string, DelegatedCategoryPolicy> = {};
	for (const [name, policy] of Object.entries(COPILOT_DELEGATED_CATEGORIES)) {
		const candidates = filterAvailable(policy.candidates, available);
		categories[name] = {
			candidates:
				candidates.length > 0 ? candidates : buildGenericDelegatedCategories(availableModels)[name]?.candidates,
			defaultThinking: policy.defaultThinking,
		};
	}

	const intents: AdaptiveRoutingConfig["intents"] = {};
	for (const [name, policy] of Object.entries(COPILOT_INTENT_POLICIES)) {
		intents[name as keyof typeof COPILOT_INTENT_POLICIES] = {
			...policy,
			preferredModels: filterAvailable(policy.preferredModels ?? [], available),
		};
	}

	return {
		mode: "shadow",
		routerModels: filterAvailable(COPILOT_ROUTER_MODELS, available),
		stickyTurns: 1,
		models: {
			ranked: filterAvailable(COPILOT_RANKED_MODELS, available),
			excluded: [...GENERIC_EXCLUDED_MODELS, ...COPILOT_EXCLUDED_MODELS],
		},
		costs: {
			modelMultipliers: filterMultiplierMap(COPILOT_MODEL_MULTIPLIERS, available),
			defaultMaxMultiplier: 1,
		},
		intents,
		scoring: DEFAULT_SCORING_CONFIG,
		delegatedRouting: {
			enabled: true,
			categories,
		},
	};
}

export function generateDefaultConfig(availableModels: InitModelInfo[]): GeneratedInitConfig {
	if (availableModels.length === 0) {
		return {
			mode: "shadow",
			delegatedRouting: { enabled: true, categories: {} },
		};
	}

	if (hasProvider(availableModels, "github-copilot")) {
		return buildCopilotAwareConfig(availableModels);
	}

	return {
		mode: "shadow",
		delegatedRouting: {
			enabled: true,
			categories: buildGenericDelegatedCategories(availableModels),
		},
	};
}
