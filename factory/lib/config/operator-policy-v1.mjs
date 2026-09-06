import { isAbsolute, join, normalize } from "node:path";

/**
 * Consumer-owned value contract for §11.9 / #227. No IO, policy application,
 * authority transport or admission lives here. Guards return their input intact
 * and throw a redacted TypeError on a protocol violation; resolver refusals are
 * values instead. docs/specs/operator-policy-v1.md owns lifecycle and discovery.
 *
 * This artifact is deliberately not wired into the v2 binary yet: #227 fixes
 * the seam before the walking skeleton consumes it. Its version is independent
 * of repository config v3 and operator inventory v1.
 */
export const POLICY_CONTRACT_VERSION = 1;
export const OPERATOR_INVENTORY_FILE = "/etc/oh-my-slop/factory/operator.json";

const REVISION = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const REJECTION_CODES = [
	"invalid-document", "unsupported-version", "ownership-conflict", "unknown-reference",
	"ambiguous-binding", "identity-mismatch", "boundary-unproven", "revision-conflict",
	"source-unavailable", "authority-unavailable",
];

function requireThat(condition) {
	// Never embed source data or a parser's message: even an unknown key may be
	// a pasted secret. Detailed safe resolver diagnostics belong in rejection.
	if (!condition) throw new TypeError("Invalid operator-policy v1 contract value");
}
function object(value) {
	requireThat(value !== null && typeof value === "object" && !Array.isArray(value));
	requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value, required, optional = []) {
	object(value);
	requireThat(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)));
	requireThat(required.every((key) => Object.hasOwn(value, key)));
}
function text(value) {
	requireThat(typeof value === "string" && value.length > 0 && value.trim() === value && !/[\r\n\0]/.test(value));
}
function id(value) { text(value); requireThat(ID.test(value)); }
function revision(value) { requireThat(typeof value === "string" && REVISION.test(value)); }
function absolute(value) { text(value); requireThat(isAbsolute(value) && normalize(value) === value); }
function integer(value) { requireThat(Number.isSafeInteger(value) && value >= 0); }
function bool(value) { requireThat(typeof value === "boolean"); }
function reference(table, name) { id(name); requireThat(Object.hasOwn(table, name)); return table[name]; }
function entries(value) {
	object(value);
	for (const name of Object.keys(value)) id(name);
	return Object.entries(value);
}

/** Exact request; no policy override input exists. */
export function assertPolicyRequest(request) {
	keys(request, ["contractVersion", "repositoryRoot", "routingSet"]);
	requireThat(request.contractVersion === POLICY_CONTRACT_VERSION);
	absolute(request.repositoryRoot);
	if (request.routingSet !== null) id(request.routingSet);
	return request;
}

/** Operator inventory v1, never a merged repository configuration. */
export function assertOperatorInventory(inventory) {
	keys(inventory, ["schemaVersion", "operatorId", "controllerHostId", "resources", "bindings", "credentials", "profiles", "aggregateLimit", "modes", "activeMode"]);
	requireThat(inventory.schemaVersion === 1);
	id(inventory.operatorId);
	id(inventory.controllerHostId);
	integer(inventory.aggregateLimit);
	for (const name of ["resources", "bindings", "credentials", "profiles", "modes"]) entries(inventory[name]);
	reference(inventory.modes, inventory.activeMode);
	return inventory;
}

/** Repository v3 keeps its own blocks and cannot declare operator policy. */
export function assertRepositoryPolicy(repository, inventory, routingSet = null) {
	keys(repository, ["schemaVersion", "operatorId", "tracker", "git", "routing", "checks", "concurrency"], ["budgets", "retention", "package", "worker"]);
	requireThat(repository.schemaVersion === 3 && repository.operatorId === inventory.operatorId);
	keys(repository.concurrency, ["maxTicketExecutions"]);
	integer(repository.concurrency.maxTicketExecutions);
	requireThat(repository.concurrency.maxTicketExecutions > 0);
	if (routingSet !== null) reference(repository.routing.sets, routingSet);
	return repository;
}

/** A policy snapshot is not permission to launch; admission rechecks revision. */
export function assertPolicyResolution(resolution, request) {
	assertPolicyRequest(request);
	keys(resolution, ["contractVersion", "state", "desiredRevision", "appliedRevision", "policy", "rejection"]);
	requireThat(resolution.contractVersion === POLICY_CONTRACT_VERSION);
	requireThat(["applied", "rejected", "unavailable"].includes(resolution.state));
	if (resolution.appliedRevision !== null) revision(resolution.appliedRevision);
	if (resolution.desiredRevision !== null) revision(resolution.desiredRevision);
	else requireThat(resolution.state === "unavailable");
	if (resolution.state !== "applied") {
		requireThat(resolution.policy === null);
		keys(resolution.rejection, ["code", "scope", "at", "question"]);
		const { code, scope, at, question } = resolution.rejection;
		requireThat(REJECTION_CODES.includes(code) && ["operator", "repository"].includes(scope));
		text(at);
		if (question !== null) text(question);
		if (code === "ambiguous-binding") requireThat(question !== null);
		requireThat((resolution.state === "unavailable") === ["source-unavailable", "authority-unavailable"].includes(code));
		return resolution;
	}
	requireThat(resolution.rejection === null && resolution.appliedRevision !== null);
	requireThat(resolution.desiredRevision === resolution.appliedRevision);
	const policy = resolution.policy;
	keys(policy, ["operator", "repository", "routingSet", "limits", "profileAvailability", "provenance"]);
	assertOperatorInventory(policy.operator);
	assertRepositoryPolicy(policy.repository, policy.operator, request.routingSet);
	keys(policy.provenance, ["operatorFile", "operatorDigest", "repositoryFile", "repositoryDigest"]);
	requireThat(policy.provenance.operatorFile === OPERATOR_INVENTORY_FILE);
	requireThat(policy.provenance.repositoryFile === join(request.repositoryRoot, ".pi", "factory.json"));
	revision(policy.provenance.operatorDigest);
	revision(policy.provenance.repositoryDigest);
	return resolution;
}
