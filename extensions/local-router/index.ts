import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { fetchRouterModels, resolveRouterUrls } from "./lib/router.mjs";

const DISCOVERY_TIMEOUT_MS = 5_000;

function discoverySignal(parent?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
	return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export default async function localRouter(pi: ExtensionAPI) {
	const { apiBaseUrl, modelsEndpoint } = resolveRouterUrls();
	const loadModels = (signal?: AbortSignal) =>
		fetchRouterModels(modelsEndpoint, { signal: discoverySignal(signal) });

	pi.registerProvider("local", {
		name: "Local OpenAI-compatible router",
		baseUrl: apiBaseUrl,
		apiKey: "none",
		api: "openai-completions",
		models: await loadModels(),
		refreshModels: async ({ signal }) => loadModels(signal),
	});
}
