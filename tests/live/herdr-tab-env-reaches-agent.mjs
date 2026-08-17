/**
 * Does a variable set with `tab create --env` reach the **agent process** `agent start` puts in
 * that pane later, or only the pane's shell?
 *
 * §6.5's identity and §6.8's session binding used to be typed at the pane as `export` lines,
 * justified by "neither `workspace create` nor `agent start` takes an environment". Herdr 0.8.0
 * makes half of that false — `--env KEY=VALUE` exists on `workspace create` and `tab create`, and
 * only `agent start` has none — so the binding can be declared to the server instead of typed
 * into terminal output the operator reads. That trade is only sound if the variable survives the
 * one hop the factory depends on: the shell launching the agent. Herdr's own help says `--env`
 * sets "an environment variable for the launched process", and *the launched process* is the
 * shell, not the agent. **This probe is why #157 did not take that on faith.**
 *
 * The proof is the agent process's own `/proc/<pid>/environ`, not a question put to the model:
 * it is free, it is exact, and it answers about the process rather than about what a model says
 * it can see. Linux only, for that reason.
 *
 * Costs no model session. `agent start` brings the harness up and the probe never prompts it.
 *
 * Usage: node tests/live/herdr-tab-env-reaches-agent.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

/** A value with a space and an apostrophe in it: exactly what the deleted quoting helper existed for. */
const DECLARED = Object.freeze({
	FACTORY_ATTEMPT: `probe-${Date.now()}`,
	FACTORY_WORKTREE: "/state/my worktrees/it's",
});

const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

let workspace = null;
try {
	const created = herdr(["workspace", "create", "--cwd", tmpdir(), "--label", "herdr-env-probe", "--no-focus"]);
	workspace = created.workspace.workspace_id;
	log("workspace", workspace);

	const tab = herdr([
		"tab",
		"create",
		"--workspace",
		workspace,
		"--cwd",
		tmpdir(),
		"--label",
		"env-probe",
		...Object.entries(DECLARED).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
		"--no-focus",
	]);
	const pane = tab.root_pane.pane_id;
	log("pane", pane, "declared", DECLARED);

	// Hop 1: the shell Herdr launched for the tab.
	report("the tab's shell", environOf(foreground(pane).shell_pid));

	// Hop 2: the agent that `agent start` runs in that shell — the one the ticket calls an
	// assumption rather than a fact. `pi` because it is the cheaper of the two runtimes to bring
	// up; the inheritance being probed is the shell's, so the runtime is not what is under test.
	log("-- starting an agent --");
	const started = herdr(["agent", "start", "envprobe", "--kind", "pi", "--pane", pane, "--timeout", "60000"]);
	log("agent", started.agent.agent, "status", started.agent.agent_status);

	const agent = foreground(pane).foreground_processes.at(0);
	log("agent process", agent.pid, agent.cmdline);
	report("the agent process", environOf(agent.pid));

	// And the point of the change: none of it is in the pane's own output.
	const scrollback = spawnSync("herdr", ["pane", "read", pane, "--raw", "--lines", "500"], { encoding: "utf8" }).stdout;
	const leaked = Object.entries(DECLARED).filter(([, value]) => scrollback.includes(value));
	log(leaked.length === 0 ? "PASS scrollback carries none of them" : "FAIL scrollback leaked", leaked);
} finally {
	log("-- done --");
	if (workspace !== null) herdr(["workspace", "close", workspace], { optional: true });
}

/** What the process at `pid` actually has, out of the kernel. */
function environOf(pid) {
	return Object.fromEntries(
		readFileSync(`/proc/${pid}/environ`, "utf8")
			.split("\0")
			.filter((entry) => entry.includes("="))
			.map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
	);
}

function report(who, environment) {
	for (const [name, value] of Object.entries(DECLARED)) {
		const found = environment[name];
		log(found === value ? "PASS" : "FAIL", `${who} ${name}`, JSON.stringify(found ?? null));
	}
}

function foreground(pane) {
	return herdr(["pane", "process-info", "--pane", pane]).process_info;
}

function herdr(args, { optional = false } = {}) {
	const answer = spawnSync("herdr", args, { encoding: "utf8" });
	if (answer.status !== 0) {
		if (!optional) log(`herdr ${args.join(" ")} EXIT ${answer.status}`, (answer.stderr ?? "").trim());
		return null;
	}
	try {
		const parsed = JSON.parse(answer.stdout);
		return parsed?.result ?? parsed;
	} catch {
		return answer.stdout;
	}
}
