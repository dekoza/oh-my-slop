import assert from "node:assert/strict";
import test from "node:test";

import { declaredParent, isMemberOf, PART_OF_PATTERN } from "../../factory/lib/tracker/membership.mjs";

/**
 * §3.1: parent-scoped membership is the literal first body line `Part of #N`,
 * matched by one anchored pattern.
 */

test("the literal first body line declares the parent", () => {
	assert.equal(declaredParent("Part of #75\n\n## What to build\n…"), 75);
	assert.equal(declaredParent("Part of #75"), 75);
	assert.equal(declaredParent("Part of #75\r\nbody"), 75);
	// A trailing space is invisible in a tracker's editor; it cannot decide this.
	assert.equal(declaredParent("Part of #75  \nbody"), 75);
});

test("the parent is the number, not the ticket's own position", () => {
	assert.equal(declaredParent("Part of #1\n"), 1);
	assert.equal(declaredParent("Part of #12345\n"), 12345);
});

test("a body that only mentions the parent is not a member", () => {
	assert.equal(declaredParent("This is part of #75, roughly."), null);
	assert.equal(declaredParent("See #75\nPart of #75"), null);
	assert.equal(declaredParent("## Parent\n\nPart of #75"), null);
});

test("the first line is taken literally — a leading blank line is not it", () => {
	assert.equal(declaredParent("\nPart of #75"), null);
	assert.equal(declaredParent("  Part of #75"), null);
});

test("only the anchored shape matches", () => {
	assert.equal(declaredParent("Part of #75 and #76"), null);
	assert.equal(declaredParent("part of #75"), null);
	assert.equal(declaredParent("Part of 75"), null);
	assert.equal(declaredParent("Part of #0"), null);
	assert.equal(declaredParent("Part of #75x"), null);
	assert.equal(declaredParent("Parts of #75"), null);
});

test("a body the tracker did not return is simply not a declaration", () => {
	assert.equal(declaredParent(null), null);
	assert.equal(declaredParent(undefined), null);
	assert.equal(declaredParent(""), null);
});

test("membership is the declaration matching this run's parent", () => {
	const body = "Part of #75\n\n## What to build\n";
	assert.equal(isMemberOf(body, 75), true);
	assert.equal(isMemberOf(body, 76), false);
	assert.equal(isMemberOf("no declaration", 75), false);
});

test("the exported pattern is the contract, not a second copy of it", () => {
	// The pattern is exported so a caller can show an author what to write; it
	// must therefore agree with the function that reads it.
	assert.match("Part of #75", PART_OF_PATTERN);
	assert.equal(PART_OF_PATTERN.test("mentions #75"), false);
});
