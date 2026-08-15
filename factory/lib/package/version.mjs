import { FactoryPackageError } from "./errors.mjs";

/**
 * §11.7's `package.expect.version`, which is "exact or range".
 *
 * This is the *declared* half of package pinning, and the only half config may
 * carry: the tree digest stays purely observational, recorded and compared
 * across attempts within a run, never hand-declared. A range is therefore an
 * expectation about the package an operator installed — not a compatibility
 * rule the factory infers, and not something it widens on their behalf.
 *
 * The supported grammar is npm's common subset: `^` · `~` · `>=` · `>` · `<=` ·
 * `<` · `=` · a bare version · `*`, joined by spaces (all of them) and by `||`
 * (any of them). **Anything outside it is refused rather than read loosely**
 * (§11.2) — a hyphen range or an `x` wildcard nobody implemented would
 * otherwise match nothing and reach the operator as a version mismatch they
 * cannot fix by changing the version.
 *
 * Prereleases are ordered by semver precedence (`1.0.0-alpha` < `1.0.0`) and
 * build metadata is ignored, as the specification says. npm's extra rule — that
 * a prerelease satisfies a range only when a comparator names the same triple —
 * is deliberately **not** reproduced: it exists so `npm install` does not
 * surprise a dependent, whereas this compares one declared expectation against
 * one observed package.
 */

/** `major.minor.patch` with optional `-prerelease` and `+build`. */
const VERSION_SHAPE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const OPERATORS = Object.freeze(["^", "~", ">=", "<=", ">", "<", "="]);

/**
 * A version, parsed, or null when it is not one. Null is a legitimate answer:
 * a package may version itself however it likes, and the factory records what
 * it found rather than refusing to describe it.
 *
 * @param {string} version
 * @returns {{ parts: [number, number, number], prerelease: string[] } | null}
 */
function parseVersion(version) {
	const found = typeof version === "string" ? VERSION_SHAPE.exec(version.trim()) : null;
	if (found === null) return null;

	return {
		parts: [Number(found[1]), Number(found[2]), Number(found[3])],
		prerelease: found[4] === undefined ? [] : found[4].split("."),
	};
}

/**
 * A range, parsed into the alternatives it is the union of. Each alternative is
 * a list of comparators every version in it must satisfy.
 *
 * @param {string} range
 * @returns {ReadonlyArray<ReadonlyArray<{ operator: string, version: string }>>}
 * @throws {FactoryPackageError} `package-expect-invalid`
 */
export function parseVersionRange(range) {
	if (typeof range !== "string" || range.trim() === "") refuse(range);

	return Object.freeze(
		range.split("||").map((alternative) => {
			const comparators = alternative.trim().split(/\s+/).filter((token) => token !== "");
			if (comparators.length === 0) refuse(range);

			return Object.freeze(comparators.map((token) => parseComparator(token, range)));
		}),
	);
}

/**
 * Does `version` satisfy `range`?
 *
 * An **observed** version outside semver satisfies nothing. It is a fact about
 * a package rather than a declaration to refuse, so it comes back as a
 * mismatch naming what was found — never as a range quietly deciding an order
 * it cannot compute.
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 * @throws {FactoryPackageError} `package-expect-invalid`
 */
export function satisfiesVersionRange(version, range) {
	const parsed = parseVersion(version);
	const alternatives = parseVersionRange(range);

	return parsed !== null && alternatives.some((alternative) =>
		alternative.every((comparator) => satisfiesComparator(parsed, comparator)),
	);
}

function parseComparator(token, range) {
	if (token === "*") return Object.freeze({ operator: ">=", version: "0.0.0" });

	const operator = OPERATORS.find((candidate) => token.startsWith(candidate)) ?? "=";
	const version = token.slice(operator === "=" && !token.startsWith("=") ? 0 : operator.length).trim();

	// Every comparator names a version the factory can order — npm requires a
	// package's own `version` to be semver, so an expectation that is not one is
	// a typo rather than a package nobody can pin.
	if (parseVersion(version) === null) refuse(range);

	return Object.freeze({ operator, version });
}

function satisfiesComparator(version, { operator, version: bound }) {
	const target = parseVersion(bound);
	const order = compare(version, target);
	switch (operator) {
		case "=":
			return order === 0;
		case ">":
			return order > 0;
		case ">=":
			return order >= 0;
		case "<":
			return order < 0;
		case "<=":
			return order <= 0;
		default:
			// `^` and `~` are a floor plus the ceiling their operator implies.
			return order >= 0 && compare(version, { parts: ceiling(operator, target.parts), prerelease: [] }) < 0;
	}
}

/**
 * npm's ceilings. `^` keeps the leftmost non-zero part, which is what makes
 * `^0.1.0` refuse `0.2.0` — the rule that matters for a 0.x package, where a
 * caret that widened to `1.0.0` would let a breaking release through the check
 * that exists to pin it.
 */
function ceiling(operator, [major, minor, patch]) {
	if (operator === "~") return [major, minor + 1, 0];
	if (major !== 0) return [major + 1, 0, 0];
	if (minor !== 0) return [0, minor + 1, 0];
	return [0, 0, patch + 1];
}

/** Semver precedence: the triple, then prerelease, with build metadata ignored. */
function compare(left, right) {
	for (const [index, part] of left.parts.entries()) {
		if (part !== right.parts[index]) return part < right.parts[index] ? -1 : 1;
	}

	if (left.prerelease.length === 0 || right.prerelease.length === 0) {
		if (left.prerelease.length === right.prerelease.length) return 0;
		return left.prerelease.length === 0 ? 1 : -1;
	}

	for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
		const order = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
		if (order !== 0) return order;
	}

	return 0;
}

function compareIdentifiers(left, right) {
	if (left === right) return 0;
	if (left === undefined) return -1;
	if (right === undefined) return 1;

	const numeric = /^\d+$/;
	if (numeric.test(left) && numeric.test(right)) return Number(left) < Number(right) ? -1 : 1;
	if (numeric.test(left)) return -1;
	if (numeric.test(right)) return 1;
	return left < right ? -1 : 1;
}

function refuse(range) {
	throw new FactoryPackageError(
		"package-expect-invalid",
		`package.expect.version ${JSON.stringify(range ?? null)} is neither a version nor a range this factory ` +
			`compares against (${OPERATORS.join(" ")} or *, joined by spaces or ||).`,
		{ at: "package.expect.version", found: range ?? null },
	);
}
