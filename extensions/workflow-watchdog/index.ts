/**
 * Workflow Watchdog Extension
 *
 * Monitors pi's workflow for common failure patterns and intervenes:
 * - Loop detection: catches when the model repeats messages in circles
 * - Mistake tracking: detects cascading errors and escalates
 * - Supervisor escalation: calls a pre-configured model for rescue instructions
 *
 * Commands:
 *   /watchdog status    — show current state
 *   /watchdog on|off    — enable/disable all detection
 *   /watchdog reset     — clear session statistics
 *   /watchdog supervisor <provider/model> — configure supervisor model
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import {
	normalizeMessage,
	extractAssistantText,
	detectLoop,
	checkToolErrors,
	buildLoopIntervention,
	buildMistakeIntervention,
	buildRecentContext,
} from "./lib/detectors.mjs";

// ── Configuration ──────────────────────────────────────────────────────────────

interface LoopDetectionConfig {
	enabled: boolean;
	windowSize: number;
	minRepetitions: number;
	sequenceLength: number;
}

interface MistakeDetectionConfig {
	enabled: boolean;
	consecutiveErrorsThreshold: number;
	cooldownMs: number;
}

interface SupervisorConfig {
	enabled: boolean;
	provider: string;
	model: string;
	apiBase?: string;
	maxTokens: number;
}

interface WatchdogState {
	lastMessages: string[];
	consecutiveErrorTurns: number;
	totalErrorTurns: number;
	totalTurns: number;
	lastInterventionTime: number;
	loopInterventionCount: number;
	mistakeInterventionCount: number;
	supervisorCallCount: number;
}

const DEFAULT_CONFIG = {
	loopDetection: {
		enabled: true,
		windowSize: 12,
		minRepetitions: 3,
		sequenceLength: 2,
	},
	mistakeDetection: {
		enabled: true,
		consecutiveErrorsThreshold: 3,
		cooldownMs: 60_000,
	},
	supervisor: {
		enabled: false,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		maxTokens: 800,
	},
};

// ── Supervisor model caller ───────────────────────────────────────────────────

interface SupervisorCallResult {
	text: string;
	error?: string;
}

function guessApiBase(provider: string): string {
	switch (provider) {
		case "openai": return "https://api.openai.com/v1";
		case "anthropic": return "https://api.anthropic.com/v1";
		default: return `https://api.${provider}.com/v1`;
	}
}

async function callAnthropic(
	baseUrl: string, apiKey: string, modelId: string,
	systemPrompt: string, userPrompt: string, maxTokens: number,
): Promise<SupervisorCallResult> {
	const endpoint = baseUrl.replace(/\/$/, "") + "/messages";
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: modelId,
			system: systemPrompt,
			messages: [{ role: "user", content: userPrompt }],
			max_tokens: maxTokens,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		return { text: "", error: `Anthropic API error ${response.status}: ${body.slice(0, 200)}` };
	}

	const data = (await response.json()) as {
		content?: Array<{ type: string; text?: string }>;
		error?: { message: string };
	};

	if (data.error) return { text: "", error: data.error.message };

	const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") ?? "";
	return { text };
}

async function callOpenAI(
	baseUrl: string, apiKey: string, modelId: string,
	systemPrompt: string, userPrompt: string, maxTokens: number,
): Promise<SupervisorCallResult> {
	const endpoint = baseUrl.replace(/\/$/, "") + "/chat/completions";
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: modelId,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			max_tokens: maxTokens,
			temperature: 0.3,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		return { text: "", error: `OpenAI API error ${response.status}: ${body.slice(0, 200)}` };
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		error?: { message: string };
	};

	if (data.error) return { text: "", error: data.error.message };
	return { text: data.choices?.[0]?.message?.content ?? "" };
}

async function callSupervisor(
	config: SupervisorConfig, ctx: ExtensionContext, recentContext: string,
): Promise<SupervisorCallResult> {
	try {
		const provider = ctx.modelRegistry.getProvider(config.provider);
		if (!provider) {
			return { text: "", error: `Provider "${config.provider}" not found.` };
		}

		const model = ctx.modelRegistry.find(config.provider, config.model);
		if (!model) {
			return { text: "", error: `Model "${config.provider}/${config.model}" not found.` };
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) {
			return { text: "", error: `No API key for ${config.provider}/${config.model}.` };
		}

		const baseUrl = config.apiBase ?? provider.baseUrl ?? guessApiBase(config.provider);
		const isAnthropic = provider.api === "anthropic-messages" || config.provider === "anthropic";

		const systemPrompt = [
			"You are a senior coding supervisor analyzing an AI agent that appears to be struggling.",
			"The agent has made repeated mistakes. Review the recent execution trace below.",
			"Provide concise, actionable instructions the agent should follow next.",
			"Focus on: what went wrong, what to try instead, and ONE concrete next step.",
			"Keep your response under 3 paragraphs. Be direct.",
		].join("\n");

		const userPrompt = [
			"The agent has been working on a task but seems stuck in an error loop.",
			"",
			"Recent assistant messages and tool results:",
			recentContext,
			"",
			"What should the agent do next? Provide specific instructions.",
		].join("\n");

		if (isAnthropic) {
			return await callAnthropic(baseUrl, auth.apiKey, config.model, systemPrompt, userPrompt, config.maxTokens);
		}
		return await callOpenAI(baseUrl, auth.apiKey, config.model, systemPrompt, userPrompt, config.maxTokens);
	} catch (error) {
		return { text: "", error: `Supervisor call failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// ── Extension entry point ─────────────────────────────────────────────────────

export default function workflowWatchdog(pi: ExtensionAPI) {
	const state: WatchdogState = {
		lastMessages: [],
		consecutiveErrorTurns: 0,
		totalErrorTurns: 0,
		totalTurns: 0,
		lastInterventionTime: 0,
		loopInterventionCount: 0,
		mistakeInterventionCount: 0,
		supervisorCallCount: 0,
	};

	let config = structuredClone(DEFAULT_CONFIG) as typeof DEFAULT_CONFIG;
	const STATUS_KEY = "watchdog";

	function updateStatus(ctx: ExtensionContext): void {
		const active = config.loopDetection.enabled || config.mistakeDetection.enabled;
		if (!active) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, `👁 T:${state.totalTurns} E:${state.consecutiveErrorTurns}/${state.totalErrorTurns}`);
	}

	function canIntervene(): boolean {
		return Date.now() - state.lastInterventionTime >= config.mistakeDetection.cooldownMs;
	}

	function recordIntervention(): void {
		state.lastInterventionTime = Date.now();
	}

	// ── Events ─────────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		state.lastMessages = [];
		state.consecutiveErrorTurns = 0;
		state.totalErrorTurns = 0;
		state.totalTurns = 0;
		state.lastInterventionTime = 0;
		state.loopInterventionCount = 0;
		state.mistakeInterventionCount = 0;
		state.supervisorCallCount = 0;
		updateStatus(ctx);
	});

	pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
		state.totalTurns++;

		const rawText = extractAssistantText(event.message?.content);
		const normalized = normalizeMessage(rawText);

		if (normalized.length >= 10) {
			state.lastMessages.push(normalized);
			const maxBuffer = Math.max(
				config.loopDetection.windowSize * 2,
				config.loopDetection.sequenceLength * config.loopDetection.minRepetitions * 2,
			);
			while (state.lastMessages.length > maxBuffer) state.lastMessages.shift();
		}

		const hasErrors = checkToolErrors(event.toolResults);
		if (hasErrors) {
			state.consecutiveErrorTurns++;
			state.totalErrorTurns++;
		} else {
			state.consecutiveErrorTurns = 0;
		}

		// Loop detection
		if (config.loopDetection.enabled && canIntervene()) {
			const { detected, repeatCount } = detectLoop(config.loopDetection, state.lastMessages);
			if (detected) {
				state.loopInterventionCount++;
				recordIntervention();
				pi.sendMessage({
					customType: "watchdog",
					content: buildLoopIntervention(repeatCount),
					display: true,
				}, { deliverAs: "steer" });
				updateStatus(ctx);
				return;
			}
		}

		// Mistake detection
		if (
			config.mistakeDetection.enabled &&
			state.consecutiveErrorTurns >= config.mistakeDetection.consecutiveErrorsThreshold &&
			canIntervene()
		) {
			const isFirstEscalation = state.mistakeInterventionCount === 0;

			if (config.supervisor.enabled && isFirstEscalation) {
				state.supervisorCallCount++;
				recordIntervention();

				const recentContext = buildRecentContext(
					state.lastMessages, state.consecutiveErrorTurns, state.totalTurns,
				);

				ctx.ui.notify("Workflow Watchdog: calling supervisor model...", "warning");
				const result = await callSupervisor(config.supervisor, ctx, recentContext);

				if (result.text) {
					state.mistakeInterventionCount++;
					pi.sendMessage({
						customType: "watchdog",
						content: [
							"[WORKFLOW WATCHDOG — Supervisor Instructions]",
							"",
							result.text,
							"",
							"Follow these instructions carefully. Do NOT repeat previous failed actions.",
						].join("\n"),
						display: true,
					}, { deliverAs: "steer" });
				} else {
					ctx.ui.notify(`Watchdog supervisor failed: ${result.error}. Using default.`, "error");
					state.mistakeInterventionCount++;
					pi.sendMessage({
						customType: "watchdog",
						content: buildMistakeIntervention(state.consecutiveErrorTurns),
						display: true,
					}, { deliverAs: "steer" });
				}
			} else {
				state.mistakeInterventionCount++;
				recordIntervention();
				pi.sendMessage({
					customType: "watchdog",
					content: buildMistakeIntervention(state.consecutiveErrorTurns),
					display: true,
				}, { deliverAs: "steer" });
			}
		}

		updateStatus(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		state.consecutiveErrorTurns = 0;
		updateStatus(ctx);
	});

	// ── Commands ───────────────────────────────────────────────────────────

	pi.registerCommand("watchdog", {
		description: "Workflow watchdog controls: /watchdog [status|on|off|reset|supervisor <provider/model>]",
		async handler(args, ctx) {
			const [subcommand, ...rest] = args.trim().split(/\s+/).filter(Boolean);

			switch ((subcommand ?? "status").toLowerCase()) {
				case "status": {
					const lines = [
						"🐕 Workflow Watchdog Status",
						`Loop detection: ${config.loopDetection.enabled ? "ON" : "OFF"} (window=${config.loopDetection.windowSize}, reps=${config.loopDetection.minRepetitions})`,
						`Mistake detection: ${config.mistakeDetection.enabled ? "ON" : "OFF"} (threshold=${config.mistakeDetection.consecutiveErrorsThreshold}, cooldown=${config.mistakeDetection.cooldownMs}ms)`,
						`Supervisor: ${config.supervisor.enabled ? `${config.supervisor.provider}/${config.supervisor.model}` : "OFF"}`,
						"",
						"Session stats:",
						`  Total turns: ${state.totalTurns}`,
						`  Error turns: ${state.totalErrorTurns} (consecutive: ${state.consecutiveErrorTurns})`,
						`  Loop interventions: ${state.loopInterventionCount}`,
						`  Mistake interventions: ${state.mistakeInterventionCount}`,
						`  Supervisor calls: ${state.supervisorCallCount}`,
					].join("\n");
					ctx.ui.notify(lines, "info");
					return;
				}

				case "on":
					config.loopDetection.enabled = true;
					config.mistakeDetection.enabled = true;
					updateStatus(ctx);
					ctx.ui.notify("Watchdog: loop + mistake detection ON.", "info");
					return;

				case "off":
					config.loopDetection.enabled = false;
					config.mistakeDetection.enabled = false;
					updateStatus(ctx);
					ctx.ui.notify("Watchdog: all detection OFF.", "warning");
					return;

				case "reset":
					state.lastMessages = [];
					state.consecutiveErrorTurns = 0;
					state.totalErrorTurns = 0;
					state.totalTurns = 0;
					state.loopInterventionCount = 0;
					state.mistakeInterventionCount = 0;
					state.supervisorCallCount = 0;
					state.lastInterventionTime = 0;
					updateStatus(ctx);
					ctx.ui.notify("Watchdog: state reset.", "info");
					return;

				case "supervisor": {
					const modelRef = rest[0] ?? "";
					const slashIdx = modelRef.indexOf("/");
					if (slashIdx === -1) {
						ctx.ui.notify("Usage: /watchdog supervisor <provider>/<model>", "warning");
						return;
					}
					const provider = modelRef.slice(0, slashIdx);

					const found = ctx.modelRegistry.find(provider, modelRef);
					if (!found) {
						ctx.ui.notify(`Model "${modelRef}" not found.`, "error");
						return;
					}

					config.supervisor.enabled = true;
					config.supervisor.provider = provider;
					config.supervisor.model = modelRef;
					ctx.ui.notify(`Watchdog supervisor set to ${provider}/${modelRef}.`, "info");
					updateStatus(ctx);
					return;
				}

				default:
					ctx.ui.notify("Usage: /watchdog [status|on|off|reset|supervisor <provider/model>]", "warning");
			}
		},
	});
}
