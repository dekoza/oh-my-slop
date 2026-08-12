import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadFactoryConfig } from "./lib/config.mjs";
import { runFactory } from "./lib/factory.mjs";
import { createGitRuntime } from "./lib/git.mjs";
import { createGiteaTracker } from "./lib/gitea.mjs";
import { createHerdrRuntime } from "./lib/herdr.mjs";
import { createRunStore } from "./lib/store.mjs";

const STATUS_KEY = "software-factory";

function parseParentIndex(argument: string): number | undefined {
	const match = argument.trim().match(/(?:^|[#/])(\d+)\/?$/);
	const index = match ? Number(match[1]) : Number.NaN;
	return Number.isSafeInteger(index) && index > 0 ? index : undefined;
}

function createRunId(): string {
	const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
	return `factory-${date}-${randomUUID().slice(0, 6)}`;
}

function formatStatus(state: Record<string, unknown>): string {
	const completed = Array.isArray(state.completed) ? state.completed.length : 0;
	const blocked = Array.isArray(state.blocked) ? state.blocked.length : 0;
	return [
		`Factory run: ${state.id}`,
		`Status: ${state.status}`,
		`Parent ticket: #${state.parentIndex}`,
		`Completed: ${completed}`,
		`Human-blocked: ${blocked}`,
		state.currentTicket ? `Current ticket: #${state.currentTicket}` : undefined,
		state.pullRequest ? `Pull request: ${state.pullRequest}` : undefined,
	].filter(Boolean).join("\n");
}

export default function softwareFactory(pi: ExtensionAPI) {
	const activeRuns = new Map<string, Promise<unknown>>();
	const agentRoot = join(process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "software-factory");

	pi.registerCommand("factory", {
		description: "Software factory controls: /factory start <parent-ticket> | /factory status",
		async handler(args, ctx) {
			const [subcommand = "status", reference = ""] = args.trim().split(/\s+/, 2);
			const store = createRunStore({ root: agentRoot, cwd: ctx.cwd });

			if (subcommand === "status") {
				const state = await store.loadActive();
				ctx.ui.notify(
					state ? formatStatus(state) : "No factory run is recorded for this repository.",
					"info",
				);
				return;
			}

			if (subcommand !== "start") {
				ctx.ui.notify("Usage: /factory start <parent-ticket> | /factory status", "warning");
				return;
			}
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("The software factory only runs in a trusted project.", "error");
				return;
			}
			const parentIndex = parseParentIndex(reference);
			if (!parentIndex) {
				ctx.ui.notify("Usage: /factory start <parent-ticket-number-or-URL>", "warning");
				return;
			}
			if (activeRuns.has(ctx.cwd)) {
				ctx.ui.notify("A software factory run is already active for this repository.", "warning");
				return;
			}

			let config;
			try {
				config = await loadFactoryConfig(ctx.cwd, CONFIG_DIR_NAME);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			const exec = (command: string, commandArgs: string[], options: Record<string, unknown> = {}) =>
				pi.exec(command, commandArgs, options);
			let herdr;
			try {
				herdr = createHerdrRuntime({ exec, agentKind: config.herdr.agentKind });
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			const tracker = createGiteaTracker({ exec, cwd: ctx.cwd, config: config.tracker });
			const git = createGitRuntime({
				exec,
				cwd: ctx.cwd,
				baseBranch: config.git.baseBranch,
				remote: config.git.remote,
			});
			const statusStore = {
				async save(state: Record<string, unknown>) {
					await store.save(state);
					ctx.ui.setStatus(STATUS_KEY, `factory: ${state.status}${state.currentTicket ? ` #${state.currentTicket}` : ""}`);
				},
			};
			const runId = createRunId();
			try {
				await store.acquire(runId);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
				return;
			}
			const promise = runFactory({
				cwd: ctx.cwd,
				parentIndex,
				runId,
				config,
				tracker,
				git,
				herdr,
				store: statusStore,
			});
			activeRuns.set(ctx.cwd, promise);
			ctx.ui.notify(`Started ${runId} for parent ticket #${parentIndex}.`, "info");
			void promise.then((state) => {
				ctx.ui.notify(formatStatus(state as Record<string, unknown>), "info");
			}).catch((error) => {
				ctx.ui.notify(`Factory run failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}).finally(async () => {
				activeRuns.delete(ctx.cwd);
				ctx.ui.setStatus(STATUS_KEY, undefined);
				try {
					await store.release(runId);
				} catch (error) {
					ctx.ui.notify(`Factory lock release failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
			});
		},
	});
}
