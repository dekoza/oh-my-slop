/**
 * Does a worker pane launched under §6.8 isolation report an agent status to Herdr?
 *
 * **This probe starts a real model session and prompts it.** Keep the prompt trivial.
 *
 * It builds the isolated config environment with the factory's own
 * `prepareWorkerEnvironment`, opens the pane, stamps it and starts the agent exactly as
 * `worker/lifecycle.mjs` does, then watches with the factory's own `watchPane` while sampling
 * `herdr agent explain` — so the two disagree out loud when the socket client drops what the
 * detector saw.
 *
 * Usage:
 *   node tests/live/herdr-isolated-worker-status.mjs --kind claude
 *   node tests/live/herdr-isolated-worker-status.mjs --kind pi --model openrouter/some/model
 *   node tests/live/herdr-isolated-worker-status.mjs --kind pi --extension ~/x --extension-env K=V
 *
 *   --no-stamp   skip the §5.5 metadata stamp, to test whether it interferes with detection
 *   --seconds N  how long to watch after prompting (default 90)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { watchPane } from "../../factory/lib/controller/herdr-events.mjs";
import { prepareWorkerEnvironment } from "../../factory/lib/worker/environment.mjs";

const SOCKET = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock");
const METADATA_SOURCE = "software-factory";
const PROMPT = "Reply with exactly the word OK and nothing else. Do not use any tools.";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const one = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};
const many = (name) => argv.flatMap((token, i) => (token === `--${name}` ? [argv[i + 1]] : []));

const kind = one("kind", "claude");
const model = one("model", kind === "pi" ? "openrouter/deepseek/deepseek-v4-flash-0731" : "opus");
const thinking = one("thinking", "high");
const stamp = !flag("no-stamp");
const seconds = Number(one("seconds", "90"));
const piExtensions = many("extension").map((path) => ({
	path,
	env: Object.fromEntries(many("extension-env").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)])),
}));

const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

/** Every distinct state the detector reported, in first-seen order. */
const seen = new Set();

const scratch = mkdtempSync(join(tmpdir(), "herdr-probe-"));
const store = join(scratch, "store");
const work = join(scratch, "work");
mkdirSync(store, { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "README.md"), "# live probe\n", "utf8");
execFileSync("git", ["init", "-q", work]);
execFileSync("git", ["-C", work, "add", "-A"]);
execFileSync("git", ["-C", work, "-c", "user.email=probe@local", "-c", "user.name=probe", "commit", "-qm", "seed"]);

const environment = prepareWorkerEnvironment({
	storeDir: store,
	repoRoot: work,
	worker: { denies: [], contextFile: null, piExtensions },
});
environment.pretrust({ worktreePath: work, gitCommonDir: join(work, ".git") });
const binding = environment.binding({ kind, posture: "builder" });
const args = kind === "pi" ? ["--model", model, "--thinking", thinking, ...binding.args] : [...binding.args];

log(`kind=${kind} model=${model} stamp=${stamp} extensions=${piExtensions.length}`);
log("config dir =", binding.paneEnv.CLAUDE_CONFIG_DIR, "|", binding.paneEnv.PI_CODING_AGENT_DIR);
log("args =", args.join(" "));

// §6.8's binding is **declared** to the server, exactly as a launch declares it
// (#157) — a probe that typed it at the shell instead would prove a pane no
// worker will ever occupy, which is the same objection §6.8 makes to probing
// under the operator's own config.
const created = herdr([
	"workspace",
	"create",
	"--cwd",
	work,
	"--label",
	"herdr-probe",
	...Object.entries(binding.paneEnv).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
	"--no-focus",
]);
const pane = created?.root_pane?.pane_id;
const workspace = created?.workspace?.workspace_id;
if (pane === undefined) {
	log("workspace create failed"), rmSync(scratch, { recursive: true, force: true });
	process.exit(1);
}
log("pane =", pane);

if (stamp) {
	herdr(["pane", "report-metadata", pane, "--source", METADATA_SOURCE, "--token", "FACTORY_ATTEMPT=live-probe", "--title", "live probe"]);
}

const transitions = [];
const watcher = watchPane({
	pane,
	socket: SOCKET,
	onTransition: (transition) => {
		transitions.push(transition);
		log("SUBSCRIBE", JSON.stringify(transition));
	},
	onDegraded: (degradation) => log("DEGRADED", JSON.stringify(degradation)),
});

const agent = "liveprobe";
const start = spawnSync("herdr", ["agent", "start", agent, "--kind", kind, "--pane", pane, "--", ...args], { encoding: "utf8" });
log("agent start exit", start.status, (start.stderr ?? "").trim().slice(0, 200));

await sleep(2000);
explain("after start");
log("prompt exit", spawnSync("herdr", ["agent", "prompt", agent, PROMPT], { encoding: "utf8" }).status);

for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 2000) {
	await sleep(2000);
	explain(null, { onlyOnChange: true });
}

log("── summary ──");
log(`detector states seen : ${[...seen].join(" → ") || "(none)"}`);
log(`socket transitions   : ${transitions.length}`);
for (const transition of transitions) log("   ", JSON.stringify(transition));
explain("final");

watcher.close();
herdr(["workspace", "close", workspace]);
rmSync(scratch, { recursive: true, force: true });
log("cleaned up");

// ── helpers ─────────────────────────────────────────────────────────────────

function herdr(args) {
	const answer = spawnSync("herdr", args, { encoding: "utf8" });
	if (answer.status !== 0) {
		log(`herdr ${args.join(" ")} EXIT ${answer.status}`, (answer.stderr ?? "").trim());
		return null;
	}
	try {
		const parsed = JSON.parse(answer.stdout);
		return parsed?.result ?? parsed;
	} catch {
		return answer.stdout;
	}
}

/** `agent explain` is the detector's own account: which rule matched, on what evidence. */
function explain(tag, { onlyOnChange = false } = {}) {
	const body = herdr(["agent", "explain", pane, "--format", "json"]);
	if (body === null || typeof body !== "object") return null;
	seen.add(body.state);
	const key = JSON.stringify([body.agent, body.state, body.matched_rule?.id]);
	if (onlyOnChange && key === explain.last) return null;
	explain.last = key;
	log(
		`EXPLAIN${tag ? ` (${tag})` : ""}`,
		JSON.stringify({
			agent: body.agent,
			state: body.state,
			rule: body.matched_rule?.id ?? null,
			region: body.matched_rule?.region ?? null,
			evidence: body.evaluated_rules?.find((rule) => rule.id === body.matched_rule?.id)?.evidence?.region_preview?.slice(0, 80) ?? null,
		}),
	);
	return body;
}

function sleep(ms) {
	return new Promise((wake) => setTimeout(wake, ms));
}
