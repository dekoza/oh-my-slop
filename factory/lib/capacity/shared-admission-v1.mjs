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
const REQUEST_BASE = ["contractVersion", "operation", "requestId", "authority"];
const MUTATION_BASE = [...REQUEST_BASE, "owner", "epoch"];
const REPLY_BASE = ["contractVersion", "operation", "requestId", "epoch", "status"];

/** Validate the controller's request before it reaches an authority. */
export function assertAdmissionRequest(request) {
	keys(request, [...MUTATION_BASE, "contenderId", "subject", "policy", "offers"]);
	requireThat(request.contractVersion === ADMISSION_CONTRACT_VERSION && request.operation === "acquire");
	uuid(request.requestId); keys(request.authority, ["operatorId", "controllerHostId"]);
	id(request.authority.operatorId); id(request.authority.controllerHostId);
	owner(request.owner); positive(request.epoch);
	uuid(request.contenderId); subject(request.subject, request.owner); policy(request.policy, request.authority);
	unique(request.offers, id);
	for (const profile of request.offers) requireThat(request.policy.resolution.policy.profileAvailability[profile] === "enabled");
	requireThat(request.subject.purpose !== "readmission");
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
		member(reply.reason, ["authority-unavailable", "ownership-inconclusive", "policy-unavailable", "resource-disabled", "exhausted", "authentication", "endpoint-outage", "no-eligible-route"]);
		if (reply.cursor !== null) integer(reply.cursor);
		return reply;
	}
	if (reply.status === "refused") {
		keys(reply, [...REPLY_BASE, "reason"]);
		member(reply.reason, ["identity-mismatch", "boundary-unproven", "stale-owner", "epoch-mismatch", "revision-conflict", "payload-conflict", "invalid-transition", "unknown-grant"]);
		return reply;
	}
	requireThat(reply.epoch === request.epoch);
	if (reply.status === "busy") {
		keys(reply, [...REPLY_BASE, "contenderId", "reason", "cursor"]);
		requireThat(reply.contenderId === request.contenderId);
		member(reply.reason, ["aggregate", "resource", "fair-turn", "readmission-in-flight"]); integer(reply.cursor);
		return reply;
	}
	keys(reply, [...REPLY_BASE, "grant"]);
	requireThat(reply.status === "granted");
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
