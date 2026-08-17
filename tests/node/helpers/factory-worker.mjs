import { join } from "node:path";

import { createHerdrControl } from "../../../factory/lib/controller/herdr-control.mjs";
import { readSkillInventory } from "../../../factory/lib/worker/closure.mjs";

/**
 * Fake runtime transports for the §6.2 probes: dumb IO answering with the
 * shapes the real harnesses were observed to produce, so the probe's parsing
 * and judgement — the part worth testing — runs for real.
 *
 * This file lives one level down so `node --test tests/node/*.mjs` does not
 * pick it up as a test file of its own.
 */

/** The `skill:<name>` command records a fixture package's skills would register. */
export function skillCommandsOf(packageRoot) {
	const inventory = readSkillInventory({ packageRoot, skillsRoots: [join(packageRoot, "skills")] });
	return [...inventory.skills.values()].map((skill) => ({
		name: `skill:${skill.name}`,
		source: "skill",
		sourceInfo: { path: skill.skillMd, baseDir: skill.dir },
	}));
}

/**
 * A pi transport answering like the live harness: `--version`, then one RPC
 * session with `get_commands` and `get_available_models`, then the router's
 * `/props`. Every answer is overridable, and every call is recorded.
 */
export function piTransport({
	commands,
	models = [{ id: "qwen3", provider: "local", baseUrl: "http://127.0.0.1:9/v1" }],
	props = { status: 200, body: JSON.stringify({ role: "router", max_instances: 1 }) },
	version = { status: 0, stdout: "0.52.0-test", stderr: "" },
} = {}) {
	const calls = { runCommand: [], lineSession: [], httpGet: [] };

	return {
		calls,
		transport: {
			runCommand: async (command, args) => {
				calls.runCommand.push([command, ...args]);
				return version;
			},
			lineSession: async (session) => {
				calls.lineSession.push(session);
				return {
					status: 0,
					timedOut: false,
					stderr: "",
					lines: [
						JSON.stringify({ type: "response", command: "get_commands", success: true, data: { commands } }),
						JSON.stringify({
							type: "response",
							command: "get_available_models",
							success: true,
							data: { models },
						}),
					],
				};
			},
			httpGet: async (url) => {
				calls.httpGet.push(url);
				if (props instanceof Error) throw props;
				return props;
			},
		},
	};
}

/**
 * A Herdr the tests drive: the **real** control surface over a fake command
 * runner, so every argv the factory builds is exercised and asserted rather
 * than stubbed away. The pane list is state — `agent start` puts an agent in
 * the pane, `agent send-keys` takes it out again — because §6.6's state table
 * is read off exactly that.
 *
 * @param {object} [options]
 * @param {string} [options.agentStatus] what the started agent reports
 * @param {object | null} [options.session] the `AgentSessionInfo` Herdr persists,
 *   or null for the attempt that records `no-transcript-pointer`
 * @param {Record<string, {exitCode: number, stderr?: string}>} [options.refuse]
 *   commands that fail, keyed by their first two argv words
 * @param {boolean} [options.ignoresQuitKeys] a harness that takes the keys and
 *   stays — §13.B's wedged pane, which is accepted and recorded, never escalated
 * @param {(input: { pane: object, text: string }) => Promise<void> | void} [options.onPrompt]
 *   the worker turn a production-path test drives after the real launch submits
 *   its prompt; the callback writes the outbox and, for builders, commits work
 * @param {number} [options.swallowPrompts] how many `agent prompt` submissions
 *   the harness swallows whole — exit 0, nothing changes in the pane — the
 *   failure shape observed live when Claude was still initializing
 */
export function fakeHerdr({
	agentStatus = "working",
	session = { agent: "pi", kind: "path", value: "/t/s.jsonl" },
	refuse = {},
	ignoresQuitKeys = false,
	onPrompt = null,
	swallowPrompts = 0,
	paneOutput = "",
} = {}) {
	const calls = [];
	const panes = [];
	let nextPane = 1;
	let prompts = 0;

	const run = async (args) => {
		calls.push(args);
		const command = args.slice(0, 2).join(" ");
		const refused = refuse[command];
		if (refused !== undefined) return { exitCode: refused.exitCode, stdout: "", stderr: refused.stderr ?? "" };

		if (command === "workspace create") {
			const id = `w${nextPane}`;
			const pane = {
				pane_id: `${id}:p1`,
				workspace_id: id,
				tab_id: `${id}:t1`,
				cwd: args[args.indexOf("--cwd") + 1],
				agent_status: "unknown",
				tokens: {},
			};
			panes.push(pane);
			nextPane += 1;
			return json({ workspace: { workspace_id: id }, tab: { tab_id: pane.tab_id }, root_pane: { pane_id: pane.pane_id } });
		}
		if (command === "pane report-metadata") {
			const pane = panes.find((entry) => entry.pane_id === args[2]);
			const token = args[args.indexOf("--token") + 1].split("=");
			pane.tokens[token[0]] = token[1];
			pane.title = args[args.indexOf("--title") + 1];
			return json({ pane_id: pane.pane_id });
		}
		if (command === "pane run") {
			// The pane's own shell takes the exports, so the fixture keeps them
			// where a test can read what a worker's environment would carry.
			const pane = panes.find((entry) => entry.pane_id === args[2]);
			pane.exported = args[3];
			return json({ ran: true });
		}
		if (command === "agent start") {
			const pane = panes.find((entry) => entry.pane_id === args[args.indexOf("--pane") + 1]);
			pane.agent = args[args.indexOf("--kind") + 1];
			pane.agent_status = agentStatus;
			if (session !== null) pane.agent_session = session;
			return json({ agent: { name: args[2] } });
		}
		if (command === "agent send-keys") {
			if (ignoresQuitKeys) return json({ sent: true });
			for (const pane of panes) {
				if (pane.agent === undefined) continue;
				delete pane.agent;
				pane.agent_status = "unknown";
			}
			return json({ sent: true });
		}
		if (command === "agent prompt") {
			const pane = panes.find((entry) => entry.agent !== undefined);
			prompts += 1;
			if (prompts <= swallowPrompts) return json({ submitted: true });
			await onPrompt?.({ pane, text: args[3] });
			// With a driven turn the agent has already finished it (idle); without
			// one the prompt was merely taken up and the agent is now busy.
			if (pane !== undefined) pane.agent_status = onPrompt === null ? "working" : "idle";
			return json({ submitted: true });
		}
		if (command === "pane read") {
			// §6.6's progress sample: the recent pane output, bounded like the real
			// `pane read --raw --lines N`. A test drives growth by mutating the
			// returned handle's `paneOutput` between samples.
			return { exitCode: 0, stdout: paneOutput, stderr: "" };
		}
		if (command === "pane list") return json({ panes: [...panes] });
		return { exitCode: 2, stdout: "", stderr: `fake herdr does not know \`${command}\`` };
	};

	return {
		calls,
		panes,
		run,
		/** The pane output the next `pane read` answers with (§6.6, #150). */
		set paneOutput(value) {
			paneOutput = value;
		},
		/** The argv words of every command issued, joined — for order assertions. */
		commands: () => calls.map((args) => args.slice(0, 2).join(" ")),
		control: createHerdrControl({ run }),
		/** Move the started agent to another status, as a transition would. */
		settle(status) {
			for (const pane of panes) if (pane.agent !== undefined) pane.agent_status = status;
		},
		/** The pane's process ends: Herdr drops the pane from its list. */
		vanish() {
			panes.length = 0;
		},
	};
}

function json(result) {
	return { exitCode: 0, stdout: JSON.stringify({ id: "cli:test", result }), stderr: "" };
}

/**
 * What a green preflight needs injected, built for one fixture package: the
 * pi transport whose command records are the package's own skills. The start
 * tests hand this to `runStart` the way they hand the Herdr probe in.
 */
export function workerTransportsAnswering(packageRoot, overrides = {}) {
	return {
		pi: piTransport({ commands: skillCommandsOf(packageRoot), ...overrides }).transport,
	};
}
