import { existsSync, readFileSync } from "node:fs";

import { CLAUDE_RESOURCE_CLASS, resourceClassOf } from "../config/profiles.mjs";
import { privateClonePath, worktreesRoot } from "../git/isolation.mjs";
import { createClaudeAdapter, proveClaudeProfileFlags } from "./claude.mjs";
import { readSkillInventory, skillClosure, validateClosureReferences } from "./closure.mjs";
import { AGENT_STATE_INTEGRATION, prepareWorkerEnvironment } from "./environment.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { DENY_FLOOR, NO_MID_ATTEMPT_APPROVALS, PI_GATING_CAVEAT, WORKER_POSTURES } from "./permissions.mjs";
import { createPiAdapter, provePiProfileFlags } from "./pi.mjs";
import { rolesInPlay } from "./roles.mjs";
import { claudeTrustDecision, piTrustDecision, readClaudeConfigState, readPiTrust } from "./trust.mjs";

/**
 * The worker half of preflight: §6.2's layers 1 and 2, and §6.8's three
 * obligations, as the run-level checks the controller records (§9.7's order
 * puts them in different sections; layer 3 is `recheck.mjs`, per attempt).
 *
 * With the artifacts and config, cheap and local:
 *
 * - **`worker-isolation`** — build the controller-owned config environment both
 *   runtimes will run in, promoting only what §6.8 allows across.
 * - **`worker-permissions`** — the postures, the deny floor as actually written
 *   into the session settings, and pi's weaker gating recorded loudly.
 * - **`worker-trust`** — pre-trust the factory's own worktrees in that
 *   environment and read the decision back through each runtime's own rule, so
 *   no trust dialog can reach a worker pane.
 * - **`skill-closure`** — the §6.1 roles the active routing puts in play, each
 *   closed over `requires:` frontmatter from the pinned revision, with §6.8's
 *   conflict predicate and reference validation.
 * - **`worker-agent-state`** — §6.5's agent-state integration, the capability
 *   that pushes the transcript pointer, observed out of the environment the
 *   workers get: present, identifiable, and current, per runtime in play. A
 *   run that could not carry the pointer ends red here, named — not with a
 *   silent `null` on every `attempt.correlated` (§6.5, §6.8).
 *
 * Then, in the probe section:
 *
 * - **`runtime-probe`** — each runtime kind those roles can dispatch to, probed
 *   live through its §6.1 adapter **inside the environment the workers get**,
 *   with the capacity observation folded in. A probe run under the operator's
 *   own config would prove a world no worker will ever see.
 * - **`profile-flags`** — every distinct profile's own launch flags, handed to
 *   the installed binary before a pane depends on their spelling (#164). It is
 *   its own check rather than part of the probe because its cardinality is the
 *   profile's, not the revision's.
 *
 * Every check answers from one computation: the closure the probe proves is the
 * closure the static layer computed, and the environment the probe runs in is
 * the environment the isolation check built.
 */

/**
 * @param {object} input
 * @param {Readonly<object> | null} input.handshake §11.7's static handshake, or
 *   null when it failed — these checks then fail *citing* that, rather than
 *   guessing at a package nothing pinned
 * @param {object} input.config the validated configuration
 * @param {object} input.activeRouting
 * @param {string} input.cacheRoot the store directory (plugin cache lives beside
 *   `state.db`, as do the worker config environment and the private clone)
 * @param {string} input.repoRoot the repository the run is about — where §6.8's
 *   declared worker-context file is read from
 * @param {Record<string, string | undefined>} [input.env] the controller's
 *   environment: the operator's config roots are read from it, and worker
 *   sessions inherit it with the two config-directory variables replaced
 * @param {{ pi?: object, claude?: object }} [input.transports] per-runtime IO
 *   overrides, so a test drives every verdict without a harness on the machine
 * @returns {{ isolationCheck: () => object, permissionsCheck: () => object,
 *   trustCheck: () => object, closureCheck: () => object, agentStateCheck: () => object,
 *   runtimeCheck: () => Promise<object>, profileFlagsCheck: () => Promise<object>,
 *   productionContext: () => object | null }}
 */
export function createWorkerPreflight({ handshake, config, activeRouting, cacheRoot, repoRoot, env = {}, transports = {} }) {
	let computed = null;
	let isolation = null;
	let runtimeResults = null;
	let flagsProven = null;

	/**
	 * The §6.8 environment, built once. Its failure is data rather than a throw
	 * because every later check has to be able to say *why* it cannot answer,
	 * and a controller crashing inside preflight would lose the run's own record
	 * of what went wrong.
	 */
	const environment = () => {
		if (isolation !== null) return isolation;
		try {
			isolation = { ok: true, handle: prepareWorkerEnvironment({ storeDir: cacheRoot, repoRoot, worker: config.worker, env }) };
		} catch (error) {
			if (!(error instanceof FactoryWorkerError)) throw error;
			isolation = { ok: false, handle: null, error };
		}
		return isolation;
	};

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

	/**
	 * What the runtime probe observed per kind, or null while there is no green
	 * probe to answer from. Both the spelling check and the production context
	 * read it, so "the probe proved this" has one meaning in both.
	 */
	const provenRuntimes = () => {
		if (runtimeResults === null || runtimeResults.some((result) => !result.ok)) return null;
		return Object.freeze(Object.fromEntries(runtimeResults.map((result) => [result.kind, result.runtime])));
	};

	return {
		/**
		 * §6.8's config isolation, built rather than described: the check's own
		 * act is what creates the environment every later check and every worker
		 * session uses.
		 */
		isolationCheck() {
			const built = environment();
			if (!built.ok) {
				return check("worker-isolation", "static", "failed", {
					message: built.error.message,
					detail: { reason: built.error.reason, ...built.error.details },
				});
			}

			const facts = built.handle.manifestFacts();
			const environmentFacts = built.handle.environmentFacts();
			const message =
				`Workers run in the controller-owned config environment at ${built.handle.roots.root}, inheriting none of ` +
				`the operator's config, skills, or hooks; ` +
				(facts.worker_context_file.declared === null
					? "no worker-context file is declared"
					: `the declared worker-context file ${facts.worker_context_file.declared} is installed as ` +
						`${facts.worker_context_file.installed_as.join(" and ")}`) +
				(facts.pi_extensions.declared.length === 0
					? ""
					: `, and ${facts.pi_extensions.declared.length} declared pi extension(s) are promoted`) +
				" (§6.8).";

			// The facts ride the check itself, the way the handshake does: the run
			// manifest records them, and reading them back out of a `detail` field
			// would make the record depend on the reporting shape.
			return withFacts(
				{ overrides: facts, environment: environmentFacts },
				check("worker-isolation", "static", "passed", {
					message,
					detail: {
						...facts,
						config_environment: environmentFacts,
						promoted: { pi: [...built.handle.promoted.pi], claude: [...built.handle.promoted.claude] },
					},
				}),
			);
		},

		/**
		 * §6.8's postures, read back out of the files the sessions will actually
		 * load. Asserting the floor against the written settings rather than
		 * against the constant is the point: the constant is never what a worker
		 * reads.
		 */
		permissionsCheck() {
			const built = environment();
			if (!built.ok) return dependsOnIsolation("worker-permissions");

			const missing = [];
			for (const posture of Object.values(WORKER_POSTURES)) {
				const written = readSettings(built.handle, posture);
				for (const rule of DENY_FLOOR) {
					if (!(written.permissions?.deny ?? []).includes(rule)) missing.push({ posture, rule });
				}
				if (["acceptEdits", "bypassPermissions"].includes(written.permissions?.defaultMode)) {
					missing.push({ posture, rule: `defaultMode ${written.permissions.defaultMode}` });
				}
			}

			if (missing.length > 0) {
				return check("worker-permissions", "static", "failed", {
					message:
						`The session settings this run would inject do not carry the deny floor: ` +
						`${missing.map((entry) => `${entry.rule} missing for the ${entry.posture}`).join("; ")}. The floor is ` +
						`mechanical and override-proof, and a per-run override may only add denies (§6.8, §14.17).`,
					detail: { missing },
				});
			}

			const piInPlay = Object.values(config.profiles).some((profile) => profile.kind === "pi");
			return check("worker-permissions", "static", "passed", {
				message:
					`All Claude sessions run dontAsk with broad allows and the deny floor; reviewer sessions additionally have ` +
					`Edit, Write, and NotebookEdit withheld. plan and acceptEdits are never used — both open approval paths.` +
					(piInPlay ? ` ${PI_GATING_CAVEAT}` : ""),
				detail: {
					postures: Object.values(WORKER_POSTURES),
					extra_denies: [...config.worker.denies],
					pi_caveat: piInPlay ? PI_GATING_CAVEAT : null,
					// The sentence, not a flag: this is the contract #107's prompt
					// template states to the worker, and a boolean in the record would
					// be evidence of a promise whose wording nothing pinned.
					no_mid_attempt_approvals: NO_MID_ATTEMPT_APPROVALS,
				},
			});
		},

		/**
		 * §6.8's trust, proven rather than assumed.
		 *
		 * The paths are deterministic — the private clone and the worktrees root
		 * are derived from the store directory — so they can be trusted before
		 * either exists, which is what lets this run in the cheap section ahead of
		 * the clone that §7.1 creates later.
		 *
		 * What is proven here is the **state predicate**: each runtime's own
		 * resolution rule, applied to the path a pane will run in, answers
		 * "trusted". That is the whole guarantee, and it is deliberately not
		 * delegated to the probe — a `--print` session never meets the trust
		 * dialog at all (Claude skips it in non-interactive mode), so a green
		 * probe says nothing about a pane. `claude.mjs` adds the one thing a
		 * session *can* contribute: no project accumulated in the controller-owned
		 * state may be one nobody trusted.
		 */
		trustCheck() {
			const built = environment();
			if (!built.ok) return dependsOnIsolation("worker-trust");

			const worktrees = worktreesRoot(cacheRoot);
			const gitCommonDir = privateClonePath(cacheRoot);
			const decisions = { pi: null, claude: false };

			try {
				// The root, not one attempt: pi resolves by nearest ancestor, so this
				// one entry covers every attempt worktree, and Claude keys by
				// repository, so the clone is the key every attempt worktree resolves
				// to. Per-attempt pre-trust still happens at worktree creation
				// (`git/attempt.mjs`); this is the same writer, proven before the first
				// claim.
				built.handle.pretrust({ worktreePath: worktrees, gitCommonDir });

				const representative = `${worktrees}/probe-t0-a0`;
				decisions.pi = piTrustDecision(readPiTrust(built.handle.roots.pi), representative);
				decisions.claude = claudeTrustDecision(readClaudeConfigState(built.handle.roots.claude), gitCommonDir);
			} catch (error) {
				// A store that cannot be written is the same outcome as one that
				// reads back untrusted — a pane meeting the dialog — so it is this
				// check's own red rather than a crash inside preflight.
				return check("worker-trust", "static", "failed", {
					message:
						`Pre-trust could not be written to the controller-owned config scope: ${error.message}. A worker pane ` +
						`would meet the trust dialog and hang there (§6.8).`,
					detail: { decisions, worktrees, git_common_dir: gitCommonDir, error: error.code ?? null },
				});
			}

			if (decisions.pi !== true || decisions.claude !== true) {
				return check("worker-trust", "static", "failed", {
					message:
						`Pre-trust did not read back as accepted (pi ${JSON.stringify(decisions.pi)}, Claude ` +
						`${JSON.stringify(decisions.claude)}) for the factory's own worktrees. A worker pane would meet the ` +
						`trust dialog and hang there, which is an automation failure, not a slow worker (§6.8).`,
					detail: { decisions, worktrees, git_common_dir: gitCommonDir },
				});
			}

			return check("worker-trust", "static", "passed", {
				message:
					`The factory's own worktrees are pre-trusted in controller-owned scope for both runtimes: pi by nearest ` +
					`ancestor on ${worktrees}, Claude by the repository key ${gitCommonDir} that every attempt worktree ` +
					`resolves to. No trust dialog can reach a worker pane (§6.8).`,
				detail: { decisions, worktrees, git_common_dir: gitCommonDir },
			});
		},

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

		/**
		 * §6.5's transcript pointer, promoted rather than inherited (§6.8): the
		 * herdr-managed integration that pushes it, observed out of the operator's
		 * config root the environment read it from. The environment only records
		 * facts — installed, digest, version — and this check is where those facts
		 * become a verdict: a missing, unidentifiable, unversioned, or outdated
		 * integration is a named red, because the pointer has no other channel and
		 * every attempt of that runtime would otherwise correlate with
		 * `transcript: null`, which is the plausible zero §6.5 says to refuse.
		 *
		 * The gate is per runtime the **active routing** can dispatch to — not per
		 * runtime the host has installed — for the same reason the permissions
		 * check's caveat is: a verdict about this run, not a survey of the host.
		 * And the version is **observed** out of the file's own header and compared
		 * against the one in `AGENT_STATE_INTEGRATION` — the number the factory is
		 * written against — so a file herdr left outdated, or updated ahead of the
		 * factory, is a finding naming both rather than an assumption either way
		 * (§11.2: measured, not assumed).
		 */
		agentStateCheck() {
			const state = closure();
			if (state.unresolved) return unpinned("worker-agent-state", "static");

			const built = environment();
			if (!built.ok) return dependsOnIsolation("worker-agent-state");

			const kinds = runtimeKinds(state.roles, config.profiles);
			const findings = [];
			const runtimes = {};
			for (const kind of [...kinds.keys()].sort()) {
				const observed = built.handle.agentState[kind];
				const expected = AGENT_STATE_INTEGRATION[kind].version;
				// The digest is not repeated here: it rides the worker-isolation
				// check's facts one line up the same stream, and a check that
				// re-records its neighbour's evidence is a second tally.
				runtimes[kind] = {
					installed: observed.installed,
					source: observed.source,
					observed_version: observed.version,
					expected_version: expected,
				};

				if (!observed.installed) {
					findings.push({
						reason: "agent-state-missing",
						runtime: kind,
						source: observed.source,
						message:
							`The ${kind} agent-state integration — the capability that pushes §6.5's transcript ` +
							`pointer — is not installed at ${observed.source}, and the pointer has no other channel: ` +
							`every ${kind} attempt of this run would correlate with no transcript. Install herdr's ` +
							`${kind} integration (§6.5, §6.8).`,
						});
					continue;
				}
				if (observed.version === null) {
					findings.push({
						reason: "agent-state-unversioned",
						runtime: kind,
						source: observed.source,
						message:
							`The ${kind} agent-state integration at ${observed.source} carries no readable ` +
							`HERDR_INTEGRATION_VERSION header, so the version a run would observe cannot be stated ` +
							`(§11.2). Reinstall it so the integration states its own identity (§6.5).`,
						});
					continue;
				}
				if (observed.id !== kind) {
					findings.push({
						reason: "agent-state-mismatch",
						runtime: kind,
						source: observed.source,
						message:
							`The ${kind} agent-state slot at ${observed.source} is identified as ` +
							`${JSON.stringify(observed.id)} — not the ${kind} integration. Reinstall it so the ` +
							`right integration lands in the right slot (§6.5).`,
						});
					continue;
				}
				if (observed.version !== expected) {
					findings.push({
						reason: "agent-state-version-mismatch",
						runtime: kind,
						source: observed.source,
						observed_version: observed.version,
						expected_version: expected,
						message:
							`The ${kind} agent-state integration at ${observed.source} observes as version ` +
							`${observed.version}; the factory is written against ${expected}. The number comes from ` +
							`the file's own header — observed, not assumed (§6.5, §11.2). Update the integration or ` +
							`the factory against it, deliberately.`,
						});
				}
			}

			if (findings.length > 0) {
				return check("worker-agent-state", "static", "failed", {
					message: `The §6.5 agent-state integration is not current for this run: ${findings.map((entry) => entry.message).join(" ")}`,
					detail: { findings, runtimes },
				});
			}

			return check("worker-agent-state", "static", "passed", {
				message:
					`The §6.5 agent-state integration is installed and current for ` +
					Object.entries(runtimes)
					.map(([kind, entry]) => `${kind} (observed ${entry.observed_version})`)
					.join(", ") +
					`, promoted into the run's own config environment — the transcript pointer is a ` +
					`capability, not an accident of the operator's home (§6.5, §6.8).`,
				detail: { runtimes },
			});
		},

		/** Layer 2 with the capacity observation folded in, in the probe section. */
		async runtimeCheck() {
			const state = closure();
			if (state.unresolved) return unpinned("runtime-probe", "probe");

			const built = environment();
			if (!built.ok) return dependsOnIsolation("runtime-probe", "probe");

			const packageRev = handshake.tree.digest;
			const kinds = runtimeKinds(state.roles, config.profiles);
			const results = [];

			for (const kind of [...kinds.keys()].sort()) {
				const adapter = adapterFor(kind, {
					state,
					handshake,
					config,
					cacheRoot,
					environment: built.handle,
					transport: transports[kind],
				});
				for (const role of kinds.get(kind)) {
					results.push(await adapter.preflight(role, packageRev));
				}
			}

			runtimeResults = Object.freeze(results);
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

		/**
		 * §6.2's flag-spelling proof, in the probe section right behind the runtime
		 * probe (#164).
		 *
		 * **Cardinality: one session per distinct profile the active routing can
		 * dispatch** — a routing table naming one profile in every role and in a
		 * rule costs one, because what is being proven is a property of the profile
		 * and not of the role that reached it. §6.2's runtime probe keeps its own
		 * cardinality, one per pinned revision: folding profiles into it would have
		 * changed that number rather than its argv, which is a different design.
		 *
		 * **It runs behind the runtime probe deliberately.** The probe starts the
		 * same kind of session without the profile's flags, so a green probe and a
		 * refused spelling session differ by exactly those flags — which is what
		 * makes this a spelling verdict rather than a guess about a broken harness.
		 * With no green probe to stand on there is nothing to attribute against, so
		 * the check says so and points at the one that carries the diagnosis.
		 */
		async profileFlagsCheck() {
			const state = closure();
			if (state.unresolved) return unpinned("profile-flags", "probe");

			const built = environment();
			if (!built.ok) return dependsOnIsolation("profile-flags", "probe");

			const runtimes = provenRuntimes();
			if (runtimes === null) {
				return check("profile-flags", "probe", "failed", {
					message:
						`No runtime was proven on the production path, so a profile's flags have nothing to be accepted or ` +
						`refused *by* — see the runtime-probe check (§6.2).`,
					detail: { cause: "runtime-probe" },
				});
			}

			const byKind = profilesInPlay(state.roles, config.profiles);
			const findings = [];
			const reported = [];
			for (const kind of [...byKind.keys()].sort()) {
				const proven = await proveProfileFlagsFor(kind, {
					profiles: byKind.get(kind),
					skillsRoots: state.skillsRoots,
					// A green Claude probe has a built plugin by construction —
					// `ensureClaudePlugin` runs before the initialize step and its failure
					// is the probe's own red — so the dir the launch argv is composed from
					// is present here, and the launch's `requireProvenPlugin` is still the
					// fail-closed point if that ever stops holding (§6.3, #160).
					pluginDir: runtimes.claude?.plugin?.dir ?? null,
					cacheRoot,
					environment: built.handle,
					transport: transports[kind],
				});
				findings.push(...proven.findings);
				reported.push(...proven.checked.map((entry) => ({ ...entry, kind, binary: proven.binary })));
			}

			flagsProven = findings.length === 0;
			if (!flagsProven) {
				return check("profile-flags", "probe", "failed", {
					message:
						`The installed binary did not accept every profile's flag spelling (§6.2, §11.7): ` +
						findings.map((finding) => finding.message).join(" "),
					detail: { findings, profiles: reported },
				});
			}

			return check("profile-flags", "probe", "passed", {
				message:
					`Every distinct profile the active routing can dispatch has its flag spelling accepted by the installed ` +
					`binary: ` +
					reported.map((entry) => `${entry.profile} (${entry.kind}, ${entry.flags.join(" ")})`).join(", ") +
					`. One session per distinct profile and no model call; §6.2's runtime probe stays one per pinned revision.`,
				detail: { revision: handshake.tree.digest, profiles: reported },
			});
		},

		/**
		 * The already-proven values the production ticket pipeline executes with.
		 * They remain off the report shape: these handles are process-local seams,
		 * while the checks above are the durable evidence an operator reads.
		 */
		productionContext() {
			const state = closure();
			const built = environment();
			const runtimes = provenRuntimes();
			if (state.unresolved || state.findings.length > 0 || !built.ok || runtimes === null) return null;
			// A profile whose flags the binary never accepted would launch a pane
			// that cannot come up, which is the whole of #164 — so an unproven
			// spelling composes nothing, exactly as an unproven runtime does not.
			if (flagsProven !== true) return null;

			return Object.freeze({
				environment: built.handle,
				roles: state.roles,
				packageRev: handshake.tree.digest,
				// The two skill-delivery facts the probe proved, hoisted side by side
				// for the launch half of the same binding (#160): the pi roots and the
				// §6.3 plugin directory. The composer reads two symmetric facts rather
				// than walking one runtime's observation shape.
				skillsRoots: Object.freeze([...state.skillsRoots]),
				pluginDir: runtimes.claude?.plugin?.dir ?? null,
				runtimes,
			});
		},
	};
}

/**
 * The **distinct** profiles the roles in play can dispatch to, grouped by runtime
 * kind and sorted by name (#164).
 *
 * Distinct by name is the whole point: `runtimeKinds` below answers a different
 * question — which kinds to probe — and a profile named by four roles is one
 * profile whose flags one session settles.
 *
 * It is also the one answer to "which profiles does this run reach": the runtime
 * probe's model-availability check reads it too, so the set whose flags are proven
 * and the set whose models are proven cannot drift apart.
 */
function profilesInPlay(roles, profiles) {
	const byKind = new Map();
	for (const name of [...new Set(roles.flatMap((role) => role.profiles))].sort()) {
		const kind = profiles[name].kind;
		if (!byKind.has(kind)) byKind.set(kind, []);
		byKind.get(kind).push({ name, ...profiles[name] });
	}
	return byKind;
}

/**
 * One runtime's flag-spelling proof, over the same builder binding the probe ran
 * and the same skill-delivery facts the probe proved (#160's composed binding).
 *
 * The reviewer binding is not spelled out for a second time here for the reason
 * `probeSession` already gives: it differs only by flags the same binary has
 * accepted, and a profile's own flags are identical under both postures.
 */
function proveProfileFlagsFor(kind, { profiles, skillsRoots, pluginDir, cacheRoot, environment, transport }) {
	const session = probeSession(kind, { environment, cacheRoot });
	const io = transport === undefined ? {} : { transport };

	return kind === "pi"
		? provePiProfileFlags({ profiles, skillsRoots, session, ...io })
		: proveClaudeProfileFlags({ profiles, pluginDir, session, ...io });
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

/**
 * The probe runs the **builder** binding, in the environment and working
 * directory a worker gets (§6.2's "production path, executed"):
 *
 * - pi in the worktrees root, whose trust entry every attempt worktree inherits
 *   by pi's own nearest-ancestor rule;
 * - Claude in the private clone, which is the project key every attempt
 *   worktree resolves to.
 *
 * The reviewer binding is not probed: it differs only by flags the same binary
 * has already accepted, and §8.4's before/after mutation attestation — not a
 * probe — is what actually guards a reviewer.
 */
function probeSession(kind, { environment, cacheRoot }) {
	const binding = environment.binding({ kind, posture: WORKER_POSTURES.builder });
	const cwd = kind === "pi" ? worktreesRoot(cacheRoot) : privateClonePath(cacheRoot);

	return {
		env: binding.env,
		sessionArgs: binding.args,
		// A directory that does not exist yet fails the spawn, not the probe's
		// judgement, so the store directory stands in — it always exists, and the
		// check whose absence this is (git isolation) is already red on its own.
		cwd: existsSync(cwd) ? cwd : cacheRoot,
		configDir: environment.roots[kind],
	};
}

function adapterFor(kind, { state, handshake, config, cacheRoot, environment, transport }) {
	const declaredResources = config.concurrency.resources;
	const session = probeSession(kind, { environment, cacheRoot });

	if (kind === "pi") {
		// The same "which distinct profiles do the roles in play reach" the spelling
		// check asks, from the same place: two answers to it could disagree about
		// which models the probe holds the inventory to (§6.2).
		const piProfiles = profilesInPlay(state.roles, config.profiles).get("pi") ?? [];

		return createPiAdapter({
			skillsRoots: state.skillsRoots,
			profiles: piProfiles,
			declaredResources,
			requiredClasses: [...new Set(piProfiles.map((profile) => resourceClassOf({ kind: "pi", model: profile.model })))],
			session,
			...(transport === undefined ? {} : { transport }),
		});
	}

	return createClaudeAdapter({
		packageRoot: handshake.package.root,
		cacheRoot,
		expectedSkills: [...state.inventory.skills.keys()].sort(),
		declaredSize: declaredResources[CLAUDE_RESOURCE_CLASS] ?? null,
		session,
		...(transport === undefined ? {} : { transport }),
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

/**
 * The same shape one level down: a check whose answer would be about a config
 * environment that was never built says so and points at the check that carries
 * the diagnosis, rather than repeating it in a vaguer form.
 */
function dependsOnIsolation(name, className = "static") {
	return check(name, className, "failed", {
		message:
			`The controller-owned worker config environment could not be built, so there is nothing to answer about — ` +
			`see the worker-isolation check (§6.8).`,
		detail: { cause: "worker-isolation" },
	});
}

/** The settings a session of one posture will load, read back off disk. */
function readSettings(handle, posture) {
	return JSON.parse(readFileSync(handle.settingsPath(posture), "utf8"));
}

function check(name, className, result, { message, detail }) {
	return { check: name, class: className, result, message, detail };
}

/** A check carrying what the run manifest records beside what it reports. */
function withFacts(facts, checked) {
	return { ...checked, facts };
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
			// §6.8's discovery fence and whether this run proved it (#163) — a green
			// check that recorded nothing about the fence leaves an operator unable
			// to tell the proof from its absence.
			...(result.runtime.discovery === undefined || result.runtime.discovery === null
				? {}
				: { discovery: result.runtime.discovery }),
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
