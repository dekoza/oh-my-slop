import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { classesReachedBy } from "../../factory/lib/config/profiles.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";

/**
 * `/setup-project-skills` writes `.pi/factory.json` for a repo that has never had
 * one, and the file it writes is a template inside its own SKILL.md. A template
 * that does not load is the whole setup failing: the operator's first `factory`
 * verb refuses, and the only way forward is `factory migrate` plus a hand-edit —
 * which is exactly the path §11.8 keeps for files written before this schema.
 *
 * So the template is executed rather than read. The per-repo answers are
 * substituted the way a setup run substitutes them, and the result goes through
 * the real loader against a real repository.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_MD = join(REPO_ROOT, "skills", "meta", "setup-project-skills", "SKILL.md");

/**
 * The answers Section D resolves by exploring the repo, in the placeholder
 * spelling the template uses. `makeRepo`'s fixture remote is what the loader's
 * §11.1 cross-check is answered against, so the tracker values are its.
 */
const ANSWERS = Object.freeze({
	"<owner/repository>": "acme/widgets",
	"<gitea-remote>": "gitea",
	"<tea-login-name>": "gitea",
	"<authenticated-gitea-user>": "factory-bot",
	"<default-branch>": "main",
});

/** The one fenced JSON block in the skill that is the policy file. */
function templateSource() {
	const blocks = [...readFileSync(SKILL_MD, "utf8").matchAll(/```json\n([\s\S]*?)```/g)].map(
		(match) => match[1],
	);
	const policy = blocks.filter((block) => block.includes('"schemaVersion"'));

	assert.equal(policy.length, 1, "setup-project-skills should carry exactly one factory.json template");
	return policy[0];
}

function answered() {
	let source = templateSource();
	for (const [placeholder, answer] of Object.entries(ANSWERS)) {
		source = source.replaceAll(placeholder, answer);
	}
	return source;
}

test("the setup template declares the schema this binary reads, not a legacy one", () => {
	const document = JSON.parse(answered());

	assert.equal(document.schemaVersion, 2);
	assert.equal(document.version, undefined, "a `version` key is the v1 spelling the loader refuses");
});

test("no placeholder or TODO hole survives the answers a setup run has", () => {
	const source = answered();

	assert.doesNotMatch(source, /<[^>]+>/, "every placeholder in the template must be one Section D resolves");
	assert.doesNotMatch(source, /TODO/, "a setup run has the answers; holes are `factory migrate`'s output, not this one's");
});

test("the setup template loads against a real repository on the first verb", (t) => {
	const root = makeRepo(t, { config: answered() });

	const { config, activeRouting } = loadFactoryConfig({ cwd: root });

	assert.equal(config.checks.length > 0, true);
	assert.equal(config.concurrency.maxTicketExecutions, 1);
	assert.equal(config.budgets.automation, 1, "the automation budget is the one number a migration cannot supply");
	assert.deepEqual(Object.keys(activeRouting.roles).sort(), ["freshRetry", "implement", "review"]);
	assert.equal(activeRouting.roles.review.length, 2, "review is a pair, one profile per §8.4 axis");
});

test("the template's resource sizes are derived from the profiles it writes", (t) => {
	const { config, activeRouting } = loadFactoryConfig({ cwd: makeRepo(t, { config: answered() }) });

	const reached = classesReachedBy(
		config.profiles,
		new Set([activeRouting.roles.implement, activeRouting.roles.freshRetry, ...activeRouting.roles.review]),
	);

	assert.deepEqual(
		Object.keys(config.concurrency.resources).sort(),
		[...reached.keys()].sort(),
		"a class the routing reaches must be sized, and a sized class nothing reaches refuses the load",
	);
});

test("every scaffolded check command runs through its project runner", () => {
	const { checks } = JSON.parse(answered());

	for (const check of checks) {
		assert.doesNotMatch(
			check.command,
			/^(pytest|ruff|just|npx|tsc|node|mypy|black)\b/,
			`${check.name} names a dev-dependency binary directly; off the controller's PATH that exits 127, ` +
				"which the runner classifies as exec-not-found rather than as a failing check",
		);
	}
});
