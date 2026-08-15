import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where the per-repo store lives (§4.1).
 *
 * `${PI_CODING_AGENT_DIR:-~/.pi/agent}/software-factory/repos/<slug>/state.db`,
 * with the root resolved by the pi SDK's `getAgentDir()`. **`PI_AGENT_DIR` is
 * not a pi variable** — it was read only by the retired factory extension, and
 * the day someone sets `PI_CODING_AGENT_DIR` that spelling splits pi and the
 * factory into two brains while the monitor reads an empty database.
 */

/** The one directory the factory owns inside the agent dir. */
const STATE_ROOT_SEGMENT = "software-factory";

/** The peer-dependency spellings of the pi SDK, in `package.json` order. */
const PI_SDK_SPECIFIERS = Object.freeze(["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"]);

/** The SDK's own variable, replicated only for the no-SDK fallback below. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/**
 * @param {{ env?: Record<string, string | undefined>, loadSdk?: () => Promise<{ getAgentDir?: () => string } | null> }} [options]
 * @returns {Promise<{ path: string, source: "pi-sdk" | "env" | "default" }>}
 *   `source` is reported rather than swallowed: the binary ships as a peer of
 *   the SDK, so a run that fell back to the documented default is a fact
 *   `doctor` should be able to state instead of a silent guess.
 */
export async function resolveAgentDir({ env = process.env, loadSdk = loadPiSdk } = {}) {
	const sdk = await loadSdk();
	if (typeof sdk?.getAgentDir === "function") {
		return Object.freeze({ path: sdk.getAgentDir(), source: "pi-sdk" });
	}

	// The SDK's rule, not a rule of our own: its variable, then `~/.pi/agent`.
	const declared = env[AGENT_DIR_ENV]?.trim();
	if (declared) return Object.freeze({ path: declared, source: "env" });

	return Object.freeze({ path: join(homedir(), ".pi", "agent"), source: "default" });
}

/** The SDK is a peer dependency, so in a bare checkout it simply is not there. */
async function loadPiSdk() {
	for (const specifier of PI_SDK_SPECIFIERS) {
		try {
			return await import(specifier);
		} catch (error) {
			if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
		}
	}
	return null;
}

/**
 * Claude's notation: the canonical path with every character outside
 * `[0-9A-Za-z]` folded to `-`, so `/home/minder/projekty/oh-my-slop` becomes
 * `-home-minder-projekty-oh-my-slop` and the §2.1 charset holds by
 * construction.
 *
 * @param {string} canonicalPath
 * @returns {string}
 */
export function repoSlug(canonicalPath) {
	return canonicalPath.replace(/[^0-9A-Za-z]/g, "-");
}

/**
 * The two candidate store directories for one repository: the slug, and the
 * realpath-hashed spelling used when the slug is already occupied by a
 * *different* canonical path. Which one is opened is `openStore`'s decision,
 * because only the recorded canonical path answers it (§4.1).
 *
 * @param {{ repoRoot: string, agentDir: string }} where
 * @returns {{ canonicalPath: string, primary: { slug: string, dir: string, dbPath: string }, onCollision: { slug: string, dir: string, dbPath: string } }}
 */
export function resolveStorePaths({ repoRoot, agentDir }) {
	const canonicalPath = canonicalize(repoRoot);
	const slug = repoSlug(canonicalPath);
	const suffix = createHash("sha256").update(canonicalPath).digest("hex").slice(0, 8);
	const reposRoot = join(agentDir, STATE_ROOT_SEGMENT, "repos");

	return Object.freeze({
		canonicalPath,
		primary: storeDirectory(reposRoot, slug),
		onCollision: storeDirectory(reposRoot, `${slug}-${suffix}`),
	});
}

function storeDirectory(reposRoot, slug) {
	const dir = join(reposRoot, slug);
	return Object.freeze({ slug, dir, dbPath: join(dir, "state.db") });
}

/**
 * The recorded path is the resolved one, so a checkout reached through a
 * symlink or a relative path is the same repository as itself.
 */
function canonicalize(repoRoot) {
	const absolute = resolve(repoRoot);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}
