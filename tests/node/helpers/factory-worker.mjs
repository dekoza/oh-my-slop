import { join } from "node:path";

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
 * What a green preflight needs injected, built for one fixture package: the
 * pi transport whose command records are the package's own skills. The start
 * tests hand this to `runStart` the way they hand the Herdr probe in.
 */
export function workerTransportsAnswering(packageRoot, overrides = {}) {
	return {
		pi: piTransport({ commands: skillCommandsOf(packageRoot), ...overrides }).transport,
	};
}
