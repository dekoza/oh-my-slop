import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	streamSimple,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
	FAILOVER_API,
	FAILOVER_PROVIDER_NAME,
	buildWrapperModel,
	formatAttemptSummary,
	orderCandidates,
	pipeFailoverStream,
} from "./lib/failover-core.mjs";

interface FailoverRouteConfig {
	provider: string;
	model: string;
}

interface FailoverModelConfig {
	id: string;
	name: string;
	strategy: FailoverRouteConfig[];
	sticky?: boolean;
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

const PROJECT_CONFIG = ".pi/provider-failover.json";
const GLOBAL_CONFIG = join(homedir(), ".pi", "agent", "provider-failover.json");

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

async function loadConfig(cwd: string): Promise<{ path: string; config: FailoverFileConfig } | undefined> {
	const projectPath = resolve(cwd, PROJECT_CONFIG);
	const configPath = (await fileExists(projectPath)) ? projectPath : (await fileExists(GLOBAL_CONFIG) ? GLOBAL_CONFIG : undefined);
	if (!configPath) {
		return undefined;
	}

	const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as unknown;
	return { path: configPath, config: validateConfig(rawConfig, configPath) };
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
		strategy: model.strategy.map((route, routeIndex) => validateRouteConfig(route, sourcePath, model.id, routeIndex)),
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
		runtime.models.clear();
		pi.unregisterProvider(FAILOVER_PROVIDER_NAME);

		try {
			const loaded = await loadConfig(ctx.cwd);
			if (!loaded) {
				runtime.configPath = undefined;
				ctx.ui.notify(
					`provider-failover: no config found at ${PROJECT_CONFIG} or ${GLOBAL_CONFIG}`,
					"warning",
				);
				return;
			}

			runtime.configPath = loaded.path;
			const registeredModels: Model<Api>[] = [];
			const registrationErrors: string[] = [];

			for (const configuredModel of loaded.config.models) {
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
					runtime.models.set(configuredModel.id, { ...configuredModel, wrapperModel });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					registrationErrors.push(`Skipping ${configuredModel.id}: ${message}`);
				}
			}

			if (registeredModels.length === 0) {
				ctx.ui.notify(`provider-failover: ${registrationErrors.join(" ")}`, "error");
				return;
			}

			pi.registerProvider(FAILOVER_PROVIDER_NAME, {
				api: FAILOVER_API as Api,
				models: registeredModels,
				streamSimple: (model, context, options) => streamWithFailover(model as Model<Api>, context, options),
			});

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

	pi.on("session_start", async (_event, ctx) => {
		runtime.ctx = ctx;
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
				ctx.ui.notify(`provider-failover: reset sticky route for ${modelId}`, "info");
				return;
			}

			runtime.stickyRouteByModelId.clear();
			ctx.ui.notify("provider-failover: reset sticky routes for all failover models", "info");
		},
	});
}
