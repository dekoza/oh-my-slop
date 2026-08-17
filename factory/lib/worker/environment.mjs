import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { FactoryWorkerError } from "./errors.mjs";
import { claudeSessionArguments, claudeSettingsDocument, piSessionArguments, WORKER_POSTURES } from "./permissions.mjs";
import { pretrustClaude, pretrustPi, claudeTrustKeys } from "./trust.mjs";

/**
 * §6.5's agent-state integration, per runtime: the capability that pushes the
 * transcript pointer into Herdr (a `SessionStart` hook for Claude, an
 * extension for pi), installed by herdr into the operator's own config root.
 *
 * It is §6.8's first closed list — a **fixed capability artifact named in
 * code per runtime**, beside the credentials and the model catalogue — and
 * not `worker.piExtensions`: the factory's own model depends on the pointer
 * (the one channel that disambiguates worker and reviewer panes as a fact),
 * so a capability the operator may or may not declare is not the right
 * channel for it, and an empty declared list would re-lose the pointer
 * silently, which is exactly the absence this promotion ends.
 *
 * `file` is where herdr installs it, relative to the operator's config root;
 * the same relative path is where it is copied into the run's root, because
 * that is where each runtime looks — pi auto-discovers extensions from the
 * agent directory's `extensions/`, and Claude's hook is wired into the
 * session settings at that run-owned path.
 *
 * `version` is the one the factory is written against. The installed file
 * states its own version in a leading `HERDR_INTEGRATION_VERSION` comment, and
 * the environment **observes** that number rather than assuming it: a file
 * herdr left outdated, or one that lost its header, is a named preflight
 * finding (§11.2) — never a silent `no-transcript-pointer` on every attempt.
 */
export const AGENT_STATE_INTEGRATION = Object.freeze({
	pi: Object.freeze({ file: "extensions/herdr-agent-state.ts", version: 8 }),
	claude: Object.freeze({ file: "hooks/herdr-agent-state.sh", version: 7 }),
});

/**
 * §6.8's **config isolation — promotion, not inheritance**: workers run in a
 * controller-owned config environment and never inherit the operator's personal
 * `~/.claude` or `~/.pi` config, skills, or hooks.
 *
 * The environment is a directory the controller owns, beside `state.db`, with
 * one root per runtime — `CLAUDE_CONFIG_DIR` and `PI_CODING_AGENT_DIR`, each
 * runtime's own documented variable. It is **derived, disposable state**: every
 * run rebuilds it, so a key the config stopped declaring stops existing rather
 * than lingering as policy nobody can read.
 *
 * **What crosses in, and why that is not inheritance.** Three closed lists:
 *
 * 1. **Capability artifacts** (`PROMOTED`, below) — credentials and the model
 *    catalogue. They carry no behaviour: no skills, no hooks, no prompts, no
 *    personal rules. §6.8 already records that on this host push authority is
 *    ambient and credentials are readable by any same-user process, so copying
 *    an auth file changes nothing about what a worker *could* do; refusing to
 *    copy it would only mean the worker cannot work at all.
 * 2. **The declared worker-context file** — §6.8's second migration channel for
 *    personal rules, copied in at run start and hash-recorded in the manifest.
 *    It lands as each runtime's own user-memory file, which is precisely the
 *    slot the operator's personal one would have occupied.
 * 3. **Declared pi extensions** — see `config/worker.mjs`. Isolation empties the
 *    agent directory of extensions, and on this host that silently removes the
 *    `local` resource class. A declared, manifest-recorded promotion is the
 *    honest answer; live inheritance is not a channel. §6.5's transcript
 *    pointer, which isolation removes with it, crosses in as a fixed
 *    capability artifact instead — `AGENT_STATE_INTEGRATION`, above: the
 *    herdr-managed hook and extension that push it, copied into the run's
 *    roots and version-observed, because a capability the factory's own model
 *    depends on is not one the operator may or may not declare.
 *
 * Everything else the operator has — settings, skills roots, extensions,
 * prompts, themes, `AGENTS.md`, `CLAUDE.md`, hooks — is simply not there, which
 * is verifiable rather than promised: a live pi session in this environment
 * answered 65 skill command records, all from the pinned package root, and a
 * live Claude session answered a commands array carrying no operator skill.
 */

/** The one directory the worker config environment occupies (§4.1's peers). */
export const WORKER_CONFIG_SEGMENT = "worker-config";

/**
 * The capability artifacts promoted into each runtime's root, by the name each
 * runtime reads them under. A name here is a decision that this file carries
 * capability and no behaviour; adding one is that decision, made again.
 */
const PROMOTED = Object.freeze({
	// `auth.json` is the provider credentials; `models.json` declares the
	// providers themselves (a `local` provider's `baseUrl` is what §9.7's
	// capacity observation reaches); `models-store.json` is the fetched catalogue.
	pi: Object.freeze(["auth.json", "models.json", "models-store.json"]),
	claude: Object.freeze([".credentials.json"]),
});

/** Where the declared worker-context file lands, per runtime (§6.8's channel 2). */
const CONTEXT_FILENAME = Object.freeze({ pi: "AGENTS.md", claude: "CLAUDE.md" });

/** The settings file injected per session, one per posture (§6.8). */
const CLAUDE_SETTINGS_FILE = Object.freeze({
	[WORKER_POSTURES.builder]: "settings-builder.json",
	[WORKER_POSTURES.reviewer]: "settings-reviewer.json",
});

/** Each runtime's own config-directory variable — its spelling, not ours. */
const CONFIG_DIR_ENV = Object.freeze({ pi: "PI_CODING_AGENT_DIR", claude: "CLAUDE_CONFIG_DIR" });

/**
 * The runtimes this environment builds a root for, read off the tables above so
 * the list and the tables cannot drift apart. Adding a runtime is a row in each
 * table and nothing here.
 */
const RUNTIME_KINDS = Object.freeze(Object.keys(CONFIG_DIR_ENV));

/**
 * @param {string} storeDir the repository's store directory
 * @returns {Readonly<{ root: string, pi: string, claude: string }>}
 */
export function workerConfigRoots(storeDir) {
	const root = join(storeDir, WORKER_CONFIG_SEGMENT);
	return Object.freeze({ root, pi: join(root, "pi"), claude: join(root, "claude") });
}

/**
 * Build the environment, from scratch, for one run.
 *
 * @param {object} input
 * @param {string} input.storeDir the repository's store directory
 * @param {string} input.repoRoot the repository the run is about (the context file's root)
 * @param {Readonly<object>} input.worker the validated `worker` config block
 * @param {Record<string, string | undefined>} [input.env] the controller's environment,
 *   read for the operator's own config roots and inherited by worker sessions
 * @param {string} [input.home] the operator's home directory. `env.HOME` first,
 *   then the OS home — the fallback is deliberate, since a controller invoked
 *   with a stripped environment still has an operator whose credentials the
 *   promotion needs, but it does mean an injected environment without `HOME`
 *   reaches the real one
 * @returns {Readonly<object>} the environment handle
 * @throws {FactoryWorkerError} `config-environment-invalid`
 */
export function prepareWorkerEnvironment({
	storeDir,
	repoRoot,
	worker,
	env = process.env,
	home = env.HOME?.trim() || homedir(),
}) {
	const roots = workerConfigRoots(storeDir);
	const operator = operatorRoots({ env, home });

	for (const kind of RUNTIME_KINDS) mkdirSync(roots[kind], { recursive: true });

	const promoted = Object.fromEntries(RUNTIME_KINDS.map((kind) => [kind, promote(operator[kind], roots[kind], PROMOTED[kind])]));
	const context = installContextFile({ roots, repoRoot, declared: worker.contextFile });
	const extensions = resolveExtensions(worker.piExtensions, home);
	const agentState = Object.fromEntries(
		RUNTIME_KINDS.map((kind) => [kind, installAgentState(operator[kind], roots[kind], kind)]),
	);

	// pi discovers its own settings; an empty controller-owned file is the
	// statement that this environment has none — no packages, no skills roots,
	// no personal defaults — rather than a file pi would create for itself.
	writeFileSync(join(roots.pi, "settings.json"), "{}\n", "utf8");

	const settingsPaths = {};
	for (const posture of Object.values(WORKER_POSTURES)) {
		const path = join(roots.claude, CLAUDE_SETTINGS_FILE[posture]);
		// The hook is wired only when the run actually owns the script it points
		// at: a hook whose command names an absent file would be a session that
		// errors on `SessionStart` rather than a worker that loses §6.5's
		// pointer, and preflight's `worker-agent-state` check is the red that
		// keeps the latter from reaching a claim.
		const hook = agentState.claude.installed
			? `bash '${join(roots.claude, AGENT_STATE_INTEGRATION.claude.file)}' session`
			: null;
		writeFileSync(path, `${JSON.stringify(claudeSettingsDocument({ posture, extraDenies: worker.denies, sessionStartHook: hook }), null, 2)}\n`, "utf8");
		settingsPaths[posture] = path;
	}

	return Object.freeze({
		roots,
		promoted: Object.freeze(promoted),
		context,
		extensions,
		agentState: Object.freeze(agentState),

		/**
		 * §6.8's per-attempt pre-trust, through both runtimes' stores at once.
		 * A worktree is not usable by a worker until it is trusted, and splitting
		 * the two writes across two callers is how one of them gets forgotten.
		 *
		 * @param {{ worktreePath: string, gitCommonDir: string }} where
		 * @returns {{ pi: ReadonlyArray<string>, claude: ReadonlyArray<string> }} what was trusted
		 */
		pretrust({ worktreePath, gitCommonDir }) {
			const piPaths = [resolve(worktreePath)];
			const claudeKeys = claudeTrustKeys({ worktreePath, gitCommonDir });
			pretrustPi(roots.pi, piPaths);
			pretrustClaude(roots.claude, claudeKeys);
			return { pi: Object.freeze(piPaths), claude: claudeKeys };
		},

		/**
		 * The environment and flags one session runs under (§6.8). #107's launch
		 * and §6.2's probe take the same binding, because a probe that proves a
		 * different environment from the one the worker gets proves nothing.
		 *
		 * `env` is the spawn environment for a probe the controller runs itself.
		 * `paneEnv` is the **closed** pane set: a worker pane's shell belongs to the
		 * multiplexer server, not to this controller, so the launch declares exactly
		 * these variables on the pane's tab (§6.5, #157) — never the controller's
		 * whole environment, which would reopen the inheritance channel this
		 * environment exists to close. Declared rather than typed, so the set does
		 * not also become pane scrollback the operator and every `pane read` sees.
		 *
		 * @param {{ kind: string, posture: string }} session
		 * @returns {{ env: Record<string, string | undefined>, paneEnv: Record<string, string>, args: ReadonlyArray<string> }}
		 */
		binding({ kind, posture }) {
			// **Both** variables, in both bindings. A pi worker that shells out to
			// `claude` — or the reverse — would otherwise land in the operator's own
			// config with all their skills and hooks, which is the one thing this
			// environment exists to prevent; the runtime that does not read a
			// variable is not harmed by it being set.
			const configDirs = { [CONFIG_DIR_ENV.pi]: roots.pi, [CONFIG_DIR_ENV.claude]: roots.claude };
			const isolated = { ...env, ...configDirs };

			if (kind === "pi") {
				// The declared extension environment rides only the sessions that load
				// the extensions, and the isolation variables are spread after it, so
				// no declared value can displace them even in an unvalidated block.
				const extensionEnv = Object.assign({}, ...extensions.map((extension) => extension.env));
				return Object.freeze({
					env: Object.freeze({ ...env, ...extensionEnv, ...configDirs }),
					paneEnv: Object.freeze({ ...extensionEnv, ...configDirs }),
					args: Object.freeze([
						...piSessionArguments({ posture }),
						...extensions.flatMap((extension) => ["--extension", extension.path]),
					]),
				});
			}
			if (kind === "claude") {
				// `claudeSessionArguments` validates the posture on its first line, so
				// an unknown one is refused there rather than reaching a settings path
				// that was never written — one posture vocabulary, one refusal.
				return Object.freeze({
					env: Object.freeze(isolated),
					paneEnv: Object.freeze({ ...configDirs }),
					args: Object.freeze(claudeSessionArguments({ posture, settingsPath: settingsPaths[posture] })),
				});
			}
			throw refuse(`"${kind}" is not a runtime this environment can bind a session for.`, { at: "kind", found: kind });
		},

		/**
		 * Where one posture's settings file is, without anyone parsing an argv.
		 *
		 * @param {string} posture
		 * @returns {string}
		 */
		settingsPath(posture) {
			const path = settingsPaths[posture];
			if (path !== undefined) return path;
			throw refuse(`"${posture}" is not a worker posture, so no settings file was written for it.`, {
				at: "posture",
				found: posture ?? null,
			});
		},

		/**
		 * What the run manifest records (§6.8's "declared, recorded").
		 *
		 * **Declarations and their digests.** The promoted capability list and the
		 * deny floor are code policy, not per-run choices, and recording them here
		 * would put decisions in evidence that no human made — the same reason
		 * `manifest.mjs` keeps the hard floor out. The context file's and each
		 * extension's **digest** are here because a path is a claim about intent
		 * and bytes are evidence: an extension edited between runs is visible, and
		 * a run re-entered with an edited context file is refused rather than
		 * quietly told something different.
		 *
		 * The agent-state integration records the same way (§6.5, §6.8): the
		 * declared source path, the content digest, and the version **observed**
		 * out of the file's own header. It is not code policy — herdr manages it
		 * in place and updates it in the operator's root, so what a run loaded is
		 * operator state worth pinning, and an integration edited or updated
		 * between runs is visible in the manifest rather than inferred.
		 */
		manifestFacts() {
			return {
				extra_denies: { declared: [...worker.denies] },
				agent_state: agentStateFacts(agentState),
				pi_extensions: {
					declared: extensions.map((extension) => ({
						declared: extension.declared,
						digest: extension.digest,
						env: { ...extension.env },
					})),
				},
				worker_context_file: {
					declared: context.declared,
					digest: context.digest,
					installed_as: context.declared === null ? [] : Object.values(CONTEXT_FILENAME).sort(),
				},
			};
		},

		/**
		 * Where the workers ran, as the manifest records it beside the overrides
		 * rather than among them. It is evidence of isolation, not a decision a
		 * human declared, and `overrides` is the block whose contract is the
		 * latter.
		 */
		environmentFacts() {
			return { claude: roots.claude, pi: roots.pi };
		},
	});
}

/** The operator's own config roots — the *source* of a promotion, never a fallback. */
function operatorRoots({ env, home }) {
	return Object.freeze({
		pi: env[CONFIG_DIR_ENV.pi]?.trim() || join(home, ".pi", "agent"),
		claude: env[CONFIG_DIR_ENV.claude]?.trim() || join(home, ".claude"),
	});
}

/**
 * §6.5's agent-state integration for one runtime: copied from the operator's
 * config root into the run's own, version-observed out of the file's header.
 *
 * The copy, like every promotion here, is rebuilt each run — a file herdr
 * removed from the operator's root stops existing in the run's root rather
 * than lingering as capability nobody granted. The facts are the check's
 * input and the manifest's evidence in one: `installed` is the predicate,
 * `version` and `id` are read off the bytes, and nothing about the
 * integration is assumed from the path alone.
 *
 * @param {string} operatorRoot the operator's config root for this runtime
 * @param {string} runRoot the run's own config root for this runtime
 * @param {string} kind `pi` or `claude`
 * @returns {Readonly<object>} the promotion's facts
 */
function installAgentState(operatorRoot, runRoot, kind) {
	const { file } = AGENT_STATE_INTEGRATION[kind];
	const source = join(operatorRoot, file);
	const target = join(runRoot, file);

	try {
		if (!statSync(source).isFile()) throw new Error("not a file");
	} catch {
		// The environment is rebuilt every run; a copy outliving its source
		// would be capability nobody granted this run.
		rmSync(target, { force: true });
		return Object.freeze({ installed: false, source, installed_as: null, digest: null, id: null, version: null });
	}

	const content = readFileSync(source);
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(source, target);
	const header = integrationHeader(content.toString("utf8"));

	return Object.freeze({
		installed: true,
		source,
		installed_as: target,
		digest: digestOf(content),
		id: header.id,
		version: header.version,
	});
}

/** What the manifest records per runtime: the declared path, the bytes, and the observed version — or null when nothing was promoted. */
function agentStateFacts(agentState) {
	const fact = (kind) => {
		const observed = agentState[kind];
		if (!observed.installed) return null;
		return { source: observed.source, digest: observed.digest, version: observed.version };
	};
	return Object.freeze({ pi: fact("pi"), claude: fact("claude") });
}

/**
 * The identity and version herdr stamps into the integration's leading
 * comments — the one surface the factory observes rather than assumes. Both
 * files spell the same keys under their own comment prefix (`#` and `//`),
 * so one scan strips either prefix and reads both; the claude file's shebang
 * is a `#` line like the rest, which is why the scan is bounded (sixty-four
 * leading lines) rather than terminated — the keys are herdr's, and a body
 * that merely mentions them must not read as a version.
 *
 * @param {string} content the integration file
 * @returns {{ id: string | null, version: number | null }}
 */
function integrationHeader(content) {
	let id = null;
	let version = null;
	for (const line of content.split("\n").slice(0, 64)) {
		const cleaned = line.replace(/^\s*(?:\/\/|#|\/\*)\s?/, "").trim();
		const idMatch = /^HERDR_INTEGRATION_ID=([A-Za-z0-9_-]+)$/.exec(cleaned);
		if (idMatch !== null) {
			id = idMatch[1];
			continue;
		}
		const versionMatch = /^HERDR_INTEGRATION_VERSION=(\d+)$/.exec(cleaned);
		if (versionMatch !== null) version = Number(versionMatch[1]);
	}
	return { id, version };
}

/**
 * Copy each named artifact that exists, remove the copy of each that does not,
 * and report what is now there.
 *
 * An absent one is not a failure: an operator who authenticates Claude through
 * a keychain has no `.credentials.json`, and refusing that would be the factory
 * inventing a requirement the harness does not have. It **is** a removal,
 * though — this environment is rebuilt every run, and a credential file that
 * outlived its source would be capability nobody granted this run.
 */
function promote(from, into, names) {
	const copied = [];
	for (const name of names) {
		const source = join(from, name);
		const target = join(into, name);
		try {
			if (!statSync(source).isFile()) throw new Error("not a file");
		} catch {
			rmSync(target, { force: true });
			continue;
		}
		copyFileSync(source, target);
		copied.push(name);
	}
	return Object.freeze(copied);
}

/**
 * §6.8's channel 2, or its deliberate absence.
 *
 * When nothing is declared the target files are **removed**, not left: a
 * context file from a previous run still sitting in the environment would be
 * personal rules reaching a worker through no channel at all.
 */
function installContextFile({ roots, repoRoot, declared }) {
	if (declared === null) {
		for (const kind of RUNTIME_KINDS) rmSync(join(roots[kind], CONTEXT_FILENAME[kind]), { force: true });
		return Object.freeze({ declared: null, digest: null, source: null });
	}

	const source = join(repoRoot, declared);
	let content;
	try {
		content = readFileSync(source, "utf8");
	} catch (error) {
		throw refuse(
			`worker.contextFile declares ${declared}, and ${source} cannot be read (${error.code ?? error.message}). ` +
				`It is one of §6.8's two channels for personal rules, so a missing one is a declared policy that would ` +
				`silently not reach any worker.`,
			{ at: "worker.contextFile", found: declared, path: source },
		);
	}

	for (const kind of RUNTIME_KINDS) writeFileSync(join(roots[kind], CONTEXT_FILENAME[kind]), content, "utf8");

	return Object.freeze({
		declared,
		digest: digestOf(content),
		source,
	});
}

/**
 * Declared extensions, resolved and **digested**.
 *
 * The digest is what turns §6.8's third channel from a promise about intent
 * into evidence: the manifest records which bytes a run loaded, so an extension
 * edited between runs is visible rather than inferred from a path that did not
 * change. A missing one is a refusal, never a skip — an extension the
 * environment cannot load is a capability the run believes it has and does not.
 *
 * An extension's declared `env` travels with it: a promoted provider whose
 * endpoint arrives from the operator's ambient shell is a capability the run
 * cannot account for, so the values a session needs are declared beside the
 * path and recorded beside the digest.
 */
function resolveExtensions(declared, home) {
	return Object.freeze(
		declared.map(({ path, env: extensionEnv }) => {
			const absolute = path.startsWith("~/") ? join(home, path.slice(2)) : path;
			try {
				// A directory is a legitimate extension source for pi, so the digest is
				// of the entry itself when it is a file and of nothing when it is not;
				// the path is the evidence in that case, and the check is presence.
				const stat = statSync(absolute);
				return Object.freeze({
					declared: path,
					path: absolute,
					env: Object.freeze({ ...extensionEnv }),
					digest: stat.isFile() ? digestOf(readFileSync(absolute)) : null,
				});
			} catch {
				throw refuse(
					`worker.piExtensions declares ${path}, and nothing is at ${absolute}. An extension the worker ` +
						`environment cannot load is a capability the run believes it has and does not.`,
					{ at: "worker.piExtensions", found: path, path: absolute },
				);
			}
		}),
	);
}

function digestOf(content) {
	return createHash("sha256").update(content).digest("hex");
}

function refuse(sentence, details) {
	return new FactoryWorkerError("config-environment-invalid", `${sentence} (§6.8).`, details);
}
