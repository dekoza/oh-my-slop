import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { readMandatoryCommands } from "../../factory/lib/migrate/matrix.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";

const MATRIX = `# AGENTS.md

Some preamble.

## Mandatory commands

Run these commands when you touch the related areas. Do not skip them.

- Full Python test suite: \`uv run pytest\`
- Markdown reference validator: \`uv run python scripts/validate_refs.py\`
- Node extension tests: \`node --test tests/node/*.mjs\`

Targeted minimums:

- Any change under \`skills/\`: \`uv run pytest tests/test_skill_frontmatter.py\`

## Repo-specific rules
`;

function repoWith(t, agents) {
	const root = makeRepo(t);
	if (agents !== null) writeFileSync(join(root, "AGENTS.md"), agents, "utf8");
	return root;
}

test("§11.6: the mandatory-commands matrix is the first bullet block under its heading", (t) => {
	const matrix = readMandatoryCommands(repoWith(t, MATRIX));

	assert.equal(matrix.path, "AGENTS.md");
	assert.deepEqual(matrix.commands, [
		{ label: "Full Python test suite", command: "uv run pytest" },
		{ label: "Markdown reference validator", command: "uv run python scripts/validate_refs.py" },
		{ label: "Node extension tests", command: "node --test tests/node/*.mjs" },
	]);
});

test("§11.6: the targeted minimums are not the matrix — they are conditional on what was touched", (t) => {
	const matrix = readMandatoryCommands(repoWith(t, MATRIX));

	assert.equal(
		matrix.commands.some((entry) => entry.command.includes("test_skill_frontmatter")),
		false,
	);
});

test("§11.6: no AGENTS.md, or no such heading, reads as no matrix rather than as an empty one", (t) => {
	assert.equal(readMandatoryCommands(repoWith(t, null)), null);
	assert.equal(readMandatoryCommands(repoWith(t, "# AGENTS.md\n\n## Repo-specific rules\n")), null);
});
