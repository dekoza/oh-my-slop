import { join } from "node:path";

import { createHerdrControl, FACTORY_ATTEMPT_TOKEN } from "../../../factory/lib/controller/herdr-control.mjs";
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
 * @param {number} [options.quitProbes] how many pane reads the harness's teardown
 *   outlives before the agent is actually gone. A TUI does not exit on the line
 *   after its quit keys, which is the race #152 was filed for
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
	quitProbes = 0,
	onPrompt = null,
	swallowPrompts = 0,
	paneOutput = "",
} = {}) {
	const calls = [];
	const panes = [];
	const workspaces = [];
	let nextWorkspace = 1;
	let prompts = 0;
	let tearingDown = 0;

	const dropAgents = () => {
		for (const pane of panes) {
			if (pane.agent === undefined) continue;
			delete pane.agent;
			pane.agent_status = "unknown";
		}
	};

	const run = async (args) => {
		calls.push(args);
		const command = args.slice(0, 2).join(" ");
		const refused = refuse[command];
		if (refused !== undefined) return { exitCode: refused.exitCode, stdout: "", stderr: refused.stderr ?? "" };

		if (command === "workspace create") {
			const id = `w${nextWorkspace}`;
			const pane = {
				pane_id: `${id}:p1`,
				workspace_id: id,
				tab_id: `${id}:t1`,
				cwd: args[args.indexOf("--cwd") + 1],
				agent_status: "unknown",
				tokens: {},
			};
			panes.push(pane);
			// `next` is the ordinal the workspace's next tab takes, because Herdr
			// numbers panes and tabs **within** a workspace: the live server answered
			// `w33:p1`/`w33:t1` for the root and `w33:p2`/`w33:t2` for the tab after it.
			workspaces.push({
				workspace_id: id,
				label: args[args.indexOf("--label") + 1],
				active_tab_id: pane.tab_id,
				next: 2,
			});
			nextWorkspace += 1;
			return json({ workspace: { workspace_id: id }, tab: { tab_id: pane.tab_id }, root_pane: { pane_id: pane.pane_id } });
		}
		if (command === "workspace list") {
			return json({ workspaces: [...workspaces] });
		}
		if (command === "tab create") {
			// The installed Herdr's own shape (0.8.0), read off a live `tab create`:
			// `tab` and `root_pane`, and no `workspace` — the tab is in one already.
			// A workspace it does not have is exit 1, which is the operator having
			// closed the run's workspace out from under a live run (#156).
			const id = args[args.indexOf("--workspace") + 1];
			const workspace = workspaces.find((entry) => entry.workspace_id === id);
			if (workspace === undefined) return { exitCode: 1, stdout: "", stderr: `workspace ${id} not found` };

			const pane = {
				pane_id: `${id}:p${workspace.next}`,
				workspace_id: id,
				tab_id: `${id}:t${workspace.next}`,
				cwd: args[args.indexOf("--cwd") + 1],
				agent_status: "unknown",
				tokens: {},
			};
			panes.push(pane);
			workspace.next += 1;
			return json({ tab: { tab_id: pane.tab_id }, root_pane: { pane_id: pane.pane_id } });
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
			// A teardown the very next read is too early to see: the keys landed,
			// the harness is on its way out, and `quitProbes` reads still find it.
			if (quitProbes > 0) tearingDown = quitProbes;
			else dropAgents();
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
		if (command === "pane list") {
			// `quitProbes` reads answer with the agent still in the pane, and the
			// one after them finds it gone: the answer is serialised before the
			// teardown lands, so the count is exactly how many reads were too early.
			const answer = json({ panes: [...panes] });
			if (tearingDown > 0) {
				tearingDown -= 1;
				if (tearingDown === 0) dropAgents();
			}
			return answer;
		}
		return { exitCode: 2, stdout: "", stderr: `fake herdr does not know \`${command}\`` };
	};

	return {
		calls,
		panes,
		run,
		/** The refusals in force, mutable so a test can break one command mid-run. */
		refuse,
		/** The pane output the next `pane read` answers with (§6.6, #150). */
		set paneOutput(value) {
			paneOutput = value;
		},
		/** The argv words of every command issued, joined — for order assertions. */
		commands: () => calls.map((args) => args.slice(0, 2).join(" ")),
		/**
		 * The pane an attempt's tab opened, found the way §5.5 finds it: by its
		 * token. Since #156 a run's workspace has a root pane of its own, so
		 * "the first pane" is the workspace's, not any attempt's.
		 */
		paneFor: (attempt) => panes.find((pane) => pane.tokens[FACTORY_ATTEMPT_TOKEN] === attempt) ?? null,
		control: createHerdrControl({ run }),
		/** Move the started agent to another status, as a transition would. */
		settle(status) {
			for (const pane of panes) if (pane.agent !== undefined) pane.agent_status = status;
		},
		/** The pane's process ends: Herdr drops the pane from its list. */
		vanish() {
			panes.length = 0;
		},
		/**
		 * The operator closes every workspace — §6.4's accepted cost, which takes
		 * the panes inside them with it.
		 */
		closeWorkspaces() {
			workspaces.length = 0;
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
