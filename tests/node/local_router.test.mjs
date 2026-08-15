import assert from "node:assert/strict";
import test from "node:test";

import { fetchRouterModels, parseRouterModels, resolveRouterUrls } from "../../extensions/local-router/lib/router.mjs";

const TEST_TIMEOUT_MS = 60_000;

test("local router defaults to llama.cpp and accepts an Ollama override", { timeout: TEST_TIMEOUT_MS }, () => {
	assert.deepEqual(resolveRouterUrls({}), {
		apiBaseUrl: "http://127.0.0.1:8080/v1",
		modelsEndpoint: "http://127.0.0.1:8080/v1/models",
	});
	assert.deepEqual(
		resolveRouterUrls({ PI_LOCAL_ROUTER_BASE_URL: "http://127.0.0.1:11434/" }),
		{
			apiBaseUrl: "http://127.0.0.1:11434/v1",
			modelsEndpoint: "http://127.0.0.1:11434/v1/models",
		},
	);
});

test("llama.cpp metadata becomes pi model capabilities", { timeout: TEST_TIMEOUT_MS }, () => {
	assert.deepEqual(
		parseRouterModels({
			data: [
				{
					id: "vision-model",
					status: {
						args: [
							"llama-server",
							"--ctx-size",
							"262144",
							"--n-predict",
							"49152",
							"--reasoning-format",
							"deepseek",
						],
					},
					architecture: { input_modalities: ["text", "image"] },
				},
			],
		}),
		[
			{
				id: "vision-model",
				name: "vision-model",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 262144,
				maxTokens: 49152,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: {
					supportsDeveloperRole: true,
					supportsReasoningEffort: false,
					supportsUsageInStreaming: true,
					thinkingFormat: "qwen-chat-template",
				},
			},
		],
	);
});

test("model discovery fetches the live OpenAI-compatible catalog", { timeout: TEST_TIMEOUT_MS }, async () => {
	const requests = [];
	const models = await fetchRouterModels("http://router.test/v1/models", {
		fetchImpl: async (url, options) => {
			requests.push({ url, options });
			return new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	assert.deepEqual(models, []);
	assert.deepEqual(requests, [
		{
			url: "http://router.test/v1/models",
			options: { headers: { Accept: "application/json" }, signal: undefined },
		},
	]);
});
