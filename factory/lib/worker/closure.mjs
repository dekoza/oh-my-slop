import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.2's layer 1: the skill closure, computed mechanically from the pinned
 * revision's `requires:` frontmatter, and the static checks that prove every
 * member is readable, well-formed, and inside the package.
 *
 * **No role knowledge lives here.** The entry skill is a parameter; what this
 * module knows is how to walk a skills root, read a declaration, and close over
 * it — which is exactly what lets the factory stay ignorant of which roles
 * exist (§6.1).
 *
 * Everything wrong is a **finding, not an exception**, in the handshake's
 * pattern: preflight records the findings as a red check, and
 * `assertClosureResolvable` is the one place they become §6.8's typed
 * automation failure. The four conflict classes — shadowed, duplicated,
 * disabled, missing — are one failure with one predicate, and every finding
 * names the offending source.
 */

/** The closed set, so `--json` consumers can branch on a reason. */
export const CLOSURE_FINDING_REASONS = Object.freeze([
	/** Two directories claim one skill name; resolution would be a coin toss. */
	"skill-duplicated",
	/** A `requires:` entry (or an entry skill) no skills root ships. */
	"skill-missing",
	/** A skill whose frontmatter declares `disabled: true` cannot be required. */
	"skill-disabled",
	/** A skill directory or its SKILL.md resolves outside the package root. */
	"skill-escapes-package",
	/** A SKILL.md that exists but cannot be read. */
	"skill-unreadable",
	/** Frontmatter that is absent, unclosed, or missing what §6.2 validates. */
	"skill-frontmatter-invalid",
	/** A relative reference in a closure member's body that resolves to nothing. */
	"skill-reference-broken",
]);

/** The §2.1-adjacent shape a skill name must have to be a directory and a command. */
const SKILL_NAME_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {string} reason one of CLOSURE_FINDING_REASONS
 * @param {string} message operator-facing sentence **naming the offending source**
 * @param {Record<string, unknown>} [details]
 * @returns {Readonly<object>}
 */
export function closureFinding(reason, message, details = {}) {
	if (!CLOSURE_FINDING_REASONS.includes(reason)) {
		throw new Error(`Unknown closure finding reason "${reason}".`);
	}
	return Object.freeze({ reason, message, ...details });
}

/**
 * Every skill the pinned package ships, with its declaration read.
 *
 * The walk recurses until it finds a `SKILL.md`, exactly as pi's discovery does
 * (§6.2's buckets cost nothing), and every directory it settles on is held to
 * the package root by realpath — a symlink wandering out of the package is the
 * finding, not a thing the walk silently follows.
 *
 * @param {{ packageRoot: string, skillsRoots: ReadonlyArray<string> }} where both
 *   come from the §11.7 handshake: the canonicalized root and the skills-root
 *   participants the manifest declares
 * @returns {{ skills: Map<string, object>, findings: ReadonlyArray<object> }}
 */
export function readSkillInventory({ packageRoot, skillsRoots }) {
	const root = realpathOr(packageRoot, packageRoot);
	const skills = new Map();
	const findings = [];

	for (const skillsRoot of skillsRoots) {
		walk(resolve(skillsRoot), { root, skills, findings });
	}

	return { skills, findings: Object.freeze(findings) };
}

function walk(directory, context) {
	const skillMd = join(directory, "SKILL.md");
	if (existsSync(skillMd)) {
		register(directory, skillMd, context);
		return;
	}

	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return; // A skills root that is not there is the handshake's finding, not ours.
	}

	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (entry.name.startsWith(".")) continue;
		const child = join(directory, entry.name);
		if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(child))) walk(child, context);
	}
}

function register(directory, skillMd, { root, skills, findings }) {
	const name = basename(directory);

	const realDir = realpathOr(directory, null);
	const realMd = realpathOr(skillMd, null);
	if (realDir === null || realMd === null || !contains(root, realDir) || !contains(root, realMd)) {
		findings.push(
			closureFinding(
				"skill-escapes-package",
				`Skill "${name}" at ${directory} resolves to ${realMd ?? realDir ?? "(nothing)"}, outside the package root ${root} (§6.2).`,
				{ skill: name, source: directory, resolved: realMd ?? realDir, root },
			),
		);
		return;
	}

	const holder = skills.get(name);
	if (holder !== undefined) {
		findings.push(
			closureFinding(
				"skill-duplicated",
				`Skill "${name}" is shipped twice: ${holder.dir} and ${directory}. A duplicated name cannot resolve uniquely (§6.8).`,
				{ skill: name, source: directory, first: holder.dir },
			),
		);
		return;
	}

	let text;
	try {
		text = readFileSync(skillMd, "utf8");
	} catch (error) {
		findings.push(
			closureFinding("skill-unreadable", `Skill "${name}" has an unreadable ${skillMd}: ${error.message}.`, {
				skill: name,
				source: skillMd,
			}),
		);
		return;
	}

	const declaration = parseFrontmatter(text);
	for (const problem of declarationProblems(name, declaration)) {
		findings.push(
			closureFinding("skill-frontmatter-invalid", `Skill "${name}" at ${skillMd}: ${problem}`, {
				skill: name,
				source: skillMd,
			}),
		);
	}

	skills.set(
		name,
		Object.freeze({
			name,
			dir: realDir,
			skillMd: realMd,
			requires: Object.freeze(declaration.keys.requires ?? []),
			disabled: declaration.keys.disabled === true,
			body: declaration.body,
		}),
	);
}

function declarationProblems(name, declaration) {
	const problems = [...declaration.problems];
	if (declaration.problems.length === 0) {
		const { keys } = declaration;
		if (typeof keys.description !== "string" || keys.description.length === 0) {
			problems.push("frontmatter declares no description.");
		}
		if (keys.name !== undefined && keys.name !== name) {
			problems.push(
				`frontmatter names it "${keys.name}" while the directory names it "${name}" — a skill disagreeing with its own directory is a shadowing hazard.`,
			);
		}
		for (const required of keys.requires ?? []) {
			if (!SKILL_NAME_SHAPE.test(required)) {
				problems.push(`requires "${required}", which is not a usable skill name.`);
			}
		}
	}
	return problems;
}

/**
 * The transitive closure of one entry skill over `requires:`.
 *
 * Cycles are fine — a closure is a set — and every miss is a finding that names
 * the skill that asked, because "review-spec requires a skill nobody ships" is
 * actionable while "something is missing" is not.
 *
 * @param {{ skills: Map<string, object> }} inventory
 * @param {string} entrySkill
 * @returns {{ closure: ReadonlyArray<string>, findings: ReadonlyArray<object> }}
 *   the closure includes the entry skill itself and is sorted for determinism
 */
export function skillClosure(inventory, entrySkill) {
	const findings = [];
	const seen = new Set();
	const pending = [{ name: entrySkill, requiredBy: null }];

	while (pending.length > 0) {
		const { name, requiredBy } = pending.pop();
		if (seen.has(name)) continue;
		seen.add(name);

		const entry = inventory.skills.get(name);
		if (entry === undefined) {
			const asker = requiredBy === null ? "the role's entry declaration" : `${requiredBy.skillMd}`;
			findings.push(
				closureFinding(
					"skill-missing",
					`Skill "${name}" is required by ${asker} and no skills root ships it (§6.2).`,
					{ skill: name, source: asker },
				),
			);
			continue;
		}

		if (entry.disabled) {
			findings.push(
				closureFinding(
					"skill-disabled",
					`Skill "${name}" at ${entry.skillMd} declares disabled: true and cannot be required (§6.8).`,
					{ skill: name, source: entry.skillMd },
				),
			);
		}

		for (const required of entry.requires) {
			pending.push({ name: required, requiredBy: entry });
		}
	}

	return {
		closure: Object.freeze([...seen].filter((name) => inventory.skills.has(name)).sort()),
		findings: Object.freeze(findings),
	};
}

/**
 * §6.2's reference validation, over the closure's own bodies: a relative
 * markdown target must exist, and must stay inside the package. Fenced code is
 * stripped first — a link inside an example is not a reference.
 *
 * @param {{ skills: Map<string, object> }} inventory
 * @param {ReadonlyArray<string>} closure
 * @param {{ packageRoot: string }} where
 * @returns {ReadonlyArray<object>} findings
 */
export function validateClosureReferences(inventory, closure, { packageRoot }) {
	const root = realpathOr(packageRoot, packageRoot);
	const findings = [];

	for (const name of closure) {
		const entry = inventory.skills.get(name);
		if (entry === undefined) continue;

		for (const target of referenceTargets(entry.body)) {
			const candidate = resolve(entry.dir, target);
			const real = realpathOr(candidate, null);
			if (real !== null && contains(root, real)) continue;

			findings.push(
				closureFinding(
					"skill-reference-broken",
					real === null
						? `Skill "${name}" at ${entry.skillMd} references ${target}, which does not exist.`
						: `Skill "${name}" at ${entry.skillMd} references ${target}, which resolves outside the package root.`,
					{ skill: name, source: entry.skillMd, target },
				),
			);
		}
	}

	return Object.freeze(findings);
}

/**
 * §6.8's one predicate, fail closed: any finding — shadowed, duplicated,
 * disabled, missing, or otherwise unprovable — is **one typed automation
 * failure** whose diagnostic names every offending source.
 *
 * @param {ReadonlyArray<object>} findings
 * @returns {ReadonlyArray<object>} the same findings, so it can be used inline
 * @throws {FactoryWorkerError} `skill-conflict`
 */
export function assertClosureResolvable(findings) {
	if (findings.length === 0) return findings;

	throw new FactoryWorkerError(
		"skill-conflict",
		`The skill closure does not resolve uniquely and verifiably to the pinned package revision (§6.8): ${findings
			.map((entry) => entry.message)
			.join(" ")}`,
		{ findings },
	);
}

// ── Frontmatter, read minimally ──────────────────────────────────────────────

/**
 * The subset of YAML the declarations actually use: top-level scalars, block
 * scalars (whose content this module never needs), and one-level lists. A full
 * parser would be a dependency for four keys; anything this cannot read is a
 * `skill-frontmatter-invalid` finding rather than a guess.
 */
function parseFrontmatter(text) {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== "---") {
		return { keys: {}, body: text, problems: ["SKILL.md does not start with frontmatter."] };
	}

	const close = lines.indexOf("---", 1);
	if (close === -1) {
		return { keys: {}, body: text, problems: ["frontmatter is never closed with '---'."] };
	}

	const keys = {};
	const problems = [];
	let listKey = null;

	for (const line of lines.slice(1, close)) {
		if (line.trim() === "" || line.trim().startsWith("#")) continue;

		const item = /^\s+-\s+(.+?)\s*$/.exec(line);
		if (item !== null) {
			if (listKey === null) continue; // an indented list under a block scalar
			keys[listKey].push(item[1]);
			continue;
		}

		if (/^\s/.test(line)) continue; // block-scalar continuation

		const scalar = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (scalar === null) {
			problems.push(`frontmatter line ${JSON.stringify(line)} is not a key this package's declarations use.`);
			listKey = null;
			continue;
		}

		const [, key, rest] = scalar;
		if (rest === "") {
			keys[key] = [];
			listKey = key;
		} else if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
			keys[key] = "(block)";
			listKey = null;
		} else {
			keys[key] = rest === "true" ? true : rest === "false" ? false : rest;
			listKey = null;
		}
	}

	return { keys, body: lines.slice(close + 1).join("\n"), problems };
}

/** Relative markdown targets in a body, fenced code stripped. */
function referenceTargets(body) {
	const targets = [];
	for (const match of stripFences(body).matchAll(/\]\(([^)]+)\)/g)) {
		let target = match[1].trim();
		if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
		const [path] = target.split("#");
		if (path === "" || /^[a-z][a-z0-9+.-]*:/i.test(path)) continue;
		targets.push(decodeURIComponent(path));
	}
	return targets;
}

function stripFences(body) {
	const kept = [];
	let fence = null;
	for (const line of body.split("\n")) {
		const opened = /^(`{3,}|~{3,})/.exec(line.trimStart());
		if (fence !== null) {
			if (opened !== null && opened[1].startsWith(fence)) fence = null;
			continue;
		}
		if (opened !== null) {
			fence = opened[1][0].repeat(3);
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n");
}

// ── Path containment (§2.1's canonicalize-and-assert-prefix) ─────────────────

function contains(root, path) {
	return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function realpathOr(path, fallback) {
	try {
		return realpathSync(path);
	} catch {
		return fallback;
	}
}

function isDirectory(path) {
	try {
		return readdirSync(path) !== null;
	} catch {
		return false;
	}
}
