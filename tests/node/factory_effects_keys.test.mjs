import test from "node:test";
import assert from "node:assert/strict";

import { PHASES } from "../../factory/lib/domain/vocabulary.mjs";
import { FactoryEffectError } from "../../factory/lib/effects/errors.mjs";
import { commentCarriesEffectKey, effectKey, embedEffectKey, parseEffectKey } from "../../factory/lib/effects/keys.mjs";

/**
 * §4.5's key grammar: `<run>/<ticket>/<phase>/<attempt>/<operation>[/<operand>]`,
 * fixed-arity, with `run`, `ticket`, and `attempt` individually nullable as the
 * reserved literal `-` (§13.C).
 */

test("a fully-specified effect key names run, ticket, phase, attempt, and operation", () => {
	const key = effectKey({
		run: "01JCZ0000000000000000000AB",
		ticket: 92,
		phase: "implement",
		attempt: "01JCZ0000000000000000000AB-t92-a1",
		operation: "label-add",
		operand: "in-progress",
	});

	assert.equal(key, "01JCZ0000000000000000000AB/92/implement/01JCZ0000000000000000000AB-t92-a1/label-add/in-progress");
});

test("a repo-scoped effect still fills every segment, with `-` for the ones it has no value for", () => {
	// An orphaned artifact blob belongs to no run, no ticket, and no attempt
	// (§4.5). A shorter key would be a second grammar, and two grammars cannot
	// share one UNIQUE constraint.
	const key = effectKey({ phase: "cleanup", operation: "artifact-delete", operand: "artifact-blob" });

	assert.equal(key, "-/-/cleanup/-/artifact-delete/artifact-blob");
	assert.equal(key.split("/").length, 6);
});

test("an operand is optional, and the key stays parseable without one", () => {
	const key = effectKey({ run: "01JCZ0000000000000000000AB", ticket: 92, phase: "harvest", operation: "issue-close" });

	assert.equal(key, "01JCZ0000000000000000000AB/92/harvest/-/issue-close");
});

test("the phase segment is §2.2's eight-member closed enum, cleanup and expiry included", () => {
	assert.deepEqual(PHASES, [
		"preflight",
		"implement",
		"harvest",
		"verify",
		"review",
		"integrate",
		"cleanup",
		"expiry",
	]);

	for (const phase of PHASES) {
		assert.equal(effectKey({ phase, operation: "artifact-delete" }).split("/")[2], phase);
	}

	// Free text in the phase slot is what #86 reached for before §13.C widened
	// the enum; the enum stays closed, so it is a refusal rather than a sixth
	// spelling of "cleanup".
	assert.throws(
		() => effectKey({ phase: "tidy-up", operation: "artifact-delete" }),
		(error) => error instanceof FactoryEffectError && error.reason === "effect-key-invalid",
	);
});

test("an identity segment carrying a separator cannot forge a longer key", () => {
	// §2.1's charset is `[0-9A-Za-z-]`, so nothing an identity slot holds can add
	// a segment. Without this, a run id of `a/92/cleanup/-/artifact-delete` names
	// somebody else's effect.
	for (const [field, parts] of [
		["run", { run: "a/92/cleanup", phase: "implement", operation: "issue-close" }],
		["attempt", { attempt: "a/b", phase: "implement", operation: "issue-close" }],
	]) {
		assert.throws(
			() => effectKey(parts),
			(error) => error instanceof FactoryEffectError && error.details.at === field,
			`${field} accepted a separator`,
		);
	}

	assert.throws(
		() => effectKey({ ticket: "92/implement", phase: "implement", operation: "issue-close" }),
		(error) => error instanceof FactoryEffectError && error.details.at === "ticket",
	);
});

test("the operation segment is checked here too, so no caller can forge a longer key", () => {
	// The operation is the one segment a key cannot omit and the one the
	// registry gates at *registration*. Left unchecked at construction, a direct
	// caller of the builder produces `-/-/cleanup/-/a/b/x`, which parses back as
	// operation `a`, operand `b/x` — a key naming an effect nobody requested.
	for (const operation of ["a/b", "", "Label-Add", "label add", undefined]) {
		assert.throws(
			() => effectKey({ phase: "cleanup", operation, operand: "x" }),
			(error) => error instanceof FactoryEffectError && error.details.at === "operation",
			`${JSON.stringify(operation ?? null)} was accepted as an operation`,
		);
	}
});

test("parsing refuses a key it cannot read back, rather than returning NaN", () => {
	for (const key of ["-/abc/cleanup/-/label-add", "-/-/cleanup/-/Label-Add", "-/-/cleanup/-", "-/-/cleanup/-/"]) {
		assert.throws(
			() => parseEffectKey(key),
			(error) => error instanceof FactoryEffectError && error.reason === "effect-key-invalid",
			`${key} parsed without complaint`,
		);
	}
});

test("an operand is the key's last segment, so a natural branch name survives whole", () => {
	// The grammar is fixed-arity with the operand last (§13.C), so a name that
	// contains separators — which every branch this factory pushes does — needs no
	// escaping and no second spelling.
	const key = effectKey({
		run: "01JCZ0000000000000000000AB",
		ticket: 92,
		phase: "integrate",
		operation: "branch-create",
		operand: "factory/t92/a1",
	});

	assert.deepEqual(parseEffectKey(key), {
		run: "01JCZ0000000000000000000AB",
		ticket: 92,
		phase: "integrate",
		attempt: null,
		operation: "branch-create",
		operand: "factory/t92/a1",
	});
});

test("a digest-shaped operand is refused: the key never carries a hash (§14.4)", () => {
	// The digest sits *beside* the key. Hashing the payload into the key would
	// make a conflicting duplicate silently become a different key, and the
	// "same key, different payload ⇒ typed conflict" rule would have nothing
	// left to compare. An artifact write is where the temptation lives: its
	// natural discriminator is the artifact's role, never its content digest.
	assert.throws(
		() =>
			effectKey({
				phase: "harvest",
				operation: "artifact-write",
				operand: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			}),
		(error) => error instanceof FactoryEffectError && error.details.at === "operand",
	);

	assert.equal(
		effectKey({ phase: "harvest", operation: "artifact-write", operand: "review-report" }).split("/").pop(),
		"review-report",
	);
});

test("an operand is short, single-line, and never empty", () => {
	for (const operand of ["", " ", "label\nname", "x".repeat(129)]) {
		assert.throws(
			() => effectKey({ phase: "implement", operation: "label-add", operand }),
			(error) => error instanceof FactoryEffectError && error.details.at === "operand",
			`${JSON.stringify(operand)} was accepted as an operand`,
		);
	}

	// A tracker label is a natural discriminator whatever punctuation it carries.
	assert.doesNotThrow(() => effectKey({ phase: "implement", operation: "label-add", operand: "workflow:implement" }));
});

test("parsing reads the reserved literal back as an absent segment, not as the string `-`", () => {
	assert.deepEqual(parseEffectKey("-/-/expiry/-/artifact-delete"), {
		run: null,
		ticket: null,
		phase: "expiry",
		attempt: null,
		operation: "artifact-delete",
		operand: null,
	});
});

// ── The embedded key comment probes match on (§4.5) ──────────────────────────

test("an embedded key survives an edit to the comment's visible text", () => {
	// Comment bodies are silently editable and deletable (§5.2), so the probe
	// matches the key, not the prose around it.
	const key = effectKey({ run: "01JCZ0000000000000000000AB", ticket: 92, phase: "preflight", operation: "comment-post" });
	const posted = embedEffectKey("Claimed by run 01JCZ0000000000000000000AB.", key);

	assert.ok(posted.startsWith("Claimed by run 01JCZ0000000000000000000AB."));
	assert.ok(commentCarriesEffectKey(posted, key));

	const editedByAHuman = posted.replace("Claimed by run 01JCZ0000000000000000000AB.", "taking this one — DK");
	assert.ok(commentCarriesEffectKey(editedByAHuman, key), "an edit to the visible text lost the effect key");
});

test("matching is exact on the embedded key, never on a marker prefix", () => {
	const key = effectKey({ run: "01JCZ0000000000000000000AB", ticket: 92, phase: "preflight", operation: "comment-post" });
	const body = embedEffectKey("Claimed.", key);

	// A neighbouring key that merely extends ours, and a body that names the key
	// only in its visible text, are both misses. Prefix matching would make the
	// two indistinguishable — the weakest link §4.5 rejects by name.
	assert.equal(commentCarriesEffectKey(body, `${key}/extra`), false);
	assert.equal(commentCarriesEffectKey(embedEffectKey("Claimed.", `${key}/extra`), key), false);
	assert.equal(commentCarriesEffectKey(`Claimed under ${key}.`, key), false);
	assert.equal(commentCarriesEffectKey("Claimed.", key), false);
});
