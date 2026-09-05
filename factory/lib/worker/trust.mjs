import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { canonicalPath } from "../identity/paths.mjs";

/**
 * §6.8's trust half: **the controller pre-trusts its own worktrees
 * mechanically, per attempt, in controller-owned config scope for both
 * runtimes.**
 *
 * A factory worktree contains only the operator's own repository at a pinned
 * commit, so auto-trusting it weakens nothing — and the alternative is the
 * proven failure: an interactive pane sitting on a trust dialog nobody is
 * watching, indistinguishable from a worker thinking.
 *
 * Each runtime's store is written **and read back through that runtime's own
 * resolution rule**, because the two rules are not the same and neither is
 * obvious:
 *
 * - **pi** keys `trust.json` by directory and walks *up* to the nearest entry
 *   (`core/trust-manager.js`), so one entry on the worktrees root covers every
 *   attempt worktree beneath it. It **canonicalizes the directory first**,
 *   resolving symlinks, both before keying and before the ancestor walk — so
 *   this module does too (#178). Resolving without following symlinks put the
 *   two spellings on different keys for any store path with a symlink in it,
 *   the pre-trust silently failed to apply, and the trust dialog fired: the
 *   exact §6.8 hang the preflight check exists to prove impossible, latent on a
 *   plain host and live wherever a temporary directory is a symlink (macOS
 *   `/tmp` and `/var` among them).
 * - **Claude** keys `.claude.json`'s `projects` map **exactly**, on a path
 *   `resolve`d and not realpath'd — deliberately not pi's spelling, because
 *   whether Claude canonicalizes has never been measured and mirroring a rule
 *   nobody observed is the guess this module exists to avoid. What covers the
 *   case if it does is `untrustedProjects`, which names any key the runtime
 *   recorded that nobody trusted. For a
 *   linked worktree the key it writes is the **repository's git common
 *   directory**, not the worktree path. Verified live against Claude Code
 *   2.1.233: a session run in a worktree of `<store>/clone.git` recorded
 *   `<store>/clone.git`. Pre-trusting the worktree path alone would leave every
 *   attempt facing the dialog, so both spellings are trusted and the preflight
 *   check asserts that the runtime recorded no project the controller had not
 *   already trusted.
 *
 * Neither store is the operator's: both paths are handed in by the caller from
 * the controller-owned config environment (`environment.mjs`).
 */

/** pi's store, relative to its agent directory (`PI_CODING_AGENT_DIR`). */
const PI_TRUST_FILE = "trust.json";

/** Claude's config state file, relative to `CLAUDE_CONFIG_DIR`. */
const CLAUDE_STATE_FILE = ".claude.json";

/**
 * What a pre-trusted Claude project has answered. `hasTrustDialogAccepted` is
 * the trust dialog itself; the external-includes pair is the *other* modal a
 * repository with `@`-imports in its `CLAUDE.md` raises, and a pane blocked on
 * that one is just as hung.
 */
export const CLAUDE_PROJECT_TRUST = Object.freeze({
	hasTrustDialogAccepted: true,
	hasClaudeMdExternalIncludesApproved: true,
	hasClaudeMdExternalIncludesWarningShown: true,
});

/**
 * What the writer settles on the state **as a whole** rather than per project:
 * the onboarding flow, which is a full-screen interstitial on a pane nobody is
 * watching.
 *
 * It is a named constant beside the per-project set for one reason (#178): the
 * `worker-trust` preflight check reads back **everything this module writes**,
 * derived from these two constants rather than hand-listed, so a fifth settled
 * key cannot become a fourth unproven one.
 */
export const CLAUDE_STATE_SETTLED = Object.freeze({ hasCompletedOnboarding: true });

/**
 * pi's own rule, mirrored: the nearest ancestor with an entry decides, and no
 * entry at all is `null` — which is the answer that raises the dialog.
 *
 * @param {Record<string, boolean | null>} map a parsed `trust.json`
 * @param {string} path the directory a session would run in
 * @returns {boolean | null}
 */
export function piTrustDecision(map, path) {
	// Canonical, because that is what pi looks the key up under. The walk then
	// runs over canonical spellings all the way to the root, exactly as pi's does.
	let current = canonicalPath(path);
	for (;;) {
		const decision = map[current];
		if (decision === true || decision === false) return decision;

		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * @param {string} agentDir the controller-owned pi agent directory
 * @returns {Record<string, boolean | null>} the store, or `{}` when there is
 *   none to read — an absent or damaged store is not a reason to fail a caller
 *   that is about to rewrite it anyway.
 */
export function readPiTrust(agentDir) {
	const parsed = readJson(join(agentDir, PI_TRUST_FILE));
	return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

/**
 * Record `true` for each path, keeping whatever else the store holds.
 *
 * An existing `false` for one of these paths is **overwritten**, not merged
 * around: the controller owns this store and the paths are its own worktrees,
 * so a refusal in it is stale state, never a human's decision about the
 * factory's private clone.
 *
 * @param {string} agentDir the controller-owned pi agent directory
 * @param {ReadonlyArray<string>} paths
 * @returns {Record<string, boolean>} the store as written
 */
export function pretrustPi(agentDir, paths) {
	const map = readPiTrust(agentDir);
	for (const path of paths) map[canonicalPath(path)] = true;

	const sorted = {};
	for (const key of Object.keys(map).sort()) sorted[key] = map[key];

	// pi's own spelling — two-space JSON, sorted keys, trailing newline — so a
	// store the factory wrote and one pi wrote are the same file.
	writeAtomic(join(agentDir, PI_TRUST_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
	return sorted;
}

/**
 * Every spelling Claude might key one attempt worktree's project by.
 *
 * The common directory is what a linked worktree resolves to, and its parent is
 * what a *non-bare* repository's would be (`<root>/.git` → `<root>`). Trusting
 * the superset is safe — every path here is one the factory created inside its
 * own state area — and it is what keeps this from depending on a rule the
 * harness is free to change between versions.
 *
 * @param {{ worktreePath: string, gitCommonDir: string }} where
 * @returns {ReadonlyArray<string>} sorted, de-duplicated
 */
export function claudeTrustKeys({ worktreePath, gitCommonDir }) {
	const common = resolve(gitCommonDir);
	const keys = new Set([resolve(worktreePath), common]);
	if (common.endsWith("/.git")) keys.add(dirname(common));

	return Object.freeze([...keys].sort());
}

/**
 * @param {string} configDir the controller-owned `CLAUDE_CONFIG_DIR`
 * @returns {object} the config state, always with a `projects` map
 */
export function readClaudeConfigState(configDir) {
	const parsed = readJson(join(configDir, CLAUDE_STATE_FILE));
	const state = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	return { ...state, projects: state.projects ?? {} };
}

/**
 * Accept the trust dialog for each key, and the onboarding that would block an
 * interactive pane just as thoroughly.
 *
 * @param {string} configDir the controller-owned `CLAUDE_CONFIG_DIR`
 * @param {ReadonlyArray<string>} keys
 * @returns {object} the state as written
 */
export function pretrustClaude(configDir, keys) {
	const state = readClaudeConfigState(configDir);
	const projects = { ...state.projects };
	for (const key of keys) {
		projects[resolve(key)] = { ...projects[resolve(key)], ...CLAUDE_PROJECT_TRUST };
	}

	const written = { ...state, ...CLAUDE_STATE_SETTLED, projects };
	writeAtomic(join(configDir, CLAUDE_STATE_FILE), `${JSON.stringify(written, null, 2)}\n`);
	return written;
}

/**
 * Which of the settled keys did **not** read back for this project (#178).
 *
 * The writer settles four things — the trust dialog, both external-includes
 * keys, and the onboarding flag — and the check that proved one of them proved
 * one interstitial while three more were written and never read. Each of those
 * is a modal that hangs an interactive pane exactly as thoroughly as the trust
 * dialog does, so the readback is over the constants themselves: what is written
 * is what is proven, by construction rather than by anyone remembering.
 *
 * @param {object} state what `readClaudeConfigState` answered
 * @param {string} key one project key
 * @returns {ReadonlyArray<string>} the key names that failed to read back, in
 *   the order the constants declare them; empty when every one is settled
 */
export function claudeUnsettledKeys(state, key) {
	return Object.freeze([
		...unsettledIn(state, CLAUDE_STATE_SETTLED),
		...unsettledIn(state.projects?.[resolve(key)], CLAUDE_PROJECT_TRUST),
	]);
}

/** The names in `expectations` that `carrier` does not answer with the expected value. */
function unsettledIn(carrier, expectations) {
	return Object.entries(expectations)
		.filter(([name, expected]) => (carrier ?? {})[name] !== expected)
		.map(([name]) => name);
}

/**
 * Whether one project reads back as fully settled — **every** key the writer
 * writes, not the trust dialog alone (#178).
 *
 * @param {object} state what `readClaudeConfigState` answered
 * @param {string} key one project key
 * @returns {boolean}
 */
export function claudeTrustDecision(state, key) {
	return claudeUnsettledKeys(state, key).length === 0;
}

/**
 * Which projects the runtime recorded that nobody had pre-trusted.
 *
 * This is the assertion that catches the failure mode the spelling above exists
 * for: if Claude keys a project some way the controller did not anticipate, the
 * key appears here untrusted, and a preflight failure naming it is cheaper by
 * every measure than a pane discovering it later.
 *
 * @param {object} state what `readClaudeConfigState` answered
 * @returns {ReadonlyArray<string>} sorted
 */
export function untrustedProjects(state) {
	return Object.freeze(
		Object.entries(state.projects ?? {})
			.filter(([, project]) => project?.hasTrustDialogAccepted !== true)
			.map(([key]) => key)
			.sort(),
	);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/**
 * Temp-and-rename, because both stores are read by the harness at startup and a
 * half-written one reads as "no decision" — which is the dialog.
 */
function writeAtomic(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.factory-tmp`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, path);
}
