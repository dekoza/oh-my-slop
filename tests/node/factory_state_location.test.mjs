import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { resolveAgentDir, resolveStorePaths, repoSlug } from "../../factory/lib/state/location.mjs";
import { factorySources, makeRepo } from "./helpers/factory-repo.mjs";

/**
 * §4.1's location rules: the root comes from the pi SDK, the slug is Claude's
 * notation, and a collision on a differing canonical path is answered by a
 * realpath hash rather than by two repositories sharing one brain.
 */

// ── The agent directory (§4.1) ───────────────────────────────────────────────

test("the store root is the pi SDK's getAgentDir(), not an environment reading of our own", async () => {
	const resolved = await resolveAgentDir({
		env: { PI_CODING_AGENT_DIR: "/env/should/not/win" },
		loadSdk: async () => ({ getAgentDir: () => "/sdk/agent" }),
	});

	assert.equal(resolved.path, "/sdk/agent");
	assert.equal(resolved.source, "pi-sdk");
});

test("without the SDK on the resolution path, the documented default applies", async () => {
	const resolved = await resolveAgentDir({ env: {}, loadSdk: async () => null });

	assert.equal(resolved.path, join(homedir(), ".pi", "agent"));
	assert.equal(resolved.source, "default");
});

test("without the SDK, PI_CODING_AGENT_DIR is the one spelling honoured", async () => {
	const resolved = await resolveAgentDir({
		env: { PI_CODING_AGENT_DIR: "/elsewhere/agent" },
		loadSdk: async () => null,
	});

	assert.equal(resolved.path, "/elsewhere/agent");
	assert.equal(resolved.source, "env");
});

test("PI_AGENT_DIR moves nothing — it is not a pi variable (§4.1)", async () => {
	const resolved = await resolveAgentDir({
		env: { PI_AGENT_DIR: "/retired/extension/spelling" },
		loadSdk: async () => null,
	});

	assert.equal(resolved.path, join(homedir(), ".pi", "agent"));
});

test("no factory source reads PI_AGENT_DIR at all", () => {
	// The retired spelling may be *named* in prose — §4.1 explains why it is
	// wrong — so this looks for an environment read of it, not a mention.
	const environmentRead = /(?:process\.)?env\s*(?:\.PI_AGENT_DIR\b|\[\s*["'`]PI_AGENT_DIR)/;

	for (const [path, source] of factorySources()) {
		assert.equal(environmentRead.test(source), false, `${path} reads the retired PI_AGENT_DIR spelling`);
	}
});

// ── The slug and its collision suffix (§4.1) ─────────────────────────────────

test("the slug is Claude's notation for the canonical path", () => {
	assert.equal(repoSlug("/home/minder/projekty/oh-my-slop"), "-home-minder-projekty-oh-my-slop");
});

test("the slug charset is [0-9A-Za-z-] by construction (§2.1)", () => {
	assert.match(repoSlug("/tmp/weird name.with_dots/@scope"), /^[0-9A-Za-z-]+$/);
});

test("the collision candidate appends the first eight hex of sha256(realpath)", (t) => {
	const root = realpathSync(makeRepo(t));
	const expected = createHash("sha256").update(root).digest("hex").slice(0, 8);

	const paths = resolveStorePaths({ repoRoot: root, agentDir: "/agent" });

	assert.equal(paths.onCollision.slug, `${paths.primary.slug}-${expected}`);
});

test("the paths land under <agent dir>/software-factory/repos/<slug>/state.db", (t) => {
	const root = realpathSync(makeRepo(t));

	const paths = resolveStorePaths({ repoRoot: root, agentDir: "/agent" });

	assert.equal(paths.canonicalPath, root);
	assert.equal(paths.primary.dir, join("/agent", "software-factory", "repos", paths.primary.slug));
	assert.equal(paths.primary.dbPath, join(paths.primary.dir, "state.db"));
	assert.equal(paths.onCollision.dbPath, join(paths.onCollision.dir, "state.db"));
});

test("a repo path reached through a symlink resolves to the same store", (t) => {
	const root = makeRepo(t);
	const viaLink = join(dirname(root), "..", basenameOf(dirname(root)), basenameOf(root));

	assert.equal(
		resolveStorePaths({ repoRoot: viaLink, agentDir: "/agent" }).primary.slug,
		resolveStorePaths({ repoRoot: root, agentDir: "/agent" }).primary.slug,
	);
});

function basenameOf(path) {
	return path.split("/").filter(Boolean).at(-1);
}
