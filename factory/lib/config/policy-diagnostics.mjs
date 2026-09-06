import { FactoryConfigError } from "./errors.mjs";
import { validateRouting } from "./routing.mjs";

/** Diagnostic refinement only: the v1 guards remain the acceptance authority.
 * Every location/question below is code-owned. A map key, parser excerpt, URL,
 * or validator's free-text error could contain pasted credentials and never
 * reaches the refusal. Malformed shapes fall back to invalid-document.
 */
export function policyDiagnostic(document, scope, inventory, routingSet) {
	const invalid = diagnostic("invalid-document", "document", "Correct the source against operator-policy v1's closed schema.");
	if (!record(document)) return invalid;
	if (document.schemaVersion !== (scope === "operator" ? 1 : 3)) {
		return diagnostic("unsupported-version", "schemaVersion", "Use inventory schemaVersion 1 and repository schemaVersion 3; no automatic migration occurs.");
	}
	const forbidden = scope === "repository"
		? ["resources", "profiles", "modes", "activeMode", "bindings", "credentials", "aggregateLimit", "controllerHostId"]
		: ["tracker", "git", "routing", "checks", "concurrency", "budgets", "retention", "package", "worker"];
	const conflict = forbidden.find((key) => Object.hasOwn(document, key));
	if (conflict) return ownership(conflict);
	if (scope === "repository") {
		if (record(document.concurrency) && Object.hasOwn(document.concurrency, "resources")) return ownership("concurrency.resources");
		if (document.operatorId !== inventory.operatorId) return diagnostic("identity-mismatch", "operatorId", "Bind this repository to the intended operator inventory identity.");
		const endpointEnvs = new Set(Object.values(inventory.bindings).flatMap((b) => b.endpoint ? [b.endpoint.env] : []));
		if (Array.isArray(document.worker?.piExtensions) && document.worker.piExtensions.some((e) => record(e?.env) && Object.keys(e.env).some((name) => endpointEnvs.has(name)))) return ownership("worker.piExtensions.env");
		try { validateRouting(document.routing, inventory.profiles, routingSet, "operator-policy"); } catch (error) {
			if (!(error instanceof FactoryConfigError)) return invalid;
			if (error.reason === "unknown-routing-set" || (error.details.expected === Object.keys(inventory.profiles).join("|") && typeof error.details.found === "string" && !Object.hasOwn(inventory.profiles, error.details.found))) return unknown("routing");
		}
		return invalid;
	}
	const { resources, bindings, credentials, profiles, modes } = document;
	if (![resources, bindings, credentials, profiles, modes].every(record)) return invalid;
	if (missing(modes, document.activeMode)) return unknown("activeMode");
	for (const binding of Object.values(bindings).filter(record)) {
		if (missing(resources, binding.resourceId)) return unknown("bindings.resourceId");
		if (binding.credentialId !== null && missing(credentials, binding.credentialId)) return unknown("bindings.credentialId");
	}
	for (const profile of Object.values(profiles).filter(record)) if (missing(bindings, profile.bindingId)) return unknown("profiles.bindingId");
	for (const mode of Object.values(modes).filter(record)) if (record(mode.resources) && Object.keys(mode.resources).some((name) => missing(resources, name))) return unknown("modes.resources");
	const identities = new Set();
	for (const resource of Object.values(resources).filter(record)) {
		const identity = resource.identity;
		if (!record(identity)) continue;
		const fields = identity.kind === "gpu" ? [identity.kind, identity.hostId, identity.deviceId] : [identity.kind, identity.provider, identity.accountId, identity.quotaId];
		if (fields.some((value) => typeof value !== "string")) continue;
		const key = JSON.stringify(fields);
		if (identities.has(key)) return ambiguous("resources.identity");
		identities.add(key);
	}
	const endpoints = new Map();
	const auth = new Map();
	for (const binding of Object.values(bindings).filter(record)) {
		let endpoint = null;
		try { if (typeof binding.endpoint?.url === "string") endpoint = new URL(binding.endpoint.url).href; } catch { /* Invalid URLs remain invalid-document. */ }
		// Invalid references/fields may be deeply nested JSON. Never coerce them
		// into property keys or recursively stringify them while refining a refusal.
		const credential = typeof binding.credentialId === "string" ? credentials[binding.credentialId] : null;
		const fields = record(credential) ? [credential.kind, credential.runtime, credential.name] : null;
		const key = fields?.every((value) => typeof value === "string") ? JSON.stringify(fields) : null;
		for (const [table, identity] of [[endpoints, endpoint], [auth, key]]) {
			if (identity === null) continue;
			if (table.has(identity) && table.get(identity) !== binding.resourceId) return ambiguous("bindings");
			table.set(identity, binding.resourceId);
		}
	}
	return invalid;
}

function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function missing(table, name) { return typeof name === "string" && !Object.hasOwn(table, name); }
function diagnostic(code, at, question) { return { code, at, question }; }
function ownership(at) { return diagnostic("ownership-conflict", at, "Keep resource policy in the operator inventory and project policy in the repository; remove the cross-owner declaration."); }
function unknown(at) { return diagnostic("unknown-reference", at, "Declare the referenced inventory/profile/routing entry or correct the reference, including dormant entries."); }
function ambiguous(at) { return diagnostic("ambiguous-binding", at, "Which bindings share one physical device or account quota? Assign them to one resource, or provide distinct confirmed identities."); }
