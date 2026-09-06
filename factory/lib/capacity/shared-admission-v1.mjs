import { assertPolicyRequest, assertPolicyResolution } from "../config/operator-policy-v1.mjs";

/**
 * Consumer-owned wire contract, §9.10 / #228. These guards authenticate nothing
 * and perform no IO. They return the input intact; consumers must preserve an
 * immutable snapshot. Runtime admission/launch/recovery is deliberately absent.
 * docs/specs/shared-admission-v1.md owns the protocol and deployment obligations.
 * A reply lost after commit is unknown success, never an implicit busy result.
 */
export const ADMISSION_CONTRACT_VERSION = 1;
export const ADMISSION_AUTHORITY_ROOT = "/var/lib/oh-my-slop/factory/authority";
export const ADMISSION_RENDEZVOUS = "/run/oh-my-slop/factory/admission";

const BUSY_REASONS = ["aggregate", "resource", "fair-turn", "readmission-in-flight"];
const UNAVAILABLE_REASONS = ["authority-unavailable", "ownership-inconclusive", "policy-unavailable", "resource-disabled", "exhausted", "authentication", "endpoint-outage", "no-eligible-route"];
const REFUSAL_REASONS = ["identity-mismatch", "boundary-unproven", "stale-owner", "epoch-mismatch", "revision-conflict", "payload-conflict", "invalid-transition", "unknown-grant"];

function requireThat(condition) {
	// Do not embed values: invalid fields can contain credentials or capability tokens.
	if (!condition) throw new TypeError("Invalid shared-admission v1 contract value");
}
function keys(value, names) {
	requireThat(value !== null && typeof value === "object" && !Array.isArray(value));
	requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
	requireThat(Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name)));
}
function pattern(value, expression) { requireThat(typeof value === "string" && expression.test(value)); }
function id(value) { pattern(value, /^[a-z][a-z0-9_-]{0,31}$/); }
function uuid(value) { pattern(value, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/); }
function revision(value) { pattern(value, /^[a-f0-9]{64}$/); }
function token(value) { pattern(value, /^[a-f0-9]{32}$/); }
function integer(value) { requireThat(Number.isSafeInteger(value) && value >= 0); }
function positive(value) { integer(value); requireThat(value > 0); }
function member(value, choices) { requireThat(choices.includes(value)); }
function list(value, check) { requireThat(Array.isArray(value)); value.forEach(check); }
function unique(value, check) { list(value, check); requireThat(value.length > 0 && new Set(value).size === value.length); }
function same(left, right) {
	// Structural correlation only, NOT authentication of a bearer token. The
	// authority verifies capabilities with constant-time comparison at its gate.
	if (left === null || typeof left !== "object") return left === right;
	return right !== null && typeof right === "object" && Object.keys(left).length === Object.keys(right).length
		&& Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
}
function owner(value) {
	keys(value, ["repositoryId", "runId", "controllerId", "generation", "token"]);
	uuid(value.repositoryId); uuid(value.controllerId); positive(value.generation); token(value.token);
	pattern(value.runId, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
}
function subject(value, holder) {
	if (value?.kind === "attempt") {
		keys(value, ["kind", "id", "ticket"]); positive(value.ticket);
		pattern(value.id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}-t[1-9][0-9]*-a[1-9][0-9]*$/);
		requireThat(value.id.startsWith(`${holder.runId}-t${value.ticket}-a`));
	} else {
		keys(value, ["kind", "id", "purpose"]); requireThat(value.kind === "probe");
		uuid(value.id); member(value.purpose, ["preflight", "readmission"]);
	}
}
function grant(value) {
	keys(value, ["id", "token", "owner", "subject", "contenderId", "policyRevision", "profileId", "bindingId", "resourceId", "aggregateSlot", "resourceSlot", "state", "launchId"]);
	uuid(value.id); token(value.token); owner(value.owner); subject(value.subject, value.owner); uuid(value.contenderId);
	revision(value.policyRevision); id(value.profileId); id(value.bindingId); id(value.resourceId);
	integer(value.aggregateSlot); integer(value.resourceSlot);
	member(value.state, ["held", "launch-pending", "running", "released"]);
	if (value.launchId !== null) uuid(value.launchId);
	if (value.state === "held") requireThat(value.launchId === null);
	if (["launch-pending", "running"].includes(value.state)) requireThat(value.launchId !== null);
}
function policy(value, authority) {
	keys(value, ["request", "resolution"]);
	assertPolicyResolution(value.resolution, value.request);
	requireThat(value.request.view === "applied" && value.resolution.state === "applied");
	const operator = value.resolution.policy.operator;
	requireThat(operator.operatorId === authority.operatorId && operator.controllerHostId === authority.controllerHostId);
}
function availability(value) {
	keys(value, ["resourceId", "revision", "state", "retryAfter", "observationId"]);
	id(value.resourceId); integer(value.revision);
	member(value.state, ["available", "disabled", "exhausted", "authentication", "endpoint-outage", "inconclusive"]);
	if (value.retryAfter !== null) integer(value.retryAfter);
	if (value.observationId !== null) uuid(value.observationId);
}
function occupancy(value) { keys(value, ["limit", "held"]); integer(value.limit); integer(value.held); }
function distinctRows(rows, key) { requireThat(new Set(rows.map((row) => row[key])).size === rows.length); }
function snapshot(value, repositoryId) {
	keys(value, ["cursor", "recovering", "aggregate", "resources", "grants", "contenders", "policies"]);
	integer(value.cursor); requireThat(typeof value.recovering === "boolean"); occupancy(value.aggregate);
	list(value.resources, (resource) => {
		keys(resource, ["resourceId", "occupancy", "availability"]); id(resource.resourceId);
		occupancy(resource.occupancy); availability(resource.availability);
		requireThat(resource.resourceId === resource.availability.resourceId);
	});
	list(value.grants, (value) => { grant(value); if (repositoryId !== null) requireThat(value.owner.repositoryId === repositoryId); });
	list(value.contenders, (contender) => {
		keys(contender, ["id", "owner", "subject", "offers", "state", "reason", "lastGrantSequence", "cursor"]);
		uuid(contender.id); owner(contender.owner); subject(contender.subject, contender.owner); unique(contender.offers, id);
		member(contender.state, ["waiting", "suspended", "cancelled"]);
		if (contender.state === "cancelled") requireThat(contender.reason === null);
		else member(contender.reason, contender.state === "waiting" ? BUSY_REASONS : [...UNAVAILABLE_REASONS, ...REFUSAL_REASONS]);
		integer(contender.lastGrantSequence); integer(contender.cursor);
		requireThat(contender.lastGrantSequence <= value.cursor && contender.cursor <= value.cursor);
		if (repositoryId !== null) requireThat(contender.owner.repositoryId === repositoryId);
	});
	list(value.policies, (policy) => {
		keys(policy, ["repositoryId", "desiredRevision", "appliedRevision", "state", "reason"]); uuid(policy.repositoryId);
		if (repositoryId !== null) requireThat(policy.repositoryId === repositoryId);
		if (policy.desiredRevision !== null) revision(policy.desiredRevision);
		if (policy.appliedRevision !== null) revision(policy.appliedRevision);
		member(policy.state, ["applied", "rejected", "unavailable"]);
		if (policy.state === "applied") requireThat(policy.reason === null && policy.appliedRevision !== null && policy.appliedRevision === policy.desiredRevision);
		else member(policy.reason, ["invalid-document", "unsupported-version", "ownership-conflict", "unknown-reference", "ambiguous-binding", "identity-mismatch", "boundary-unproven", "revision-conflict", "source-unavailable", "authority-unavailable"]);
	});
	for (const [name, key] of [["resources", "resourceId"], ["grants", "id"], ["contenders", "id"], ["policies", "repositoryId"]]) distinctRows(value[name], key);
}
function endEvidence(value) {
	keys(value, ["kind", "observationId"]); member(value.kind, ["never-launched", "proven-ended"]); uuid(value.observationId);
}
function retainedGrant(value, previous) {
	grant(previous);
	for (const key of Object.keys(previous)) {
		if (["owner", "state", "launchId"].includes(key)) continue;
		requireThat(same(value[key], previous[key]));
	}
	if (previous.launchId !== null) requireThat(value.launchId === previous.launchId);
	if (previous.state === "released") requireThat(value.state === "released");
}
const REQUEST_BASE = ["contractVersion", "operation", "requestId", "authority"];
const MUTATION_BASE = [...REQUEST_BASE, "owner", "epoch"];
const REPLY_BASE = ["contractVersion", "operation", "requestId", "epoch", "status"];

/** Validate the controller's request before it reaches an authority. */
export function assertAdmissionRequest(request) {
	const fields = {
		acquire: ["contenderId", "subject", "policy", "offers"],
		readmit: ["contenderId", "subject", "policy", "offers", "availabilityRevision"],
		confirm: ["grant"], release: ["grant"], reconcile: ["grant"], observe: ["grant", "observation"],
		wait: ["contenderId", "after"], cancel: ["contenderId"], inspect: ["repositoryId"], attach: [], refresh: ["policyRequest"],
	};
	requireThat(request?.contractVersion === ADMISSION_CONTRACT_VERSION && Object.hasOwn(fields, request.operation));
	keys(request, [...(request.operation === "inspect" ? REQUEST_BASE : MUTATION_BASE), ...fields[request.operation]]);
	uuid(request.requestId); keys(request.authority, ["operatorId", "controllerHostId"]);
	id(request.authority.operatorId); id(request.authority.controllerHostId);
	if (request.operation === "inspect") {
		if (request.repositoryId !== null) uuid(request.repositoryId);
		return request;
	}
	owner(request.owner); positive(request.epoch);
	if (request.operation === "attach") return request;
	if (request.operation === "refresh") {
		assertPolicyRequest(request.policyRequest); requireThat(request.policyRequest.view === "applied");
		return request;
	}
	if (["wait", "cancel"].includes(request.operation)) {
		uuid(request.contenderId);
		if (request.operation === "wait") integer(request.after);
		return request;
	}
	if (Object.hasOwn(request, "grant")) {
		grant(request.grant);
		if (request.operation === "reconcile") {
			requireThat(request.grant.owner.repositoryId === request.owner.repositoryId && request.grant.owner.runId === request.owner.runId);
		} else requireThat(same(request.grant.owner, request.owner));
		if (request.operation === "confirm") member(request.grant.state, ["held", "launch-pending"]);
		if (request.operation === "observe") {
			const value = request.observation;
			keys(value, ["id", "kind", "source", "evidenceDigest", "retryAfter"]);
			uuid(value.id); member(value.kind, ["exhausted", "authentication", "endpoint-outage"]);
			member(value.source, ["harness", "transport"]); revision(value.evidenceDigest);
			if (value.retryAfter !== null) integer(value.retryAfter);
		}
		return request;
	}
	uuid(request.contenderId); subject(request.subject, request.owner); policy(request.policy, request.authority);
	unique(request.offers, id);
	for (const profile of request.offers) requireThat(request.policy.resolution.policy.profileAvailability[profile] === "enabled");
	if (request.operation === "readmit") {
		integer(request.availabilityRevision);
		requireThat(request.subject.kind === "probe" && request.subject.purpose === "readmission" && request.offers.length === 1);
	} else requireThat(request.subject.purpose !== "readmission");
	return request;
}

/** Validate correlation and safety properties, not external evidence truth. */
export function assertAdmissionReply(reply, request) {
	assertAdmissionRequest(request);
	requireThat(reply?.contractVersion === ADMISSION_CONTRACT_VERSION && reply.operation === request.operation && reply.requestId === request.requestId);
	if (reply.epoch !== null) positive(reply.epoch);
	else requireThat(reply.status === "incompatible" || (reply.status === "unavailable" && reply.reason === "authority-unavailable"));
	if (reply.status === "incompatible") {
		keys(reply, [...REPLY_BASE, "supportedVersions"]); unique(reply.supportedVersions, positive);
		return reply;
	}
	if (reply.status === "unavailable") {
		keys(reply, [...REPLY_BASE, "reason", "cursor"]);
		member(reply.reason, UNAVAILABLE_REASONS);
		if (reply.cursor !== null) integer(reply.cursor);
		return reply;
	}
	if (reply.status === "refused") {
		keys(reply, [...REPLY_BASE, "reason"]);
		member(reply.reason, REFUSAL_REASONS);
		return reply;
	}
	if (reply.status === "snapshot") {
		requireThat(request.operation === "inspect"); keys(reply, [...REPLY_BASE, "snapshot"]);
		snapshot(reply.snapshot, request.repositoryId);
		return reply;
	}
	requireThat(reply.epoch === request.epoch);
	if (reply.status === "attached") {
		requireThat(request.operation === "attach"); keys(reply, REPLY_BASE);
		return reply;
	}
	if (reply.status === "policy") {
		requireThat(request.operation === "refresh"); keys(reply, [...REPLY_BASE, "resolution"]);
		assertPolicyResolution(reply.resolution, request.policyRequest);
		if (reply.resolution.state === "applied") policy({ request: request.policyRequest, resolution: reply.resolution }, request.authority);
		return reply;
	}
	if (reply.status === "changed") {
		requireThat(request.operation === "wait"); keys(reply, [...REPLY_BASE, "cursor"]);
		integer(reply.cursor); requireThat(reply.cursor >= request.after);
		return reply;
	}
	if (reply.status === "cancelled") {
		requireThat(request.operation === "cancel"); keys(reply, [...REPLY_BASE, "contenderId", "grantId", "evidence"]);
		requireThat(reply.contenderId === request.contenderId);
		if (reply.grantId === null) requireThat(reply.evidence === null);
		else { uuid(reply.grantId); endEvidence(reply.evidence); }
		return reply;
	}
	if (reply.status === "observed") {
		requireThat(request.operation === "observe"); keys(reply, [...REPLY_BASE, "availability"]);
		availability(reply.availability);
		requireThat(reply.availability.resourceId === request.grant.resourceId && reply.availability.state !== "available");
		return reply;
	}
	if (reply.status === "released") {
		requireThat(request.operation === "release"); keys(reply, [...REPLY_BASE, "grantId", "evidence"]);
		requireThat(reply.grantId === request.grant.id); endEvidence(reply.evidence);
		if (request.grant.state === "running") requireThat(reply.evidence.kind === "proven-ended");
		return reply;
	}
	if (reply.status === "launch-authorized" || reply.status === "reconciled") {
		keys(reply, [...REPLY_BASE, "grant", ...(reply.status === "reconciled" ? ["liveness", "adoptable"] : [])]);
		grant(reply.grant); retainedGrant(reply.grant, request.grant);
		if (reply.status === "launch-authorized") {
			requireThat(request.operation === "confirm" && reply.grant.state === "launch-pending");
			requireThat(same(reply.grant.owner, request.owner));
		} else {
			requireThat(request.operation === "reconcile");
			member(reply.liveness, ["proven-live", "proven-ended", "never-launched", "inconclusive"]);
			if (request.grant.state === "running") requireThat(reply.liveness !== "never-launched");
			requireThat(typeof reply.adoptable === "boolean");
			if (["proven-ended", "never-launched"].includes(reply.liveness)) requireThat(reply.grant.state === "released" && !reply.adoptable);
			else requireThat(reply.grant.state !== "released");
			if (reply.liveness === "proven-live") requireThat(reply.grant.state === "running");
			if (reply.adoptable) requireThat(reply.liveness === "proven-live" && same(reply.grant.owner, request.owner));
			else requireThat(same(reply.grant.owner, request.grant.owner));
		}
		return reply;
	}
	if (reply.status === "busy") {
		member(request.operation, ["acquire", "readmit"]);
		keys(reply, [...REPLY_BASE, "contenderId", "reason", "cursor"]);
		requireThat(reply.contenderId === request.contenderId);
		member(reply.reason, BUSY_REASONS); integer(reply.cursor);
		return reply;
	}
	keys(reply, [...REPLY_BASE, "grant"]);
	requireThat(reply.status === "granted"); member(request.operation, ["acquire", "readmit"]);
	grant(reply.grant);
	const value = reply.grant;
	requireThat(same(value.owner, request.owner) && same(value.subject, request.subject));
	requireThat(value.contenderId === request.contenderId && value.state === "held");
	const { resolution } = request.policy;
	const selected = resolution.policy.operator.profiles[value.profileId];
	requireThat(request.offers.includes(value.profileId) && value.policyRevision === resolution.appliedRevision);
	requireThat(value.bindingId === selected.bindingId && value.resourceId === resolution.policy.operator.bindings[value.bindingId].resourceId);
	requireThat(value.aggregateSlot < resolution.policy.limits.aggregate && value.resourceSlot < resolution.policy.limits.resources[value.resourceId]);
	return reply;
}
