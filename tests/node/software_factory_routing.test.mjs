import test from "node:test";
import assert from "node:assert/strict";

import { selectWorkerProfile } from "../../extensions/software-factory/lib/routing.mjs";

const workers = {
	profiles: {
		local: { kind: "pi", model: "local/thinkingcap-qwen3.6-27b" },
		gpt: { kind: "pi", model: "openai-codex/gpt-5.6-sol" },
		claude: { kind: "claude", model: "sonnet" },
	},
	routing: {
		defaults: { implement: "local", freshRetry: "gpt", review: "gpt", finalReview: "claude" },
		rules: [
			{ labelsAny: ["factory:claude", "risk:high"], phases: ["implement", "review"], profile: "claude" },
		],
	},
};

test("selectWorkerProfile uses the first matching label rule for the requested phase", () => {
	assert.deepEqual(
		selectWorkerProfile(workers, "implement", { labels: ["workflow:implement", "risk:high"] }),
		{ name: "claude", kind: "claude", model: "sonnet" },
	);
	assert.deepEqual(
		selectWorkerProfile(workers, "freshRetry", { labels: ["risk:high"] }),
		{ name: "gpt", kind: "pi", model: "openai-codex/gpt-5.6-sol" },
	);
});

test("selectWorkerProfile routes run-level review through its configured default", () => {
	assert.deepEqual(
		selectWorkerProfile(workers, "finalReview"),
		{ name: "claude", kind: "claude", model: "sonnet" },
	);
});
