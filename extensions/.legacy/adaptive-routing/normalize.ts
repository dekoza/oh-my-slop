import type { Api, Model } from "@mariozechner/pi-ai";
import type { NormalizedRouteCandidate, RouteThinkingLevel, RouteTier } from "./types.js";

export function normalizeRouteCandidates(models: Model<Api>[]): NormalizedRouteCandidate[] {
	return models.map((model) => {
		const provider = String(model.provider);
		const modelId = model.id;
		const fullId = `${provider}/${modelId}`;
		return {
			fullId,
			provider,
			modelId,
			label: model.name || fullId,
			reasoning: model.reasoning,
			maxThinkingLevel: deriveMaxThinkingLevel(model),
			tier: deriveCandidateTier(model),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			input: [...model.input],
			costKnown: hasKnownCost(model),
			tags: deriveCandidateTags(model),
			family: deriveCandidateFamily(model),
			fallbackGroups: deriveFallbackGroups(model),
			available: true,
			authenticated: true,
			model,
		};
	});
}

export function deriveMaxThinkingLevel(model: Model<Api>): RouteThinkingLevel {
	if (!model.reasoning) return "off";

	const id = model.id.toLowerCase();
	// Models with documented extended/xhigh reasoning budgets
	if (
		id.includes("gpt-5") ||
		id.includes("opus-4.6") ||
		id.includes("opus-4-6") ||
		id.includes("gemini-3.1") ||
		id.includes("gemini-3-pro") ||
		id.includes("o1") ||
		id.includes("o3")
	) {
		return "xhigh";
	}

	return "high";
}

export function deriveCandidateTier(model: Model<Api>): RouteTier {
	const id = model.id.toLowerCase();
	const name = (model.name ?? "").toLowerCase();

	if (
		id.includes("gpt-5.4") ||
		id.includes("opus-4.6") ||
		id.includes("opus-4-6") ||
		name.includes("ultra") ||
		id.includes("o3") ||
		id.includes("gemini-3.1")
	) {
		return "peak";
	}
	if (
		id.includes("opus") ||
		id.includes("sonnet") ||
		id.includes("pro") ||
		id.includes("gpt-5") ||
		id.includes("codex") ||
		id.includes("o1")
	) {
		return "premium";
	}
	if (id.includes("flash") || id.includes("mini") || id.includes("haiku") || id.includes("nano")) {
		return "cheap";
	}
	return "balanced";
}

/**
 * Derives capability tags from model characteristics — NOT from provider brand.
 * Brand-based bias (Anthropic=design, OpenAI=architecture) has been removed.
 * Routing preference is governed by `preferredModels`/`preferredProviders` in config.
 */
export function deriveCandidateTags(model: Model<Api>): string[] {
	const tags = new Set<string>();
	const provider = String(model.provider);
	const tier = deriveCandidateTier(model);

	tags.add(provider);
	tags.add(tier);

	if (model.reasoning) tags.add("reasoning");
	if (model.input.includes("image")) tags.add("multimodal");
	if (tier === "premium" || tier === "peak") tags.add("premium");
	if (tier === "cheap") tags.add("cheap");

	// Large context window → suitable for large-breadth tasks
	if (model.contextWindow && model.contextWindow >= 500_000) tags.add("large-context");

	// Coding-specialised models
	const id = model.id.toLowerCase();
	if (id.includes("codex") || id.includes("coder") || id.includes("code")) tags.add("code-specialist");

	return Array.from(tags);
}

export function deriveCandidateFamily(model: Model<Api>): string | undefined {
	const provider = String(model.provider);
	const tier = deriveCandidateTier(model);

	switch (provider) {
		case "anthropic":
			return `anthropic-${tier}`;
		case "openai":
			return `openai-${tier}`;
		case "cursor-agent":
			return `cursor-${tier}`;
		case "google":
			return `google-${tier}`;
		default:
			return undefined;
	}
}

export function deriveFallbackGroups(model: Model<Api>): string[] {
	const provider = String(model.provider);
	const id = model.id.toLowerCase();
	const groups = new Set<string>();
	const tier = deriveCandidateTier(model);

	if (tier === "cheap") groups.add("cheap-router");

	// Premium/peak Anthropic or OpenAI models → design pool
	if (
		(provider === "anthropic" && (id.includes("opus") || id.includes("sonnet"))) ||
		(provider === "openai" && id.includes("gpt-5.4")) ||
		(provider === "google" && (id.includes("gemini-3.1") || id.includes("gemini-2.5-pro") || id.includes("gemini-3-pro")))
	) {
		groups.add("design-premium");
	}

	// Peak models → reasoning pool
	if (
		(provider === "anthropic" && id.includes("opus")) ||
		(provider === "openai" && id.includes("gpt-5.4")) ||
		(provider === "google" && id.includes("gemini-3.1"))
	) {
		groups.add("peak-reasoning");
	}

	if (provider === "cursor-agent") groups.add("peak-reasoning");

	return Array.from(groups);
}

export function matchesModelRef(
	reference: string,
	candidate: Pick<NormalizedRouteCandidate, "fullId" | "modelId">,
): boolean {
	const normalized = reference.trim();
	return normalized === candidate.fullId || normalized === candidate.modelId;
}

function hasKnownCost(model: Model<Api>): boolean {
	return Object.values(model.cost).some((value) => Number(value) > 0);
}
