import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	streamSimple,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
	FAILOVER_PROVIDER_NAME,
	buildWrapperModel,
	formatAttemptSummary,
	orderCandidates,
	pipeFailoverStream,
} from "./lib/failover-core.mjs";
import { buildFailoverProviderConfig } from "./lib/provider-registration.mjs";
import {
	formatGenerationPlan,
	inspectGenerationPlan,
	resolvePreferredProviders,
} from "./lib/default-config.mjs";
import {
	ensureFailoverStoragePath,
	getFailoverConfigPath,
	getFailoverStatePath,
	migrateLegacyFile,
} from "./lib/storage.mjs";
import { buildBootstrapWrapperModel, buildPersistedWrapperSnapshot } from "./lib/bootstrap-models.mjs";

interface FailoverRouteConfig {
	provider: string;
	model: string;
}

interface FailoverWrapperConfig {
	reasoning: boolean;
	input: string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

interface FailoverModelConfig {
	id: string;
	name: string;
	strategy: FailoverRouteConfig[];
	sticky?: boolean;
	wrapper?: FailoverWrapperConfig;
}

interface FailoverFileConfig {
	models: FailoverModelConfig[];
}

interface RegisteredFailoverModel extends FailoverModelConfig {
	wrapperModel: Model<Api>;
}

interface ResolvedCandidate {
	key: string;
	provider: string;
	model: string;
	resolvedModel: Model<Api>;
	auth: { apiKey: string; headers?: Record<string, string> };
}

interface SkippedCandidate {
	provider: string;
	model: string;
	reason: string;
}

const LEGACY_CONFIG_PATH = fileURLToPath(new URL("./config.json", import.meta.url));
const LEGACY_STATE_PATH = fileURLToPath(new URL("./state.json", import.meta.url));
const CONFIG_PATH = getFailoverConfigPath(getAgentDir());
const STATE_PATH = getFailoverStatePath(getAgentDir());

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createErrorMessage(model: Model<Api>, errorMessage: string, stopReason: "error" | "aborted" = "error") {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	} satisfies AssistantMessage;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function loadState(): Promise<Map<string, string>> {
	migrateLegacyFile(LEGACY_STATE_PATH, STATE_PATH);

	if (!(await fileExists(STATE_PATH))) {
		return new Map();
	}
	try {
		const raw = JSON.parse(await readFile(STATE_PATH, "utf8")) as unknown;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return new Map();
		}
		const stickyRoutes = (raw as { stickyRoutes?: unknown }).stickyRoutes;
		if (!stickyRoutes || typeof stickyRoutes !== "object" || Array.isArray(stickyRoutes)) {
			return new Map();
		}
		return new Map(
			Object.entries(stickyRoutes as Record<string, unknown>).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return new Map();
	}
}

async function saveState(stickyRoutes: Map<string, string>): Promise<void> {
	ensureFailoverStoragePath(STATE_PATH);
	await writeFile(
		STATE_PATH,
		`${JSON.stringify({ stickyRoutes: Object.fromEntries(stickyRoutes) }, null, 2)}\n`,
		"utf8",
	);
}

async function loadConfig(): Promise<{ path: string; config: FailoverFileConfig } | undefined> {
	migrateLegacyFile(LEGACY_CONFIG_PATH, CONFIG_PATH);

	if (!(await fileExists(CONFIG_PATH))) {
		return undefined;
	}

	const rawConfig = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as unknown;
	return { path: CONFIG_PATH, config: validateConfig(rawConfig, CONFIG_PATH) };
}

function loadConfigSync(): { path: string; config: FailoverFileConfig } | undefined {
	migrateLegacyFile(LEGACY_CONFIG_PATH, CONFIG_PATH);

	if (!existsSync(CONFIG_PATH)) {
		return undefined;
	}

	const rawConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
	return { path: CONFIG_PATH, config: validateConfig(rawConfig, CONFIG_PATH) };
}

async function getGenerationPlan(ctx: ExtensionContext) {
	const availableModels = await ctx.modelRegistry.getAvailable();
	const preferredProviders = resolvePreferredProviders(availableModels);
	return inspectGenerationPlan(availableModels, preferredProviders);
}

async function generateDefaultConfig(
	ctx: ExtensionContext,
): Promise<{ path: string; config: FailoverFileConfig; preferredProviders: string[] }> {
	const plan = await getGenerationPlan(ctx);
	const generatedConfig = await hydrateWrapperMetadata({ models: plan.matchedModels }, ctx);
	if (generatedConfig.models.length === 0) {
		throw new Error(
			`Could not generate ${CONFIG_PATH}. No GitHub Copilot models matched providers from this plan: ${plan.preferredProviders.join(", ")}.`,
		);
	}

	await saveConfig(generatedConfig);
	ctx.ui.notify(
		`provider-failover: generated default config at ${CONFIG_PATH} using provider plan ${plan.preferredProviders.join(" -> ")}`,
		"info",
	);
	return { path: CONFIG_PATH, config: generatedConfig, preferredProviders: plan.preferredProviders };
}

async function saveConfig(config: FailoverFileConfig): Promise<void> {
	ensureFailoverStoragePath(CONFIG_PATH);
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function hydrateWrapperMetadata(config: FailoverFileConfig, ctx: ExtensionContext): Promise<FailoverFileConfig> {
	const models: FailoverModelConfig[] = [];

	for (const configuredModel of config.models) {
		const backendModels = configuredModel.strategy.map((route) => ctx.modelRegistry.find(route.provider, route.model));
		if (backendModels.some((model) => !model)) {
			models.push(configuredModel);
			continue;
		}

		try {
			const wrapperModel = buildWrapperModel(
				{ id: configuredModel.id, name: configuredModel.name },
				backendModels as Model<Api>[],
			) as Model<Api>;
			models.push({ ...configuredModel, wrapper: buildPersistedWrapperSnapshot(wrapperModel) });
		} catch {
			models.push(configuredModel);
		}
	}

	return { models };
}

function wrappersEqual(left: FailoverWrapperConfig | undefined, right: FailoverWrapperConfig | undefined): boolean {
	if (!left || !right) {
		return left === right;
	}

	return JSON.stringify(left) === JSON.stringify(right);
}

function validateConfig(rawConfig: unknown, sourcePath: string): FailoverFileConfig {
	if (!rawConfig || typeof rawConfig !== "object") {
		throw new Error(`Failover config ${sourcePath} must be a JSON object.`);
	}

	const models = (rawConfig as { models?: unknown }).models;
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error(`Failover config ${sourcePath} must define a non-empty models array.`);
	}

	return {
		models: models.map((item, index) => validateModelConfig(item, sourcePath, index)),
	};
}

function validateModelConfig(rawModel: unknown, sourcePath: string, index: number): FailoverModelConfig {
	if (!rawModel || typeof rawModel !== "object") {
		throw new Error(`Failover config ${sourcePath} has an invalid model entry at index ${index}.`);
	}

	const model = rawModel as {
		id?: unknown;
		name?: unknown;
		strategy?: unknown;
		sticky?: unknown;
		wrapper?: unknown;
	};

	if (typeof model.id !== "string" || model.id.trim() === "") {
		throw new Error(`Failover config ${sourcePath} model #${index + 1} is missing a string id.`);
	}

	if (typeof model.name !== "string" || model.name.trim() === "") {
		throw new Error(`Failover config ${sourcePath} model ${model.id} is missing a string name.`);
	}

	if (!Array.isArray(model.strategy) || model.strategy.length < 2) {
		throw new Error(`Failover config ${sourcePath} model ${model.id} needs at least two strategy entries.`);
	}

	return {
		id: model.id,
		name: model.name,
		sticky: model.sticky !== false,
		wrapper: validateWrapperConfig(model.wrapper),
		strategy: model.strategy.map((route, routeIndex) => validateRouteConfig(route, sourcePath, model.id, routeIndex)),
	};
}

function validateWrapperConfig(rawWrapper: unknown): FailoverWrapperConfig | undefined {
	if (!rawWrapper || typeof rawWrapper !== "object" || Array.isArray(rawWrapper)) {
		return undefined;
	}

	const wrapper = rawWrapper as {
		reasoning?: unknown;
		input?: unknown;
		cost?: unknown;
		contextWindow?: unknown;
		maxTokens?: unknown;
	};

	if (typeof wrapper.reasoning !== "boolean") {
		return undefined;
	}

	if (!Array.isArray(wrapper.input) || wrapper.input.some((item) => typeof item !== "string")) {
		return undefined;
	}

	const cost = wrapper.cost as
		| { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown }
		| undefined;
	if (!cost) {
		return undefined;
	}

	const costValues = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite];
	if (costValues.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
		return undefined;
	}

	if (typeof wrapper.contextWindow !== "number" || !Number.isFinite(wrapper.contextWindow)) {
		return undefined;
	}

	if (typeof wrapper.maxTokens !== "number" || !Number.isFinite(wrapper.maxTokens)) {
		return undefined;
	}

	return {
		reasoning: wrapper.reasoning,
		input: [...wrapper.input],
		cost: {
			input: cost.input,
			output: cost.output,
			cacheRead: cost.cacheRead,
			cacheWrite: cost.cacheWrite,
		},
		contextWindow: wrapper.contextWindow,
		maxTokens: wrapper.maxTokens,
	};
}

function validateRouteConfig(
	rawRoute: unknown,
	sourcePath: string,
	modelId: string,
	index: number,
): FailoverRouteConfig {
	if (!rawRoute || typeof rawRoute !== "object") {
		throw new Error(`Failover config ${sourcePath} model ${modelId} has an invalid route at index ${index}.`);
	}

	const route = rawRoute as { provider?: unknown; model?: unknown };
	if (typeof route.provider !== "string" || route.provider.trim() === "") {
		throw new Error(`Failover config ${sourcePath} model ${modelId} route #${index + 1} is missing a provider.`);
	}

	if (typeof route.model !== "string" || route.model.trim() === "") {
		throw new Error(`Failover config ${sourcePath} model ${modelId} route #${index + 1} is missing a model.`);
	}

	return { provider: route.provider, model: route.model };
}

export default function (pi: ExtensionAPI) {
	const runtime = {
		ctx: undefined as ExtensionContext | undefined,
		configPath: undefined as string | undefined,
		models: new Map<string, RegisteredFailoverModel>(),
		stickyRouteByModelId: new Map<string, string>(),
		notices: [] as string[],
	};

	const flushNotices = (ctx: ExtensionContext) => {
		while (runtime.notices.length > 0) {
			const notice = runtime.notices.shift();
			if (notice) {
				ctx.ui.notify(notice, "warning");
			}
		}
	};

	const ensureProviderRegistered = async (ctx: ExtensionContext) => {
		try {
			const loaded = (await loadConfig()) ?? (await generateDefaultConfig(ctx));
			const hydratedConfig = await hydrateWrapperMetadata(loaded.config, ctx);
			const configChanged = hydratedConfig.models.some(
				(model, index) => !wrappersEqual(model.wrapper, loaded.config.models[index]?.wrapper),
			);
			if (configChanged) {
				await saveConfig(hydratedConfig);
			}

			runtime.configPath = loaded.path;
			const registeredModels: Model<Api>[] = [];
			const nextRuntimeModels = new Map<string, RegisteredFailoverModel>();
			const registrationErrors: string[] = [];

			for (const configuredModel of hydratedConfig.models) {
				const backendModels = configuredModel.strategy.map((route) => ctx.modelRegistry.find(route.provider, route.model));
				if (backendModels.some((model) => !model)) {
					const missingTargets = configuredModel.strategy
						.filter((_, index) => !backendModels[index])
						.map((route) => `${route.provider}/${route.model}`)
						.join(", ");
					registrationErrors.push(`Skipping ${configuredModel.id}: model not found (${missingTargets}).`);
					continue;
				}

				try {
					const wrapperModel = buildWrapperModel(
						{ id: configuredModel.id, name: configuredModel.name },
						backendModels as Model<Api>[],
					) as Model<Api>;
					registeredModels.push(wrapperModel);
					nextRuntimeModels.set(configuredModel.id, { ...configuredModel, wrapperModel });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					registrationErrors.push(`Skipping ${configuredModel.id}: ${message}`);
				}
			}

			if (registeredModels.length === 0) {
				ctx.ui.notify(`provider-failover: ${registrationErrors.join(" ")}`, "error");
				return;
			}

			runtime.models.clear();
			for (const [modelId, modelConfig] of nextRuntimeModels.entries()) {
				runtime.models.set(modelId, modelConfig);
			}

			pi.registerProvider(
				FAILOVER_PROVIDER_NAME,
				buildFailoverProviderConfig(
					registeredModels,
					(model, context, options) => streamWithFailover(model as Model<Api>, context, options),
				),
			);

			if (registrationErrors.length > 0) {
				ctx.ui.notify(`provider-failover: ${registrationErrors.join(" ")}`, "warning");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`provider-failover: ${message}`, "error");
		}
	};

	const resolveCandidates = async (wrapperModelId: string): Promise<{ candidates: ResolvedCandidate[]; skipped: SkippedCandidate[] }> => {
		const ctx = runtime.ctx;
		const configuredModel = runtime.models.get(wrapperModelId);
		if (!ctx || !configuredModel) {
			return { candidates: [], skipped: [] };
		}

		const stickyKey = configuredModel.sticky ? runtime.stickyRouteByModelId.get(wrapperModelId) : undefined;
		const orderedRoutes = orderCandidates(
			configuredModel.strategy.map((route) => ({
				...route,
				key: `${route.provider}/${route.model}`,
			})),
			stickyKey,
		);

		const candidates: ResolvedCandidate[] = [];
		const skipped: SkippedCandidate[] = [];

		for (const route of orderedRoutes) {
			const resolvedModel = ctx.modelRegistry.find(route.provider, route.model);
			if (!resolvedModel) {
				skipped.push({ provider: route.provider, model: route.model, reason: "model not found" });
				continue;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolvedModel);
			if (!auth.ok || !auth.apiKey) {
				skipped.push({
					provider: route.provider,
					model: route.model,
					reason: auth.ok ? "missing API key or OAuth token" : auth.error,
				});
				continue;
			}

			candidates.push({
				key: route.key,
				provider: route.provider,
				model: route.model,
				resolvedModel: resolvedModel as Model<Api>,
				auth: { apiKey: auth.apiKey, headers: auth.headers },
			});
		}

		return { candidates, skipped };
	};

	const pushSyntheticError = (
		stream: ReturnType<typeof createAssistantMessageEventStream>,
		model: Model<Api>,
		errorMessage: string,
		stopReason: "error" | "aborted" = "error",
	) => {
		const message = createErrorMessage(model, errorMessage, stopReason);
		stream.push({ type: "start", partial: message });
		stream.push({ type: "error", reason: message.stopReason, error: message });
		stream.end();
	};

	const streamWithFailover = (model: Model<Api>, context: Parameters<typeof streamSimple>[1], options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();

		void (async () => {
			const configuredModel = runtime.models.get(model.id);
			if (!configuredModel) {
				pushSyntheticError(stream, model, `Failover model ${model.id} is not registered.`);
				return;
			}

			const { candidates, skipped } = await resolveCandidates(model.id);
			if (candidates.length === 0) {
				pushSyntheticError(stream, model, formatAttemptSummary([], skipped));
				return;
			}

			const result = await pipeFailoverStream({
				candidates,
				invoke: async (candidate) =>
					streamSimple(candidate.resolvedModel, context, {
						...options,
						apiKey: candidate.auth.apiKey,
						headers: candidate.auth.headers,
					}),
				forward: async (event) => {
					stream.push(event);
				},
				onFallback: ({ failedCandidate, errorMessage }) => {
					runtime.notices.push(
						`provider-failover: ${configuredModel.name} switched away from ${failedCandidate.provider}/${failedCandidate.model} after ${errorMessage}`,
					);
				},
			});

			if (result.ok) {
				if (configuredModel.sticky) {
					runtime.stickyRouteByModelId.set(model.id, result.usedCandidate.key);
					try {
						await saveState(runtime.stickyRouteByModelId);
					} catch (saveError) {
						runtime.notices.push(
							`provider-failover: failed to persist sticky route: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
						);
					}
				}
				stream.end();
				return;
			}

			if (result.forwardedAny) {
				stream.end();
				return;
			}

			const finalMessage = formatAttemptSummary(result.attempts, skipped);
			pushSyntheticError(
				stream,
				model,
				finalMessage,
				options?.signal?.aborted ? "aborted" : "error",
			);
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			pushSyntheticError(stream, model, message, options?.signal?.aborted ? "aborted" : "error");
		});

		return stream;
	};

	const bootstrapPersistedProvider = () => {
		try {
			const loaded = loadConfigSync();
			if (!loaded) {
				return;
			}

			runtime.configPath = loaded.path;
			const bootstrapModels = loaded.config.models.map((configuredModel) => {
				const wrapperModel = buildBootstrapWrapperModel(configuredModel) as Model<Api>;
				runtime.models.set(configuredModel.id, { ...configuredModel, wrapperModel });
				return wrapperModel;
			});

			if (bootstrapModels.length === 0) {
				return;
			}

			pi.registerProvider(
				FAILOVER_PROVIDER_NAME,
				buildFailoverProviderConfig(
					bootstrapModels,
					(model, context, options) => streamWithFailover(model as Model<Api>, context, options),
				),
			);
		} catch (error) {
			console.warn(
				`provider-failover: failed to bootstrap persisted models: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	bootstrapPersistedProvider();

	pi.on("session_start", async (_event, ctx) => {
		runtime.ctx = ctx;
		runtime.stickyRouteByModelId = await loadState();
		await ensureProviderRegistered(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		flushNotices(ctx);
	});

	pi.on("session_shutdown", async () => {
		runtime.ctx = undefined;
		runtime.notices.length = 0;
	});

	pi.registerCommand("failover-reset", {
		description: "Reset sticky failover routes so the primary provider is tried first again",
		handler: async (args, ctx) => {
			const modelId = args.trim();
			if (modelId) {
				if (!runtime.models.has(modelId)) {
					ctx.ui.notify(`provider-failover: unknown failover model ${modelId}`, "error");
					return;
				}

				runtime.stickyRouteByModelId.delete(modelId);
				await saveState(runtime.stickyRouteByModelId);
				ctx.ui.notify(`provider-failover: reset sticky route for ${modelId}`, "info");
				return;
			}

			runtime.stickyRouteByModelId.clear();
			await saveState(runtime.stickyRouteByModelId);
			ctx.ui.notify("provider-failover: reset sticky routes for all failover models", "info");
		},
	});

	pi.registerCommand("failover-regenerate-config", {
		description: "Regenerate config.json from currently available providers and models",
		handler: async (_args, ctx) => {
			await generateDefaultConfig(ctx);
			runtime.stickyRouteByModelId.clear();
			await saveState(runtime.stickyRouteByModelId);
			await ensureProviderRegistered(ctx);
			ctx.ui.notify("provider-failover: regenerated config and reloaded failover models", "info");
		},
	});

	pi.registerCommand("failover-show-plan", {
		description: "Show the current provider preference order and Copilot failover matches",
		handler: async (_args, ctx) => {
			const plan = await getGenerationPlan(ctx);
			const planText = formatGenerationPlan(plan);
			if (!ctx.hasUI) {
				ctx.ui.notify("provider-failover: failover-show-plan requires interactive or RPC UI", "error");
				return;
			}

			await ctx.ui.editor("Provider failover plan", planText);
		},
	});
}
