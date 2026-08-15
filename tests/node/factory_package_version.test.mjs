import test from "node:test";
import assert from "node:assert/strict";

import { parseVersionRange, satisfiesVersionRange } from "../../factory/lib/package/version.mjs";
import { refusalOf } from "./helpers/factory-store.mjs";

/**
 * §11.7's declared half: `package.expect.version` is "exact or range", and this
 * is the comparison behind it. The *observed* tree digest is never compared
 * this way — it is not declarable at all.
 */

test("an exact version matches itself and nothing else", () => {
	assert.equal(satisfiesVersionRange("0.1.0", "0.1.0"), true);
	assert.equal(satisfiesVersionRange("0.1.0", "=0.1.0"), true);
	assert.equal(satisfiesVersionRange("0.1.1", "0.1.0"), false);
	assert.equal(satisfiesVersionRange("0.1.0-rc.1", "0.1.0"), false);
});

test("caret and tilde carry their npm meanings, zero-major included", () => {
	// The zero-major rule is the one that matters here: this package is 0.x, and
	// a `^` that widened to 1.0.0 would let a breaking release through the very
	// check that exists to pin the package.
	assert.deepEqual(
		["0.1.0", "0.1.9", "0.2.0", "1.0.0"].map((version) => satisfiesVersionRange(version, "^0.1.0")),
		[true, true, false, false],
	);
	assert.deepEqual(
		["1.2.3", "1.9.0", "2.0.0"].map((version) => satisfiesVersionRange(version, "^1.2.3")),
		[true, true, false],
	);
	assert.deepEqual(
		["1.2.3", "1.2.9", "1.3.0"].map((version) => satisfiesVersionRange(version, "~1.2.3")),
		[true, true, false],
	);
	assert.equal(satisfiesVersionRange("0.0.4", "^0.0.3"), false, "^0.0.x pins the patch");
});

test("comparators combine with a space, alternatives with ||, and * takes anything", () => {
	assert.equal(satisfiesVersionRange("1.5.0", ">=1.2.0 <2.0.0"), true);
	assert.equal(satisfiesVersionRange("2.0.0", ">=1.2.0 <2.0.0"), false);
	assert.equal(satisfiesVersionRange("2.0.0", ">=1.2.0 <2.0.0 || 2.0.0"), true);
	assert.equal(satisfiesVersionRange("9.9.9", "*"), true);
});

test("prereleases order below their release, by precedence", () => {
	assert.equal(satisfiesVersionRange("1.0.0-alpha", "<1.0.0"), true);
	assert.equal(satisfiesVersionRange("1.0.0-alpha.1", ">1.0.0-alpha"), true);
	assert.equal(satisfiesVersionRange("1.0.0-alpha.1", ">1.0.0-alpha.2"), false);
	assert.equal(satisfiesVersionRange("1.0.0+build.7", "1.0.0"), true, "build metadata is not precedence");
});

test("an observed version outside semver satisfies nothing, rather than being ordered by guess", () => {
	// npm requires a package's own `version` to be semver, so this is a broken
	// package rather than a style choice — and the honest answer is a mismatch
	// naming what was found, not an order nobody can compute.
	assert.equal(satisfiesVersionRange("1.0", ">=0.0.1"), false);
	assert.equal(satisfiesVersionRange("", "*"), false);
});

test("a range the factory cannot parse is refused, never treated as matching nothing", () => {
	// "Matches nothing" would reach the operator as a version mismatch they
	// cannot fix by changing the version. §11.2's no-silent-guessing core says
	// the declaration itself is what is wrong.
	for (const range of ["", ">=", "1.2.3 - 2.0.0", "not a version", null]) {
		assert.equal(refusalOf(() => parseVersionRange(range)).reason, "package-expect-invalid");
	}
});
