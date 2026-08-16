import assert from "node:assert/strict";
import test from "node:test";

import {
	createWorkerAdapter,
	unbuiltLifecycleOperations,
	validateRole,
	WORKER_OPERATIONS,
} from "../../factory/lib/worker/adapter.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { PIPELINE_ROLES, rolesInPlay } from "../../factory/lib/worker/roles.mjs";

/**
 * §6.1: one runtime-neutral adapter with four operations, role-parametric, and
 * every pi/Claude difference behind it. The seam is the contract — these tests
 * hold its shape, its refusals, and its ignorance of the role inventory.
 */

function role(overrides = {}) {
	return {
		name: "implement",
		entrySkill: "implement",
		closure: ["implement", "tdd"],
		promptTemplate: null,
		resultExpectations: { statuses: ["completed"] },
		...overrides,
	};
}

function operations(overrides = {}) {
	return {
		preflight: (checked) => ({ ok: true, role: checked.name }),
		launch: () => ({}),
		awaitCompletion: () => ({}),
		cancel: () => ({}),
		...overrides,
	};
}

// ── The contract's shape ─────────────────────────────────────────────────────

test("the contract is exactly four operations", () => {
	assert.deepEqual(WORKER_OPERATIONS, ["preflight", "launch", "awaitCompletion", "cancel"]);
});

test("an adapter missing an operation, or inventing one, is refused at construction", () => {
	for (const missing of WORKER_OPERATIONS) {
		const short = operations();
		delete short[missing];
		assert.throws(
			() => createWorkerAdapter({ kind: "pi", operations: short }),
			(error) => error instanceof FactoryWorkerError && error.reason === "adapter-invalid",
			`an adapter without ${missing}() was accepted`,
		);
	}

	assert.throws(
		() => createWorkerAdapter({ kind: "pi", operations: operations({ resume: () => ({}) }) }),
		/specification change/,
	);
});

test("an adapter names its runtime kind", () => {
	assert.throws(() => createWorkerAdapter({ operations: operations() }), /names its runtime kind/);
	assert.equal(createWorkerAdapter({ kind: "claude", operations: operations() }).kind, "claude");
});

// ── Role-parametricity (§6.1) ────────────────────────────────────────────────

test("preflight validates the role tuple on the way in, and knows no role names", () => {
	const seen = [];
	const adapter = createWorkerAdapter({
		kind: "pi",
		operations: operations({ preflight: (checked, rev) => (seen.push([checked.name, rev]), { ok: true }) }),
	});

	// A name no pipeline declares passes: the seam checks the tuple, never a list.
	adapter.preflight(role({ name: "a-role-nobody-declared", entrySkill: "tdd", closure: ["tdd"] }), "rev-1");
	assert.deepEqual(seen, [["a-role-nobody-declared", "rev-1"]]);
});

test("a role missing one of §6.1's five slots is a typed refusal", () => {
	const adapter = createWorkerAdapter({ kind: "pi", operations: operations() });

	const broken = [
		role({ name: null }),
		role({ name: "Bad Name" }),
		role({ entrySkill: undefined }),
		role({ closure: "tdd" }),
		role({ closure: ["tdd"] }), // entry skill not in its own closure
		role({ promptTemplate: 42 }),
		role({ resultExpectations: null }),
	];
	for (const [index, candidate] of broken.entries()) {
		assert.throws(
			() => adapter.preflight(candidate, "rev-1"),
			(error) => error instanceof FactoryWorkerError && error.reason === "role-invalid",
			`broken role ${index} was accepted`,
		);
	}
});

test("a declaration's null closure is valid to hold and invalid to preflight with", () => {
	const declaration = validateRole(role({ closure: null }));
	assert.equal(declaration.closure, null);

	// The tuple is frozen; attaching a computed closure is a new value, not a mutation.
	assert.throws(() => {
		declaration.closure = ["implement"];
	}, TypeError);
});

// ── The pipeline's role inventory lives with the caller ──────────────────────

test("the pipeline declares four roles, every one a valid §6.1 tuple", () => {
	assert.deepEqual(
		PIPELINE_ROLES.map((declared) => [declared.name, declared.entrySkill]),
		[
			["implement", "implement"],
			["fresh-retry", "implement"],
			["review-standards", "review-standards"],
			["review-spec", "review-spec"],
		],
	);

	for (const declared of PIPELINE_ROLES) {
		const checked = validateRole(declared);
		assert.equal(checked.closure, null, `${declared.name} hardcodes a closure §6.2 computes`);
	}
});

test("rolesInPlay resolves each role to the profiles its routing role reaches", () => {
	const inPlay = rolesInPlay({
		roles: { implement: "builder", freshRetry: "big-builder", review: ["reader", "reader"] },
		rules: [{ labelsAny: ["hard"], role: "implement", profile: "big-builder" }],
	});

	assert.deepEqual(
		inPlay.map((entry) => [entry.name, [...entry.profiles]]),
		[
			["implement", ["big-builder", "builder"]],
			["fresh-retry", ["big-builder"]],
			["review-standards", ["reader"]],
			["review-spec", ["reader"]],
		],
	);
});

// ── The lifecycle refusal (#107's slice) ─────────────────────────────────────

test("the unbuilt lifecycle operations refuse loudly, naming the slice", () => {
	const adapter = createWorkerAdapter({
		kind: "pi",
		operations: { preflight: () => ({ ok: true }), ...unbuiltLifecycleOperations("pi") },
	});

	for (const operation of ["launch", "awaitCompletion", "cancel"]) {
		assert.throws(
			() => adapter[operation]({ attempt: "r1-t42-a1" }),
			(error) => {
				assert.ok(error instanceof FactoryWorkerError);
				assert.equal(error.reason, "worker-lifecycle-unbuilt");
				assert.match(error.message, /#107/);
				assert.equal(error.details.operation, operation);
				return true;
			},
		);
	}
});

test("a lifecycle operation takes an attempt, not nothing", () => {
	const adapter = createWorkerAdapter({ kind: "pi", operations: operations() });
	assert.throws(() => adapter.launch(null), /takes an attempt/);
});
