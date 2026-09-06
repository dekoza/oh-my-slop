import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertOperatorInventory, assertPolicyRequest, assertPolicyResolution, assertRepositoryPolicy, OPERATOR_INVENTORY_FILE } from "./operator-policy-v1.mjs";
import { validateRouting } from "./routing.mjs";
import { policyDiagnostic } from "./policy-diagnostics.mjs";
import { resolveRemoteUrl } from "../git/repo.mjs";
import { readGiteaLoginIdentity } from "../tracker/gitea.mjs";
import { FactoryTrackerError } from "../tracker/errors.mjs";

/** §11.9 desired preview: source reads only, never application or admission.
 * Injection names a synthetic managed mount for filesystem tests. The binary
 * supplies no overrides; neither argv nor environment can select inventory.
 */
export function createDesiredPolicyResolver({ filesystemRoot = "/", operatorUid = 0, readLogin = readGiteaLoginIdentity } = {}) {
	return Object.freeze({ async resolve(request) {
		assertPolicyRequest(request);
		if (request.view !== "desired") throw new TypeError("This resolver only reads desired policy");
		const operatorMount = join(filesystemRoot, dirname(OPERATOR_INVENTORY_FILE));
		const operatorFile = join(operatorMount, "operator.json");
		const repositoryFile = join(request.repositoryRoot, ".pi", "factory.json");
		const sources = [observe(operatorFile), observe(repositoryFile)];
		const resolution = {
			contractVersion: 1, state: "preview",
			desiredRevision: digest(JSON.stringify([1, ...sources.map((source) => source.observation), request.routingSet])),
			appliedRevision: null, policy: null, rejection: null,
		};
		let scope = "operator";
		let document;
		let operator;
		try {
			for (const [index, source] of sources.entries()) {
				scope = index === 0 ? "operator" : "repository";
				if (source.observation.state !== "read") refuse("source-unavailable", "document", "Make the policy source a readable regular file.");
				if (!source.canonical) refuse(scope === "operator" ? "boundary-unproven" : "ownership-conflict", "document", "Keep the policy source at its canonical location without symlinked parent directories.");
			}
			scope = "operator";
			verifyOperatorMount(operatorMount, filesystemRoot, operatorUid, sources[0].stat);
			document = parse(sources[0].bytes);
			assertOperatorInventory(document);
			operator = document;
			scope = "repository";
			document = undefined;
			document = parse(sources[1].bytes);
			const repository = document;
			assertRepositoryPolicy(repository, operator, request.routingSet);
			await verifyRepositoryIdentity(request.repositoryRoot, repository.tracker, readLogin);
			const routing = validateRouting(repository.routing, operator.profiles, request.routingSet, "operator-policy");
			const mode = operator.modes[operator.activeMode];
			const limits = {
				aggregate: mode.aggregateLimit,
				resources: Object.fromEntries(Object.entries(operator.resources).map(([name, resource]) => [name, resource.enabled && Object.hasOwn(mode.resources, name) ? mode.resources[name] : 0])),
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
			const rejection = error instanceof PolicyRefusal ? error.rejection : policyDiagnostic(document, scope, operator, request.routingSet);
			resolution.state = rejection.code === "source-unavailable" ? "unavailable" : "rejected";
			resolution.rejection = { ...rejection, scope };
		}
		assertPolicyResolution(resolution, request);
		return freeze(resolution);
	} });
}

function verifyOperatorMount(mount, root, uid, fileStat) {
	const protectedOwner = (stat) => stat.uid === uid && (stat.mode & 0o022) === 0;
	let safe = protectedOwner(fileStat);
	try {
		for (let path = mount; ; path = dirname(path)) {
			const stat = lstatSync(path);
			safe &&= stat.isDirectory() && realpathSync(path) === path && protectedOwner(stat);
			if (path === root) break;
			if (path === dirname(path)) { safe = false; break; }
		}
	} catch (error) {
		if (typeof error.code !== "string") throw error;
		refuse("source-unavailable", "document", "Make the canonical operator mount readable before retrying inspection.");
	}
	// These filesystem facts are not proof of enrollment, a read-only mount,
	// executable restrictions or enforced model access. Doctor reports those as
	// unobserved. Privileged operators remain outside the enforcement guarantee.
	if (!safe) refuse("boundary-unproven", "document", "Use an operator-owned canonical inventory mount and parent directories without group or other write access.");
}

async function verifyRepositoryIdentity(root, tracker, readLogin) {
	let login;
	try { login = await readLogin(tracker.login); } catch (error) {
		if (!(error instanceof FactoryTrackerError) && !(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
		refuse("source-unavailable", "tracker.login", "Make the selected tea login's nonsecret metadata readable; no tracker connection was attempted.");
	}
	if (login === null) refuse("unknown-reference", "tracker.login", "Configure the selected tea login before inspecting this repository.");
	const remote = resolveRemoteUrl(root, tracker.remote);
	let matches = false;
	try {
		const forge = new URL(login.url);
		const scp = /^[^/@]+@([^/:]+):(.+)$/.exec(remote ?? "");
		const url = scp ? new URL(`ssh://${scp[1]}/${scp[2]}`) : new URL(remote);
		if (!["http:", "https:"].includes(forge.protocol) || forge.username || forge.password || forge.search || forge.hash) throw new TypeError("Invalid login URL");
		let namespacePrefix;
		if (url.protocol === "ssh:") {
			const ssh = new URL(`ssh://${login.sshHost}`);
			matches = url.hostname === ssh.hostname && (url.port || "22") === (ssh.port || "22");
			namespacePrefix = "/";
		} else {
			matches = url.origin === forge.origin;
			namespacePrefix = `${forge.pathname.replace(/\/+$/, "")}/`;
		}
		// Gitea's HTTP base path belongs to the forge; SSH paths begin at its
		// repository namespace. A suffix-only slug match accepts another route.
		const repositoryPath = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
		matches &&= repositoryPath.startsWith(namespacePrefix)
			&& repositoryPath.slice(namespacePrefix.length).toLowerCase() === tracker.repo.toLowerCase()
			&& !url.password && !url.search && !url.hash;
	} catch (error) {
		if (!(error instanceof TypeError)) throw error;
		// Invalid/unresolvable identity is a safe refusal, never source text.
	}
	if (!matches) refuse("identity-mismatch", "tracker.remote", "Match the repository remote's forge, port and owner/repository to the selected tea login and tracker.repo.");
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parse(bytes) {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const value = JSON.parse(source);
	// JSON.parse owns the grammar; this token walk only rejects duplicate keys
	// it would otherwise erase. Decode escaped spellings before comparison.
	const stack = [];
	for (const [token] of source.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]/g)) {
		const top = stack.at(-1);
		if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, key: true });
		else if (token === "}" || token === "]") stack.pop();
		else if (token === ",") top.key = true;
		else if (token === ":") top.key = false;
		else if (top?.keys && top.key) {
			const key = JSON.parse(token);
			if (top.keys.has(key)) throw new SyntaxError("Duplicate policy key");
			top.keys.add(key);
		}
	}
	return value;
}

function observe(file) {
	let fd;
	try {
		const canonical = realpathSync(file) === file;
		fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const stat = fstatSync(fd);
		if (!stat.isFile()) return { observation: { state: "unreadable" } };
		const bytes = readFileSync(fd);
		return { observation: { state: "read", digest: digest(bytes) }, bytes, stat, canonical: canonical && realpathSync(file) === file };
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
