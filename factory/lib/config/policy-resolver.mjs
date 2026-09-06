import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertOperatorInventory, assertPolicyRequest, assertPolicyResolution, assertRepositoryPolicy, OPERATOR_INVENTORY_FILE } from "./operator-policy-v1.mjs";
import { validateRouting } from "./routing.mjs";

/** §11.9 desired preview: source reads only, never application or admission.
 * Injection names a synthetic managed mount for filesystem tests. The binary
 * supplies no overrides; neither argv nor environment can select inventory.
 */
export function createDesiredPolicyResolver({ operatorMount = dirname(OPERATOR_INVENTORY_FILE), operatorUid = 0 } = {}) {
	return Object.freeze({ async resolve(request) {
		assertPolicyRequest(request);
		if (request.view !== "desired") throw new TypeError("This resolver only reads desired policy");
		const operatorFile = join(operatorMount, "operator.json");
		const repositoryFile = join(request.repositoryRoot, ".pi", "factory.json");
		const sources = [observe(operatorFile), observe(repositoryFile)];
		const resolution = {
			contractVersion: 1, state: "preview",
			desiredRevision: digest(JSON.stringify([1, ...sources.map((source) => source.observation), request.routingSet])),
			appliedRevision: null, policy: null, rejection: null,
		};
		let scope = "operator";
		try {
			for (const [index, source] of sources.entries()) {
				scope = index === 0 ? "operator" : "repository";
				if (source.observation.state !== "read") refuse("source-unavailable", "document", "Make the policy source a readable regular file.");
			}
			scope = "operator";
			// No symlink may substitute a different mount or inventory. Root owns
			// the production mount; group/other write permission is never accepted.
			const mount = lstatSync(operatorMount);
			if (!mount.isDirectory() || realpathSync(operatorMount) !== operatorMount || mount.uid !== operatorUid || (mount.mode & 0o022) !== 0 || sources[0].stat.uid !== operatorUid || (sources[0].stat.mode & 0o022) !== 0) {
				refuse("boundary-unproven", "document", "Use an operator-owned canonical inventory mount without group or other write access.");
			}
			const operator = parse(sources[0].bytes);
			assertOperatorInventory(operator);
			scope = "repository";
			const repository = parse(sources[1].bytes);
			assertRepositoryPolicy(repository, operator, request.routingSet);
			const routing = validateRouting(repository.routing, operator.profiles, request.routingSet, "operator-policy");
			const mode = operator.modes[operator.activeMode];
			const limits = {
				aggregate: mode.aggregateLimit,
				resources: Object.fromEntries(Object.entries(operator.resources).map(([name, resource]) => [name, resource.enabled ? (mode.resources[name] ?? 0) : 0])),
			};
			const profileAvailability = Object.fromEntries(Object.entries(operator.profiles).map(([name, profile]) => {
				const resourceId = operator.bindings[profile.bindingId].resourceId;
				const reason = !profile.enabled ? "profile-disabled"
					: !operator.resources[resourceId].enabled ? "resource-disabled"
					: !Object.hasOwn(mode.resources, resourceId) ? "mode-disabled"
					: limits.aggregate === 0 || limits.resources[resourceId] === 0 ? "zero-capacity" : "enabled";
				return [name, reason];
			}));
			resolution.policy = { operator, repository, routingSet: routing.active.name, limits, profileAvailability,
				provenance: { operatorFile: OPERATOR_INVENTORY_FILE, operatorDigest: sources[0].observation.digest,
					repositoryFile, repositoryDigest: sources[1].observation.digest } };
		} catch (error) {
			if (!(error instanceof PolicyRefusal) && !(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
			const rejection = error instanceof PolicyRefusal ? error.rejection : { code: "invalid-document", at: "document", question: "Correct the source against operator-policy v1's closed schema." };
			resolution.state = rejection.code === "source-unavailable" ? "unavailable" : "rejected";
			resolution.rejection = { ...rejection, scope };
		}
		assertPolicyResolution(resolution, request);
		return freeze(resolution);
	} });
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parse(bytes) { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }

function observe(file) {
	let fd;
	try {
		fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const stat = fstatSync(fd);
		if (!stat.isFile()) return { observation: { state: "unreadable" } };
		const bytes = readFileSync(fd);
		return { observation: { state: "read", digest: digest(bytes) }, bytes, stat };
	} catch (error) {
		if (typeof error.code !== "string") throw error;
		return { observation: { state: error.code === "ENOENT" ? "missing" : "unreadable" } };
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

class PolicyRefusal extends Error {
	constructor(code, at, question) {
		super("Policy source refused");
		this.rejection = { code, at, question };
	}
}
function refuse(code, at, question) { throw new PolicyRefusal(code, at, question); }
function freeze(value) {
	if (value !== null && typeof value === "object") {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}
