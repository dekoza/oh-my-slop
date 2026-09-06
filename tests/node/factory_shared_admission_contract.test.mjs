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

function operation(request, name, fields = {}) {
	const { contractVersion, authority, owner, epoch } = request;
	return { contractVersion, operation: name, requestId: uuid(20), authority, owner, epoch, ...fields };
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

test("controller waits without a partial grant on busy, unavailable, revision and compatibility refusals", async () => {
	const { request, grant } = scenario();
	for (const fields of [
		{ status: "busy", contenderId: request.contenderId, reason: "resource", cursor: 7 },
		{ status: "unavailable", reason: "authority-unavailable", cursor: null, epoch: null },
		{ status: "unavailable", reason: "ownership-inconclusive", cursor: 7 },
		{ status: "refused", reason: "revision-conflict" },
		{ status: "refused", reason: "stale-owner" },
		{ status: "incompatible", supportedVersions: [2], epoch: null },
	]) {
		const response = reply(request, fields);
		const result = await consume(stub(request, response), request);
		assert.equal(result.status, fields.status);
		assert.equal(Object.hasOwn(result, "grant"), false);
		await assert.rejects(consume(stub(request, { ...response, grant }), request), TypeError);
	}
	await assert.rejects(consume(stub(request, reply(request, { status: "busy", contenderId: uuid(99), reason: "resource", cursor: 7 })), request), TypeError);
	await assert.rejects(consume(stub(request, { ...reply(request, { status: "granted", grant }), contractVersion: 2 }), request), TypeError);
	await assert.rejects(consume(stub(request, reply(request, { status: "refused", reason: "guess-and-retry" })), request), TypeError);
});

test("controller confirms one launch identity and accepts only proven release or fenced recovery", async () => {
	const { request, grant } = scenario();
	const confirm = operation(request, "confirm", { grant });
	const pending = { ...grant, state: "launch-pending", launchId: uuid(6) };
	const result = await consume(stub(confirm, reply(confirm, { status: "launch-authorized", grant: pending })), confirm);
	assert.equal(result.grant.launchId, uuid(6));
	const repeated = operation(request, "confirm", { grant: pending });
	await consume(stub(repeated, reply(repeated, { status: "launch-authorized", grant: pending })), repeated);
	await assert.rejects(consume(stub(repeated, reply(repeated, { status: "launch-authorized", grant: { ...pending, launchId: uuid(7) } })), repeated), TypeError);

	const successor = { ...request.owner, controllerId: uuid(8), generation: 2, token: "f".repeat(32) };
	const reconcile = operation(request, "reconcile", { owner: successor, grant: pending });
	for (const [liveness, recovered, adoptable] of [
		["proven-live", { ...pending, state: "running", owner: successor }, true],
		["proven-live", { ...pending, state: "running" }, false],
		["inconclusive", pending, false],
		["proven-ended", { ...pending, state: "released" }, false],
		["never-launched", { ...pending, state: "released" }, false],
	]) {
		const recovery = await consume(stub(reconcile, reply(reconcile, { status: "reconciled", grant: recovered, liveness, adoptable })), reconcile);
		assert.equal(recovery.liveness, liveness);
		if (["proven-live", "inconclusive"].includes(liveness)) assert.notEqual(recovery.grant.state, "released");
	}
	for (const [liveness, recovered, adoptable] of [
		["proven-live", { ...pending, state: "released" }, false],
		["inconclusive", { ...pending, state: "released" }, false],
		["inconclusive", pending, true],
		["proven-ended", pending, false],
		["proven-live", { ...pending, state: "running" }, true],
	]) await assert.rejects(consume(stub(reconcile, reply(reconcile, { status: "reconciled", grant: recovered, liveness, adoptable })), reconcile), TypeError);

	const release = operation(request, "release", { grant: pending });
	await consume(stub(release, reply(release, { status: "released", grantId: grant.id, evidence: { kind: "proven-ended", observationId: uuid(9) } })), release);
	await assert.rejects(consume(stub(release, reply(release, { status: "released", grantId: grant.id, evidence: { kind: "valid-result", observationId: uuid(9) } })), release), TypeError);
	await assert.rejects(consume(stub(release, reply(release, { status: "released", grantId: uuid(99), evidence: { kind: "proven-ended", observationId: uuid(9) } })), release), TypeError);
	const stale = operation(request, "release", { owner: successor, grant: pending });
	await assert.rejects(consume(stub(stale, reply(stale, { status: "released", grantId: grant.id, evidence: { kind: "proven-ended", observationId: uuid(9) } })), stale), TypeError);
});

test("failed local acquisition or tracker claim cancels the whole grant before another offer", async () => {
	for (const failure of ["ticket-slot", "tracker-claim"]) {
		const { request, grant } = scenario();
		const calls = [];
		const authority = { async exchange(actual) {
			calls.push(actual.operation);
			if (actual.operation === "acquire") return reply(actual, { status: "granted", grant });
			assert.equal(actual.operation, "cancel", "failure must never reach confirm/launch");
			assert.equal(actual.contenderId, grant.contenderId);
			return reply(actual, { status: "cancelled", contenderId: grant.contenderId, grantId: grant.id, evidence: { kind: "never-launched", observationId: uuid(9) } });
		} };
		// Controller-side protocol recipe: local CAS is nonblocking, then claim.
		// The stub is not evidence that a real authority implements compensation.
		const admitted = await consume(authority, request);
		assert.equal(admitted.status, "granted");
		const ticketAcquired = failure !== "ticket-slot";
		const claimWon = ticketAcquired && failure !== "tracker-claim";
		assert.equal(claimWon, false);
		const cancelled = await consume(authority, operation(request, "cancel", { contenderId: admitted.grant.contenderId }));
		assert.equal(cancelled.grantId, grant.id);
		assert.equal(cancelled.evidence.kind, "never-launched");
		assert.deepEqual(calls, ["acquire", "cancel"]);
	}
});

test("waiting is cursor-based and cancellation cannot hide an unresolved grant", async () => {
	const { request, grant } = scenario();
	const wait = operation(request, "wait", { contenderId: request.contenderId, after: 7 });
	for (const cursor of [7, 8]) {
		const result = await consume(stub(wait, reply(wait, { status: "changed", cursor })), wait);
		assert.equal(result.cursor, cursor);
	}
	await assert.rejects(consume(stub(wait, reply(wait, { status: "changed", cursor: 6 })), wait), TypeError);
	const cancel = operation(request, "cancel", { contenderId: request.contenderId });
	await consume(stub(cancel, reply(cancel, { status: "cancelled", contenderId: request.contenderId, grantId: null, evidence: null })), cancel);
	await consume(stub(cancel, reply(cancel, { status: "unavailable", reason: "ownership-inconclusive", cursor: 8 })), cancel);
	await assert.rejects(consume(stub(cancel, reply(cancel, { status: "cancelled", contenderId: request.contenderId, grantId: grant.id, evidence: null })), cancel), TypeError);
	await assert.rejects(consume(stub(cancel, reply(cancel, { status: "cancelled", contenderId: uuid(99), grantId: null, evidence: null })), cancel), TypeError);
});

test("consumer inspects global occupancy without a lease and attaches only at the observed epoch", async () => {
	const { request, grant } = scenario();
	const inspect = { contractVersion: 1, operation: "inspect", requestId: uuid(30), authority: request.authority, repositoryId: request.owner.repositoryId };
	const snapshot = {
		cursor: 12, recovering: true, aggregate: { limit: 0, held: 1 },
		resources: [{ resourceId: "gpu", occupancy: { limit: 0, held: 1 }, availability: { resourceId: "gpu", revision: 3, state: "disabled", retryAfter: null, observationId: null } }],
		grants: [grant], contenders: [{ id: request.contenderId, owner: request.owner, subject: request.subject, offers: ["builder"], state: "suspended", lastGrantSequence: 11, cursor: 12 }],
		policies: [{ repositoryId: request.owner.repositoryId, desiredRevision: "b".repeat(64), appliedRevision: "a".repeat(64), state: "rejected", reason: "invalid-document" }],
	};
	const observed = await consume(stub(inspect, reply(inspect, { status: "snapshot", snapshot, epoch: 2 })), inspect);
	assert.deepEqual(observed.snapshot.aggregate, { limit: 0, held: 1 }, "lowered limits never erase excess occupancy");
	assert.equal(observed.snapshot.contenders[0].lastGrantSequence, 11, "restart retains fair-turn history");
	assert.equal(observed.snapshot.recovering, true);
	const attach = operation(request, "attach", { epoch: observed.epoch });
	await consume(stub(attach, reply(attach, { status: "attached" })), attach);
	await assert.rejects(consume(stub(attach, reply(attach, { status: "attached", epoch: 1 })), attach), TypeError);
	await assert.rejects(consume(stub(inspect, reply(inspect, { status: "snapshot", snapshot: { ...snapshot, aggregate: { limit: 0, held: null } } })), inspect), TypeError);
	await assert.rejects(consume(stub(inspect, reply(inspect, { status: "snapshot", snapshot: { ...snapshot, grants: [{ ...grant, owner: { ...grant.owner, repositoryId: uuid(99) } }] } })), inspect), TypeError);
});

test("a revision race forces applied-policy refresh rather than launch from a stale preview", async () => {
	const { request } = scenario();
	const raced = await consume(stub(request, reply(request, { status: "refused", reason: "revision-conflict" })), request);
	assert.equal(raced.reason, "revision-conflict");
	const refresh = operation(request, "refresh", { policyRequest: request.policy.request });
	const resolution = structuredClone(request.policy.resolution);
	resolution.desiredRevision = resolution.appliedRevision = "f".repeat(64);
	const refreshed = await consume(stub(refresh, reply(refresh, { status: "policy", resolution })), refresh);
	assert.equal(refreshed.resolution.appliedRevision, "f".repeat(64));
	const rejected = { ...resolution, state: "rejected", desiredRevision: "b".repeat(64), policy: null, rejection: { code: "invalid-document", scope: "operator", at: "document", question: null } };
	await consume(stub(refresh, reply(refresh, { status: "policy", resolution: rejected })), refresh);
	await assert.rejects(consume(stub(refresh, reply(refresh, { status: "policy", resolution: { ...resolution, state: "preview", appliedRevision: null } })), refresh), TypeError);
	const preview = { ...request, policy: { ...request.policy, request: { ...request.policy.request, view: "desired" }, resolution: { ...request.policy.resolution, state: "preview", appliedRevision: null } } };
	assert.throws(() => assertAdmissionRequest(preview), TypeError);
});

test("controller receives one indivisible aggregate/resource grant pinned to applied policy", async () => {
	const { request, grant } = scenario();
	const result = await consume(stub(request, reply(request, { status: "granted", grant })), request);
	assert.equal(result.grant.state, "held");
	assert.equal(result.grant.launchId, null, "acquisition alone is not launch authorization");
	assert.equal(result.grant.resourceId, "gpu");
	assert.equal(result.grant.policyRevision, "a".repeat(64));
	assert.deepEqual([result.grant.aggregateSlot, result.grant.resourceSlot], [0, 0]);
});
