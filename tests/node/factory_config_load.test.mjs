import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_BLOCKS, CONFIG_SCHEMA_VERSION, loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { remoteUrlToRepoSlug } from "../../factory/lib/git/repo.mjs";
import { cloneValidConfig as clone, makeRepo } from "./helpers/factory-repo.mjs";

function loadFailure(cwd) {
	try {
		loadFactoryConfig({ cwd });
	} catch (error) {
		return error;
	}
	throw new assert.AssertionError({ message: `expected a load failure in ${cwd}` });
}

// ── The block inventory (§11.3) ──────────────────────────────────────────────

test("the loader reads schemaVersion 2 and exactly the surviving §11.3 blocks", () => {
	assert.equal(CONFIG_SCHEMA_VERSION, 2);
	assert.deepEqual(Object.keys(CONFIG_BLOCKS), [
		"tracker",
		"git",
		"profiles",
		"routing",
		"checks",
		"budgets",
		"concurrency",
		"retention",
		"package",
	]);
	assert.deepEqual(
		Object.entries(CONFIG_BLOCKS)
			.filter(([, block]) => !block.required)
			.map(([name]) => name),
		["budgets", "retention", "package"],
	);
});

// ── Discovery ────────────────────────────────────────────────────────────────

test("discovery walks up from the invocation directory to the git repo root", (t) => {
	const root = makeRepo(t);
	const deep = join(root, "packages", "widget", "src");
	mkdirSync(deep, { recursive: true });

	const loaded = loadFactoryConfig({ cwd: deep });

	assert.equal(loaded.repoRoot, root);
	assert.equal(loaded.configPath, join(root, ".pi", "factory.json"));
	assert.equal(loaded.config.tracker.repo, "acme/widgets");
});

test("discovery reads exactly the repo-root file, never a nearer one", (t) => {
	const root = makeRepo(t);
	const nested = join(root, "sub");
	mkdirSync(join(nested, ".pi"), { recursive: true });
	const decoy = clone();
	decoy.tracker.assignee = "decoy";
	writeFileSync(join(nested, ".pi", "factory.json"), JSON.stringify(decoy), "utf8");

	const loaded = loadFactoryConfig({ cwd: nested });

	assert.equal(loaded.configPath, join(root, ".pi", "factory.json"));
	assert.equal(loaded.config.tracker.assignee, "factory-bot");
});

test("a directory outside any git repository refuses with no-repo-root", (t) => {
	const outside = mkdtempSync(join(tmpdir(), "factory-norepo-"));
	t.after(() => rmSync(outside, { recursive: true, force: true }));

	const error = loadFailure(outside);

	assert.equal(error.reason, "no-repo-root");
	assert.match(error.message, /git repo(sitory)? root/i);
});

test("a repo with no .pi/factory.json refuses and names the file it looked for", (t) => {
	const root = makeRepo(t, { config: null });

	const error = loadFailure(root);

	assert.equal(error.reason, "file-missing");
	assert.ok(error.message.includes(join(root, ".pi", "factory.json")));
});

// ── The five load failures (§11.2) ───────────────────────────────────────────

test("a parse error refuses instead of falling back to a default config", (t) => {
	const root = makeRepo(t, { config: '{ "schemaVersion": 2, ' });

	const error = loadFailure(root);

	assert.equal(error.reason, "parse-error");
	assert.ok(error.message.includes(join(root, ".pi", "factory.json")));
});

test("a v1 config is rejected by schemaVersion and pointed at factory migrate", (t) => {
	const root = makeRepo(t, { config: { version: 1, tracker: { repo: "acme/widgets" } } });

	const error = loadFailure(root);

	assert.equal(error.reason, "schema-version");
	assert.match(error.message, /factory migrate/);
});

test("an unrecognised schemaVersion refuses and names both versions", (t) => {
	const config = clone();
	config.schemaVersion = 3;
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "schema-version");
	assert.equal(error.details.found, 3);
	assert.equal(error.details.expected, 2);
});

test("an unknown top-level key refuses and names it", (t) => {
	const config = clone();
	config.completion = { closeAfterIntegration: true };
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "completion");
});

test("an unknown key inside a block the loader owns refuses and names its path", (t) => {
	const config = clone();
	config.tracker.labels = { readyForAgent: "ready-for-agent" };
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "tracker.labels");
});

test("a missing required block refuses and names it", (t) => {
	const config = clone();
	delete config.checks;
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "missing-key");
	assert.equal(error.details.at, "checks");
});

test("a missing required key inside a block the loader owns refuses and names it", (t) => {
	const config = clone();
	delete config.git.baseBranch;
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "missing-key");
	assert.equal(error.details.at, "git.baseBranch");
});

test("blocks with defaults may be omitted", (t) => {
	const config = clone();
	delete config.budgets;
	delete config.retention;
	const root = makeRepo(t, { config });

	assert.equal(loadFactoryConfig({ cwd: root }).config.tracker.repo, "acme/widgets");
});

test("a residual TODO sentinel anywhere in the document refuses and names its path", (t) => {
	const config = clone();
	config.concurrency.resources = { local: "TODO: size this class" };
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "todo-sentinel");
	assert.equal(error.details.at, "concurrency.resources.local");
});

test("a TODO sentinel inside an array element is found too", (t) => {
	const config = clone();
	config.checks[0].command = "TODO";
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "todo-sentinel");
	assert.equal(error.details.at, "checks[0].command");
});

test("a TODO sentinel used as a key refuses even when it holds a whole block", (t) => {
	const config = clone();
	config.routing.sets = { "TODO: post-subscription": { implement: "local" } };
	const root = makeRepo(t, { config });

	const error = loadFailure(root);

	assert.equal(error.reason, "todo-sentinel");
	assert.match(error.details.at, /^routing\.sets\.TODO/);
});

test("a command that merely mentions TODO is not a sentinel", (t) => {
	const config = clone();
	config.checks[0].command = "grep -r TODO src";
	const root = makeRepo(t, { config });

	assert.equal(loadFactoryConfig({ cwd: root }).config.checks[0].command, "grep -r TODO src");
});

// ── The repo-binding cross-check (§11.1) ─────────────────────────────────────

test("a remote pointing at another repository refuses and names both sides", (t) => {
	const root = makeRepo(t, { remotes: { gitea: "git@gitea.example:acme/gadgets.git" } });

	const error = loadFailure(root);

	assert.equal(error.reason, "remote-mismatch");
	assert.equal(error.details.at, "tracker.repo");
	assert.equal(error.details.expected, "acme/widgets");
	assert.equal(error.details.found, "acme/gadgets");
	assert.ok(error.message.includes("git@gitea.example:acme/gadgets.git"));
});

test("the cross-check reads the remote tracker.remote names, not origin", (t) => {
	const root = makeRepo(t, {
		remotes: {
			origin: "git@github.com:acme/widgets.git",
			gitea: "git@gitea.example:acme/gadgets.git",
		},
	});

	const error = loadFailure(root);

	assert.equal(error.reason, "remote-mismatch");
	assert.equal(error.details.remote, "gitea");
});

test("a tracker.remote the repo does not define refuses as unresolvable", (t) => {
	const root = makeRepo(t, { remotes: { origin: "git@gitea.example:acme/widgets.git" } });

	const error = loadFailure(root);

	assert.equal(error.reason, "remote-unresolvable");
	assert.equal(error.details.remote, "gitea");
});

test("https and scp remote URLs both resolve to the same repository", (t) => {
	const root = makeRepo(t, { remotes: { gitea: "https://gitea.example:30008/ACME/Widgets.git" } });

	assert.equal(loadFactoryConfig({ cwd: root }).remote.slug, "ACME/Widgets");
});

// ── What the loader must never reuse ─────────────────────────────────────────

test("no factory source reaches for the config-loader extension's fallback semantics", () => {
	const factoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "factory");

	for (const entry of readdirSync(factoryRoot, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
		const source = readFileSync(join(entry.parentPath, entry.name), "utf8");

		assert.doesNotMatch(
			source,
			/from\s+["'][^"']*config-loader|\bloadJsonConfigFile\s*\(/,
			`${entry.name} calls the silently-defaulting loader §11.2 rules out`,
		);
	}
});

// ── Remote URL shapes ────────────────────────────────────────────────────────

test("remoteUrlToRepoSlug reads the owner/repository out of every remote shape", () => {
	assert.equal(remoteUrlToRepoSlug("git@gitea.example:acme/widgets.git"), "acme/widgets");
	assert.equal(remoteUrlToRepoSlug("ssh://git@gitea.example:2222/acme/widgets.git"), "acme/widgets");
	assert.equal(remoteUrlToRepoSlug("https://gitea.example/acme/widgets"), "acme/widgets");
	assert.equal(remoteUrlToRepoSlug("https://user:token@gitea.example/acme/widgets.git"), "acme/widgets");
	assert.equal(remoteUrlToRepoSlug("/srv/git/acme/widgets.git"), "acme/widgets");
	assert.equal(remoteUrlToRepoSlug("file:///srv/git/acme/widgets/"), "acme/widgets");
	assert.equal(remoteUrlToRepoSlug("widgets.git"), null);
	assert.equal(remoteUrlToRepoSlug(""), null);
});
