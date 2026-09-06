import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { fetchRouterModels, resolveRouterUrls } from "./lib/router.mjs";

const DISCOVERY_TIMEOUT_MS = 5_000;

function discoverySignal(parent?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
	return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export default async function localRouter(pi: ExtensionAPI) {
	// This extension ships to every package user; only configured routers opt in.
	if (!process.env.PI_LOCAL_ROUTER_BASE_URL?.trim()) return;

	const { apiBaseUrl, modelsEndpoint } = resolveRouterUrls();
	let discoveryFailed = false;
	const loadModels = async (signal?: AbortSignal) => {
		try {
			const models = await fetchRouterModels(modelsEndpoint, { signal: discoverySignal(signal) });
			discoveryFailed = false;
			return models;
		} catch (error) {
			// Caller cancellation is not a router outage.
			signal?.throwIfAborted();
			if (!discoveryFailed) {
				const reason = error instanceof Error ? error.message : String(error);
				// stderr keeps model listings and RPC stdout machine-readable.
				console.warn(`[local-router] Model discovery failed: ${reason}. Continuing without local models; use /reload when the router is available.`);
			}
			discoveryFailed = true;
			return [];
		}
	};

	pi.registerProvider("local", {
		name: "Local OpenAI-compatible router",
		baseUrl: apiBaseUrl,
		apiKey: "none",
		api: "openai-completions",
		models: await loadModels(),
		refreshModels: async ({ signal }) => loadModels(signal),
	});
}
