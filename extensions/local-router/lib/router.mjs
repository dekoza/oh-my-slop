const DEFAULT_ROUTER_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 32_768;
const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function optionValue(args, option) {
	const index = args.indexOf(option);
	if (index >= 0 && index + 1 < args.length) return args[index + 1];

	const prefix = `${option}=`;
	return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(value, fallback) {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchRouterModels(endpoint, { fetchImpl = fetch, signal } = {}) {
	const response = await fetchImpl(endpoint, {
		headers: { Accept: "application/json" },
		signal,
	});
	if (!response.ok) {
		throw new Error(`Router model discovery failed with HTTP ${response.status}`);
	}

	return parseRouterModels(await response.json());
}

export function parseRouterModels(payload) {
	if (!payload || !Array.isArray(payload.data)) {
		throw new TypeError("Router response must contain a data array");
	}

	return payload.data.map((model) => {
		const args = Array.isArray(model.status?.args) ? model.status.args : [];
		const modalities = Array.isArray(model.architecture?.input_modalities)
			? model.architecture.input_modalities.filter((modality) => modality === "text" || modality === "image")
			: ["text"];
		const reasoningFormat = optionValue(args, "--reasoning-format");

		return {
			id: model.id,
			name: model.id,
			reasoning: Boolean(reasoningFormat && reasoningFormat !== "none"),
			input: modalities.length > 0 ? modalities : ["text"],
			contextWindow: positiveInteger(optionValue(args, "--ctx-size"), DEFAULT_CONTEXT_WINDOW),
			maxTokens: positiveInteger(optionValue(args, "--n-predict"), DEFAULT_MAX_TOKENS),
			cost: { ...ZERO_COST },
			compat: {
				supportsDeveloperRole: true,
				supportsReasoningEffort: false,
				supportsUsageInStreaming: true,
				thinkingFormat: "qwen-chat-template",
			},
		};
	});
}

export function resolveRouterUrls(environment = process.env) {
	const configured = environment.PI_LOCAL_ROUTER_BASE_URL?.trim() || DEFAULT_ROUTER_BASE_URL;
	const url = new URL(configured);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("PI_LOCAL_ROUTER_BASE_URL must use http or https");
	}

	url.pathname = url.pathname.replace(/\/+$/, "");
	const serverBaseUrl = url.toString().replace(/\/$/, "");
	const apiBaseUrl = serverBaseUrl.endsWith("/v1") ? serverBaseUrl : `${serverBaseUrl}/v1`;

	return {
		apiBaseUrl,
		modelsEndpoint: `${apiBaseUrl}/models`,
	};
}
