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
	const request = { contractVersion: 1, repositoryRoot: "/test/repository", routingSet: null, view: "applied" };
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
	if (resolution.state === "preview") return { desiredRevision: resolution.desiredRevision, policy: resolution.policy, appliedRevision: null };
	return resolution.state === "applied"
		? { revision: resolution.appliedRevision, policy: resolution.policy }
		: { waiting: resolution.rejection.code, appliedRevision: resolution.appliedRevision };
}

function stub(request, response) {
	return { async resolve(actual) { assert.deepEqual(actual, request); return structuredClone(response); } };
}

test("value guards accept shared acyclic children but refuse object and array cycles safely", () => {
	const { operator, repository } = scenario();
	operator.profiles.alias = operator.profiles.builder;
	assert.equal(assertOperatorInventory(operator), operator);
	assert.equal(assertRepositoryPolicy(repository, operator), repository);
	for (const cycle of [{}, []]) {
		if (Array.isArray(cycle)) cycle.push(cycle);
		else cycle.self = cycle;
		for (const guard of [
			() => assertOperatorInventory({ ...operator, unexpected: cycle }),
			() => assertRepositoryPolicy({ ...repository, unexpected: cycle }, operator),
		]) assert.throws(guard, { name: "TypeError", message: "Invalid operator-policy v1 contract value" });
	}
});

test("consumer resolves explicit operator policy with repository routing and provenance", async () => {
	const { request, response } = scenario();
	const result = await inspectPolicy(stub(request, response), request);
	assert.equal(result.revision, "a".repeat(64));
	assert.equal(result.policy.operator.operatorId, "test_operator");
	assert.equal(result.policy.repository.routing.roles.implement, "builder");
	assert.deepEqual(result.policy.limits, { aggregate: 1, resources: { gpu: 1 } });
	assert.equal(result.policy.provenance.repositoryFile, "/test/repository/.pi/factory.json");
});

test("doctor can preview desired policy without claiming an authority applied it", async () => {
	const { request, response } = scenario();
	request.view = "desired";
	response.state = "preview";
	response.appliedRevision = null;
	const result = await inspectPolicy(stub(request, response), request);
	assert.equal(result.desiredRevision, "a".repeat(64));
	assert.equal(result.appliedRevision, null);
	assert.deepEqual(result.policy.limits, { aggregate: 1, resources: { gpu: 1 } });
	request.view = "applied";
	await assert.rejects(inspectPolicy(stub(request, response), request), TypeError);
	request.view = "desired";
	response.appliedRevision = response.desiredRevision;
	await assert.rejects(inspectPolicy(stub(request, response), request), TypeError);
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

test("authority loss is not a file revision and neither grants a stale policy", async () => {
	const { request, response } = scenario();
	Object.assign(response, { state: "unavailable", desiredRevision: null, policy: null,
		rejection: { code: "authority-unavailable", scope: "operator", at: "authority", question: null } });
	assert.deepEqual(await inspectPolicy(stub(request, response), request), {
		waiting: "authority-unavailable", appliedRevision: "a".repeat(64),
	});
	response.rejection.code = "source-unavailable";
	await assert.rejects(inspectPolicy(stub(request, response), request), TypeError);
	response.desiredRevision = "e".repeat(64);
	assert.equal((await inspectPolicy(stub(request, response), request)).waiting, "source-unavailable");
	await assert.rejects(inspectPolicy({ async resolve() { throw new Error("transport offline"); } }, request), /transport offline/);
});

test("unknown keys, versions, unresolved references and invalid limits fail closed", () => {
	const invalid = [
		(o) => { o.schemaVersion = 2; },
		(o) => { o.resources.gpu.limit = 1.5; },
		(o) => { o.resources.gpu.enabled = "false"; },
		(o) => { o.resources.gpu.extra = true; },
		(o) => { o.resources.gpu.identity.port = 8000; },
		(o) => { o.bindings.local.resourceId = "missing"; },
		(o) => { o.bindings.local.credentialId = "missing"; },
		(o) => { o.bindings.local.endpoint.url = "http://user:secret@inference.invalid"; },
		(o) => { o.bindings.local.endpoint.url = "http://inference.invalid/?token=secret"; },
		(o) => { o.bindings.local.endpoint.env = "PATH"; },
		(o) => { o.bindings.local.endpoint = null; },
		(o) => { o.profiles.builder.runtime.endpoint = { env: "TEST_URL", url: "http://other.invalid" }; },
		(o) => { o.profiles.builder.runtime.permissionMode = "dontAsk"; },
		(o) => { o.profiles.builder.runtime.effort = "high"; },
		(o) => { o.profiles.builder.runtime.model = "TODO: choose"; },
		(o) => { o.modes.normal.aggregateLimit = 2; },
		(o) => { o.modes.normal.resources.gpu = 2; },
		(o) => { o.modes.dormant = { aggregateLimit: 1, resources: { missing: 1 } }; },
		(o) => { o.activeMode = "missing"; },
		(o) => { o.credentials.bad = { kind: "runtime-auth", runtime: "pi", name: "test_credential", token: "not-a-real-secret" }; },
	];
	for (const mutate of invalid) {
		const { operator } = scenario();
		mutate(operator);
		assert.throws(() => assertOperatorInventory(operator), TypeError);
	}
});

test("same-GPU aliases and ports stay one resource; endpoint equality cannot split it", () => {
	const { operator } = scenario();
	operator.bindings.alias = { ...structuredClone(operator.bindings.local), endpoint: { env: "TEST_INFERENCE_URL", url: "http://alias.invalid:9000" } };
	operator.profiles.alternate = { ...structuredClone(operator.profiles.builder), bindingId: "alias" };
	assert.doesNotThrow(() => assertOperatorInventory(operator));
	operator.resources.second = { ...structuredClone(operator.resources.gpu), identity: { kind: "gpu", hostId: "test_host", deviceId: "second_device" } };
	operator.bindings.alias.resourceId = "second";
	operator.bindings.alias.endpoint.url = "http://inference.invalid:8000/";
	assert.throws(() => assertOperatorInventory(operator), TypeError);
});

test("independent accounts stay independent while shared credentials and quotas cannot split", () => {
	const { operator } = scenario();
	for (const name of ["first", "second"]) {
		operator.resources[name] = { identity: { kind: "account", provider: "test_provider", accountId: name, quotaId: "subscription" }, enabled: false, limit: 0 };
		operator.credentials[name] = { kind: "runtime-auth", runtime: "pi", name };
		operator.bindings[name] = { resourceId: name, credentialId: name, endpoint: null };
	}
	assert.doesNotThrow(() => assertOperatorInventory(operator));
	operator.credentials.second.name = "first";
	assert.throws(() => assertOperatorInventory(operator), TypeError);
	operator.credentials.second.name = "second";
	operator.resources.second.identity.accountId = "first";
	assert.throws(() => assertOperatorInventory(operator), TypeError);
});

test("dormant profiles survive mode changes and all availability reasons are explicit", async () => {
	for (const [mutate, availability, resourceLimit, aggregate] of [
		[(o) => { o.profiles.builder.enabled = false; }, "profile-disabled", 1, 1],
		[(o) => { o.resources.gpu.enabled = false; }, "resource-disabled", 0, 1],
		[(o) => { o.modes.normal.resources = {}; }, "mode-disabled", 0, 1],
		[(o) => { o.modes.normal.resources.gpu = 0; }, "zero-capacity", 0, 1],
		[(o) => { o.modes.normal.aggregateLimit = 0; }, "zero-capacity", 1, 0],
	]) {
		const { request, response, operator } = scenario();
		mutate(operator);
		response.policy.limits = { aggregate, resources: { gpu: resourceLimit } };
		response.policy.profileAvailability.builder = availability;
		const result = await inspectPolicy(stub(request, response), request);
		assert.equal(result.policy.profileAvailability.builder, availability);
	}
});

test("explicit named-set selection is recorded without overriding operator mode", async () => {
	const { request, response, repository } = scenario();
	repository.routing.sets = { chosen: structuredClone(repository.routing) };
	request.routingSet = "chosen";
	response.policy.routingSet = "chosen";
	assert.equal((await inspectPolicy(stub(request, response), request)).policy.operator.activeMode, "normal");
	request.routingSet = null;
	repository.routing.activeSet = "chosen";
	assert.equal((await inspectPolicy(stub(request, response), request)).policy.routingSet, "chosen");
});

test("request overrides and secret-bearing invalid documents do not leak through diagnostics", async () => {
	const { request, operator } = scenario();
	request.activeMode = "other";
	await assert.rejects(inspectPolicy({ resolve() { assert.fail("must not call resolver"); } }, request), TypeError);
	operator.credentials.secret = { kind: "runtime-auth", runtime: "pi", name: "test", "not-a-real-secret": true };
	assert.throws(() => assertOperatorInventory(operator), (error) => {
		assert.equal(error.message, "Invalid operator-policy v1 contract value");
		return true;
	});
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
