import { recordCheckOutputs } from "../checks/artifacts.mjs";
import { baselineForRepo } from "../checks/baseline.mjs";
import { FactoryEffectError } from "../effects/errors.mjs";
import { gitIsolationCheck } from "../git/preflight.mjs";
import { FactoryPackageError } from "../package/errors.mjs";
import { assertPackageIntact, packageHandshake, recordPackageHandshake } from "../package/handshake.mjs";
import { sourceForActor } from "../state/events.mjs";
import { createWorkerPreflight } from "../worker/preflight.mjs";
import { probeHerdr } from "./herdr.mjs";
import { writeRunManifest } from "./manifest.mjs";

/**
 * §10.3's preflight: **an observable phase with per-check and per-probe results,
 * not a pass/fail gate.**
 *
 * It runs **after the run exists**, which is the whole reason `baseline-red` can
 * be a run end reason naming a specific red check: a gate that ran before the
 * run had an id could only refuse, and an operator would be left with a refusal
 * and no run to look at. Every check here writes a record on the run's own
 * stream, hanging off **no tracker ticket** — these are run-scoped stages.
 *
 * Order is §9.7's: **artifacts and config (cheap, local) → runtime probes →
 * baseline (expensive)**. A wrong number fails before a full test suite is spent
 * discovering it.
 */

/**
 * What a check answers.
 *
 * `unbuilt` is neither of the other two, and that is deliberate. A check whose
 * subsystem has not landed has observed nothing, so calling it `passed` would be
 * the plausible zero §10.5 refuses everywhere else — and calling it `failed`
 * would end every run in this package `baseline-red`, which is a refusal
 * disguised as a verdict. It is reported, named, and does not colour the phase.
 * What keeps that honest is the drain report: a run that claims nothing says so
 * in the same breath, so §9.7's "green-looking run that did nothing" has nowhere
 * to hide.
 */
export const PREFLIGHT_RESULTS = Object.freeze({ passed: "passed", failed: "failed", unbuilt: "unbuilt" });

/** A static artifact check, or a live probe of something outside this process. */
export const PREFLIGHT_CLASSES = Object.freeze({ static: "static", probe: "probe" });

/**
 * @param {object} store an open store
 * @param {object} context
 * @param {string} context.run
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {object} context.scope §3.1's selector
 * @param {object} context.config the validated configuration
 * @param {string} context.configPath
 * @param {string} context.repoRoot the repository the run is about — §6.8's declared
 *   worker-context file is read from it
 * @param {object} context.activeRouting
 * @param {Record<string, ReadonlyArray<string>>} context.declared
 * @param {string} [context.executable] §11.7's anchor
 * @param {Record<string, string | undefined>} [context.env]
 * @param {(options: object) => Promise<object>} [context.herdr] §10.3's availability
 *   probe, injectable so a test drives both answers without a multiplexer on the machine
 * @param {{ pi?: object, claude?: object }} [context.workerTransports] the §6.2
 *   runtime probes' IO, injectable for the same reason `herdr` is: the real
 *   transports spawn the operator's harnesses
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<object>>} the phase's results, red checks first-class
 */
export async function preflight(
	store,
	{
		run,
		hold,
		scope,
		config,
		configPath,
		repoRoot,
		activeRouting,
		declared,
		executable,
		env,
		herdr = probeHerdr,
		workerTransports = {},
		actor,
		at,
	},
) {
	const checks = [];
	const record = (check) => {
		checks.push(emit(store, { run, actor, at, check }));
		return check;
	};

	// ── Artifacts and config: cheap, local, and first (§9.7) ─────────────────
	const handshake = record(
		handshakeCheck(store, { run, executable, env, expect: config.package?.expect ?? null, hold, actor, at }),
	);

	// §6.2's layers 1 and 2 and §6.8's three obligations, over the handshake's own
	// pin: one computation behind the closure, the environment, and the probe.
	const worker = createWorkerPreflight({
		handshake: handshake.handshake ?? null,
		config,
		activeRouting,
		cacheRoot: store.storeDir,
		repoRoot,
		env,
		transports: workerTransports,
	});

	// §6.8's environment is built before the manifest, because the manifest
	// records what it promoted: the declared context file's digest is evidence,
	// and evidence of a file nobody had read yet would be a claim.
	const workerIsolation = record(worker.isolationCheck());

	const manifest = record(
		manifestCheck(store, {
			run,
			scope,
			config,
			configPath,
			activeRouting,
			declared,
			handshake: handshake.handshake ?? null,
			worker: workerIsolation.facts ?? null,
			hold,
			actor,
			at,
		}),
	);

	record(worker.permissionsCheck());
	record(worker.trustCheck());
	record(worker.closureCheck());
	record(worker.agentStateCheck());

	// ── Runtime probes (§9.7) ────────────────────────────────────────────────
	const herdrAvailable = record(await herdrCheck({ env, herdr }));

	// §7.1's clone, §7.2's fetchable base, §7.8's plain-repo refusal — the
	// factory-private clone is created here if the run is the repo's first. The
	// baseline below runs at the commit **this** check pinned rather than fetching
	// a second one, so the recorded base and the verified base are one fact.
	const isolation = record(await gitIsolationCheck(store, config));

	// §6.2's live per-runtime probe, §9.7's capacity observation folded in.
	record(await worker.runtimeCheck());

	// §6.2's flag-spelling proof, one session per distinct profile (#164). It sits
	// behind the probe rather than beside it: the probe runs the same session
	// without the profile's flags, so a green probe is what makes a refusal here a
	// statement about the spelling and not about the harness.
	record(await worker.profileFlagsCheck());

	// ── The expensive one, last (§9.7) ───────────────────────────────────────
	record(await baselineCheck(store, { run, isolation, config, hold, actor, at }));

	const red = checks.filter((check) => check.result === PREFLIGHT_RESULTS.failed);
	const workerContext = worker.productionContext();
	const production =
		red.length === 0 && isolation.clone !== undefined && isolation.base !== undefined && workerContext !== null
			? Object.freeze({
					clone: isolation.clone,
					socket: herdrAvailable.detail.socket,
					worker: workerContext,
				})
			: null;

	return Object.freeze({
		ok: red.length === 0,
		// Named rather than counted: §10.3 asks `baseline-red` to name the
		// specific red check, and a count cannot. A check that is red *for* named
		// things says which — §8.3 wants the baseline's red **declared** check,
		// not the word "baseline" — and every other check names itself.
		red: Object.freeze(red.flatMap((check) => check.red ?? [check.check])),
		checks: Object.freeze(checks.map(reported)),
		manifest: manifest.reference ?? null,
		// Process-local handles for #147's production composition. The report above
		// remains JSON-only evidence; clone and environment handles never leak into it.
		production,
	});
}

/**
 * §11.7's static handshake, and the one place its findings stop a run.
 *
 * The artifact is written **before** the assertion, so a failed handshake is
 * durable evidence rather than a sentence in a dead process's stderr.
 */
function handshakeCheck(store, { run, executable, env, expect, hold, actor, at }) {
	let handshake;
	try {
		handshake = packageHandshake({ executable, expect, env });
	} catch (error) {
		if (!(error instanceof FactoryPackageError)) throw error;
		return failed("package-handshake", PREFLIGHT_CLASSES.static, {
			message: error.message,
			detail: { reason: error.reason, ...error.details },
		});
	}

	let reference = null;
	try {
		reference = recordPackageHandshake(store, handshake, {
			run,
			actor,
			// Through the hold's gate rather than off its generation: §14.6's
			// "stop issuing effects" is a latch on the hold, and reading the
			// number directly would walk straight past it.
			fencingGeneration: hold.fence().generation,
			at,
		}).reference;
	} catch (error) {
		const pinned = repinned(error, { check: "package-handshake", what: "package pin", spec: "§11.7" });
		if (pinned === null) throw error;
		return { ...pinned, handshake };
	}

	try {
		assertPackageIntact(handshake);
	} catch (error) {
		if (!(error instanceof FactoryPackageError)) throw error;
		return {
			...failed("package-handshake", PREFLIGHT_CLASSES.static, {
				message: error.message,
				detail: { reason: error.reason, findings: handshake.findings.map((finding) => finding.reason) },
			}),
			handshake,
		};
	}

	return {
		...passed("package-handshake", PREFLIGHT_CLASSES.static, {
			message:
				`The package handshake holds: ${handshake.package.name ?? "(unnamed)"} ` +
				`${handshake.package.version ?? "(unversioned)"} at tree ${handshake.tree.digest}.`,
			detail: {
				root: handshake.package.root,
				tree: handshake.tree.digest,
				participants: handshake.participants.length,
			},
		}),
		handshake,
		reference,
	};
}

/** §6.8's evidence, written per run and immutable for its life (§3.1). */
function manifestCheck(store, context) {
	try {
		const written = writeRunManifest(store, context);
		return {
			...passed("run-manifest", PREFLIGHT_CLASSES.static, {
				message: `The run manifest is recorded as ${written.reference.digest} (${written.outcome}).`,
				detail: { digest: written.reference.digest, bytes: written.reference.bytes, outcome: written.outcome },
			}),
			reference: written.reference,
		};
	} catch (error) {
		const pinned = repinned(error, { check: "run-manifest", what: "declared inputs", spec: "§3.1, §6.8" });
		if (pinned === null) throw error;
		return pinned;
	}
}

/**
 * The two writes above share one failure worth naming rather than crashing on.
 *
 * Both are keyed by the run, so re-entering a run re-issues the same key; a
 * different payload is §4.5's typed conflict. That conflict is not a bug — it is
 * **run membership and the package pin being immutable for the run's life**
 * arriving as a refusal. The operator's fix is `--new-run`, and the check says so
 * rather than leaving them to read an effect-key error.
 *
 * @returns {object | null} the red check, or null when this was some other error
 */
function repinned(error, { check, what, spec }) {
	if (!(error instanceof FactoryEffectError) || error.reason !== "effect-payload-conflict") return null;

	return failed(check, PREFLIGHT_CLASSES.static, {
		message:
			`This run's ${what} no longer match what it started with, and they are immutable for a run's life ` +
			`(${spec}). Start a fresh run with \`--new-run\` rather than re-entering this one: ${error.message}`,
		detail: { reason: error.reason, ...error.details },
	});
}

/**
 * §8.3's gate: **the required set, at the pinned base, before the first claim.**
 *
 * It is last because it is the expensive one (§9.7) and it runs **only** when
 * the base was pinned: a baseline with nothing to check out is reported red
 * rather than skipped, because §14.14 is a *never* — a run must not start on a
 * baseline nobody ran, and "the git check already went red" is a reason to
 * explain it, not a reason to call this one green.
 *
 * The output of every check is written to the artifact store here and referenced
 * by digest (§8.7, §12.1); what reaches the journal is the record, never the
 * bytes.
 */
async function baselineCheck(store, { run, isolation, config, hold, actor, at }) {
	const answered = await baselineForRepo(store, config, { at, isolation });
	if (!answered.ran) {
		return failed("baseline", PREFLIGHT_CLASSES.probe, { message: answered.message, detail: answered.detail });
	}

	const baseline = answered.baseline;
	const checks = recordCheckOutputs(store, baseline.results, {
		execution: baseline.execution,
		run,
		phase: "preflight",
		actor,
		// The hold's gate rather than its generation, for the reason the handshake
		// gives above: §14.6's "stop issuing effects" is a latch on the hold.
		fencingGeneration: hold.fence().generation,
		at,
	});

	const detail = {
		baseline: baseline.execution,
		base_branch: baseline.base_branch,
		base_commit: baseline.base_commit,
		checks,
		skipped: baseline.skipped,
		worktree: baseline.worktree,
		// §8.3's v2 upgrade, stated where an operator meets its absence rather than
		// only in the module that does not implement it.
		differential: {
			implemented: false,
			why: "Per-test identity would have to be parsed out of three unrelated runners, and a wrong diff silently passes a real regression (§8.3).",
			spec: "§8.3",
		},
	};

	return baseline.ok
		? passed("baseline", PREFLIGHT_CLASSES.probe, { message: baseline.message, detail })
		: { ...failed("baseline", PREFLIGHT_CLASSES.probe, { message: baseline.message, detail }), red: baseline.red };
}

/** §10.3's named check: the factory checks the multiplexer, it does not manage it. */
async function herdrCheck({ env, herdr }) {
	const answer = await herdr({ env });

	return answer.available
		? passed("herdr-available", PREFLIGHT_CLASSES.probe, {
				message: answer.message,
				detail: { socket: answer.socket, binary: answer.binary },
			})
		: failed("herdr-available", PREFLIGHT_CLASSES.probe, {
				message: answer.message,
				// The exact command, carried as its own field as well as inside the
				// sentence: an operator reads the sentence, a `--json` consumer reads
				// the field, and §10.3 asks for the command either way.
				detail: { reason: answer.reason, command: answer.command, socket: answer.socket, binary: answer.binary },
			});
}

function passed(check, className, { message, detail }) {
	return { check, class: className, result: PREFLIGHT_RESULTS.passed, message, detail };
}

function failed(check, className, { message, detail }) {
	return { check, class: className, result: PREFLIGHT_RESULTS.failed, message, detail };
}

/**
 * One stage record per check, on the run's stream and carrying **no ticket**:
 * §10.3's preflight stages hang off no tracker ticket, and a ticket slot here
 * would create a ticket execution for a stage that belongs to the run.
 */
function emit(store, { run, actor, at, check }) {
	store.append({
		kind: "preflight.checked",
		source: sourceForActor(actor),
		run,
		phase: "preflight",
		occurredAt: at,
		observedAt: at,
		payload: reported(check),
	});
	return check;
}

/** A check as both the journal and the operator read it: never the internals. */
function reported(check) {
	return {
		check: check.check,
		class: check.class,
		result: check.result,
		message: check.message,
		detail: check.detail,
	};
}
