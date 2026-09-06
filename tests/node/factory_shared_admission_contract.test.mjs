import test from "node:test";
import assert from "node:assert/strict";
import { assertAdmissionRequest, assertAdmissionReply } from "../../factory/lib/capacity/shared-admission-v1.mjs";
import { cloneValidConfig } from "./helpers/factory-repo.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runId = "01M06G9WM4J389YE9AQ317GK0B";

// Synthetic values, not installed settings or an allocator. This consumer uses
// the production contract guards, as the eventual repository controller must.
function scenario() {
	const repository = cloneValidConfig();
	const runtime = repository.profiles.builder;
	delete repository.profiles;
	delete repository.concurrency.resources;
	repository.schemaVersion = 3;
	repository.operatorId = "operator";
	const operator = {
		schemaVersion: 1, operatorId: "operator", controllerHostId: "host",
		resources: { gpu: { identity: { kind: "gpu", hostId: "inference", deviceId: "device" }, enabled: true, limit: 1 } },
		bindings: { local: { resourceId: "gpu", credentialId: null, endpoint: { env: "TEST_INFERENCE_URL", url: "http://inference.invalid:8000" } } },
		credentials: {}, profiles: { builder: { enabled: true, bindingId: "local", runtime } },
		aggregateLimit: 1, modes: { normal: { aggregateLimit: 1, resources: { gpu: 1 } } }, activeMode: "normal",
	};
	const policy = {
		request: { contractVersion: 1, repositoryRoot: "/test/repository", routingSet: null, view: "applied" },
		resolution: {
			contractVersion: 1, state: "applied", desiredRevision: "a".repeat(64), appliedRevision: "a".repeat(64), rejection: null,
			policy: {
				operator, repository, routingSet: null, limits: { aggregate: 1, resources: { gpu: 1 } }, profileAvailability: { builder: "enabled" },
				provenance: { operatorFile: "/etc/oh-my-slop/factory/operator.json", operatorDigest: "b".repeat(64), repositoryFile: "/test/repository/.pi/factory.json", repositoryDigest: "c".repeat(64) },
			},
		},
	};
	const request = {
		contractVersion: 1, operation: "acquire", requestId: uuid(1), authority: { operatorId: "operator", controllerHostId: "host" },
		owner: { repositoryId: uuid(2), runId, controllerId: uuid(3), generation: 1, token: "d".repeat(32) }, epoch: 1,
		contenderId: uuid(4), subject: { kind: "attempt", id: `${runId}-t228-a1`, ticket: 228 }, policy, offers: ["builder"],
	};
	const grant = {
		id: uuid(5), token: "e".repeat(32), owner: structuredClone(request.owner), subject: structuredClone(request.subject), contenderId: uuid(4),
		policyRevision: "a".repeat(64), profileId: "builder", bindingId: "local", resourceId: "gpu", aggregateSlot: 0, resourceSlot: 0,
		state: "held", launchId: null,
	};
	return { request, grant };
}

function reply(request, fields) {
	return { contractVersion: 1, operation: request.operation, requestId: request.requestId, epoch: request.epoch ?? 1, ...fields };
}
function stub(expected, response) {
	return { async exchange(actual) { assert.deepEqual(actual, expected); return structuredClone(response); } };
}
async function consume(authority, request) {
	assertAdmissionRequest(request);
	const response = await authority.exchange(request);
	return assertAdmissionReply(response, request);
}

test("controller receives one indivisible aggregate/resource grant pinned to applied policy", async () => {
	const { request, grant } = scenario();
	const result = await consume(stub(request, reply(request, { status: "granted", grant })), request);
	assert.equal(result.grant.state, "held");
	assert.equal(result.grant.launchId, null, "acquisition alone is not launch authorization");
	assert.equal(result.grant.resourceId, "gpu");
	assert.equal(result.grant.policyRevision, "a".repeat(64));
	assert.deepEqual([result.grant.aggregateSlot, result.grant.resourceSlot], [0, 0]);
});
