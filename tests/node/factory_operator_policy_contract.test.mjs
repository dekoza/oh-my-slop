import test from "node:test";
import assert from "node:assert/strict";

import { assertPolicyRequest, assertPolicyResolution, assertOperatorInventory, assertRepositoryPolicy } from "../../factory/lib/config/operator-policy-v1.mjs";
import { cloneValidConfig } from "./helpers/factory-repo.mjs";

// These are synthetic wire values, never installed operator settings. The stub
// asserts the consumer's request and returns a literal provider-side scenario;
// it deliberately does not implement discovery, application or admission.
function scenario() {
	const repository = cloneValidConfig();
	const runtime = repository.profiles.builder;
	delete repository.profiles;
	delete repository.concurrency.resources;
	repository.schemaVersion = 3;
	repository.operatorId = "test_operator";
	const operator = {
		schemaVersion: 1, operatorId: "test_operator", controllerHostId: "test_controller",
		resources: { gpu: { identity: { kind: "gpu", hostId: "test_host", deviceId: "test_device" }, enabled: true, limit: 1 } },
		bindings: { local: { resourceId: "gpu", credentialId: null, endpoint: { env: "TEST_INFERENCE_URL", url: "http://inference.invalid:8000" } } },
		credentials: {}, profiles: { builder: { enabled: true, bindingId: "local", runtime } },
		aggregateLimit: 1, modes: { normal: { aggregateLimit: 1, resources: { gpu: 1 } } }, activeMode: "normal",
	};
	const request = { contractVersion: 1, repositoryRoot: "/test/repository", routingSet: null };
	const response = {
		contractVersion: 1, state: "applied", desiredRevision: "a".repeat(64), appliedRevision: "a".repeat(64), rejection: null,
		policy: {
			operator, repository, routingSet: null,
			limits: { aggregate: 1, resources: { gpu: 1 } }, profileAvailability: { builder: "enabled" },
			provenance: {
				operatorFile: "/etc/oh-my-slop/factory/operator.json", operatorDigest: "b".repeat(64),
				repositoryFile: "/test/repository/.pi/factory.json", repositoryDigest: "c".repeat(64),
			},
		},
	};
	return { request, response, operator, repository };
}

async function inspectPolicy(resolver, request) {
	assertPolicyRequest(request);
	const resolution = await resolver.resolve(request);
	assertPolicyResolution(resolution, request);
	// A policy read is not a grant. In particular, a rejected revision never
	// hands a stale policy to a consumer, even if appliedRevision is still set.
	return resolution.state === "applied"
		? { revision: resolution.appliedRevision, policy: resolution.policy }
		: { waiting: resolution.rejection.code, appliedRevision: resolution.appliedRevision };
}

function stub(request, response) {
	return { async resolve(actual) { assert.deepEqual(actual, request); return structuredClone(response); } };
}

test("consumer resolves explicit operator policy with repository routing and provenance", async () => {
	const { request, response } = scenario();
	const result = await inspectPolicy(stub(request, response), request);
	assert.equal(result.revision, "a".repeat(64));
	assert.equal(result.policy.operator.operatorId, "test_operator");
	assert.equal(result.policy.repository.routing.roles.implement, "builder");
	assert.deepEqual(result.policy.limits, { aggregate: 1, resources: { gpu: 1 } });
	assert.equal(result.policy.provenance.repositoryFile, "/test/repository/.pi/factory.json");
});

test("consumer retains a disabled resource without accepting dispatchable policy for it", async () => {
	const { request, response, operator } = scenario();
	operator.resources.gpu.enabled = false;
	response.policy.limits.resources.gpu = 0;
	response.policy.profileAvailability.builder = "resource-disabled";
	const result = await inspectPolicy(stub(request, response), request);
	assert.equal(result.policy.profileAvailability.builder, "resource-disabled");
	assert.equal(result.policy.operator.profiles.builder.bindingId, "local");
	response.policy.profileAvailability.builder = "enabled";
	await assert.rejects(inspectPolicy(stub(request, response), request), TypeError);
});

test("consumer exposes conflicting ownership, unknown binding and rejected revisions without stale policy", async () => {
	for (const [code, scope, at] of [
		["ownership-conflict", "repository", "concurrency.resources"],
		["unknown-reference", "operator", "profiles.builder.bindingId"],
		["invalid-document", "operator", "document"],
		["revision-conflict", "repository", "revision"],
	]) {
		const { request, response } = scenario();
		const priorPolicy = response.policy;
		Object.assign(response, { state: "rejected", desiredRevision: "d".repeat(64), policy: null, rejection: { code, scope, at, question: null } });
		const result = await inspectPolicy(stub(request, response), request);
		assert.deepEqual(result, { waiting: code, appliedRevision: "a".repeat(64) });
		response.policy = priorPolicy;
		await assert.rejects(inspectPolicy(stub(request, response), request), TypeError);
	}
});

test("consumer refuses forged limits, stale revisions, wrong provenance and selection", async () => {
	for (const mutate of [
		(r) => { r.policy.limits.aggregate = 2; },
		(r) => { r.policy.limits.resources.gpu = 2; },
		(r) => { r.policy.limits.resources.extra = 1; },
		(r) => { delete r.policy.profileAvailability.builder; },
		(r) => { r.policy.routingSet = "unselected"; },
		(r) => { r.appliedRevision = "d".repeat(64); },
		(r) => { r.policy.provenance.repositoryFile = "/different/.pi/factory.json"; },
		(r) => { r.contractVersion = 2; },
	]) {
		const { request, response } = scenario();
		mutate(response);
		await assert.rejects(inspectPolicy(stub(request, response), request), TypeError);
	}
});

test("repository ownership is closed recursively, including alternate routes and env channels", () => {
	const invalid = [
		["tracker key", (r) => { r.tracker.token = "not-a-real-secret"; }],
		["resource ceiling", (r) => { r.concurrency.resources = { gpu: 9 }; }],
		["profile enablement", (r) => { r.profiles = { builder: { enabled: true } }; }],
		["unknown role profile", (r) => { r.routing.roles.implement = "missing"; }],
		["unknown dormant set profile", (r) => { r.routing.sets = { dormant: { roles: { ...r.routing.roles, implement: "missing" }, rules: [] } }; }],
		["binding env override", (r) => { r.worker = { piExtensions: [{ path: "/test/extension", env: { TEST_INFERENCE_URL: "http://other.invalid" } }] }; }],
		["invalid check", (r) => { delete r.checks[0].expectedFailureExitCodes; }],
		["unknown budget", (r) => { r.budgets.newBudget = 1; }],
		["sentinel", (r) => { r.git.baseBranch = "TODO: choose"; }],
	];
	for (const [name, mutate] of invalid) {
		const { repository, operator } = scenario();
		mutate(repository);
		assert.throws(() => assertRepositoryPolicy(repository, operator), TypeError, name);
	}
});

test("contract refuses unknown bindings and duplicate physical identities even in dormant inventory", () => {
	const { operator } = scenario();
	operator.profiles.builder.bindingId = "missing";
	assert.throws(() => assertOperatorInventory(operator), TypeError);
	operator.profiles.builder.bindingId = "local";
	operator.resources.alias = structuredClone(operator.resources.gpu);
	operator.resources.alias.enabled = false;
	assert.throws(() => assertOperatorInventory(operator), TypeError);
});
