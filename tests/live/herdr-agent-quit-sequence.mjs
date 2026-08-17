/**
 * What does §13.B's quit sequence actually do to a Claude worker, key by key?
 *
 * `herdr-agent-stop-latency.mjs` answers the *idle* case — an agent started and never
 * prompted leaves the pane record 729 ms after the keys. Run `01M0859CJAA1Z8XK41756H5Y30`
 * on #114 showed the other case behaves qualitatively differently: three attempts sent
 * `esc ctrl+c ctrl+c` as one `send-keys` call at a worker that was mid-turn, and all three
 * left a live Claude sitting at its prompt minutes later, having read the sequence as a
 * **turn interrupt** rather than an exit. No bound of any length confirms a stop that never
 * happens, so the open question was the sequence's shape, not the re-probe budget (#158).
 *
 * It stays runnable after that question was answered, because the sequence is a claim about
 * somebody else's TUI: the harness that absorbed it once can change its key handling in any
 * release, and this is what re-checks the claim.
 *
 * This probe answers it directly. It drives a worker into a real mid-turn state, then plays
 * the keys as a **send plan** — which keys ride in one `send-keys` call, and how long the
 * gap to the next call is — sampling after every call what Herdr says about the agent and
 * what the pane actually shows. Grouping is the variable that matters and a flat list cannot
 * express it: `esc ctrl+c ctrl+c` in one call and the same three keys a second apart are
 * different inputs to the harness, and they get different answers — the table in
 * `tests/live/README.md` is what this probe produced.
 *
 * **Costs one short model turn** (`--model`, default `haiku` — the cheapest thing that can
 * hold a tool call open). The model's only work is to start a script that waits, so the
 * mid-turn window is wide and free rather than paid for in inference. `--no-prompt` skips
 * the prompt entirely and costs nothing, which is the control run: the same transcript
 * against an idle TUI.
 *
 * `--keys` is the send plan. Spaces separate **calls**, commas separate keys **within one
 * call**, so `esc,ctrl+c,ctrl+c` is the single call §13.B sent before #158 and
 * `esc ctrl+c,ctrl+c` is what it sends now.
 *
 * Usage:
 *   node tests/live/herdr-agent-quit-sequence.mjs                          # the shipped sequence, mid-turn
 *   node tests/live/herdr-agent-quit-sequence.mjs --keys 'esc,ctrl+c,ctrl+c' # the pre-#158 one call
 *   node tests/live/herdr-agent-quit-sequence.mjs --no-prompt              # idle control, free
 *
 *   --keys PLAN      calls separated by spaces, keys within a call by commas
 *                    (default: §13.B's own `AGENT_STOP_KEY_CALLS`, as it groups them)
 *   --gap N          ms between calls (default: §13.B's `AGENT_STOP_SETTLE_MS`)
 *   --hold N         ms to watch after the first `working` status, so the keys land on a
 *                    running tool rather than on inference — and so the pane record is
 *                    sampled throughout a turn it is definitely in (default 0)
 *   --settle N       ms to let the TUI reach a resting state before prompting (default 8000)
 *   --working N      ms to wait for the first `working` status before giving up (default 90000)
 *   --kind claude|pi which harness to probe (default claude)
 *   --model NAME     the model the harness runs (default haiku / a cheap pi route)
 *   --limit N        ms to keep watching for the agent to leave (default 30000)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_STOP_KEY_CALLS, AGENT_STOP_SETTLE_MS } from "../../factory/lib/controller/herdr-control.mjs";
import { prepareWorkerEnvironment } from "../../factory/lib/worker/environment.mjs";

/**
 * A turn that stays open without costing inference: one tool call into a script that waits.
 * The mid-turn window has to outlast the whole key sequence plus its spacing, or the probe
 * measures a turn that ended on its own and calls it a quit.
 *
 * The wait is a **committed script rather than a `sleep` in the prompt**, because the
 * operator's own hooks reach an isolated worker: a first run of this probe had `sleep 240`
 * refused by one, and the "mid-turn" measurement it produced was in fact a turn that had
 * already ended. What holds the turn open has to be something no hook is written about.
 */
const HOLD_SECONDS = 240;
const HOLD_SCRIPT = "hold.sh";
const PROMPT = `Run exactly this shell command with your Bash tool: sh ${HOLD_SCRIPT}. Do nothing else, and do not explain.`;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const one = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};

const kind = one("kind", "claude");
const model = one("model", kind === "pi" ? "openrouter/deepseek/deepseek-v4-flash-0731" : "haiku");
// The default *is* what the controller sends, read from the one place that decides it, so
// the probe keeps reproducing the shipped sequence rather than a copy of it that drifts.
const plan = one("keys", AGENT_STOP_KEY_CALLS.map((call) => call.join(",")).join(" "))
	.split(/\s+/)
	.filter((call) => call.length > 0)
	.map((call) => call.split(","));
const gapMs = Number(one("gap", String(AGENT_STOP_SETTLE_MS)));
const settleMs = Number(one("settle", "8000"));
const workingMs = Number(one("working", "90000"));
const holdMs = Number(one("hold", "0"));
const limitMs = Number(one("limit", "30000"));
const prompted = !flag("no-prompt");

const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

const scratch = mkdtempSync(join(tmpdir(), "herdr-quit-"));
const work = join(scratch, "work");
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "README.md"), "# quit sequence probe\n", "utf8");
writeFileSync(join(work, HOLD_SCRIPT), `#!/bin/sh\nsleep ${HOLD_SECONDS}\n`, "utf8");
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
const args = ["--model", model, ...(kind === "pi" ? ["--thinking", "high"] : []), ...binding.args];

log(`kind=${kind} model=${model} plan=${renderPlan()} gap=${gapMs}ms prompted=${prompted}`);

// §6.8's binding is **declared** to the server rather than typed at the shell (#157) — a
// probe that typed it would prove a pane no worker will ever occupy. The launch assembles
// it at the tab; this probe's pane is a workspace root, so it declares there, which is the
// same channel one level up.
const created = herdr([
	"workspace",
	"create",
	"--cwd",
	work,
	"--label",
	"herdr-quit-probe",
	...Object.entries(binding.paneEnv).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
	"--no-focus",
]);
const pane = created?.root_pane?.pane_id;
const workspace = created?.workspace?.workspace_id;
if (pane === undefined) {
	log("workspace create failed");
	rmSync(scratch, { recursive: true, force: true });
	process.exit(1);
}

const agent = "quitprobe";
log(`starting ${kind} in ${pane}`);
log("agent start exit", spawnSync("herdr", ["agent", "start", agent, "--kind", kind, "--pane", pane, "--", ...args], { encoding: "utf8" }).status);

// Let the TUI reach a steady resting state, or the prompt races the splash screen.
await sleep(settleMs);
sample("after start");

/** §5.2's other half: how the pane record answered while the worker was demonstrably working. */
const held = { reads: 0, absences: 0 };

let reachedWork = !prompted;
if (prompted) {
	log(`prompting (one turn, ${model}): ${PROMPT}`);
	log("agent prompt exit", spawnSync("herdr", ["agent", "prompt", agent, PROMPT], { encoding: "utf8" }).status);
	reachedWork = await waitForWorking();
	if (!reachedWork) {
		// Sending quit keys at a worker that never started working would answer the idle
		// question a second time and label it mid-turn — the one thing this probe must not do.
		log(`NEVER REACHED working within ${workingMs} ms — aborting rather than measuring the wrong state`);
	}
	// `working` arrives while the model is still streaming, and the state #114 recorded was
	// deeper than that: a tool already running. `--hold` pushes the interrupt past the
	// inference and into the shell command, which is the substate a timeout actually meets.
	//
	// The hold is **watched, not slept**, because it is also the only window in which
	// §5.2's other half can be tested: `stopped: true` is written from an absence of an
	// agent in the pane record, so a record that ever reports absence *while the worker is
	// working* is a false confirmation waiting to be recorded. Every read of that window is
	// counted, and any absence in it is the finding.
	if (reachedWork && holdMs > 0) {
		log(`holding ${holdMs} ms so the interrupt lands on a running tool, not on inference`);
		const from = Date.now();
		while (Date.now() - from < holdMs) {
			held.reads += 1;
			if (!agentAlive()) held.absences += 1;
			await sleep(100);
		}
		log(`presence while working: ${held.reads - held.absences}/${held.reads} reads saw an agent, ${held.absences} saw none`);
	}
}

// Timed from the call that turned out to be the last one: the plan's own spacing is this
// probe's, not the harness's, and folding it into the answer would inflate the very number
// #152's bound is sized against. The gap between calls is therefore *watched* rather than
// slept through, or a quit that landed during it would be dated from the following sample.
const stopping = reachedWork || !prompted;
let lastCallAt = Date.now();
let goneAfter = null;
if (stopping) {
	sample("before quit");
	for (const [index, call] of plan.entries()) {
		log(`send-keys call ${index + 1}/${plan.length}: ${call.join(" ")}`);
		lastCallAt = Date.now();
		herdr(["agent", "send-keys", agent, ...call]);
		await watch(gapMs);
		sample(`after ${call.join(" ")}`);
		if (goneAfter !== null) {
			log(`the agent left after call ${index + 1}; the remaining ${plan.length - index - 1} were not sent`);
			break;
		}
	}
	await watch(limitMs);
}

log("── result ──");
log(`kind / model                : ${kind} / ${model}`);
log(`state when keys were sent   : ${prompted ? (reachedWork ? `mid-turn, ${holdMs} ms past the first working status` : "NEVER REACHED — no keys sent") : "idle (never prompted)"}`);
log(`send plan                   : ${renderPlan()} (${gapMs} ms between calls)`);
log(`presence while working      : ${held.reads === 0 ? "not sampled (--hold 0)" : `${held.absences} absences in ${held.reads} reads`}`);
log(`agent gone after last call  : ${!stopping ? "n/a" : goneAfter === null ? `NOT within ${limitMs} ms` : `${goneAfter} ms`}`);
sample("final");

herdr(["workspace", "close", workspace], { optional: true });
rmSync(scratch, { recursive: true, force: true });

/** Wait, but keep reading: the first read that finds no agent dates the quit and ends the wait. */
async function watch(ms) {
	const from = Date.now();
	while (goneAfter === null && Date.now() - from < ms) {
		if (!agentAlive()) {
			goneAfter = Date.now() - lastCallAt;
			return;
		}
		await sleep(100);
	}
}

/** The send plan as the flag spells it, so a transcript can be replayed from its own header. */
function renderPlan() {
	return plan.map((call) => call.join(",")).join(" ");
}

/** Everything one observation of the pane can say, printed as one line plus the screen tail. */
function sample(tag) {
	const body = herdr(["pane", "get", pane], { optional: true });
	const found = body?.pane ?? body;
	const shown = screen();
	log(
		`SAMPLE (${tag})`,
		JSON.stringify({
			agent: found?.agent ?? null,
			status: found?.agent_status ?? null,
			title: found?.terminal_title_stripped ?? null,
			// The TUI's own claim that a turn is in flight, kept beside Herdr's status
			// because the two can disagree — and because it is what makes "mid-turn"
			// a fact in the transcript rather than an assumption about timing.
			interruptible: shown.some((line) => line.includes("esc to interrupt")),
		}),
	);
	for (const line of shown) log("   │", line);
}

/** The pane as the operator would see it — the evidence a status alone cannot carry. */
function screen(lines = 12) {
	const text = spawnSync("herdr", ["agent", "read", pane, "--source", "visible", "--lines", String(lines)], { encoding: "utf8" });
	if (text.status !== 0) return ["(unreadable)"];
	return text.stdout.split("\n").map((line) => line.trimEnd());
}

/** §5.2's one Herdr fact, read the way `agentAlive` reads it. */
function agentAlive() {
	const body = herdr(["pane", "get", pane], { optional: true });
	const found = body?.pane ?? body;
	return typeof found?.agent === "string" && found.agent.length > 0;
}

/** The mid-turn state this probe exists to test, confirmed before any key is sent. */
async function waitForWorking() {
	const deadline = Date.now() + workingMs;
	while (Date.now() < deadline) {
		const body = herdr(["pane", "get", pane], { optional: true });
		if ((body?.pane ?? body)?.agent_status === "working") return true;
		await sleep(500);
	}
	return false;
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
