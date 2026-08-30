/**
 * Does a Claude session the factory launches warm `cachedChromeExtensionInstalled`
 * in the controller-owned config state — and does §6.8's browser fence stop it?
 *
 * #178's hazard, stated as a state predicate: the Chrome integration is gated on a
 * cache key **the harness warms itself**, and a warm key raises a
 * "Claude will use your Chrome browser by default" prompt waiting on a keypress.
 * A worker has nobody to supply one. Herdr reads that pane as `agent_status: "idle"`
 * — a settled status — so §6.6's table answered `no-result` and §8.10 charged the
 * worker's own repair budget for a worker that never got to start.
 *
 * It is permanent rather than per-run: the config environment rebuild overwrites
 * *named files* while the pre-trust writer merges unknown keys forward, so once any
 * session in that store warms the key, every attempt in every later run meets the
 * prompt until a human deletes the directory.
 *
 * **The assertion is an absence, and a single session cannot make it.** The first
 * session is the one that would warm the cache and the *later* ones are the ones
 * that would raise the prompt, so this runs at least three in one directory and
 * asserts the key is still not there. Both sides are run, for the reason §6.2's
 * discovery-fence proof runs both: an absence under a probe that could not have
 * observed the write is not evidence of a fence.
 *
 * **A TTY is required, and that is the finding, not an inconvenience.** Measured on
 * Claude Code 2.1.241: three `--print` sessions with promoted credentials left the
 * key absent whether or not the flag was passed, so a headless test asserting the
 * absence is green over a live bug. The detection runs in the interactive startup
 * this probe drives through `script(1)`.
 *
 * **Costs no tokens.** Every session is started, left at its prompt, and killed.
 *
 * Usage:
 *   node tests/live/claude-chrome-cache.mjs
 *
 *   --sessions N  how many successive sessions per side (default 3, minimum 2)
 *   --settle N    ms to let each startup reach its prompt (default 12000)
 *   --fenced-only skip the unfenced control side
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_BROWSER_FENCE, claudeWorkerArguments } from "../../factory/lib/worker/claude.mjs";
import { prepareWorkerEnvironment } from "../../factory/lib/worker/environment.mjs";

/** The key the harness writes, and the whole subject of this probe. */
const CACHE_KEY = "cachedChromeExtensionInstalled";

const argv = process.argv.slice(2);
const one = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? fallback : argv[index + 1];
};
const sessions = Math.max(2, Number(one("sessions", "3")));
const settleMs = Number(one("settle", "12000"));
const fencedOnly = argv.includes("--fenced-only");

const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

/**
 * One side's world: its own store, so its own controller-owned config root —
 * the two sides must not share the directory whose state is the measurement.
 */
function world(label) {
	const scratch = mkdtempSync(join(tmpdir(), `claude-chrome-${label}-`));
	const work = join(scratch, "work");
	mkdirSync(work, { recursive: true });
	writeFileSync(join(work, "README.md"), "# chrome cache probe\n", "utf8");
	execFileSync("git", ["init", "-q", work]);
	execFileSync("git", ["-C", work, "add", "-A"]);
	execFileSync("git", ["-C", work, "-c", "user.email=probe@local", "-c", "user.name=probe", "commit", "-qm", "seed"]);

	const environment = prepareWorkerEnvironment({
		storeDir: join(scratch, "store"),
		repoRoot: work,
		worker: { denies: [], contextFile: null, piExtensions: [] },
	});
	// The pane would meet the *trust* dialog otherwise, which is a different
	// interstitial and would mask the one this probe is about.
	environment.pretrust({ worktreePath: work, gitCommonDir: join(work, ".git") });

	return { scratch, work, environment, binding: environment.binding({ kind: "claude", posture: "builder" }) };
}

/** The chrome-related keys the config state holds right now. */
function chromeKeys(configRoot) {
	const path = join(configRoot, ".claude.json");
	if (!existsSync(path)) return {};
	try {
		const state = JSON.parse(readFileSync(path, "utf8"));
		return Object.fromEntries(Object.entries(state).filter(([name]) => name.toLowerCase().includes("chrome")));
	} catch (error) {
		return { unreadable: error.message };
	}
}

/**
 * One interactive startup, driven to its prompt and killed.
 *
 * `script(1)` is what allocates the pty. Node has no built-in one, and without a
 * pty the harness takes its non-interactive path — where, measured, the detection
 * never runs at all and the absence this probe asserts would be free.
 */
function interactiveStartup({ binary, args, cwd, env }) {
	const quoted = [binary, ...args].map((word) => `'${word.replaceAll("'", `'\\''`)}'`).join(" ");
	const answered = spawnSync("script", ["-qec", quoted, "/dev/null"], {
		cwd,
		env: { ...process.env, ...env, TERM: "xterm-256color" },
		stdio: ["ignore", "pipe", "pipe"],
		timeout: settleMs,
		killSignal: "SIGTERM",
		encoding: "utf8",
	});
	return { status: answered.status, timedOut: answered.error?.code === "ETIMEDOUT" };
}

/**
 * @param {boolean} fenced whether the session carries `CLAUDE_BROWSER_FENCE` — the
 *   production binding when true, the same binding minus the flag when false.
 */
function side(fenced) {
	const label = fenced ? "fenced" : "control";
	const built = world(label);
	const configRoot = built.environment.roots.claude;
	// The worker binding, verbatim, with the plugin directory left off: the §6.3
	// plugin is not what is under test and building one would cost this probe a
	// dependency it does not need. The fence is what varies, and nothing else.
	const args = claudeWorkerArguments(built.work, [...built.binding.args]).filter(
		(word) => fenced || !CLAUDE_BROWSER_FENCE.includes(word),
	);

	log(`── ${label}: ${sessions} successive sessions in ${configRoot}`);
	log(`   argv        : ${args.join(" ")}`);

	const seen = [];
	for (let session = 1; session <= sessions; session += 1) {
		const answered = interactiveStartup({ binary: "claude", args, cwd: built.work, env: built.binding.env });
		const keys = chromeKeys(configRoot);
		seen.push(keys);
		log(`   session ${session}    : exit ${answered.status}${answered.timedOut ? " (settled, killed)" : ""} · ${JSON.stringify(keys)}`);
	}

	rmSync(built.scratch, { recursive: true, force: true });
	return { label, warmed: seen.some((keys) => CACHE_KEY in keys) };
}

log(`claude ${execFileSync("claude", ["--version"], { encoding: "utf8" }).trim()}`);
log(`the key under test: ${CACHE_KEY}`);

const fenced = side(true);
const control = fencedOnly ? null : side(false);

log("");
log("── what this run established ──────────────────────────────────────────────");
const pad = (text) => text.padEnd(CLAUDE_BROWSER_FENCE.join(" ").length + 10);
log(`${pad(`fenced (${CLAUDE_BROWSER_FENCE.join(" ")})`)}: ${fenced.warmed ? `${CACHE_KEY} WAS written` : `${CACHE_KEY} absent`}`);
if (control !== null) {
	log(`${pad("control (no fence)")}: ${control.warmed ? `${CACHE_KEY} was written` : `${CACHE_KEY} ABSENT`}`);
}

if (fenced.warmed) {
	log("");
	log(`FAIL: the fence did not stop the detection. A later worker pane will meet the prompt (§6.8, #178).`);
	process.exit(1);
}
if (control !== null && !control.warmed) {
	log("");
	log(
		`UNPROVEN: the control side did not warm the key either, so the absence above is not evidence of a fence — ` +
			`the same shape as §6.2's \`discovery-fence-unproven\`. Check that the pty took, and that credentials ` +
			`were promoted (the detection does not run for a session that is not logged in).`,
	);
	process.exit(2);
}
log("");
log("OK: the fence holds, and the control proves this run could have seen it fail.");
