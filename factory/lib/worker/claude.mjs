import { CLAUDE_RESOURCE_CLASS } from "../config/profiles.mjs";
import { createWorkerAdapter, unbuiltLifecycleOperations } from "./adapter.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { ensureClaudePlugin } from "./plugin.mjs";
import { harnessVersion, memoizedPreflight, parseJson, probeFinding, unreachableRuntime } from "./probe.mjs";
import * as realTransport from "./transports.mjs";

/**
 * The Claude half of §6.1's adapter: plugin directory, strict validation, and
 * the stream-json control protocol live here and nowhere else.
 *
 * §6.2's layer 2 is three steps, in order, all against the §6.3 plugin built
 * from the pinned revision:
 *
 * 1. `claude plugin validate --strict` — the generator's output, held to the
 *    loader's own strict schema;
 * 2. `claude --plugin-dir <dir> plugin details` — the expected-vs-actual
 *    component diff, because the loader drops mis-nested skills **silently**
 *    and only the registered count betrays it;
 * 3. the authoritative **`initialize` control-request over stream-json** —
 *    the session's structured `commands` array, `<plugin>:<skill>` records for
 *    the closure, at zero model cost. This is the production path, executed.
 *
 * **The capacity probe folds into the same request** (§6.2, §9.7): the
 * initialize response carries the model inventory, and `claude-code` is a
 * cloud-shaped class — nothing observes a `max_instances`, so it stays
 * declared-only and the probe's success is its reachability.
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The production flag set for the initialize probe, per §6.2. #106's config
 * isolation adds the controller-owned `--settings`/`CLAUDE_CONFIG_DIR` pair on
 * top when it lands; the plugin and protocol flags are fixed here.
 *
 * @param {string} pluginDir
 * @returns {string[]}
 */
export function claudeProbeArguments(pluginDir) {
	return [
		"--plugin-dir",
		pluginDir,
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--print",
		"--verbose",
	];
}

/**
 * One live probe of the Claude runtime — role-independent, memoized by the
 * adapter per pinned revision.
 *
 * @param {object} input
 * @param {string} input.packageRoot the handshake's canonical root
 * @param {ReadonlyArray<string>} input.expectedSkills every skill the pinned
 *   revision ships — the component diff's expectation
 * @param {number | null} input.declaredSize `concurrency.resources["claude-code"]`
 * @param {string} input.cacheRoot the store directory holding the plugin cache
 * @param {string} input.packageRev the pinned tree digest — the plugin cache key
 * @param {object} [input.transport]
 * @param {string} [input.binary]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Readonly<object>>} the runtime observation, findings included
 */
export async function probeClaudeRuntime({
	packageRoot,
	packageRev,
	cacheRoot,
	expectedSkills,
	declaredSize = null,
	transport = {},
	binary = "claude",
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const io = { ...realTransport, ...transport };
	const failures = [];

	const version = await harnessVersion(io, { label: "Claude", binary, timeoutMs }, failures);
	if (version === null) return observation({ ok: false, version, failures, declaredSize, binary });

	// §6.3: built by the package's generator, cached per revision, immutable.
	let plugin;
	try {
		plugin = await ensureClaudePlugin({ packageRoot, treeDigest: packageRev, cacheRoot, runCommand: io.runCommand });
	} catch (error) {
		if (!(error instanceof FactoryWorkerError)) throw error;
		failures.push(probeFinding("plugin-invalid", error.message, { reason: error.reason, ...error.details }));
		return observation({ ok: false, version, failures, declaredSize, binary });
	}

	await strictValidation(io, { binary, plugin, timeoutMs }, failures);
	await componentDiff(io, { binary, plugin, expectedSkills, timeoutMs }, failures);

	const initialized = await initializeProbe(io, { binary, plugin, timeoutMs }, failures);
	const commands = initialized?.commands ?? Object.freeze([]);
	const models = initialized?.models ?? Object.freeze([]);

	return observation({
		ok: failures.length === 0,
		version,
		failures,
		plugin,
		commands,
		models,
		reachable: initialized !== null,
		declaredSize,
		binary,
	});
}

/**
 * The role-level half: every closure member must appear as a
 * `<plugin>:<skill>` command in the initialize response's `commands` array —
 * registration on the production path, not an inspection of the tree.
 *
 * @param {Readonly<object>} probed what `probeClaudeRuntime` observed
 * @param {ReadonlyArray<string>} closure
 * @returns {ReadonlyArray<object>} findings
 */
export function proveClaudeClosure(probed, closure) {
	const pluginName = probed.plugin?.manifest.name ?? null;
	const registered = new Set(probed.commands);
	const findings = [];

	for (const name of closure) {
		const command = `${pluginName}:${name}`;
		if (pluginName !== null && registered.has(command)) continue;
		findings.push(
			probeFinding(
				"skill-not-invocable",
				`/${command} is not in the initialize control-request's commands array — native invocation is unprovable, ` +
					`and no degraded prose-loading mode exists (§6.2).`,
				{ skill: name, command },
			),
		);
	}

	return Object.freeze(findings);
}

/**
 * §6.1's adapter for the Claude runtime; the lifecycle operations are #107's.
 *
 * @param {object} context everything `probeClaudeRuntime` takes except the revision,
 *   which arrives per call as §6.1's `package_rev`
 * @returns {Readonly<object>} the adapter
 */
export function createClaudeAdapter(context) {
	return createWorkerAdapter({
		kind: "claude",
		operations: {
			preflight: memoizedPreflight({
				kind: "claude",
				probe: (packageRev) => probeClaudeRuntime({ ...context, packageRev }),
				prove: proveClaudeClosure,
			}),
			...unbuiltLifecycleOperations("claude"),
		},
	});
}

// ── The probe's three steps ──────────────────────────────────────────────────

async function strictValidation(io, { binary, plugin, timeoutMs }, failures) {
	const answer = await io.runCommand(binary, ["plugin", "validate", "--strict", plugin.dir], { timeout: timeoutMs });
	if (answer.status === 0) return;

	failures.push(
		probeFinding(
			"plugin-invalid",
			`\`${binary} plugin validate --strict\` refused the built plugin at ${plugin.dir} (exit ${answer.status}): ` +
				`${(answer.stderr || answer.stdout).trim().split("\n").at(-1) ?? "(no output)"} (§6.3).`,
			{ dir: plugin.dir, status: answer.status },
		),
	);
}

/**
 * The expected-vs-actual diff over `plugin details`. The expectation is every
 * skill the pinned revision ships — the generator flattens them all — because
 * the loader's failure mode is a silently smaller inventory, and only a count
 * compared against the shipped count betrays it (§6.3).
 */
async function componentDiff(io, { binary, plugin, expectedSkills, timeoutMs }, failures) {
	const name = plugin.manifest.name;
	const answer = await io.runCommand(binary, ["--plugin-dir", plugin.dir, "plugin", "details", name], {
		timeout: timeoutMs,
	});

	const inventory = answer.status === 0 ? parseSkillInventory(answer.stdout) : null;
	if (inventory === null) {
		failures.push(
			probeFinding(
				"plugin-component-diff",
				`\`${binary} plugin details ${name}\` answered no readable component inventory (exit ${answer.status}), so ` +
					`the expected-vs-actual diff cannot be taken (§6.2).`,
				{ plugin: name, status: answer.status },
			),
		);
		return;
	}

	const actual = new Set(inventory.skills);
	const missing = expectedSkills.filter((skill) => !actual.has(skill));
	const surplus = inventory.skills.filter((skill) => !expectedSkills.includes(skill));

	if (missing.length === 0 && surplus.length === 0 && inventory.count === expectedSkills.length) return;

	failures.push(
		probeFinding(
			"plugin-component-diff",
			`The plugin registers ${inventory.count} skills while the pinned revision ships ${expectedSkills.length}` +
				(missing.length === 0 ? "" : `; missing: ${missing.join(", ")}`) +
				(surplus.length === 0 ? "" : `; unexpected: ${surplus.join(", ")}`) +
				". The loader drops mis-nested skills silently, so a smaller inventory is the only symptom (§6.3).",
			{ plugin: name, expected: expectedSkills.length, registered: inventory.count, missing, surplus },
		),
	);
}

async function initializeProbe(io, { binary, plugin, timeoutMs }, failures) {
	const requestId = `factory-preflight-${Date.now().toString(36)}`;
	let session;
	try {
		session = await io.lineSession({
			binary,
			args: claudeProbeArguments(plugin.dir),
			input: [JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } })],
			timeoutMs,
		});
	} catch (error) {
		failures.push(unreachableRuntime("Claude", binary, error.message));
		return null;
	}

	for (const line of session.lines) {
		const parsed = parseJson(line);
		if (parsed?.type !== "control_response" || parsed.response?.request_id !== requestId) continue;

		const inner = parsed.response.response ?? {};
		return {
			commands: Object.freeze(
				(inner.commands ?? []).map((command) => command?.name).filter((name) => typeof name === "string"),
			),
			models: Object.freeze(
				(inner.models ?? [])
					.filter((model) => typeof model?.value === "string")
					.map((model) =>
						Object.freeze({ value: model.value, resolved: model.resolvedModel ?? null }),
					),
			),
		};
	}

	failures.push(
		unreachableRuntime(
			"Claude",
			binary,
			session.timedOut
				? `the initialize control-request over stream-json got no control_response within ${timeoutMs}ms`
				: `the initialize control-request over stream-json got no control_response (exit ${session.status})` +
						(session.stderr.trim() === "" ? "" : `: ${session.stderr.trim().split("\n").at(-1)}`),
		),
	);
	return null;
}

/** The one line of `plugin details` this probe reads: `Skills (N)  a, b, c`. */
function parseSkillInventory(stdout) {
	const match = /^\s*Skills \((\d+)\)\s*(.*)$/m.exec(stdout);
	if (match === null) return null;
	return {
		count: Number(match[1]),
		skills: match[2]
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name !== ""),
	};
}

function observation({
	ok,
	version,
	failures,
	plugin = null,
	commands = Object.freeze([]),
	models = Object.freeze([]),
	reachable = false,
	declaredSize,
	binary,
}) {
	return Object.freeze({
		kind: "claude",
		ok,
		version,
		failures: Object.freeze([...failures]),
		plugin,
		commands,
		models,
		// §9.7: a cloud class has nothing to observe and stays declared-only, so
		// `max_instances` is null by construction and reachability is the probe's
		// own success — one request, no second place to disagree.
		classes: Object.freeze({
			[CLAUDE_RESOURCE_CLASS]: Object.freeze({
				class: CLAUDE_RESOURCE_CLASS,
				endpoint: binary,
				reachable,
				max_instances: null,
				declared: declaredSize,
				models: Object.freeze(models.map((model) => model.value)),
			}),
		}),
	});
}

