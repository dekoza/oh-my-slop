import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EFFECT_REGISTRY } from "../../factory/lib/effects/registry.mjs";
import { effectKey, parseEffectKey } from "../../factory/lib/effects/keys.mjs";
import { worktreeTarget } from "../../factory/lib/git/isolation.mjs";
import { paneTarget } from "../../factory/lib/controller/herdr-control.mjs";
import { addressFromOperand } from "../../factory/lib/artifacts/blobs.mjs";
import {
	CLEANUP_KIND_NAMES,
	CLEANUP_KINDS,
	cleanupOperand,
	DEFAULT_CLEANUP_KINDS,
	EXECUTION_ORDER,
	kindsFor,
	OPERATION_BY_KIND,
	PRIVATE_CLONE_KIND,
} from "../../factory/lib/cleanup/targets.mjs";
import { refusalOf } from "./helpers/factory-store.mjs";

/**
 * §12.8's whitelist as a vocabulary: **exactly six default kinds**, the
 * factory-private clone outside them, and one operand grammar per subject so a
 * probe resolves a target through the code that created it.
 */

const RUN = "01JCZ0000000000000000000AB";
const ATTEMPT = `${RUN}-t92-a1`;
const DIGEST = "a".repeat(64);

test("the whitelist is exactly §12.8's six kinds, and the private clone is not among them", () => {
	assert.deepEqual(DEFAULT_CLEANUP_KINDS, [
		"attempt-worktree",
		"attempt-branch",
		"worker-pane",
		"controller-pane",
		"baseline-worktree",
		"orphaned-blob",
	]);
	assert.equal(DEFAULT_CLEANUP_KINDS.length, 6);
	assert.equal(DEFAULT_CLEANUP_KINDS.includes(PRIVATE_CLONE_KIND), false);
	assert.deepEqual(CLEANUP_KIND_NAMES, [...DEFAULT_CLEANUP_KINDS, PRIVATE_CLONE_KIND]);
});

test("a default plan covers every kind and never the private clone; naming it plans that alone", () => {
	// §12.8's "the whole eligible set by default", and its "separate explicit
	// invocation" for the clone — which is separate precisely because a plan that
	// contains it contains nothing else.
	assert.deepEqual(kindsFor(null), DEFAULT_CLEANUP_KINDS);
	assert.deepEqual(kindsFor(PRIVATE_CLONE_KIND), [PRIVATE_CLONE_KIND]);
	assert.deepEqual(kindsFor(CLEANUP_KINDS.workerPane), [CLEANUP_KINDS.workerPane]);
});

test("a kind outside the whitelist is refused rather than narrowed to nothing", () => {
	const error = refusalOf(() => kindsFor("worktrees"));

	assert.equal(error.reason, "cleanup-kind-unknown");
	assert.match(error.message, /whitelist/);
	assert.equal(error.details.found, "worktrees");
});

test("six kinds map onto the four deletion operations §4.5 declares, plus the clone's own", () => {
	// The catalogue keys deletions by the class of thing deleted, because that is
	// the granularity at which the probe differs. Two kinds sharing an operation
	// is the design, not a collision.
	assert.deepEqual(
		DEFAULT_CLEANUP_KINDS.map((kind) => OPERATION_BY_KIND[kind]),
		["worktree-delete", "branch-delete", "pane-delete", "pane-delete", "worktree-delete", "artifact-delete"],
	);

	for (const kind of CLEANUP_KIND_NAMES) {
		assert.ok(EFFECT_REGISTRY.has(OPERATION_BY_KIND[kind]), `${kind} maps onto a registered effect kind`);
		assert.ok(EFFECT_REGISTRY.probeFor(OPERATION_BY_KIND[kind]).call.length > 0, `${kind} has a probe`);
	}
});

test("worktrees are deleted before the branches checked out in them, and the clone last", () => {
	const order = (kind) => EXECUTION_ORDER.indexOf(kind);

	assert.ok(order(CLEANUP_KINDS.attemptWorktree) < order(CLEANUP_KINDS.attemptBranch));
	assert.ok(order(CLEANUP_KINDS.baselineWorktree) < order(CLEANUP_KINDS.attemptBranch));
	assert.equal(EXECUTION_ORDER.at(-1), PRIVATE_CLONE_KIND);
	assert.deepEqual([...EXECUTION_ORDER].sort(), [...CLEANUP_KIND_NAMES].sort());
});

test("every operand round-trips through the module that owns its subject", () => {
	const storeDir = "/state/repo";

	const worktree = cleanupOperand({ kind: CLEANUP_KINDS.attemptWorktree, attempt: ATTEMPT });
	assert.equal(worktreeTarget(storeDir, worktree).path, join(storeDir, "worktrees", ATTEMPT));

	const baseline = cleanupOperand({ kind: CLEANUP_KINDS.baselineWorktree, baseline: "01JBASE" });
	assert.equal(worktreeTarget(storeDir, baseline).path, join(storeDir, "baselines", "01JBASE"));

	assert.deepEqual(paneTarget(cleanupOperand({ kind: CLEANUP_KINDS.workerPane, attempt: ATTEMPT })), {
		kind: "attempt",
		id: ATTEMPT,
		token: "FACTORY_ATTEMPT",
	});
	assert.deepEqual(paneTarget(cleanupOperand({ kind: CLEANUP_KINDS.controllerPane, run: RUN })), {
		kind: "run",
		id: RUN,
		token: "FACTORY_RUN",
	});

	assert.deepEqual(
		addressFromOperand(cleanupOperand({ kind: CLEANUP_KINDS.orphanedBlob, address: { digest: DIGEST } })),
		{ algorithm: "sha256", digest: DIGEST },
	);

	// The clone is the repository's one clone: nothing to discriminate between.
	assert.equal(cleanupOperand({ kind: PRIVATE_CLONE_KIND }), null);
});

test("a blob's operand carries its address without ever being a bare digest (§14.4, §14.28)", () => {
	// §14.28 leaves a blob no handle but its digest, so the key has to carry one;
	// §14.4 refuses a *bare* sha256, which is the spelling the forbidden move —
	// keying an effect by a hash of its own payload — actually takes.
	const operand = cleanupOperand({ kind: CLEANUP_KINDS.orphanedBlob, address: { digest: DIGEST } });

	assert.equal(operand, `sha256/${DIGEST}`);
	assert.notEqual(operand, DIGEST);

	const key = effectKey({ phase: "cleanup", operation: "artifact-delete", operand });
	assert.equal(key, `-/-/cleanup/-/artifact-delete/sha256/${DIGEST}`);
	assert.equal(parseEffectKey(key).operand, operand);

	// The bare form is still refused, so the guard has not been widened away.
	assert.throws(() => effectKey({ phase: "cleanup", operation: "artifact-delete", operand: DIGEST }), {
		reason: "effect-key-invalid",
	});
});

test("every cleanup effect key is repo-scoped, so its record lands on the controller stream (§12.8)", () => {
	// §4.3 refuses a record carrying a run anywhere but that run's own stream, so
	// a run-slotted cleanup effect could not land where §12.8 puts it — and would
	// be deleted by the expiry of the very run whose reclamation it documents.
	for (const kind of CLEANUP_KIND_NAMES) {
		const operand = cleanupOperand({
			kind,
			attempt: ATTEMPT,
			run: RUN,
			baseline: "01JBASE",
			branch: "factory/t92/a" + ATTEMPT,
			address: { digest: DIGEST },
		});
		const key = effectKey({ phase: "cleanup", operation: OPERATION_BY_KIND[kind], operand });
		const parsed = parseEffectKey(key);

		assert.equal(parsed.run, null, `${kind} names a run in its key`);
		assert.equal(parsed.ticket, null, `${kind} names a ticket in its key`);
		assert.equal(parsed.attempt, null, `${kind} names an attempt in its key`);
		assert.equal(parsed.phase, "cleanup");
	}
});

// ── The structural guard (§14.26) ────────────────────────────────────────────

test("no cleanup module can be given a force flag", () => {
	// §14.26 is a *never*, and the way it would be broken is a parameter nobody
	// noticed: `--force` on a git command, a `force` option threaded through the
	// planner. A behavioural test cannot see the flag that has not been passed
	// yet; this reads the tree the invariant is about.
	const root = fileURLToPath(new URL("../../factory/lib/cleanup/", import.meta.url));

	for (const entry of readdirSync(root)) {
		if (!entry.endsWith(".mjs")) continue;
		const source = readFileSync(join(root, entry), "utf8");
		// Prose about the absence is the point of the modules' documentation, so
		// the pattern is the *code* shapes: an argv element and an option name.
		assert.equal(/"--force"|'--force'|\bforce\s*[:=]/.test(source), false, `${entry} admits a force`);
	}
});
