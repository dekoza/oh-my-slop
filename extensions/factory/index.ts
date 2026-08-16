/**
 * `/factory` — the Software Factory's front inside a pi session (§10.2, §11.8).
 *
 * The command is a thin wrapper over the package binary's `runCli`: the same
 * code the shell runs, answered the same way, plus §10.6's one-way monitor
 * trigger through the shared event bus. The binary is resolved from this
 * extension's own place in the package (§11.7: one package, one version), so
 * there is nothing to configure and nothing here that the shell cannot also
 * reach.
 *
 * The monitor coupling is the bus and nothing else: the extension never
 * imports `factory-monitor` and never spawns it, and a missing or slow
 * monitor degrades the answer by one line.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { resolveFactoryBinary, runFactoryCommand } from "./lib/command.mjs";

export default function factoryExtension(pi: ExtensionAPI) {
	const executable = resolveFactoryBinary(import.meta.url);

	pi.registerCommand("factory", {
		description:
			"Software Factory: /factory <start|status|doctor|reconcile|stop|cleanup-plan|cleanup-execute|migrate> [args] — the factory binary, run from this session",
		async handler(args, ctx) {
			const argv = args.trim().split(/\s+/).filter((token) => token.length > 0);
			await runFactoryCommand(argv, {
				cwd: ctx.cwd,
				env: process.env,
				executable,
				events: pi.events,
				display: (text, { isError }) => ctx.ui.notify(text, isError ? "error" : "info"),
			});
		},
	});
}
