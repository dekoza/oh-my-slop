import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { fileURLToPath } from "node:url";

import { seedBundledAgents } from "./lib/project-agents.mjs";

const BUNDLED_AGENTS_DIR = fileURLToPath(new URL("../../agents", import.meta.url));

export default function subagentBundledAgentsExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      seedBundledAgents({ cwd: ctx.cwd, sourceDir: BUNDLED_AGENTS_DIR });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[subagent-bundled-agents] Failed to seed bundled agents: ${message}`);
    }
  });
}
