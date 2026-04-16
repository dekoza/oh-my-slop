import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
	BashToolCallEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ModelSelectEvent,
} from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { classifyPrompt } from "./classifier.js";
import { getAdaptiveRoutingConfigPath, readAdaptiveRoutingConfig } from "./config.js";
import {
	appendCommitTrail,
	attributeFixToOriginalCommits,
	buildTrailEntry,
	extractCommitHash,
	findTrailEntry,
	isFixCommit,
} from "./commit-trail.js";
import { decideRoute } from "./engine.js";
import { generateDefaultConfig, type InitModelInfo } from "./init.js";
import { normalizeRouteCandidates } from "./normalize.js";
import {
	formatScoreReport,
	getScoreAdjustment,
	readModelScores,
	recordFixAttribution,
	recordSuccessfulSession,
	shouldPenalise,
	toModelKey,
	writeModelScores,
} from "./scoring.js";
import { readAdaptiveRoutingState, writeAdaptiveRoutingState } from "./state.js";
import {
	appendTelemetryEvent,
	computeStats,
	createDecisionId,
	createFeedbackEvent,
	formatStats,
	hashPrompt,
	readTelemetryEvents,
} from "./telemetry.js";
import type {
	AdaptiveRoutingMode,
	AdaptiveRoutingState,
	CommitTrailEntry,
	ModelScoreStore,
	ProviderUsageState,
	RouteDecision,
	RouteEvidenceEntry,
	RouteFeedbackCategory,
	RouteIntent,
	RouteThinkingLevel,
} from "./types.js";

const STATUS_KEY = "adaptive-routing";

type RuntimeState = {
	state: AdaptiveRoutingState;
	usage?: ProviderUsageState;
	lastDecision?: RouteDecision;
	lastDecisionPromptHash?: string;
	lastDecisionTurnCount: number;
	lastDecisionOverridden: boolean;
	applyingRoute: boolean;
	/** Model actually in use (may differ from routed model if user overrode). */
	actualModel?: string;
	actualThinking?: RouteThinkingLevel;
	scoreStore: ModelScoreStore;
	/** Pending commit command waiting for its tool_result hash. */
	pendingCommitCommand?: string;
};

export default function adaptiveRoutingExtension(pi: ExtensionAPI) {
	const runtime: RuntimeState = {
		state: readAdaptiveRoutingState(),
		usage: undefined,
		lastDecision: undefined,
		lastDecisionPromptHash: undefined,
		lastDecisionTurnCount: 0,
		lastDecisionOverridden: false,
		applyingRoute: false,
		scoreStore: readModelScores(),
	};

	// ── Helpers ───────────────────────────────────────────────────────────────

	function persistState(): void {
		writeAdaptiveRoutingState({ ...runtime.state, lastDecision: runtime.lastDecision });
	}

	function getEffectiveMode(): AdaptiveRoutingMode {
		const config = readAdaptiveRoutingConfig();
		return runtime.state.mode ?? config.mode;
	}

	function currentRouteLabel(): string | undefined {
		const mode = getEffectiveMode();
		if (mode === "off") return undefined;
		const lockLabel = runtime.state.lock ? ` 🔒 ${runtime.state.lock.model}:${runtime.state.lock.thinking}` : "";
		const decision = runtime.lastDecision;
		const chanceLabel = decision?.isChanceTrial ? " [chance]" : "";
		return decision
			? `${mode} → ${decision.selectedModel}:${decision.selectedThinking}${chanceLabel}${lockLabel}`
			: `${mode}${lockLabel}`;
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, currentRouteLabel());
	}

	function refreshUsageSnapshot(): void {
		pi.events.emit("usage:query");
	}

	// ── Event: usage limits ────────────────────────────────────────────────────

	pi.events.on("usage:limits", (payload) => {
		const providers: ProviderUsageState["providers"] = {};
		if (payload && typeof payload === "object" && payload.providers && typeof payload.providers === "object") {
			for (const [provider, value] of Object.entries(payload.providers as Record<string, unknown>)) {
				providers[provider] = {
					confidence: extractQuotaConfidence(value),
					remainingPct: extractRemainingPct(value),
				};
			}
		}
		runtime.usage = {
			providers,
			sessionCost: typeof payload?.sessionCost === "number" ? payload.sessionCost : undefined,
			rolling30dCost: typeof payload?.rolling30dCost === "number" ? payload.rolling30dCost : undefined,
			perModel: typeof payload?.perModel === "object" ? payload.perModel : undefined,
			perSource: typeof payload?.perSource === "object" ? payload.perSource : undefined,
			updatedAt: Date.now(),
		};
	});

	// ── Event: session start ───────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		runtime.state = readAdaptiveRoutingState();
		runtime.scoreStore = readModelScores();
		refreshUsageSnapshot();
		updateStatus(ctx);
	});

	// ── Event: model select ────────────────────────────────────────────────────

	pi.on("model_select", async (event, ctx) => {
		if (!runtime.applyingRoute) {
			runtime.actualModel = `${event.model.provider}/${event.model.id}`;
			runtime.actualThinking = pi.getThinkingLevel() as RouteThinkingLevel;

			if (shouldRecordOverride(event, runtime.lastDecision)) {
				appendTelemetryEvent(readAdaptiveRoutingConfig().telemetry, {
					type: "route_override",
					timestamp: Date.now(),
					decisionId: runtime.lastDecision?.id,
					from: {
						model: runtime.lastDecision?.selectedModel ?? "unknown",
						thinking: runtime.lastDecision?.selectedThinking ?? "off",
					},
					to: {
						model: runtime.actualModel,
						thinking: runtime.actualThinking,
					},
					reason: "manual",
				});
				runtime.lastDecisionOverridden = true;
			}
		}
		updateStatus(ctx);
	});

	// ── Event: agent end ───────────────────────────────────────────────────────

	pi.on("agent_end", async (_event, _ctx) => {
		if (!runtime.lastDecision?.id) return;
		appendTelemetryEvent(readAdaptiveRoutingConfig().telemetry, {
			type: "route_outcome",
			timestamp: Date.now(),
			decisionId: runtime.lastDecision.id,
			turnCount: runtime.lastDecisionTurnCount,
			completed: true,
			userOverrideOccurred: runtime.lastDecisionOverridden,
		});
	});

	// ── Event: turn end ────────────────────────────────────────────────────────

	pi.on("turn_end", async () => {
		runtime.lastDecisionTurnCount += 1;
	});

	// ── Event: tool_call — intercept git commits ───────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		const cmd = (event as BashToolCallEvent).input.command;
		if (/\bgit\s+commit\b/.test(cmd) && /-m\s+["']/.test(cmd)) {
			runtime.pendingCommitCommand = cmd;
		}
	});

	// ── Event: tool_result — process git commit result ────────────────────────

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash" || !runtime.pendingCommitCommand) return;
		const bashResult = event as { toolName: "bash"; result: { output: string; exitCode?: number } };
		if (bashResult.result?.exitCode !== 0 && bashResult.result?.exitCode !== undefined) {
			runtime.pendingCommitCommand = undefined;
			return;
		}

		const output = bashResult.result?.output ?? "";
		const hash = extractCommitHash(output);
		runtime.pendingCommitCommand = undefined;
		if (!hash || !runtime.lastDecision) return;

		// Build trail entry — track the actual model, not just the routed one
		const actualModel = runtime.actualModel ?? runtime.lastDecision.selectedModel;
		const actualThinking = runtime.actualThinking ?? runtime.lastDecision.selectedThinking;
		const trailEntry = buildTrailEntry(
			hash,
			runtime.lastDecision,
			actualModel,
			actualThinking,
			runtime.lastDecisionTurnCount,
		);
		appendCommitTrail(trailEntry);

		// If this is a fix commit, attempt attribution and update scores
		const cmd = runtime.pendingCommitCommand ?? "";
		if (isFixCommit(cmd)) {
			void processFixCommit(hash, trailEntry, ctx.cwd);
		}
	});

	async function processFixCommit(fixHash: string, _fixEntry: CommitTrailEntry, cwd: string): Promise<void> {
		const blamedHashes = attributeFixToOriginalCommits(fixHash, cwd);
		const config = readAdaptiveRoutingConfig();
		let store = readModelScores();

		for (const blamedHash of blamedHashes) {
			const originalEntry = findTrailEntry(blamedHash);
			if (!originalEntry) continue;

			const modelKey = toModelKey(originalEntry.actualModel);
			const { record } = getScoreAdjustment(modelKey, store, config.scoring);
			const { penalised } = shouldPenalise(record, config.scoring);

			const evidence: RouteEvidenceEntry = {
				commitHash: fixHash,
				fixedHash: blamedHash,
				intent: originalEntry.intent,
				thinking: originalEntry.actualThinking,
				turns: originalEntry.turns,
				isChanceTrial: originalEntry.isChanceTrial,
				timestamp: Date.now(),
			};
			store = recordFixAttribution(store, modelKey, evidence, config.scoring);

			// Check if we just crossed the penalty threshold
			const { penalised: nowPenalised } = shouldPenalise(store.scores[modelKey], config.scoring);
			if (!penalised && nowPenalised) {
				console.warn(`[adaptive-routing] ${modelKey} has crossed the fix threshold — scoring penalty applied.`);
			}
		}

		writeModelScores(store);
		runtime.scoreStore = store;
	}

	// ── Event: before_agent_start — main routing logic ────────────────────────

	pi.on("before_agent_start", async (event, ctx) => {
		const config = readAdaptiveRoutingConfig();
		runtime.state = readAdaptiveRoutingState();
		const mode = runtime.state.mode ?? config.mode;
		if (mode === "off") {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		refreshUsageSnapshot();
		const availableModels = ctx.modelRegistry.getAvailable();
		const candidates = normalizeRouteCandidates(availableModels).filter(
			(c) => !config.models.excluded.some((entry) => entry === c.fullId || entry === c.modelId),
		);
		if (candidates.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, `${mode} → no eligible models`);
			return;
		}

		const classification = await classifyPrompt(event.prompt, config, ctx, candidates);
		const currentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
		const currentThinking = pi.getThinkingLevel() as RouteThinkingLevel;

		const decision = decideRoute({
			config,
			candidates,
			classification,
			currentModel,
			currentThinking,
			usage: runtime.usage,
			lock: runtime.state.lock,
			scoreStore: runtime.scoreStore,
		});
		if (!decision) {
			ctx.ui.setStatus(STATUS_KEY, `${mode} → no route`);
			return;
		}

		decision.id = createDecisionId();
		runtime.lastDecision = decision;
		runtime.lastDecisionPromptHash = hashPrompt(event.prompt);
		runtime.lastDecisionTurnCount = 0;
		runtime.lastDecisionOverridden = false;
		runtime.state.lastDecision = decision;
		persistState();

		// Track the routed model as the initial "actual" model (may be updated by model_select)
		runtime.actualModel = decision.selectedModel;
		runtime.actualThinking = decision.selectedThinking;

		appendTelemetryEvent(config.telemetry, {
			type: "route_decision",
			timestamp: Date.now(),
			decisionId: decision.id,
			promptHash: runtime.lastDecisionPromptHash,
			mode,
			selected: { model: decision.selectedModel, thinking: decision.selectedThinking },
			fallbacks: decision.fallbacks,
			classifier: classification,
			quota: decision.explanation.quota,
			candidates: decision.explanation.candidates,
			explanationCodes: decision.explanation.codes,
			isChanceTrial: decision.isChanceTrial,
		});

		if (mode === "shadow") {
			ctx.ui.notify(
				`Adaptive route suggestion: ${decision.selectedModel} · ${decision.selectedThinking}${decision.isChanceTrial ? " [chance trial]" : ""}`,
				"info",
			);
			updateStatus(ctx);
			return;
		}

		await applyDecision(pi, ctx, decision, candidates, runtime);
		updateStatus(ctx);
	});

	// ── /route command ─────────────────────────────────────────────────────────

	pi.registerCommand("route", {
		description:
			"Adaptive routing controls: /route [status|on|off|shadow|auto|explain|lock|unlock|refresh|feedback|stats|scores|init]",
		async handler(args, ctx) {
			const [head, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = (head ?? "status").toLowerCase();
			runtime.state = readAdaptiveRoutingState();

			switch (subcommand) {
				case "on":
				case "auto":
					runtime.state.mode = "auto";
					persistState();
					updateStatus(ctx);
					ctx.ui.notify("Adaptive routing set to auto mode.", "info");
					return;
				case "off":
					runtime.state.mode = "off";
					persistState();
					updateStatus(ctx);
					ctx.ui.notify("Adaptive routing disabled.", "warning");
					return;
				case "shadow":
					runtime.state.mode = "shadow";
					persistState();
					updateStatus(ctx);
					ctx.ui.notify("Adaptive routing set to shadow mode.", "info");
					return;
				case "lock": {
					if (!ctx.model) {
						ctx.ui.notify("No active model to lock.", "warning");
						return;
					}
					runtime.state.lock = {
						model: `${ctx.model.provider}/${ctx.model.id}`,
						thinking: pi.getThinkingLevel() as RouteThinkingLevel,
						setAt: Date.now(),
					};
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(
						`Adaptive routing locked to ${runtime.state.lock.model}:${runtime.state.lock.thinking}.`,
						"info",
					);
					return;
				}
				case "unlock":
					runtime.state.lock = undefined;
					persistState();
					updateStatus(ctx);
					ctx.ui.notify("Adaptive routing lock cleared.", "info");
					return;
				case "refresh":
					refreshUsageSnapshot();
					runtime.state = readAdaptiveRoutingState();
					runtime.scoreStore = readModelScores();
					ctx.ui.notify("Adaptive routing config, scores, and usage refreshed.", "info");
					updateStatus(ctx);
					return;
				case "feedback": {
					const category = normalizeFeedbackCategory(rest[0]);
					if (!category) {
						ctx.ui.notify(
							"Usage: /route feedback <good|bad|wrong-intent|overkill|underpowered|wrong-provider|wrong-thinking>",
							"warning",
						);
						return;
					}
					appendTelemetryEvent(
						readAdaptiveRoutingConfig().telemetry,
						createFeedbackEvent(runtime.lastDecision, category),
					);
					ctx.ui.notify(`Recorded route feedback: ${category}.`, "info");
					return;
				}
				case "scores":
					if (rest[0]?.toLowerCase() === "sync") {
						syncScoresToSwampCastle(pi, runtime.scoreStore);
						ctx.ui.notify("SwampCastle sync request queued — see injected message.", "info");
					} else {
						await openOverlay(ctx, formatScoreReport(runtime.scoreStore));
					}
					return;
				case "stats":
					await openOverlay(ctx, formatStats(computeStats(readTelemetryEvents())));
					return;
				case "explain":
					await openOverlay(ctx, buildExplanationLines(runtime.lastDecision, runtime.usage));
					return;
				case "init":
					await runInit(ctx);
					return;
				default:
					ctx.ui.notify(buildStatusLine(runtime.state, runtime.lastDecision, getEffectiveMode()), "info");
			}
		},
	});
}

// ── SwampCastle sync ──────────────────────────────────────────────────────────

/**
 * Injects a structured prompt that asks the agent to persist model scores to
 * SwampCastle (wing: model-routing, room: scores). The extension cannot call
 * MCP tools directly, so it delegates to the agent via sendUserMessage.
 */
function syncScoresToSwampCastle(pi: ExtensionAPI, store: ModelScoreStore): void {
	const records = Object.values(store.scores).sort((a, b) => b.score - a.score);
	const lines = [
		"[adaptive-routing] Sync model routing scores to SwampCastle.",
		"Wing: model-routing  Room: scores",
		"",
		"For each record below, call swampcastle_kg_add with:",
		'  subject = modelKey, predicate = "routing_score", object = JSON snippet',
		"",
		"Records:",
	];
	for (const r of records) {
		lines.push(
			`  ${r.modelKey}: score=${r.score} fixCount=${r.fixCount} totalTrials=${r.totalTrials} updatedAt=${r.updatedAt}`,
		);
	}
	lines.push("");
	lines.push(`Store metadata: penaltyThreshold=${store.penaltyThreshold} headStart=${store.headStart} updatedAt=${store.updatedAt}`);
	lines.push("");
	lines.push("After writing all records, confirm with a brief summary.");

	pi.sendUserMessage(lines.join("\n"));
}

// ── Apply decision ────────────────────────────────────────────────────────────

async function applyDecision(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	decision: RouteDecision,
	candidates: ReturnType<typeof normalizeRouteCandidates>,
	runtime: RuntimeState,
): Promise<void> {
	const currentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const currentThinking = pi.getThinkingLevel() as RouteThinkingLevel;
	if (currentModel === decision.selectedModel && currentThinking === decision.selectedThinking) return;

	const target = candidates.find((c) => c.fullId === decision.selectedModel);
	if (!target) {
		ctx.ui.notify(`Adaptive route target unavailable: ${decision.selectedModel}`, "warning");
		return;
	}

	runtime.applyingRoute = true;
	try {
		if (currentModel !== decision.selectedModel) {
			const ok = await pi.setModel(target.model);
			if (!ok) {
				ctx.ui.notify(`Failed to switch to ${decision.selectedModel}.`, "error");
				return;
			}
		}
		if (currentThinking !== decision.selectedThinking) {
			pi.setThinkingLevel(decision.selectedThinking);
		}
		const chanceLabel = decision.isChanceTrial ? " [chance trial — give it a chance]" : "";
		ctx.ui.notify(
			`Adaptive route applied: ${decision.selectedModel} · ${decision.selectedThinking}${chanceLabel}`,
			"info",
		);
	} finally {
		runtime.applyingRoute = false;
	}
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function shouldRecordOverride(event: ModelSelectEvent, lastDecision: RouteDecision | undefined): boolean {
	if (!(lastDecision && event.model)) return false;
	return `${event.model.provider}/${event.model.id}` !== lastDecision.selectedModel;
}

function extractQuotaConfidence(value: unknown): ProviderUsageState["providers"][string]["confidence"] {
	if (!value || typeof value !== "object") return "unknown";
	if (Array.isArray((value as { windows?: unknown }).windows) && (value as { windows: unknown[] }).windows.length > 0) return "authoritative";
	if ((value as { stale?: unknown }).stale) return "estimated";
	return "unknown";
}

function extractRemainingPct(value: unknown): number | undefined {
	if (!value || typeof value !== "object" || !Array.isArray((value as { windows?: unknown }).windows)) return undefined;
	const percentages = (value as { windows: unknown[] }).windows
		.map((w) =>
			w && typeof w === "object" ? Number((w as { remainingPct?: unknown }).remainingPct) : Number.NaN,
		)
		.filter((pct: number) => Number.isFinite(pct));
	if (percentages.length === 0) return undefined;
	return Math.min(...percentages);
}

function normalizeFeedbackCategory(value: string | undefined): RouteFeedbackCategory | undefined {
	switch ((value ?? "").toLowerCase()) {
		case "good":
		case "bad":
		case "wrong-intent":
		case "overkill":
		case "underpowered":
		case "wrong-provider":
		case "wrong-thinking":
			return value?.toLowerCase() as RouteFeedbackCategory;
		default:
			return undefined;
	}
}

function buildStatusLine(
	state: AdaptiveRoutingState,
	decision: RouteDecision | undefined,
	mode: AdaptiveRoutingMode,
): string {
	const parts = [`mode=${mode}`];
	if (state.lock) parts.push(`lock=${state.lock.model}:${state.lock.thinking}`);
	if (decision) {
		const chance = decision.isChanceTrial ? " [chance]" : "";
		parts.push(`last=${decision.selectedModel}:${decision.selectedThinking}${chance}`);
	}
	return `adaptive routing · ${parts.join(" · ")}`;
}

function buildExplanationLines(decision: RouteDecision | undefined, usage: ProviderUsageState | undefined): string[] {
	if (!decision) return ["Adaptive Routing", "No route decision recorded yet."];
	const lines = [
		"Adaptive Routing",
		`Selected: ${decision.selectedModel}${decision.isChanceTrial ? " [chance trial]" : ""}`,
		`Thinking: ${decision.selectedThinking}`,
		`Summary: ${decision.explanation.summary}`,
		`Codes: ${decision.explanation.codes.join(", ") || "none"}`,
	];
	if (decision.explanation.classification) {
		const c = decision.explanation.classification;
		lines.push(`Intent: ${c.intent} · complexity ${c.complexity} · tier ${c.recommendedTier}`);
		lines.push(`Thinking recommendation: ${c.recommendedThinking} · confidence ${Math.round(c.confidence * 100)}%`);
		lines.push(`Classifier: ${c.classifierMode}${c.classifierModel ? ` (${c.classifierModel})` : ""}`);
		lines.push(`Reason: ${c.reason}`);
	}
	if (decision.explanation.cost) {
		const sel = decision.explanation.cost.selectedMultiplier;
		const max = decision.explanation.cost.maxMultiplier;
		lines.push(`Multiplier: ${sel ?? "unknown"}${max === undefined ? "" : ` · budget ≤ ${max}`}`);
	}
	if (decision.fallbacks.length > 0) lines.push(`Fallbacks: ${decision.fallbacks.join(" → ")}`);
	if (decision.explanation.candidates?.length) {
		lines.push("Top candidates:");
		for (const c of decision.explanation.candidates) {
			const m = c.multiplier === undefined ? "" : ` · x${c.multiplier}`;
			lines.push(`  - ${c.model} (${c.score.toFixed(1)}${m}) [${c.reasons.join(", ")}]`);
		}
	}
	if (usage && Object.keys(usage.providers).length > 0) {
		lines.push("Quota snapshot:");
		for (const [provider, state] of Object.entries(usage.providers)) {
			lines.push(`  - ${provider}: ${state.remainingPct ?? "?"}% · ${state.confidence}`);
		}
	}
	lines.push("Press q, esc, space, or enter to close.");
	return lines;
}

async function openOverlay(ctx: ExtensionCommandContext, lines: string[]): Promise<void> {
	await ctx.ui.custom(
		(tui, _theme, _keybindings, done) => ({
			render(width: number) {
				return lines.map((line) => line.slice(0, width));
			},
			handleInput(data: string) {
				if (data === "q" || data === "\x1b" || data === " " || data === "\r") {
					done(undefined);
					return;
				}
				if (data === "r") tui.requestRender();
			},
			dispose() {},
		}),
		{ overlay: true, overlayOptions: { anchor: "center", width: 96, maxHeight: 28 } },
	);
}

async function runInit(ctx: ExtensionCommandContext): Promise<void> {
	const configPath = getAdaptiveRoutingConfigPath();

	if (existsSync(configPath)) {
		const overwrite = await ctx.ui.confirm("Config exists", `${configPath} already exists. Overwrite?`);
		if (!overwrite) {
			ctx.ui.notify("Init cancelled.", "info");
			return;
		}
	}

	const availableModels = ctx.modelRegistry.getAvailable();
	const modelInfos: InitModelInfo[] = availableModels.map((model) => ({
		provider: String(model.provider),
		id: model.id,
		name: model.name,
		reasoning: model.reasoning,
		cost: { input: Number(model.cost?.input ?? 0) },
	}));

	const generated = generateDefaultConfig(modelInfos);
	const json = `${JSON.stringify(generated, null, 2)}\n`;
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, json, "utf-8");

	const categoryNames = Object.keys(generated.delegatedRouting.categories);
	const summary =
		categoryNames.length > 0
			? `Created ${configPath} with categories: ${categoryNames.join(", ")}`
			: `Created ${configPath} (no models detected — add categories manually)`;
	ctx.ui.notify(summary, "info");

	const lines = [
		"Adaptive Routing — Config Generated",
		"",
		`File: ${configPath}`,
		`Mode: ${generated.mode}`,
		`Delegated routing: ${generated.delegatedRouting.enabled ? "enabled" : "disabled"}`,
		"",
	];
	for (const [name, cat] of Object.entries(generated.delegatedRouting.categories)) {
		lines.push(`  ${name}:`);
		lines.push(`    thinking: ${cat.defaultThinking ?? "default"}`);
		lines.push(`    models: ${(cat.candidates ?? []).join(", ")}`);
		lines.push("");
	}
	lines.push("Edit the file to customize categories and model order.");
	lines.push("Run /route on to enable auto-routing.");
	lines.push("");
	lines.push("Commit trailer format for agent commits:");
	lines.push("  Pi-Route: model=<id> intent=<intent> complexity=<n> thinking=<level> turns=<n>");
	lines.push("Press q, esc, space, or enter to close.");

	await openOverlay(ctx, lines);
}
