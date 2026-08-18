/**
 * How long after §13.B's quit keys does Herdr stop reporting an agent in the pane?
 *
 * This is the quantity a stop-confirmation bound has to cover (#152), and it is **not** the
 * quantity #114's journal measured. That evidence — a pi worker's session file falling silent
 * 22 ms and 41 ms after the `agent-stop` effect resolved — bounds when the *process stopped
 * working*. `agentAlive` reads Herdr's pane record instead, and Herdr infers a Claude agent's
 * presence from the screen (`herdr agent explain` names the rule), so the pane record can lag
 * the process by a detection cycle. The controller never closes the pane, so the shell survives
 * and `pane_exited` never fires; the agent simply stops being detected.
 *
 * **Costs no tokens.** The agent is started and never prompted, so no request is ever made —
 * what is being timed is the harness quitting and Herdr noticing, neither of which involves a
 * model.
 *
 * It asks its question of an idle TUI, and that is the whole of its scope. *Whether* a given
 * sequence quits a worker at all — which turned out to depend on how the keys are grouped
 * into `send-keys` calls, and to differ between an idle harness and a working one — is
 * `herdr-agent-quit-sequence.mjs` (#158), which costs one short turn to answer.
 *
 * Usage:
 *   node tests/live/herdr-agent-stop-latency.mjs --kind claude
 *   node tests/live/herdr-agent-stop-latency.mjs --kind pi --model openrouter/some/model
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { createHerdrControl } from "../../factory/lib/controller/herdr-control.mjs";
import { prepareWorkerEnvironment } from "../../factory/lib/worker/environment.mjs";

const argv = process.argv.slice(2);
const one = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};

const kind = one("kind", "claude");
const model = one("model", kind === "pi" ? "openrouter/deepseek/deepseek-v4-flash-0731" : "opus");
const settleMs = Number(one("settle", "8000"));
const limitMs = Number(one("limit", "60000"));

const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

const scratch = mkdtempSync(join(tmpdir(), "herdr-stop-"));
const work = join(scratch, "work");
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "README.md"), "# stop latency probe\n", "utf8");
execFileSync("git", ["init", "-q", work]);
execFileSync("git", ["-C", work, "add", "-A"]);
execFileSync("git", ["-C", work, "-c", "user.email=probe@local", "-c", "user.name=probe", "commit", "-qm", "seed"]);

const environment = prepareWorkerEnvironment({
	storeDir: join(scratch, "store"),
	repoRoot: work,
	worker: { denies: [], contextFile: null, piExtensions: [] },
});
environment.pretrust({ worktreePath: work, gitCommonDir: join(work, ".git") });
const binding = environment.binding({ kind, posture: "builder" });
const args = kind === "pi" ? ["--model", model, "--thinking", "high", ...binding.args] : [...binding.args];

// §6.8's binding is **declared** to the server rather than typed at the shell
// (#157) — a probe that typed it would prove a pane no worker will ever occupy,
// which is the same objection §6.8 makes to probing under the operator's own
// config. The launch assembles it at the tab; this probe's pane is a workspace
// root, so it declares there, which is the same channel one level up.
const created = herdr([
	"workspace",
	"create",
	"--cwd",
	work,
	"--label",
	"herdr-stop-probe",
	...Object.entries(binding.paneEnv).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
	"--no-focus",
]);
const pane = created.root_pane.pane_id;
const workspace = created.workspace.workspace_id;

const agent = "stopprobe";
log(`starting ${kind} in ${pane} (never prompted, so no request is made)`);
log("agent start exit", spawnSync("herdr", ["agent", "start", agent, "--kind", kind, "--pane", pane, "--", ...args], { encoding: "utf8" }).status);

// Let the TUI reach a steady resting state, or the quit races the splash screen.
await sleep(settleMs);
log("alive before quit:", agentAlive());

// §13.B's sequence is issued by **the controller's own `stopAgent`** rather than replayed
// here: since #158 the sequence has a shape — two calls with a settle between them — and a
// probe that spelled that shape out a second time would keep measuring the shape it
// remembered. The lag is timed from the call's return, which is the moment after the last
// key went out.
log("sending §13.B's quit keys through the controller's own stopAgent");
log("stopAgent ok:", (await createHerdrControl({}).stopAgent(agent)).ok);
const sentAt = Date.now();

// The controller's own probe: one read, taken immediately, with no grace.
log(`the zero-grace probe would have recorded: stopped=${!agentAlive()}`);

let goneAfter = null;
while (Date.now() - sentAt < limitMs) {
	if (!agentAlive()) {
		goneAfter = Date.now() - sentAt;
		break;
	}
	await sleep(100);
}

log("── result ──");
log(`kind                       : ${kind}`);
log(`agent gone from pane record: ${goneAfter === null ? `NOT within ${limitMs} ms` : `${goneAfter} ms`}`);
log(`pane still exists          : ${herdr(["pane", "get", pane], { optional: true }) !== null}`);

herdr(["workspace", "close", workspace], { optional: true });
rmSync(scratch, { recursive: true, force: true });

/** §5.2's one Herdr fact, read the way `agentAlive` reads it. */
function agentAlive() {
	const body = herdr(["pane", "get", pane], { optional: true });
	const found = body?.pane ?? body;
	return typeof found?.agent === "string" && found.agent.length > 0;
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

function sleep(ms) {
	return new Promise((wake) => setTimeout(wake, ms));
}
