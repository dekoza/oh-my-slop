import { isAbsolute, join, normalize } from "node:path";
import { requireDeclarableEnvName } from "./declared-env.mjs";
import { FactoryConfigError } from "./errors.mjs";
import { validateChecks } from "./checks.mjs";
import { validateBudgets, validateRetention } from "./defaults.mjs";
import { validateRouting } from "./routing.mjs";
import { validateWorker } from "./worker.mjs";
import { parseVersionRange } from "../package/version.mjs";

/**
 * Consumer-owned value contract for §11.9 / #227. No IO, policy application,
 * authority transport or admission lives here. Guards return their input intact
 * and throw a redacted TypeError on a protocol violation; resolver refusals are
 * values instead. docs/specs/operator-policy-v1.md owns lifecycle and discovery.
 *
 * #230's desired-preview resolver consumes this frozen #227 artifact. Its
 * version is independent of repository config v3 and operator inventory v1;
 * legacy v2 operations do not consume it.
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
	keys(request, ["contractVersion", "repositoryRoot", "routingSet", "view"]);
	requireThat(request.contractVersion === POLICY_CONTRACT_VERSION);
	requireThat(["desired", "applied"].includes(request.view));
	absolute(request.repositoryRoot);
	if (request.routingSet !== null) id(request.routingSet);
	return request;
}

/** Operator inventory v1, never a merged repository configuration. */
export function assertOperatorInventory(inventory) {
	assertJson(inventory);
	keys(inventory, ["schemaVersion", "operatorId", "controllerHostId", "resources", "bindings", "credentials", "profiles", "aggregateLimit", "modes", "activeMode"]);
	requireThat(inventory.schemaVersion === 1);
	id(inventory.operatorId);
	id(inventory.controllerHostId);
	integer(inventory.aggregateLimit);
	for (const name of ["resources", "bindings", "credentials", "profiles", "modes"]) entries(inventory[name]);
	reference(inventory.modes, inventory.activeMode);
	const identities = new Set();
	for (const resource of Object.values(inventory.resources)) {
		keys(resource, ["identity", "enabled", "limit"]);
		bool(resource.enabled);
		integer(resource.limit);
		object(resource.identity);
		const fields = resource.identity.kind === "gpu" ? ["kind", "hostId", "deviceId"] : ["kind", "provider", "accountId", "quotaId"];
		keys(resource.identity, fields);
		requireThat(["gpu", "account"].includes(resource.identity.kind));
		for (const field of fields) id(resource.identity[field]);
		const identity = JSON.stringify(fields.map((field) => resource.identity[field]));
		requireThat(!identities.has(identity));
		identities.add(identity);
	}
	for (const credential of Object.values(inventory.credentials)) {
		keys(credential, ["kind", "runtime", "name"]);
		requireThat(credential.kind === "runtime-auth" && ["pi", "claude"].includes(credential.runtime));
		id(credential.name);
	}
	const endpoints = new Map();
	const credentials = new Map();
	for (const binding of Object.values(inventory.bindings)) {
		keys(binding, ["resourceId", "credentialId", "endpoint"]);
		const resource = reference(inventory.resources, binding.resourceId);
		if (binding.credentialId !== null) {
			const credential = reference(inventory.credentials, binding.credentialId);
			bindOnce(credentials, JSON.stringify([credential.kind, credential.runtime, credential.name]), binding.resourceId);
		}
		if (binding.endpoint !== null) {
			keys(binding.endpoint, ["env", "url"]);
			configGuard(() => requireDeclarableEnvName(binding.endpoint.env, "endpoint.env", "operator-policy"));
			text(binding.endpoint.url);
			let endpoint;
			try { endpoint = new URL(binding.endpoint.url); } catch { requireThat(false); }
			requireThat(["http:", "https:"].includes(endpoint.protocol));
			requireThat(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
			bindOnce(endpoints, endpoint.href, binding.resourceId);
		}
		requireThat(resource.identity.kind !== "gpu" || binding.endpoint !== null);
		requireThat(resource.identity.kind !== "account" || binding.credentialId !== null);
	}
	for (const profile of Object.values(inventory.profiles)) {
		keys(profile, ["enabled", "bindingId", "runtime"]);
		bool(profile.enabled);
		const binding = reference(inventory.bindings, profile.bindingId);
		assertRuntime(profile.runtime);
		if (binding.credentialId !== null) requireThat(inventory.credentials[binding.credentialId].runtime === profile.runtime.kind);
	}
	for (const mode of Object.values(inventory.modes)) {
		keys(mode, ["aggregateLimit", "resources"]);
		integer(mode.aggregateLimit);
		requireThat(mode.aggregateLimit <= inventory.aggregateLimit);
		for (const [name, limit] of entries(mode.resources)) {
			const resource = reference(inventory.resources, name);
			integer(limit);
			requireThat(limit <= resource.limit);
		}
	}
	return inventory;
}

// Values may alias one resource, never silently manufacture another pool.
function bindOnce(bindings, key, resource) {
	requireThat(!bindings.has(key) || bindings.get(key) === resource);
	bindings.set(key, resource);
}

function configGuard(validate) {
	try { return validate(); } catch (error) {
		if (!(error instanceof FactoryConfigError)) throw error;
		requireThat(false);
	}
}

function assertRuntime(runtime) {
	object(runtime);
	requireThat(["pi", "claude"].includes(runtime.kind));
	const flag = runtime.kind === "pi" ? "thinking" : "effort";
	const clocks = ["startupTimeoutMs", "attemptTimeoutMs", "noProgressTimeoutMs"];
	keys(runtime, ["kind", "model"], [flag, ...clocks]);
	text(runtime.model);
	if (runtime.kind === "pi") {
		requireThat(/^[^/\s]+\/[^\s]+$/.test(runtime.model));
		requireThat(!/(^|[^a-z0-9])(opus|fable)([^a-z0-9]|$)/i.test(runtime.model));
	}
	if (Object.hasOwn(runtime, flag)) {
		const levels = flag === "thinking" ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high", "xhigh", "max"];
		requireThat(levels.includes(runtime[flag]));
	}
	for (const clock of clocks) if (Object.hasOwn(runtime, clock)) {
		integer(runtime[clock]);
		requireThat(runtime[clock] > 0);
	}
}

/** Repository v3 keeps its own blocks and cannot declare operator policy. */
export function assertRepositoryPolicy(repository, inventory, routingSet = null) {
	assertJson(repository);
	keys(repository, ["schemaVersion", "operatorId", "tracker", "git", "routing", "checks", "concurrency"], ["budgets", "retention", "package", "worker"]);
	requireThat(repository.schemaVersion === 3 && repository.operatorId === inventory.operatorId);
	keys(repository.concurrency, ["maxTicketExecutions"]);
	integer(repository.concurrency.maxTicketExecutions);
	requireThat(repository.concurrency.maxTicketExecutions > 0);
	keys(repository.tracker, ["kind", "repo", "remote", "login", "assignee"]);
	for (const value of Object.values(repository.tracker)) text(value);
	requireThat(repository.tracker.kind === "gitea" && /^[^/\s]+\/[^/\s]+$/.test(repository.tracker.repo));
	keys(repository.git, ["baseBranch", "remote"]);
	for (const value of Object.values(repository.git)) text(value);
	object(repository.routing);
	if (routingSet !== null) id(routingSet);
	configGuard(() => {
		validateRouting(repository.routing, inventory.profiles, routingSet, "operator-policy");
		validateChecks(repository.checks, "operator-policy");
		for (const name of ["budgets", "retention", "worker"]) if (Object.hasOwn(repository, name)) object(repository[name]);
		validateBudgets(repository.budgets, "operator-policy");
		validateRetention(repository.retention, "operator-policy");
		const worker = validateWorker(repository.worker, "operator-policy");
		const endpointEnvs = new Set(Object.values(inventory.bindings).flatMap((binding) => binding.endpoint === null ? [] : [binding.endpoint.env]));
		for (const extension of worker.piExtensions) {
			requireThat(Object.keys(extension.env).every((name) => !endpointEnvs.has(name)));
		}
	});
	if (Object.hasOwn(repository, "package")) {
		keys(repository.package, ["expect"]);
		keys(repository.package.expect, ["name", "version"]);
		text(repository.package.expect.name);
		text(repository.package.expect.version);
		// The range parser's free-text diagnostics may quote input. At this wire
		// boundary the only failure surface is the redacted contract exception.
		try { parseVersionRange(repository.package.expect.version); } catch { requireThat(false); }
	}
	return repository;
}

// Only JSON values cross the seam; TODO is a migration hole, never policy.
function assertJson(value) {
	if (typeof value === "string") { text(value); requireThat(!/^TODO\b/.test(value)); }
	else if (typeof value === "number") requireThat(Number.isSafeInteger(value));
	else if (Array.isArray(value)) value.forEach(assertJson);
	else if (value !== null && typeof value === "object") {
		object(value);
		for (const [name, child] of Object.entries(value)) {
			requireThat(!/^TODO\b/.test(name));
			assertJson(child);
		}
	} else requireThat(value === null || typeof value === "boolean");
}

/** A policy snapshot is not permission to launch; admission rechecks revision. */
export function assertPolicyResolution(resolution, request) {
	assertPolicyRequest(request);
	keys(resolution, ["contractVersion", "state", "desiredRevision", "appliedRevision", "policy", "rejection"]);
	requireThat(resolution.contractVersion === POLICY_CONTRACT_VERSION);
	requireThat(["preview", "applied", "rejected", "unavailable"].includes(resolution.state));
	if (request.view === "desired") requireThat(resolution.appliedRevision === null && resolution.state !== "applied");
	else requireThat(resolution.state !== "preview");
	if (resolution.appliedRevision !== null) revision(resolution.appliedRevision);
	if (resolution.desiredRevision !== null) revision(resolution.desiredRevision);
	else requireThat(resolution.state === "unavailable");
	if (["rejected", "unavailable"].includes(resolution.state)) {
		requireThat(resolution.policy === null);
		keys(resolution.rejection, ["code", "scope", "at", "question"]);
		const { code, scope, at, question } = resolution.rejection;
		requireThat(REJECTION_CODES.includes(code) && ["operator", "repository"].includes(scope));
		text(at);
		if (question !== null) text(question);
		if (code === "ambiguous-binding") requireThat(question !== null);
		requireThat((resolution.state === "unavailable") === ["source-unavailable", "authority-unavailable"].includes(code));
		requireThat((resolution.desiredRevision === null) === (code === "authority-unavailable"));
		if (request.view === "desired") requireThat(code !== "authority-unavailable");
		return resolution;
	}
	requireThat(resolution.rejection === null);
	if (resolution.state === "applied") {
		requireThat(resolution.appliedRevision !== null && resolution.desiredRevision === resolution.appliedRevision);
	}
	const policy = resolution.policy;
	keys(policy, ["operator", "repository", "routingSet", "limits", "profileAvailability", "provenance"]);
	assertOperatorInventory(policy.operator);
	assertRepositoryPolicy(policy.repository, policy.operator, request.routingSet);
	const routing = configGuard(() => validateRouting(policy.repository.routing, policy.operator.profiles, request.routingSet, "operator-policy"));
	requireThat(policy.routingSet === routing.active.name);
	assertEffectiveAvailability(policy);
	keys(policy.provenance, ["operatorFile", "operatorDigest", "repositoryFile", "repositoryDigest"]);
	requireThat(policy.provenance.operatorFile === OPERATOR_INVENTORY_FILE);
	requireThat(policy.provenance.repositoryFile === join(request.repositoryRoot, ".pi", "factory.json"));
	revision(policy.provenance.operatorDigest);
	revision(policy.provenance.repositoryDigest);
	return resolution;
}

function assertEffectiveAvailability({ operator, limits, profileAvailability }) {
	keys(limits, ["aggregate", "resources"]);
	const mode = operator.modes[operator.activeMode];
	requireThat(limits.aggregate === mode.aggregateLimit);
	keys(limits.resources, Object.keys(operator.resources));
	for (const [name, resource] of Object.entries(operator.resources)) {
		const limit = resource.enabled && Object.hasOwn(mode.resources, name) ? mode.resources[name] : 0;
		requireThat(limits.resources[name] === limit);
	}
	keys(profileAvailability, Object.keys(operator.profiles));
	for (const [name, profile] of Object.entries(operator.profiles)) {
		const resourceId = operator.bindings[profile.bindingId].resourceId;
		let availability = "enabled";
		if (!profile.enabled) availability = "profile-disabled";
		else if (!operator.resources[resourceId].enabled) availability = "resource-disabled";
		else if (!Object.hasOwn(mode.resources, resourceId)) availability = "mode-disabled";
		else if (limits.aggregate === 0 || limits.resources[resourceId] === 0) availability = "zero-capacity";
		requireThat(profileAvailability[name] === availability);
	}
}
