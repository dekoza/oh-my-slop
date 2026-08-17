/**
 * What is `pane.agent` — the one fact §5.2 trusts — actually derived from?
 *
 * `agentAlive` reads exactly this field, and every stop this controller confirms is an
 * *absence* of it (§6.6, #152). So the guarantee "a stop is only recorded from an observed
 * absence" is exactly as good as that field: if presence were inferred from the screen the
 * way agent **state** is, a mid-turn screen that stopped matching the detection rules would
 * make `agentAlive` report absence while the worker was still working — a false confirmation
 * no bound can fix, since more reads of a wrong signal only converge on the wrong answer
 * faster (#158, #153).
 *
 * Herdr's own state detection is screen-derived and says so — `agent explain` names the rule
 * that matched and the region it matched in. What it does not say is where the `agent` field
 * beside that state came from. This probe settles it by construction rather than by reading
 * the answer's shape:
 *
 *   1. a pane running only a shell — is anything reported?
 *   2. Claude launched **at the shell**, with no `agent start` — does Herdr notice a harness
 *      it was not told about?
 *   3. a bare `sleep` wearing the name `claude`, with **no TUI at all** — the discriminator:
 *      a screen that could not match a single detection rule, against a process that looks
 *      like the harness only in its argv
 *   4. Claude launched through `agent start`, the way §6.5 launches a worker
 *   5. `pane release-agent` against that pane, with the TUI still plainly on screen — can a
 *      holder of the lifecycle authority take presence away from a live worker?
 *   6. `pane report-agent` from a source of our own — can an outsider assert it?
 *
 * **Costs no tokens.** Every session is started and never prompted.
 *
 * Usage:
 *   node tests/live/herdr-agent-presence-source.mjs
 *
 *   --settle N  ms to let each launched TUI reach a resting state (default 8000)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareWorkerEnvironment } from "../../factory/lib/worker/environment.mjs";

const argv = process.argv.slice(2);
const one = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};
const settleMs = Number(one("settle", "8000"));

/** Phase 3's impostor: a process wearing the harness's name and running no TUI at all. */
const IMPOSTOR_SCRIPT = "impostor.sh";

const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

const scratch = mkdtempSync(join(tmpdir(), "herdr-presence-"));
const work = join(scratch, "work");
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "README.md"), "# presence probe\n", "utf8");
execFileSync("git", ["init", "-q", work]);
execFileSync("git", ["-C", work, "add", "-A"]);
execFileSync("git", ["-C", work, "-c", "user.email=probe@local", "-c", "user.name=probe", "commit", "-qm", "seed"]);

const environment = prepareWorkerEnvironment({
	storeDir: join(scratch, "store"),
	repoRoot: work,
	worker: { denies: [], contextFile: null, piExtensions: [] },
});
environment.pretrust({ worktreePath: work, gitCommonDir: join(work, ".git") });
const binding = environment.binding({ kind: "claude", posture: "builder" });

const created = herdr([
	"workspace",
	"create",
	"--cwd",
	work,
	"--label",
	"herdr-presence-probe",
	...Object.entries(binding.paneEnv).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
	"--no-focus",
]);
const workspace = created?.workspace?.workspace_id;
const shellPane = created?.root_pane?.pane_id;
if (shellPane === undefined) {
	log("workspace create failed");
	rmSync(scratch, { recursive: true, force: true });
	process.exit(1);
}

// ── 1. a shell, and nothing else ─────────────────────────────────────────────
report("a pane running only a shell", shellPane);

// ── 2. Claude at the shell, never registered ─────────────────────────────────
// `pane run` types the command into the pane's own shell, which is precisely the
// launch §6.5 stopped using (#157) — used here because the question is what Herdr
// notices on its own, and a registered launch cannot answer that.
log("launching claude at the shell (no `agent start`)");
herdr(["pane", "run", shellPane, "claude", ...binding.args]);
await sleep(settleMs);
// The process list is what stops this phase from proving only that the launch failed:
// "no agent reported" means something if and only if a harness is demonstrably running.
log("   process     :", JSON.stringify(herdr(["pane", "process-info", "--pane", shellPane], { optional: true })));
report("claude launched at the shell, never registered", shellPane);
log("   agent list  :", JSON.stringify(herdr(["agent", "list"], { optional: true })));

// ── 3. a process merely *named* claude, with nothing on the screen ───────────
// The discriminator between the two ways phase 2 could have happened. If a bare
// `sleep` wearing the name reports an agent, presence is read off the process and
// the screen cannot take it away; if it does not, presence came from the harness
// announcing itself, which the screen cannot take away either. Either answer
// settles §5.2 — what neither would be is "the detection rules decide it".
const named = herdr(["tab", "create", "--workspace", workspace, "--cwd", work, "--label", "named", "--no-focus"])?.root_pane?.pane_id;
log(`running a process named claude, with no TUI at all, in ${named}`);
// Through a committed script rather than `bash -c '…'`: `pane run` sends its words to the
// pane's shell, so the quoting that would keep the `-c` payload together is not ours to do.
writeFileSync(join(work, IMPOSTOR_SCRIPT), "exec -a claude sleep 300\n", "utf8");
herdr(["pane", "run", named, "bash", join(work, IMPOSTOR_SCRIPT)]);
await sleep(4000);
log("   process     :", JSON.stringify(herdr(["pane", "process-info", "--pane", named], { optional: true })?.process_info?.foreground_processes));
report("a process named claude, blank screen", named);

// ── 4. the registered launch, the way a worker is started ────────────────────
// The binding rides the **tab**, as §6.5's launch assembles it (#157). Omitting it here
// once put the probe's own session on the operator's config, where a trust dialog it had
// never pre-trusted was waiting — which is the failure §6.8's isolation exists to prevent,
// arriving in the probe rather than in a worker.
const tab = herdr([
	"tab",
	"create",
	"--workspace",
	workspace,
	"--cwd",
	work,
	"--label",
	"registered",
	...Object.entries(binding.paneEnv).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
	"--no-focus",
]);
const startedPane = tab?.root_pane?.pane_id;
const agent = "presenceprobe";
log(`starting claude through \`agent start\` in ${startedPane}`);
log("agent start exit", spawnSync("herdr", ["agent", "start", agent, "--kind", "claude", "--pane", startedPane, "--", ...binding.args], { encoding: "utf8" }).status);
await sleep(settleMs);
const registered = report("claude started through `agent start`", startedPane);
log("   agent get   :", JSON.stringify(herdr(["agent", "get", agent], { optional: true })));

// ── 5. released, with the harness still on screen ────────────────────────────
// Herdr's *lifecycle authority* verbs are the remaining way presence could be
// taken from a live worker by something other than its own exit: if a release
// clears the field, then anything holding the source can make `agentAlive`
// answer false about a worker that is still working.
const source = registered?.agent_session?.source ?? "herdr:claude";
const label = registered?.agent ?? "claude";
log(`releasing the agent authority (--source ${source} --agent ${label}) — the TUI is untouched`);
log("release-agent exit", spawnSync("herdr", ["pane", "release-agent", startedPane, "--source", source, "--agent", label], { encoding: "utf8" }).status);
await sleep(1000);
report("after `pane release-agent`, with claude still running", startedPane);

// ── 6. reported back by a source of our own ──────────────────────────────────
log("reporting the agent from a source of this probe's own");
log("report-agent exit", spawnSync("herdr", ["pane", "report-agent", startedPane, "--source", "presence-probe", "--agent", "claude", "--state", "working"], { encoding: "utf8" }).status);
await sleep(1000);
report("after `pane report-agent` from `presence-probe`", startedPane);

herdr(["workspace", "close", workspace], { optional: true });
rmSync(scratch, { recursive: true, force: true });

/**
 * One observation, from both sides: the pane record `agentAlive` reads, and the
 * detector's own account of the same pane. The two disagreeing is the finding.
 */
function report(tag, pane) {
	const body = herdr(["pane", "get", pane], { optional: true });
	const found = body?.pane ?? body;
	const explained = herdr(["agent", "explain", pane, "--format", "json"], { optional: true });
	log(`── ${tag} ──`);
	log(
		"   pane record :",
		JSON.stringify({
			agent: found?.agent ?? null,
			agent_status: found?.agent_status ?? null,
			agent_session: found?.agent_session ?? null,
			title: found?.terminal_title_stripped ?? null,
		}),
	);
	log(
		"   explain     :",
		JSON.stringify({
			agent: explained?.agent ?? null,
			state: explained?.state ?? null,
			matched_rule: explained?.matched_rule?.id ?? null,
			rules_evaluated: explained?.evaluated_rules?.length ?? null,
		}),
	);
	// The screen is printed for the released case above all: it is the evidence that
	// nothing about what is on the terminal changed when the field did.
	for (const line of screen(pane)) log("   │", line);
	return found ?? null;
}

function screen(pane, lines = 10) {
	const text = spawnSync("herdr", ["pane", "read", pane, "--source", "visible", "--lines", String(lines)], { encoding: "utf8" });
	if (text.status !== 0) return ["(unreadable)"];
	return text.stdout.split("\n").map((line) => line.trimEnd());
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
