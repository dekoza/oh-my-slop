import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * §11.6's mandatory-commands matrix, read **once, at migration**.
 *
 * This is the single sanctioned reading of `AGENTS.md`, and it is deliberately
 * not a runtime one: §8.2 rules out inferring the checks from a manifest, a
 * Makefile, or prose, and §11.6 keeps the config and the document in agreement
 * **by hand** thereafter, with no automated agreement check — that would need
 * exactly the parser §8.2 ruled out. What comes out of here is a draft a human
 * reviews before the file can load at all, because every field the matrix cannot
 * answer is left as a hole.
 */

const AGENTS_FILE_NAME = "AGENTS.md";
const HEADING = /^#{1,6}\s+mandatory commands\s*$/i;

/**
 * `- <label>: \`<command>\``. A bullet with no backticked command is prose about
 * commands rather than one, and prose is what §8.2 refuses to read.
 */
const COMMAND_BULLET = /^[-*]\s+(?<label>[^:]+):\s*`(?<command>[^`]+)`\s*$/;

const BULLET = /^[-*]\s+/;

/**
 * @param {string} repoRoot
 * @returns {{ path: string, commands: Array<{ label: string, command: string }> } | null}
 *   null when there is no matrix to read — an absent document and an empty one
 *   are the same fact, and neither is an excuse to invent a check.
 */
export function readMandatoryCommands(repoRoot) {
	const source = readOrNull(join(repoRoot, AGENTS_FILE_NAME));
	if (source === null) return null;

	const lines = source.split("\n");
	const heading = lines.findIndex((line) => HEADING.test(line.trim()));
	if (heading === -1) return null;

	const commands = firstBulletBlock(lines.slice(heading + 1))
		.map((line) => line.match(COMMAND_BULLET))
		.filter((match) => match !== null)
		.map((match) => ({ label: match.groups.label.trim(), command: match.groups.command.trim() }));

	return commands.length === 0 ? null : { path: AGENTS_FILE_NAME, commands };
}

/**
 * The first run of bullets under the heading, and no later one. The section's
 * later blocks are the targeted minimums — conditional on which surface a change
 * touched, which the `checks` block has no way to express and no business
 * guessing at.
 */
function firstBulletBlock(lines) {
	const block = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (BULLET.test(trimmed)) {
			block.push(trimmed);
			continue;
		}
		if (block.length > 0) break;
		if (trimmed.startsWith("#")) break;
	}

	return block;
}

function readOrNull(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}
