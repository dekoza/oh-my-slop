import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { activityMessageText } from "./lib/activity.mjs";
import { registerClaudeWorker } from "./lib/extension.mjs";

export default function claudeWorker(pi: ExtensionAPI) {
	pi.registerMessageRenderer("cc-worker-log", (message, options) => new Text(activityMessageText(message, options), 0, 0));
	registerClaudeWorker(pi, Type.Object({
		prompt: Type.String({ minLength: 1, description: "A bounded task or follow-up instruction for Claude Code." }),
		resume: Type.Optional(Type.Boolean({ description: "Continue the last saved Claude Code session in this project." })),
	}));
}
