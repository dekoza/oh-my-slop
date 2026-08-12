import type { Api, AssistantMessage, Message, Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { buildFallbackClassification } from "./engine.js";
import { matchesModelRef } from "./normalize.js";
import type {
	AdaptiveRoutingConfig,
	NormalizedRouteCandidate,
	PromptRouteClassification,
	RouteComplexity,
	RouteContextBreadth,
	RouteIntent,
	RouteThinkingLevel,
	RouteTier,
} from "./types.js";

// ── Public entry point ────────────────────────────────────────────────────────

export async function classifyPrompt(
	prompt: string,
	config: AdaptiveRoutingConfig,
	ctx: Pick<ExtensionContext, "modelRegistry" | "sessionManager">,
	candidates: NormalizedRouteCandidate[],
): Promise<PromptRouteClassification> {
	const heuristic = classifyPromptHeuristically(prompt);
	const routerModel = pickRouterModel(config.routerModels, candidates);
	if (!routerModel) {
		return heuristic;
	}

	const apiKey = await resolveApiKey(routerModel.model, ctx);
	if (!apiKey) {
		return heuristic;
	}

	const transcript = buildTranscript(ctx.sessionManager.getBranch(), routerModel.model.contextWindow);

	try {
		const response = await completeSimple(
			routerModel.model,
			{
				systemPrompt:
					"You classify coding-agent prompts. Return strict JSON only with keys: intent, complexity, risk, expectedTurns, toolIntensity, contextBreadth, recommendedTier, recommendedThinking, confidence, reason. Use only allowed values. Keep reason ≤ 20 words.",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: buildClassifierPrompt(prompt, transcript) }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey,
				reasoning: routerModel.reasoning ? "minimal" : undefined,
			},
		);

		const parsed = parseClassifierResponse(extractAnswer(response));
		if (!parsed) {
			return { ...heuristic, reason: `${heuristic.reason} (classifier fallback)`, classifierMode: "heuristic" };
		}
		return { ...parsed, classifierMode: "llm", classifierModel: routerModel.fullId };
	} catch {
		return { ...heuristic, reason: `${heuristic.reason} (classifier unavailable)`, classifierMode: "heuristic" };
	}
}

// ── Heuristic classifier ──────────────────────────────────────────────────────

export function classifyPromptHeuristically(prompt: string): PromptRouteClassification {
	const text = prompt.toLowerCase();
	const intent = detectIntent(text);
	const complexity = detectComplexity(text, intent);
	const recommendedTier = detectTier(intent, complexity);
	const recommendedThinking = detectThinking(recommendedTier, intent);

	return {
		intent,
		complexity,
		risk: detectRisk(intent, complexity),
		expectedTurns: detectExpectedTurns(intent, complexity),
		toolIntensity: detectToolIntensity(intent),
		contextBreadth: detectContextBreadth(text, intent, complexity),
		recommendedTier,
		recommendedThinking,
		confidence: 0.5,
		reason: `heuristic ${intent} classification`,
		classifierMode: "heuristic",
	};
}

// ── Intent detection (ordered: specific → general) ───────────────────────────

function detectIntent(text: string): RouteIntent {
	// Autonomous: must come first — "keep going", "do everything", "handle all of"
	if (/(autonomous|work through|handle all of|keep going until|do everything|take care of all)/.test(text)) {
		return "autonomous";
	}

	// Architecture: system-level tradeoffs and design decisions
	// Note: "deep refactor" removed — it belongs to refactor, not architecture
	if (/(architecture|system design|tradeoff|trade-off|cross-cutting|cross cutting|approach for|how should (we|i|the system))/.test(text)) {
		return "architecture";
	}

	// Design: visual, UI/UX focused
	if (/(design|ui|ux|layout|visual|styling|style guide|theme|color palette|aesthetic|wireframe|mockup|figma)/.test(text)) {
		return "design";
	}

	// Debugging: error/fix focus
	if (/(debug|debugg|failing|failed|error|exception|stack trace|why is.*not|why (doesn't|does not|isn't|is not)|broken|crash(es|ing)?|wrong output|unexpected)/.test(text)) {
		return "debugging";
	}

	// Migration: porting/upgrading
	if (/(migrat|port from|upgrade (to|from)|move (to|from|the .* to)|convert (to|from)|transition (to|from))/.test(text)) {
		return "migration";
	}

	// Optimization: performance/resource focus
	if (/(optim|faster|speed up|slow(er|down|ness)|performance|latency|throughput|memory (usage|leak|pressure)|reduce (cost|overhead|memory|cpu|time))/.test(text)) {
		return "optimization";
	}

	// Test-writing: must come before implementation (write tests ≠ implement)
	if (/(write (a |the |some )?tests?|add (a |the |some )?tests?|test coverage|spec(ify|s) (this |the |a )?(function|method|class|module|component)|unit test|integration test|e2e test|playwright|pytest|vitest|jest)/.test(text)) {
		return "test-writing";
	}

	// Documentation
	if (/(document(ation|ation for|ing|s)?|docstring|jsdoc|readme|api docs?|write (up|a guide|the docs?|docs? for)|add (comments?|docs?))/.test(text)) {
		return "documentation";
	}

	// Review / audit
	if (/(review|audit|look over|inspect (this|the) (change|code|pr|diff|patch)|code review|give (me |your )?feedback on)/.test(text)) {
		return "review";
	}

	// Refactor / cleanup
	if (/(refactor|clean up|restructure|reorganize|rework|simplify|extract (method|function|class))/.test(text)) {
		return "refactor";
	}

	// Planning
	if (/(plan|roadmap|spec (out|this)|outline|break (this |it )?down|how (to )?approach|strategy for|steps (to|for))/.test(text)) {
		return "planning";
	}

	// Research / investigation
	if (/(research|investigate|compare|look up|search for|survey|find out|what are the (options|alternatives|tradeoffs))/.test(text)) {
		return "research";
	}

	// Explain: "explain", "how does X work", "what is X" (medium or long)
	if (/(explain|walk (me )?through|how does|how (do|does|did|can|would|should)|what (is|are|was|does|do)|why does|tell me (about|how|why|what))/.test(text)) {
		const wordCount = text.split(/\s+/).length;
		// Very short "what is X" → quick-qna; longer explanatory requests → explain
		return wordCount > 6 ? "explain" : "quick-qna";
	}

	// Implementation: explicit build/create/add
	if (/(implement|build|add|create|wire up|integrate|set up|scaffold|generate|write (a |the |some )?(function|class|module|service|component|endpoint|api|handler|hook|util))/.test(text)) {
		return "implementation";
	}

	// Fallback: short → quick-qna, longer → explain
	return text.split(/\s+/).length < 12 ? "quick-qna" : "explain";
}

// ── Complexity ────────────────────────────────────────────────────────────────

function detectComplexity(text: string, intent: RouteIntent): RouteComplexity {
	let score = 1;
	const words = text.split(/\s+/);
	const length = words.length;

	// Length signal (but saturates — 100-word prompts aren't necessarily harder than 60-word ones)
	if (length > 15) score += 1;
	if (length > 40) score += 1;

	// Scope-breadth signals: cross-cutting work is harder
	if (/(across (all|the|multiple|every)|entire (codebase|repo|app|system|project)|all (files|modules|services|endpoints)|everywhere|end.to.end|full (stack|system)|all (tests|components))/.test(text)) {
		score += 2;
	}

	// Multiple-concern signals
	if (/(multiple|several|various|and (also|then|additionally)|as well as|in addition|plus (also|the|a)|both .* and)/.test(text)) {
		score += 1;
	}

	// Risky / critical signals
	if (/(migration|breaking (change|api)|prod(uction)?|security|auth|credential|secret|token|password|encrypt|permiss)/.test(text)) {
		score += 1;
	}

	// Deep technical signals
	if (/(deeply|thoroughly|carefully|comprehensively|fully|completely|end.to.end|from scratch|ground up)/.test(text)) {
		score += 1;
	}

	// Intent bumps: inherently complex intents
	if (["architecture", "autonomous", "migration"].includes(intent)) {
		score += 1;
	}

	return Math.min(score, 5) as RouteComplexity;
}

// ── Tier / thinking / risk / turns / tools / breadth ──────────────────────────

function detectTier(intent: RouteIntent, complexity: RouteComplexity): RouteTier {
	const cheapIntents: RouteIntent[] = ["quick-qna", "explain", "documentation"];
	const balancedIntents: RouteIntent[] = ["planning", "research", "implementation", "test-writing"];
	const premiumIntents: RouteIntent[] = ["debugging", "review", "refactor", "migration", "optimization", "design"];
	const peakIntents: RouteIntent[] = ["architecture", "autonomous"];

	if (cheapIntents.includes(intent) && complexity <= 2) return "cheap";
	if (peakIntents.includes(intent)) return complexity >= 3 ? "peak" : "premium";
	if (premiumIntents.includes(intent)) return complexity >= 4 ? "peak" : "premium";
	if (balancedIntents.includes(intent)) return complexity >= 4 ? "premium" : complexity >= 3 ? "balanced" : "cheap";

	// documentation / explain can escalate
	if (complexity >= 4) return "premium";
	return complexity <= 2 ? "cheap" : "balanced";
}

function detectThinking(tier: RouteTier, intent: RouteIntent): RouteThinkingLevel {
	if (tier === "cheap") return "minimal";
	if (tier === "balanced") return "medium";
	if (tier === "premium") {
		// High-risk intents within premium deserve more thinking
		if (["debugging", "refactor", "migration", "optimization", "design"].includes(intent)) return "high";
		return "medium";
	}
	// peak
	return "xhigh";
}

function detectRisk(intent: RouteIntent, complexity: RouteComplexity): "low" | "medium" | "high" {
	if (intent === "quick-qna" || intent === "explain" || intent === "documentation") return "low";
	if (["architecture", "migration", "autonomous"].includes(intent) || complexity >= 4) return "high";
	if (["debugging", "refactor", "optimization", "review"].includes(intent)) return "medium";
	return "medium";
}

function detectExpectedTurns(intent: RouteIntent, complexity: RouteComplexity): "one" | "few" | "many" {
	if (intent === "quick-qna" || intent === "explain") return "one";
	if (["architecture", "autonomous", "migration"].includes(intent) || complexity >= 4) return "many";
	return "few";
}

function detectToolIntensity(intent: RouteIntent): "low" | "medium" | "high" {
	if (["quick-qna", "explain", "documentation"].includes(intent)) return "low";
	if (["implementation", "debugging", "refactor", "migration", "optimization", "test-writing", "autonomous"].includes(intent)) return "high";
	return "medium";
}

function detectContextBreadth(text: string, intent: RouteIntent, complexity: RouteComplexity): RouteContextBreadth {
	// Explicit large-scope signals
	if (/(across (all|the|multiple|every)|entire (codebase|repo|app|system|project)|all (files|modules|services)|everywhere|full (stack|system)|whole (codebase|project|app))/.test(text)) {
		return "large";
	}

	// Explicit small-scope signals
	if (/(this (file|function|method|line|class|component|hook)|in here|right here|just (this|the following)|single (file|function|method))/.test(text)) {
		return "small";
	}

	// Derive from intent + complexity as fallback
	if (intent === "architecture" || intent === "autonomous") return "large";
	if (complexity >= 4) return "large";
	if (complexity >= 3 || ["migration", "refactor", "optimization"].includes(intent)) return "medium";
	return "small";
}

// ── Transcript builder ────────────────────────────────────────────────────────

/**
 * Builds a compact conversation transcript from the current session branch,
 * excluding tool results (which pollute context). Truncated to ≤60% of the
 * router model's context window (measured in characters ÷ 4 as a token proxy).
 */
function buildTranscript(entries: SessionEntry[], contextWindow?: number): string {
	const maxChars = contextWindow ? Math.floor(contextWindow * 0.6) * 4 : 32_000 * 4;
	const lines: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message as Message;

		if (msg.role === "user") {
			const text = extractUserText(msg);
			if (text) lines.push(`User: ${text}`);
		} else if (msg.role === "assistant") {
			const aMsg = msg as AssistantMessage;
			const parts: string[] = [];
			for (const part of aMsg.content) {
				if (part.type === "text") parts.push(part.text);
				if (part.type === "thinking") parts.push(`[thinking: ${part.thinking}]`);
				if (part.type === "tool_use") {
					const args = JSON.stringify((part as { type: "tool_use"; name: string; input: unknown }).input ?? {});
					parts.push(`[tool: ${(part as { type: "tool_use"; name: string }).name}(${args.slice(0, 120)})]`);
				}
			}
			if (parts.length) lines.push(`Assistant: ${parts.join(" ")}`);
		}
		// toolResult entries (role === "toolResult") are intentionally skipped
	}

	// Trim from the front to stay within budget
	let result = lines.join("\n");
	if (result.length > maxChars) {
		const trimmed = result.slice(result.length - maxChars);
		// Snap to a line boundary to avoid mid-line truncation
		const firstNewline = trimmed.indexOf("\n");
		result = firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed;
		result = `[...transcript trimmed...]\n${result}`;
	}
	return result;
}

function extractUserText(msg: Message): string {
	if (msg.role !== "user") return "";
	const content = msg.content;
	if (typeof content === "string") return content;
	return content
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join(" ");
}

// ── LLM classifier helpers ────────────────────────────────────────────────────

function buildClassifierPrompt(prompt: string, transcript: string): string {
	const parts = [
		"Classify this coding-agent prompt.",
		"Allowed intent values: quick-qna, explain, planning, research, implementation, test-writing, debugging, review, refactor, migration, optimization, documentation, design, architecture, autonomous.",
		"Allowed complexity values: 1, 2, 3, 4, 5.",
		"Allowed risk values: low, medium, high.",
		"Allowed expectedTurns values: one, few, many.",
		"Allowed toolIntensity values: low, medium, high.",
		"Allowed contextBreadth values: small, medium, large.",
		"Allowed recommendedTier values: cheap, balanced, premium, peak.",
		"Allowed recommendedThinking values: off, minimal, low, medium, high, xhigh.",
		"Return JSON only.",
	];

	if (transcript.trim()) {
		parts.push("", "Recent conversation context (use to understand what the user is working on):", transcript, "");
	}

	parts.push(`New prompt to classify: ${prompt}`);
	return parts.join("\n");
}

function parseClassifierResponse(text: string): PromptRouteClassification | undefined {
	try {
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) return undefined;
		const parsed = JSON.parse(match[0]) as Partial<PromptRouteClassification>;
		if (!(parsed.intent && parsed.recommendedTier && parsed.recommendedThinking)) return undefined;
		return {
			...buildFallbackClassification(parsed.intent),
			...parsed,
			confidence: clampConfidence(parsed.confidence),
			reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "llm classification",
		};
	} catch {
		return undefined;
	}
}

function extractAnswer(message: AssistantMessage): string {
	return message.content
		.filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("")
		.trim();
}

function clampConfidence(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0.65;
	return Math.max(0, Math.min(1, parsed));
}

function pickRouterModel(
	routerModels: string[],
	candidates: NormalizedRouteCandidate[],
): NormalizedRouteCandidate | undefined {
	for (const ref of routerModels) {
		const match = candidates.find((c) => matchesModelRef(ref, c));
		if (match) return match;
	}
	return candidates.find((c) => c.tier === "cheap") ?? candidates[0];
}

async function resolveApiKey(
	model: Model<Api>,
	ctx: Pick<ExtensionContext, "modelRegistry">,
): Promise<string | undefined> {
	const registry = ctx.modelRegistry as ExtensionContext["modelRegistry"] & {
		getApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
		authStorage?: { getApiKey?: (provider: string) => Promise<string | undefined> };
	};
	if (typeof registry.getApiKey === "function") return registry.getApiKey(model);
	if (typeof registry.getApiKeyForProvider === "function") return registry.getApiKeyForProvider(model.provider);
	if (typeof registry.authStorage?.getApiKey === "function") return registry.authStorage.getApiKey(model.provider);
	return undefined;
}
