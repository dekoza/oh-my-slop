import { validateRouting } from "../config/routing.mjs";

/** Render the same guarded resolution that --json publishes (§10.2, §11.9). */
export function renderPolicyResolution(resolution) {
	const lines = [
		`  policy state: ${resolution.state}`,
		`  desired revision: ${resolution.desiredRevision}`,
	];
	if (resolution.policy === null) {
		lines.push(`  refusal: ${resolution.rejection.code} (${resolution.rejection.scope}, ${resolution.rejection.at})`);
		return lines;
	}
	const { operator, repository, routingSet, limits, profileAvailability, provenance } = resolution.policy;
	const routing = validateRouting(repository.routing, operator.profiles, routingSet, "operator-policy").active;
	const eligible = [...routing.profiles].filter((name) => profileAvailability[name] === "enabled").sort();
	lines.push(
		`  operator: ${operator.operatorId}; configured controller host: ${operator.controllerHostId}`,
		`  active mode: ${operator.activeMode}; routing set: ${routingSet ?? "file-level"}`,
		`  configured aggregate ceiling: ${limits.aggregate} (inventory ceiling: ${operator.aggregateLimit})`,
		`  configured ticket ceiling: ${repository.concurrency.maxTicketExecutions} (not an admission grant)`,
		`  configured eligible profiles: ${eligible.join(", ") || "(none)"} (conditional on routing labels; not capability or free slots)`,
		`  operator source: ${provenance.operatorFile} sha256:${provenance.operatorDigest}`,
		`  repository source: ${provenance.repositoryFile} sha256:${provenance.repositoryDigest}`,
		"  resource inventory:",
	);
	for (const [name, resource] of Object.entries(operator.resources)) {
		lines.push(`    ${name}: enabled=${resource.enabled}; configured effective ceiling=${limits.resources[name]}; configured inventory ceiling=${resource.limit}; identity=${JSON.stringify(resource.identity)}`);
	}
	lines.push("  binding inventory:");
	for (const [name, binding] of Object.entries(operator.bindings)) {
		lines.push(`    ${name}: resource=${binding.resourceId}; credential reference=${binding.credentialId ?? "none"}; endpoint=${JSON.stringify(binding.endpoint)}`);
	}
	lines.push("  profile inventory:");
	for (const [name, profile] of Object.entries(operator.profiles)) {
		lines.push(`    ${name}: ${profileAvailability[name]}; reachable=${routing.profiles.has(name)}; binding=${profile.bindingId}; runtime=${JSON.stringify(profile.runtime)}`);
	}
	return lines;
}
