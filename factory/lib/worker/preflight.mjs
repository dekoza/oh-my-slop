import { resourceClassOf } from "../config/profiles.mjs";
import { createClaudeAdapter } from "./claude.mjs";
import { readSkillInventory, skillClosure, validateClosureReferences } from "./closure.mjs";
import { createPiAdapter } from "./pi.mjs";
import { rolesInPlay } from "./roles.mjs";

/**
 * §6.2's three-layer preflight, layers 1 and 2, as the two run-level checks the
 * controller records (§9.7's order puts them in different sections; layer 3 is
 * `recheck.mjs`, per attempt).
 *
 * - **`skill-closure`** (static, with the artifacts): the §6.1 roles the active
 *   routing puts in play, each closed over `requires:` frontmatter from the
 *   pinned revision, with §6.8's conflict predicate and reference validation.
 * - **`runtime-probe`** (probe): each runtime kind those roles can dispatch to,
 *   probed live through its §6.1 adapter on the production path, **with the
 *   capacity observation folded in** — declared-vs-observed sizes and
 *   unreachable classes are this check's failures, never a silent clamp or a
 *   quiet zero.
 *
 * Both checks answer from one computation: the closure the probe proves is the
 * closure the static layer computed, because two computations would be two
 * answers about what a role needs.
 */

/**
 * @param {object} input
 * @param {Readonly<object> | null} input.handshake §11.7's static handshake, or
 *   null when it failed — these checks then fail *citing* that, rather than
 *   guessing at a package nothing pinned
 * @param {object} input.config the validated configuration
 * @param {object} input.activeRouting
 * @param {string} input.cacheRoot the store directory (plugin cache lives beside `state.db`)
 * @param {{ pi?: object, claude?: object }} [input.transports] per-runtime IO
 *   overrides, so a test drives every verdict without a harness on the machine
 * @param {{ pi?: string, claude?: string }} [input.binaries]
 * @param {number} [input.timeoutMs]
 * @returns {{ closureCheck: () => object, runtimeCheck: () => Promise<object> }}
 */
export function createWorkerPreflight({
	handshake,
	config,
	activeRouting,
	cacheRoot,
	transports = {},
	binaries = {},
	timeoutMs,
}) {
	let computed = null;

	const closure = () => {
		if (computed !== null) return computed;

		const skillsRoots = (handshake?.participants ?? [])
			.filter((participant) => participant.kind === "skills-root" && participant.path !== null)
			.map((participant) => participant.path);

		if (handshake === null || skillsRoots.length === 0) {
			computed = { unresolved: true, skillsRoots, roles: [], inventory: null, findings: [] };
			return computed;
		}

		const inventory = readSkillInventory({ packageRoot: handshake.package.root, skillsRoots });
		const findings = [...inventory.findings];
		const roles = rolesInPlay(activeRouting).map((role) => {
			const closed = skillClosure(inventory, role.entrySkill);
			findings.push(...closed.findings);
			return Object.freeze({ ...role, closure: closed.closure });
		});

		const union = [...new Set(roles.flatMap((role) => role.closure))].sort();
		findings.push(...validateClosureReferences(inventory, union, { packageRoot: handshake.package.root }));

		computed = { unresolved: false, skillsRoots, roles: Object.freeze(roles), inventory, findings };
		return computed;
	};

	return {
		/** Layer 1, recorded with the artifacts-and-config section (§9.7). */
		closureCheck() {
			const state = closure();
			if (state.unresolved) return unpinned("skill-closure", "static");

			if (state.findings.length > 0) {
				return check("skill-closure", "static", "failed", {
					message:
						`The skill closure does not resolve from the pinned revision (§6.2, §6.8): ` +
						`${state.findings.map((entry) => entry.message).join(" ")}`,
					detail: { findings: state.findings, roles: reportedRoles(state.roles) },
				});
			}

			return check("skill-closure", "static", "passed", {
				message:
					`Every role's closure resolves from the pinned revision: ` +
					state.roles.map((role) => `${role.name} (${role.closure.length} skills)`).join(", ") +
					".",
				detail: { revision: handshake.tree.digest, roles: reportedRoles(state.roles) },
			});
		},

		/** Layer 2 with the capacity observation folded in, in the probe section. */
		async runtimeCheck() {
			const state = closure();
			if (state.unresolved) return unpinned("runtime-probe", "probe");

			const packageRev = handshake.tree.digest;
			const kinds = runtimeKinds(state.roles, config.profiles);
			const results = [];

			for (const kind of [...kinds.keys()].sort()) {
				const adapter = adapterFor(kind, {
					state,
					handshake,
					config,
					cacheRoot,
					transport: transports[kind],
					binary: binaries[kind],
					timeoutMs,
				});
				for (const role of kinds.get(kind)) {
					results.push(await adapter.preflight(role, packageRev));
				}
			}

			const findings = dedupe(results.flatMap((result) => result.findings));
			const runtimes = reportedRuntimes(results);

			if (findings.length > 0) {
				return check("runtime-probe", "probe", "failed", {
					message: `The live runtime probe failed (§6.2, §9.7): ${findings.map((entry) => entry.message).join(" ")}`,
					detail: { findings, runtimes, roles: reportedResults(results) },
				});
			}

			return check("runtime-probe", "probe", "passed", {
				message:
					`Native invocation is proven on the production path for ` +
					results.map((result) => `${result.role} (${result.kind})`).join(", ") +
					`; capacity observed: ${describeCapacity(runtimes)}.`,
				detail: { revision: packageRev, runtimes, roles: reportedResults(results) },
			});
		},
	};
}

/** Which runtime kinds the roles in play can dispatch to, and which roles each serves. */
function runtimeKinds(roles, profiles) {
	const kinds = new Map();
	for (const role of roles) {
		for (const profileName of role.profiles) {
			const kind = profiles[profileName].kind;
			if (!kinds.has(kind)) kinds.set(kind, []);
			if (!kinds.get(kind).some((entry) => entry.name === role.name)) kinds.get(kind).push(role);
		}
	}
	return kinds;
}

function adapterFor(kind, { state, handshake, config, cacheRoot, transport, binary, timeoutMs }) {
	const declaredResources = config.concurrency.resources;

	if (kind === "pi") {
		const piProfiles = Object.entries(config.profiles)
			.filter(([, profile]) => profile.kind === "pi")
			.filter(([name]) => state.roles.some((role) => role.profiles.includes(name)))
			.map(([name, profile]) => ({ name, model: profile.model }));

		return createPiAdapter({
			skillsRoots: state.skillsRoots,
			profiles: piProfiles,
			declaredResources,
			requiredClasses: [...new Set(piProfiles.map((profile) => resourceClassOf({ kind: "pi", model: profile.model })))],
			...(transport === undefined ? {} : { transport }),
			...(binary === undefined ? {} : { binary }),
			...(timeoutMs === undefined ? {} : { timeoutMs }),
		});
	}

	return createClaudeAdapter({
		packageRoot: handshake.package.root,
		cacheRoot,
		expectedSkills: [...state.inventory.skills.keys()].sort(),
		declaredSize: declaredResources[resourceClassOf({ kind: "claude", model: "" })] ?? null,
		...(transport === undefined ? {} : { transport }),
		...(binary === undefined ? {} : { binary }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	});
}

/**
 * Both checks fail the same way when §11.7's handshake did not resolve: the
 * package-handshake check already carries the diagnosis, and a closure or
 * probe verdict about a package nothing pinned would be a second, vaguer copy
 * of it.
 */
function unpinned(name, className) {
	return check(name, className, "failed", {
		message:
			`The package handshake did not resolve, so there is no pinned revision to answer from — see the ` +
			`package-handshake check (§6.2, §11.7).`,
		detail: { cause: "package-handshake" },
	});
}

function check(name, className, result, { message, detail }) {
	return { check: name, class: className, result, message, detail };
}

function reportedRoles(roles) {
	return roles.map((role) => ({
		role: role.name,
		entry_skill: role.entrySkill,
		profiles: [...role.profiles],
		closure: [...role.closure],
	}));
}

function reportedResults(results) {
	return results.map((result) => ({ role: result.role, kind: result.kind, ok: result.ok }));
}

/** One record per runtime, not per role: the probe ran once per kind (§6.2). */
function reportedRuntimes(results) {
	const runtimes = {};
	for (const result of results) {
		runtimes[result.kind] ??= {
			version: result.runtime.version,
			classes: result.runtime.classes ?? {},
			...(result.runtime.plugin === undefined || result.runtime.plugin === null
				? {}
				: { plugin: { dir: result.runtime.plugin.dir, outcome: result.runtime.plugin.outcome } }),
		};
	}
	return runtimes;
}

function describeCapacity(runtimes) {
	const described = Object.values(runtimes)
		.flatMap((runtime) => Object.values(runtime.classes))
		.map(
			(entry) =>
				`${entry.class} ${entry.max_instances === null ? "declared-only" : `max_instances ${entry.max_instances}`}` +
				` (declared ${entry.declared ?? "none"})`,
		);
	return described.length === 0 ? "no classes in play" : described.join(", ");
}

function dedupe(findings) {
	const seen = new Set();
	return findings.filter((entry) => {
		const key = JSON.stringify(entry);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
