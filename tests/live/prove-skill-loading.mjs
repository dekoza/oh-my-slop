#!/usr/bin/env node
/**
 * §6.7's skill-loading acceptance matrix — **this spends model tokens.**
 *
 * One short turn per cell (models × three cases), run by hand, never from a
 * suite: it lives here for the reason `README.md` gives, alongside the probe
 * that starts a paid session to answer a question about a real runtime.
 *
 * What it proves is what §6.2's preflight probe cannot: that the model was
 * given the skill **body** and acted on it, rather than that the skill's name
 * was in the session's command records. It does that by asking for a receipt
 * whose token, transform and answer live only in the shipped body — never in
 * any prompt — against a nonce minted per cell.
 *
 * Every cell runs the **worker** binding (#160): the argv a worker pane
 * receives, plus the probe-only stream-json IO flags and nothing else. A cell
 * proven under any other flag set would prove a session no worker runs in. That
 * *plus* is also the matrix's own limit, recorded rather than glossed: a
 * `--print` session is headless, and §6.4 runs every real attempt in a pane.
 *
 * The judgement, the claim assessment and the document are not this file's —
 * they are `factory/lib/proof/`, held by `tests/node/factory_proof_*.test.mjs`.
 * What lives here is the wiring and the spending.
 *
 * Usage:
 *   node tests/live/prove-skill-loading.mjs                     # opus and fable
 *   node tests/live/prove-skill-loading.mjs --model opus        # one model
 *   node tests/live/prove-skill-loading.mjs --dry-run           # plan and argv, no turns
 *   node tests/live/prove-skill-loading.mjs --out docs/proofs/  # where the document lands
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import { validateWorker } from "../../factory/lib/config/worker.mjs";
import { describeCheckout } from "../../factory/lib/git/repo.mjs";
import { treeDigest } from "../../factory/lib/package/tree.mjs";
import { claudeCellArguments, runClaudeCell } from "../../factory/lib/proof/claude-session.mjs";
import { FactoryProofError } from "../../factory/lib/proof/errors.mjs";
import { PROOF_CASES, renderCellPrompt, renderMatrixDocument, runMatrix } from "../../factory/lib/proof/matrix.mjs";
import { PROOF_ENTRY_SKILL, readProofContract } from "../../factory/lib/proof/receipt.mjs";
import { prepareWorkerEnvironment } from "../../factory/lib/worker/environment.mjs";
import { ensureClaudePlugin } from "../../factory/lib/worker/plugin.mjs";
import { runCommand } from "../../factory/lib/worker/transports.mjs";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * The one surface a scripted turn can run on. Named rather than assumed,
 * because the claim about "interactive versus headless" workers reads it and
 * stays unverified on the strength of it.
 */
const SESSION_SURFACE = "headless";

const argv = process.argv.slice(2);

/**
 * A flag that took no value is a refusal, never a fallback.
 *
 * `--model` as the final token used to yield `["--model", undefined]` in a
 * worker's argv and `--timeout` a `NaN` deadline, so the run half-happened and
 * reported a verdict about neither. A proof that spends tokens has to be at
 * least as strict about its own inputs as the preflight it complements (§11.2).
 */
function refuse(sentence) {
	console.error(`prove-skill-loading: ${sentence}`);
	process.exit(2);
}

const flag = (name) => argv.includes(`--${name}`);
const valueAt = (name, at) => {
	const value = argv[at + 1];
	if (value === undefined || value.startsWith("--")) {
		refuse(`--${name} needs a value; it was given ${value === undefined ? "nothing" : `\`${value}\``}.`);
	}
	return value;
};
const one = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? fallback : valueAt(name, at);
};
const many = (name, fallback) => {
	const values = argv.flatMap((token, at) => (token === `--${name}` ? [valueAt(name, at)] : []));
	return values.length === 0 ? fallback : values;
};

const KNOWN_FLAGS = Object.freeze(["binary", "model", "effort", "timeout", "out", "dry-run"]);
for (const token of argv) {
	if (token.startsWith("--") && !KNOWN_FLAGS.includes(token.slice(2))) {
		refuse(`\`${token}\` is not a flag this runner accepts (${KNOWN_FLAGS.map((name) => `--${name}`).join(", ")}).`);
	}
}

const binary = one("binary", "claude");
const declaredModels = many("model", ["opus", "fable"]);
const effort = one("effort", undefined);
const timeoutMs = Number(one("timeout", "180000"));
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
	refuse(`--timeout must be a positive whole number of milliseconds; it was given \`${one("timeout", "")}\`.`);
}
const outDir = resolve(PACKAGE_ROOT, one("out", "docs/proofs"));
const dryRun = flag("dry-run");

const log = (...parts) => console.log(...parts);

// ── What this matrix is about: the pinned revision, and the body it ships ────

const contract = readProofContract(readProofSkill());
const packageRev = treeDigest(PACKAGE_ROOT);
log(`package  ${packageRev.algorithm}:${packageRev.digest} (${packageRev.files} files)`);
log(`contract marker=${contract.marker} token=${contract.token} rule=${contract.rule}`);

// ── The environment a worker runs in, built by the factory's own code ────────

const scratch = mkdtempSync(join(tmpdir(), "factory-skill-proof-"));
const store = join(scratch, "store");
const work = join(scratch, "work");
mkdirSync(store, { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "README.md"), "# skill-loading acceptance matrix\n", "utf8");
execFileSync("git", ["init", "-q", work]);

// `validateWorker(undefined, …)` is the one home for the absent block's shape
// (§11.3): hand-spelling it here would be a second, and a key added there would
// leave these cells running a binding no worker runs in — the defect this whole
// proof exists to catch.
const environment = prepareWorkerEnvironment({
	storeDir: store,
	repoRoot: work,
	worker: validateWorker(undefined, "<no config: the acceptance matrix declares no worker overrides>"),
});
environment.pretrust({ worktreePath: work, gitCommonDir: join(work, ".git") });
const binding = environment.binding({ kind: "claude", posture: "builder" });

const plugin = await ensureClaudePlugin({
	packageRoot: PACKAGE_ROOT,
	treeDigest: packageRev.digest,
	cacheRoot: store,
	runCommand,
});
log(`plugin   ${plugin.manifest.name} at ${plugin.dir}`);

const version = await harnessVersion();
log(`harness  ${binary} ${version}`);
log(`cwd      ${work}`);

const models = declaredModels.map((declared) => ({
	declared,
	profile: { name: `${declared}-builder`, kind: "claude", model: declared, ...(effort === undefined ? {} : { effort }) },
}));

for (const model of models) {
	log(`argv     ${model.declared}: ${claudeCellArguments({ pluginDir: plugin.dir, sessionArgs: binding.args, profile: model.profile }).join(" ")}`);
}

if (dryRun) {
	for (const name of PROOF_CASES) {
		log(`\n── ${name} ──\n${renderCellPrompt({ case: name, nonce: "<nonce>", plugin: { name: plugin.manifest.name, dir: plugin.dir }, kind: "claude" })}`);
	}
	log(`\nDry run: ${models.length * PROOF_CASES.length} cells would have run. Nothing was spent.`);
	process.exit(0);
}

// ── The paid part ───────────────────────────────────────────────────────────

log(`\nRunning ${models.length * PROOF_CASES.length} cells. Each is one short turn.\n`);

const record = await runMatrix({
	harness: { runtime: "claude", binary, version },
	packageRev,
	checkout: describeCheckout(PACKAGE_ROOT),
	surface: SESSION_SURFACE,
	plugin: { name: plugin.manifest.name, dir: plugin.dir },
	contract,
	models,
	mintNonce: () => randomBytes(4).toString("hex"),
	at: new Date().toISOString(),
	async session(cell) {
		const transcript = await runClaudeCell(
			{},
			{
				binary,
				pluginDir: plugin.dir,
				sessionArgs: binding.args,
				profile: cell.model.profile,
				prompt: cell.prompt,
				timeoutMs,
				where: { env: binding.env, cwd: work },
			},
		);
		log(
			`  ${cell.model.declared.padEnd(6)} ${cell.case.padEnd(18)} nonce=${cell.nonce} ` +
				`${transcript.answered ? `answered as ${transcript.resolvedModel ?? "?"}` : `no answer — ${transcript.said}`}`,
		);
		return transcript;
	},
});

const document = renderMatrixDocument(record);
const path = join(outDir, `skill-loading-claude-${version}-${packageRev.digest.slice(0, 12)}.md`);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, document, "utf8");

log(`\n${record.cells.map((cell) => `${cell.model.declared}/${cell.case}: ${cell.verdict}`).join("\n")}`);
log(`\nWrote ${path}`);
// Left rather than removed: a red cell is diagnosed from the isolated config
// dir, the built plugin and the settings file this run used, and a script that
// deleted them would leave the operator with a verdict and no way to ask why.
log(`Scratch left at ${scratch} — remove it once the result is understood.`);

function readProofSkill() {
	const path = join(PACKAGE_ROOT, "skills", "meta", PROOF_ENTRY_SKILL, "SKILL.md");
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		throw new FactoryProofError(
			"proof-skill-missing",
			`The pinned revision ships no \`${PROOF_ENTRY_SKILL}\` at ${path} (${error.code ?? error.message}). That body ` +
				`is the subject of the proof and the source of the contract judging it, so there is nothing to run.`,
			{ at: path },
		);
	}
}

async function harnessVersion() {
	const answer = await runCommand(binary, ["--version"], { timeout: timeoutMs, env: binding.env, cwd: work });
	const said = `${answer.stdout} ${answer.stderr}`.trim();
	const found = /\b\d+\.\d+\.\d+\b/.exec(said);
	if (found === null) {
		throw new FactoryProofError(
			"harness-unidentified",
			`\`${binary} --version\` answered no version string (${said || "nothing"}), so nothing could be recorded as ` +
				`the harness this matrix was taken against (§11.7).`,
			{ binary },
		);
	}
	return found[0];
}
