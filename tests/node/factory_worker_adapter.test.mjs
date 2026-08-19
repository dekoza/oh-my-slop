import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerAdapter, validateRole, WORKER_OPERATIONS } from "../../factory/lib/worker/adapter.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { lifecycleOperations } from "../../factory/lib/worker/lifecycle.mjs";
import { PIPELINE_ROLES, postureOf, profileForRole, REVIEW_ROLES, rolesInPlay } from "../../factory/lib/worker/roles.mjs";

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
		assert.equal(
			typeof checked.promptTemplate,
			"function",
			`${declared.name} carries no §6.4 template, so nothing could render its first prompt`,
		);
	}
});

test("a role's posture derives from the role, and an unknown name is refused (§6.8, §11.4)", () => {
	assert.deepEqual(
		PIPELINE_ROLES.map((declared) => [declared.name, postureOf(declared)]),
		[
			["implement", "builder"],
			["fresh-retry", "builder"],
			["review-standards", "reviewer"],
			["review-spec", "reviewer"],
		],
	);
	assert.equal(postureOf("review-spec"), "reviewer", "the name alone answers, for a caller that has only that");

	// Answering "builder" for an unrecognised name would hand the edit tools to
	// whatever asked — the one direction this must not guess in.
	assert.throws(() => postureOf("final-review"), (error) => {
		assert.equal(error.reason, "role-invalid");
		return true;
	});
});

test("REVIEW_ROLES is §8.4's two axes, in the order §11.5's pair is written in", () => {
	assert.deepEqual(
		REVIEW_ROLES.map((axis) => axis.name),
		["review-standards", "review-spec"],
	);
	for (const axis of REVIEW_ROLES) {
		assert.deepEqual(axis.resultExpectations.verdicts, ["approve", "reject"]);
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

test("a role's reroute order is in play too: #164's proof covers what a quota blip makes the only way forward (#155)", () => {
	const inPlay = rolesInPlay({
		roles: { implement: "builder", freshRetry: "builder", review: ["reader", "reader"] },
		rules: [],
		fallbacks: { implement: ["cloud"], freshRetry: [], review: [["cloud-a"], ["cloud-b"]] },
	});

	assert.deepEqual(
		inPlay.map((entry) => [entry.name, [...entry.profiles]]),
		[
			["implement", ["builder", "cloud"]],
			["fresh-retry", ["builder"]],
			// §11.5 binds the pair to the phase, so both axes carry the whole review
			// reach — which axis lands on which profile is dispatch's decision.
			["review-standards", ["cloud-a", "cloud-b", "reader"]],
			["review-spec", ["cloud-a", "cloud-b", "reader"]],
		],
	);
});

// ── Dispatch: `labelsAny × role → profile` (§11.5) ───────────────────────────

/** A routing whose three roles are declared, as §11.5 requires all of them to be. */
function routing(overrides = {}) {
	return {
		roles: { implement: "builder", freshRetry: "big-builder", review: ["reader", "reader"] },
		rules: [],
		...overrides,
	};
}

test("a role with no matching rule takes its declared profile (§11.5)", () => {
	assert.equal(profileForRole(routing(), { role: "freshRetry", labels: ["area:db"] }), "big-builder");
	// The declared value is answered as declared, whatever shape it is — §11.5's
	// `review` pair passes through rather than being unwrapped or expanded here.
	assert.deepEqual(profileForRole(routing(), { role: "review", labels: [] }), ["reader", "reader"]);
});

test("a rule matching any one of its labels wins over the declared profile (§11.5)", () => {
	const active = routing({ rules: [{ labelsAny: ["risk:high", "risk:critical"], role: "freshRetry", profile: "opus" }] });

	assert.equal(profileForRole(active, { role: "freshRetry", labels: ["area:db", "risk:critical"] }), "opus");
	assert.equal(
		profileForRole(active, { role: "implement", labels: ["risk:critical"] }),
		"builder",
		"a rule routes the role it names and no other",
	);
});

test("a ticket matching two rules for one role is a ticket-scoped automation failure (§11.5)", () => {
	// Not a load error: the two label sets are disjoint, so the loader's static
	// overlap check passes and only a ticket carrying both can reach this.
	const active = routing({
		rules: [
			{ labelsAny: ["risk:high"], role: "freshRetry", profile: "opus" },
			{ labelsAny: ["area:db"], role: "freshRetry", profile: "sonnet" },
		],
	});

	assert.throws(
		() => profileForRole(active, { role: "freshRetry", labels: ["risk:high", "area:db"] }),
		(error) => {
			assert.ok(error instanceof FactoryWorkerError);
			assert.equal(error.reason, "routing-ambiguous");
			assert.deepEqual(error.details.profiles, ["opus", "sonnet"]);
			return true;
		},
	);
});

test("an undeclared role is refused, never filled in from another role (§11.5)", () => {
	const active = routing();
	delete active.roles.freshRetry;

	assert.throws(
		() => profileForRole(active, { role: "freshRetry", labels: [] }),
		(error) => {
			assert.equal(error.reason, "routing-ambiguous");
			assert.match(error.message, /freshRetry/);
			assert.doesNotMatch(
				error.message,
				/"builder"/,
				"an implicit freshRetry = implement is the silent runtime-policy guess §11.5 refuses",
			);
			return true;
		},
	);
});

// ── The lifecycle binding (§6.1, §6.4) ───────────────────────────────────────

test("a runtime binds the lifecycle by naming its agent kind, and nothing more", async () => {
	// What this holds is the *binding*: three operations, whatever the runtime,
	// with the runtime's two values and the builder's defaults merged under the
	// attempt — so nothing downstream has to ask which runtime it is running.
	for (const runtime of ["pi", "claude"]) {
		const bound = lifecycleOperations({ runtime, agentKind: runtime }, { socket: "/run/herdr.sock" });
		assert.deepEqual(Object.keys(bound).sort(), ["awaitCompletion", "cancel", "launch"]);

		const adapter = createWorkerAdapter({ kind: runtime, operations: { preflight: () => ({ ok: true }), ...bound } });
		await assert.rejects(
			() => adapter.launch({ store: null, identity: { run: "r", ticket: 1, phase: "implement", attempt: "x" } }),
			(error) => {
				assert.ok(error instanceof FactoryWorkerError, "a bad tuple is a typed worker refusal, not a TypeError");
				assert.equal(error.reason, "attempt-identity-invalid");
				return true;
			},
		);
	}
});

test("a lifecycle operation takes an attempt, not nothing", () => {
	const adapter = createWorkerAdapter({ kind: "pi", operations: operations() });
	assert.throws(() => adapter.launch(null), /takes an attempt/);
});
