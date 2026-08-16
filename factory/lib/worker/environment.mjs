import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { FactoryWorkerError } from "./errors.mjs";
import { claudeSessionArguments, claudeSettingsDocument, piSessionArguments, WORKER_POSTURES } from "./permissions.mjs";
import { pretrustClaude, pretrustPi, claudeTrustKeys } from "./trust.mjs";

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
 *    `local` resource class and §6.5's transcript pointer. A declared,
 *    manifest-recorded promotion is the honest answer; live inheritance is not
 *    a channel.
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

	// pi discovers its own settings; an empty controller-owned file is the
	// statement that this environment has none — no packages, no skills roots,
	// no personal defaults — rather than a file pi would create for itself.
	writeFileSync(join(roots.pi, "settings.json"), "{}\n", "utf8");

	const settingsPaths = {};
	for (const posture of Object.values(WORKER_POSTURES)) {
		const path = join(roots.claude, CLAUDE_SETTINGS_FILE[posture]);
		writeFileSync(path, `${JSON.stringify(claudeSettingsDocument({ posture, extraDenies: worker.denies }), null, 2)}\n`, "utf8");
		settingsPaths[posture] = path;
	}

	return Object.freeze({
		roots,
		promoted: Object.freeze(promoted),
		context,
		extensions,

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
		 * @param {{ kind: string, posture: string }} session
		 * @returns {{ env: Record<string, string | undefined>, args: ReadonlyArray<string> }}
		 */
		binding({ kind, posture }) {
			// **Both** variables, in both bindings. A pi worker that shells out to
			// `claude` — or the reverse — would otherwise land in the operator's own
			// config with all their skills and hooks, which is the one thing this
			// environment exists to prevent; the runtime that does not read a
			// variable is not harmed by it being set.
			const isolated = { ...env, [CONFIG_DIR_ENV.pi]: roots.pi, [CONFIG_DIR_ENV.claude]: roots.claude };

			if (kind === "pi") {
				return Object.freeze({
					env: Object.freeze(isolated),
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
		 */
		manifestFacts() {
			return {
				extra_denies: { declared: [...worker.denies] },
				pi_extensions: {
					declared: extensions.map((extension) => ({ declared: extension.declared, digest: extension.digest })),
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
 */
function resolveExtensions(declared, home) {
	return Object.freeze(
		declared.map((path) => {
			const absolute = path.startsWith("~/") ? join(home, path.slice(2)) : path;
			try {
				// A directory is a legitimate extension source for pi, so the digest is
				// of the entry itself when it is a file and of nothing when it is not;
				// the path is the evidence in that case, and the check is presence.
				const stat = statSync(absolute);
				return Object.freeze({
					declared: path,
					path: absolute,
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
