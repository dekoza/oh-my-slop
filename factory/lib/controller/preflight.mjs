import { FactoryEffectError } from "../effects/errors.mjs";
import { FactoryPackageError } from "../package/errors.mjs";
import { assertPackageIntact, packageHandshake, recordPackageHandshake } from "../package/handshake.mjs";
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
 * @param {object} context.activeRouting
 * @param {Record<string, ReadonlyArray<string>>} context.declared
 * @param {string} [context.executable] §11.7's anchor
 * @param {Record<string, string | undefined>} [context.env]
 * @param {(options: object) => Promise<object>} [context.herdr] §10.3's availability
 *   probe, injectable so a test drives both answers without a multiplexer on the machine
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
		activeRouting,
		declared,
		executable,
		env,
		herdr = probeHerdr,
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

	const manifest = record(
		manifestCheck(store, {
			run,
			scope,
			config,
			configPath,
			activeRouting,
			declared,
			handshake: handshake.handshake ?? null,
			hold,
			actor,
			at,
		}),
	);

	record(
		unbuilt("skill-closure", PREFLIGHT_CLASSES.static, {
			missing: "the transitive skill closure and its readable-SKILL.md check (#105)",
			spec: "§6.2",
		}),
	);

	// ── Runtime probes (§9.7) ────────────────────────────────────────────────
	record(await herdrCheck({ env, herdr }));

	record(
		unbuilt("runtime-probe", PREFLIGHT_CLASSES.probe, {
			missing: "the per-runtime live probe and the capacity observation folded into it (#105)",
			spec: "§6.2, §9.7",
		}),
	);

	// ── The expensive one, last (§9.7) ───────────────────────────────────────
	record(
		unbuilt("baseline", PREFLIGHT_CLASSES.static, {
			missing: "the check runner and the baseline gate (#104)",
			spec: "§8.3",
		}),
	);

	const red = checks.filter((check) => check.result === PREFLIGHT_RESULTS.failed);

	return Object.freeze({
		ok: red.length === 0,
		// Named rather than counted: §10.3 asks `baseline-red` to name the
		// specific red check, and a count cannot.
		red: Object.freeze(red.map((check) => check.check)),
		checks: Object.freeze(checks.map(reported)),
		manifest: manifest.reference ?? null,
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

function unbuilt(check, className, { missing, spec }) {
	return {
		check,
		class: className,
		result: PREFLIGHT_RESULTS.unbuilt,
		message: `${check} is specified but not built in this package, so this run observed nothing about it.`,
		detail: { missing, spec },
	};
}

/**
 * One stage record per check, on the run's stream and carrying **no ticket**:
 * §10.3's preflight stages hang off no tracker ticket, and a ticket slot here
 * would create a ticket execution for a stage that belongs to the run.
 */
function emit(store, { run, actor, at, check }) {
	store.append({
		kind: "preflight.checked",
		source: actor === "controller" ? "controller" : "operator",
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
