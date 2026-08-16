import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	assertClosureResolvable,
	readSkillInventory,
	skillClosure,
	validateClosureReferences,
} from "../../factory/lib/worker/closure.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { makeTree } from "./helpers/factory-package.mjs";

/**
 * §6.2's layer 1: the closure is computed mechanically from `requires:`
 * frontmatter, and §6.8's four conflict classes — shadowed, duplicated,
 * disabled, missing — are one typed failure naming the offending source.
 *
 * Real trees on disk, because every statement here — a symlink escaping, a
 * duplicate directory, an unreadable file — is a statement about a filesystem.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function skill(name, { description = `the ${name} skill`, requires = [], extra = "", body = "" } = {}) {
	const list = requires.length === 0 ? "" : `requires:\n${requires.map((entry) => `  - ${entry}`).join("\n")}\n`;
	return `---\nname: ${name}\ndescription: ${description}\n${list}${extra}---\n${body}`;
}

function inventoryOf(t, files, { skillsDir = "skills" } = {}) {
	const root = makeTree(t, files);
	return {
		root,
		inventory: readSkillInventory({ packageRoot: root, skillsRoots: [join(root, skillsDir)] }),
	};
}

// ── The closure (§6.2) ───────────────────────────────────────────────────────

test("the closure follows requires: transitively and includes the entry skill", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/workflow/implement/SKILL.md": skill("implement", { requires: ["tdd", "git-discipline"] }),
		"skills/practice/tdd/SKILL.md": skill("tdd", { requires: ["testing-workflow"] }),
		"skills/practice/testing-workflow/SKILL.md": skill("testing-workflow"),
		"skills/practice/git-discipline/SKILL.md": skill("git-discipline"),
		"skills/practice/unrelated/SKILL.md": skill("unrelated"),
	});

	const { closure, findings } = skillClosure(inventory, "implement");

	assert.deepEqual(closure, ["git-discipline", "implement", "tdd", "testing-workflow"]);
	assert.deepEqual(findings, []);
});

test("a cycle is a set, not a hang", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/practice/a/SKILL.md": skill("a", { requires: ["b"] }),
		"skills/practice/b/SKILL.md": skill("b", { requires: ["a"] }),
	});

	const { closure, findings } = skillClosure(inventory, "a");

	assert.deepEqual(closure, ["a", "b"]);
	assert.deepEqual(findings, []);
});

test("the walk recurses until it finds a SKILL.md, exactly as pi discovery does", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/deep/nest/bucket/thing/SKILL.md": skill("thing"),
	});

	assert.ok(inventory.skills.has("thing"));
});

// ── §6.8's four conflict classes, each naming the offending source ───────────

test("a missing requirement is a finding naming the skill that asked", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/workflow/implement/SKILL.md": skill("implement", { requires: ["ghost"] }),
	});

	const { findings } = skillClosure(inventory, "implement");

	assert.equal(findings.length, 1);
	assert.equal(findings[0].reason, "skill-missing");
	assert.equal(findings[0].skill, "ghost");
	assert.match(findings[0].message, /implement\/SKILL\.md/);
});

test("a missing entry skill names the role declaration as the asker", (t) => {
	const { inventory } = inventoryOf(t, {});

	const { findings } = skillClosure(inventory, "implement");

	assert.equal(findings[0].reason, "skill-missing");
	assert.match(findings[0].message, /entry declaration/);
});

test("a duplicated name is a finding naming both directories", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/practice/tdd/SKILL.md": skill("tdd"),
		"skills/workflow/tdd/SKILL.md": skill("tdd"),
	});

	const duplicated = inventory.findings.find((entry) => entry.reason === "skill-duplicated");
	assert.ok(duplicated);
	assert.match(duplicated.message, /practice\/tdd/);
	assert.match(duplicated.message, /workflow\/tdd/);
});

test("a disabled skill in the closure is a finding naming its SKILL.md", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/workflow/implement/SKILL.md": skill("implement", { requires: ["tdd"] }),
		"skills/practice/tdd/SKILL.md": skill("tdd", { extra: "disabled: true\n" }),
	});

	const { findings } = skillClosure(inventory, "implement");

	assert.equal(findings.length, 1);
	assert.equal(findings[0].reason, "skill-disabled");
	assert.match(findings[0].message, /tdd\/SKILL\.md/);
});

test("a skill escaping the package through a symlink is a finding, not a member", (t) => {
	const outside = makeTree(t, { "escapee/SKILL.md": skill("escapee") });
	const { root, inventory } = inventoryOf(t, {
		"skills/practice/honest/SKILL.md": skill("honest"),
	});
	symlinkSync(join(outside, "escapee"), join(root, "skills", "practice", "escapee"));

	const again = readSkillInventory({ packageRoot: root, skillsRoots: [join(root, "skills")] });

	assert.ok(!again.skills.has("escapee"), "an escaping skill was inventoried");
	const escaped = again.findings.find((entry) => entry.reason === "skill-escapes-package");
	assert.ok(escaped);
	assert.equal(escaped.skill, "escapee");
	assert.ok(again.skills.has("honest"), "one escapee took the honest skills with it");
});

test("assertClosureResolvable is one typed failure carrying every finding", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/workflow/implement/SKILL.md": skill("implement", { requires: ["ghost", "off"] }),
		"skills/practice/off/SKILL.md": skill("off", { extra: "disabled: true\n" }),
	});

	const { findings } = skillClosure(inventory, "implement");

	assert.throws(
		() => assertClosureResolvable(findings),
		(error) => {
			assert.ok(error instanceof FactoryWorkerError);
			assert.equal(error.reason, "skill-conflict");
			assert.equal(error.details.findings.length, 2);
			assert.match(error.message, /ghost/);
			assert.match(error.message, /off\/SKILL\.md/);
			return true;
		},
	);

	assert.deepEqual(assertClosureResolvable([]), []);
});

// ── Frontmatter and reference validation (§6.2's layer 1) ────────────────────

test("frontmatter that is absent, unclosed, or descriptionless is a finding", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/practice/naked/SKILL.md": "# naked\nno frontmatter at all\n",
		"skills/practice/unclosed/SKILL.md": "---\nname: unclosed\ndescription: x\n",
		"skills/practice/mute/SKILL.md": "---\nname: mute\n---\nbody\n",
	});

	const reasons = inventory.findings.map((entry) => [entry.skill, entry.reason]);
	assert.deepEqual(
		reasons.sort(),
		[
			["mute", "skill-frontmatter-invalid"],
			["naked", "skill-frontmatter-invalid"],
			["unclosed", "skill-frontmatter-invalid"],
		].sort(),
	);
});

test("a frontmatter name disagreeing with its directory is a finding", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/practice/tdd/SKILL.md": skill("test-driven"),
	});

	const finding = inventory.findings.find((entry) => entry.reason === "skill-frontmatter-invalid");
	assert.ok(finding);
	assert.match(finding.message, /"test-driven".*"tdd"/);
});

test("block-scalar descriptions and comments parse; commented keys stay comments", (t) => {
	const { inventory } = inventoryOf(t, {
		"skills/practice/wordy/SKILL.md":
			"---\nname: wordy\ndescription: >\n  A long description\n  over two lines.\n#disabled: true\nrequires:\n  - quiet\n---\n",
		"skills/practice/quiet/SKILL.md": skill("quiet"),
	});

	assert.deepEqual(inventory.findings, []);
	assert.deepEqual([...inventory.skills.get("wordy").requires], ["quiet"]);
	assert.equal(inventory.skills.get("wordy").disabled, false);
});

test("a broken relative reference in a closure member is a finding; fences and URLs are not", (t) => {
	const { root, inventory } = inventoryOf(t, {
		"skills/practice/refs/SKILL.md": skill("refs", {
			body:
				"See [good](references/good.md) and [gone](references/gone.md).\n" +
				"A [url](https://example.com/x.md) and [anchor](#section) are fine.\n" +
				"```\nA fenced [example](nowhere/at-all.md) is not a reference.\n```\n",
		}),
		"skills/practice/refs/references/good.md": "here\n",
	});

	const findings = validateClosureReferences(inventory, ["refs"], { packageRoot: root });

	assert.equal(findings.length, 1);
	assert.equal(findings[0].reason, "skill-reference-broken");
	assert.equal(findings[0].target, "references/gone.md");
});

test("a reference resolving outside the package is a finding even when it exists", (t) => {
	const outside = makeTree(t, { "loose.md": "outside\n" });
	const { root, inventory } = inventoryOf(t, {
		"skills/practice/refs/SKILL.md": skill("refs", { body: "See [loose](linked.md).\n" }),
	});
	symlinkSync(join(outside, "loose.md"), join(root, "skills", "practice", "refs", "linked.md"));

	const again = readSkillInventory({ packageRoot: root, skillsRoots: [join(root, "skills")] });
	const findings = validateClosureReferences(again, ["refs"], { packageRoot: root });

	assert.equal(findings.length, 1);
	assert.match(findings[0].message, /outside the package root/);
});

// ── The package's own tree is the fixture that keeps this honest ─────────────

test("this package's own builder closure resolves with no findings", () => {
	// Over-strictness is the failure mode this test exists to catch: layer 1
	// runs against the real package at every real preflight, so a validator
	// stricter than the package's own conventions would end every run red.
	const inventory = readSkillInventory({
		packageRoot: REPO_ROOT,
		skillsRoots: [join(REPO_ROOT, "skills")],
	});
	assert.deepEqual(inventory.findings, []);

	for (const entry of ["implement", "review-standards", "review-spec"]) {
		const { closure, findings } = skillClosure(inventory, entry);
		assert.deepEqual(findings, [], `${entry}'s closure does not resolve`);
		assert.ok(closure.includes(entry));
		assert.deepEqual(validateClosureReferences(inventory, closure, { packageRoot: REPO_ROOT }), []);
	}
});
