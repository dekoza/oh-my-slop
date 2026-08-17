/**
 * What §6.2's live per-runtime probe can find wrong, as data.
 *
 * Findings rather than exceptions, in the handshake's pattern: preflight
 * records them as a red `runtime-probe` check, and the attempt path turns them
 * into the automation failure. The set is closed so a `--json` consumer can
 * branch on a reason.
 */
export const PROBE_FINDING_REASONS = Object.freeze([
	/** The harness itself could not be spoken to at all (§11.7). */
	"runtime-unreachable",
	/**
	 * §6.2: a closure member with no native command record on the production
	 * path. Unprovable native invocation, and there is no degraded
	 * prose-loading mode to fall back to.
	 */
	"skill-not-invocable",
	/**
	 * A command record that exists but resolves outside the pinned skills root —
	 * §6.8's shadowing, observed live rather than statically.
	 */
	"skill-shadowed",
	/**
	 * §6.8's discovery fence, unproven rather than broken: the probe's control
	 * session — the worker binding with the fence taken out — did not register
	 * the canary project skill the probe planted, so the fenced session's silence
	 * is no evidence. A probe that could not have seen the leak proves nothing
	 * about its absence (§6.2).
	 */
	"discovery-fence-unproven",
	/** A declared model the probed runtime's inventory does not carry. */
	"model-unavailable",
	/**
	 * §9.7: a required resource class nothing answers for. Named with the class,
	 * the endpoint, and the fix — never treated as capacity 0 and continued.
	 */
	"class-unreachable",
	/** §9.7: a declared size exceeding an observed `max_instances`, both named. */
	"capacity-exceeded",
	/** §6.3: the built plugin failed strict validation, or could not be built. */
	"plugin-invalid",
	/** §6.2: the expected-vs-actual component diff over `plugin details`. */
	"plugin-component-diff",
	/**
	 * §6.8: the probed session recorded a project the controller had not
	 * pre-trusted. In an interactive pane that project is a trust dialog, and a
	 * pane sitting on one is indistinguishable from a worker thinking.
	 */
	"trust-not-established",
	/**
	 * #164: a profile's own launch flags — `--model`, and Claude's `--effort` /
	 * pi's `--thinking` — spelled in a way the installed binary does not accept.
	 * A parse-level fact, so it is provable before any pane exists.
	 */
	"profile-flags-unaccepted",
]);

/**
 * @param {string} reason one of PROBE_FINDING_REASONS
 * @param {string} message operator-facing sentence naming what is wrong and the fix
 * @param {Record<string, unknown>} [details] JSON-safe structured fields
 * @returns {Readonly<object>}
 */
export function probeFinding(reason, message, details = {}) {
	if (!PROBE_FINDING_REASONS.includes(reason)) {
		throw new Error(`Unknown probe finding reason "${reason}".`);
	}
	return Object.freeze({ reason, message, ...details });
}

/** §11.7's unprobeable-runtime finding, worded once for every harness. */
export function unreachableRuntime(label, binary, sentence) {
	return probeFinding(
		"runtime-unreachable",
		`The ${label} runtime could not be probed: ${sentence}. §11.7 makes an unprobeable runtime an automation ` +
			`failure before first claim; the fix is a working \`${binary}\` on PATH.`,
		{ binary },
	);
}

/**
 * §11.7's live-probed harness version — the first thing either probe asks,
 * because every later step shells the same binary.
 *
 * @returns {Promise<string | null>} the version, or null with the failure recorded
 */
export async function harnessVersion(io, { label, binary, timeoutMs, where = {} }, failures) {
	try {
		const answer = await io.runCommand(binary, ["--version"], { timeout: timeoutMs, ...runIn(where) });
		if (answer.status === 0) return answer.stdout.trim();
		failures.push(unreachableRuntime(label, binary, `\`${binary} --version\` exited ${answer.status}`));
	} catch (error) {
		failures.push(unreachableRuntime(label, binary, error.message));
	}
	return null;
}

/**
 * §6.2's flag-spelling proof for **one profile**, shared by both runtimes (#164).
 *
 * The profile's flags are appended at launch and, before this, exercised by
 * nothing: a renamed or dropped flag surfaced as a pane that would not come up,
 * *after* a branch, a worktree and the tracker claim already existed. The proof
 * hands the installed binary the argv a pane receives — plus the probe-only IO
 * flags — and reads back the same parse-level answer the runtime probe reads.
 *
 * **The verdict is the answer, never the exit status.** A side subcommand's exit
 * code is not a spelling verdict: measured on this repository's own machine,
 * `pi list` exits 1 over a stale OAuth token while its RPC session answers
 * perfectly. A session that answers has parsed the argv; one that never does has
 * not, and the two cannot be confused.
 *
 * **What makes it a *spelling* verdict is the ordering, not this function.** The
 * check runs only when the runtime probe is already green, and the probe starts
 * the same kind of session without the profile's flags — so the two sessions
 * differ by exactly those flags and nothing else has to be inferred.
 *
 * `--version` is deliberately not used: measured against Claude 2.1.233 it
 * short-circuits before argument parsing, accepting `--nonsense-flag` with
 * exit 0, so it proves nothing at all.
 *
 * @param {object} io the transport
 * @param {object} input
 * @param {string} input.label the harness's operator-facing name
 * @param {string} input.binary
 * @param {{ name: string }} input.profile
 * @param {ReadonlyArray<string>} input.flags the flag names the profile contributes
 * @param {ReadonlyArray<string>} input.args the full argv, launch shape plus probe-only flags
 * @param {ReadonlyArray<string>} input.input the request lines
 * @param {(parsed: object | null) => boolean} input.answered recognises this
 *   runtime's answer to that request
 * @param {{ env?: object, cwd?: string }} [input.where]
 * @param {number} input.timeoutMs
 * @returns {Promise<Readonly<object> | null>} the finding, or null when accepted
 */
export async function proveFlagSpelling(
	io,
	{ label, binary, profile, flags, args, input, answered, where = {}, timeoutMs },
) {
	const refusal = await refusalFrom(io, { binary, args, input, answered, flags, where, timeoutMs });
	if (refusal === null) return null;

	// A binary that could not be spawned at all was never asked about a spelling,
	// and §11.7 already has the word for it. Reporting it as a rejected flag would
	// point the operator at their profile over a missing executable.
	if (refusal.spawned === false) return unreachableRuntime(label, binary, refusal.said);

	return probeFinding(
		"profile-flags-unaccepted",
		`Profile "${profile.name}" launches a ${label} worker with ${flags.join(" ")}, and \`${binary}\` did not accept ` +
			`that spelling — ${refusal.said}. The flags a profile carries are appended at launch, so a renamed or dropped one ` +
			`would otherwise surface as a pane that never comes up, after the branch, the worktree and the tracker claim ` +
			`already exist. §6.2 refuses before an attempt spends, and the fix is the flag as the installed binary now ` +
			`spells it, or a profile that does not declare it (§6.2, §11.2, §11.7).`,
		{ profile: profile.name, flags: [...flags], binary },
	);
}

/**
 * Why the session did not answer — or null when it did, which is the whole of
 * "the binary accepted this spelling".
 *
 * **`spawned` is the fact the caller branches on**, because it separates two
 * findings rather than two sentences (§11.2): a binary that never started was
 * never asked about a spelling, while one that took the argv and did not answer
 * was. A harness that wedges and one that exits refusing are both the latter —
 * the runtime probe has already started this binary without the profile's flags,
 * so what changed is the flags either way.
 */
async function refusalFrom(io, { binary, args, input, answered, flags, where, timeoutMs }) {
	let session;
	try {
		session = await io.lineSession({ binary, args, input, env: where.env, cwd: where.cwd, timeoutMs });
	} catch (error) {
		return { spawned: false, said: error.message };
	}

	if (session.lines.some((line) => answered(parseJson(line)))) return null;
	if (session.timedOut) {
		return { spawned: true, said: `the session took the argv and answered nothing within ${timeoutMs}ms` };
	}

	const said = complaint(session.stderr, flags);
	return {
		spawned: true,
		said: `exit ${session.status}` + (said === null ? " with nothing on stderr" : `: ${said}`),
	};
}

/**
 * §6.2's flag-spelling proof over **every distinct profile of one runtime** — the
 * loop both runtimes share, so the cardinality, the accumulation and the reported
 * shape have one implementation (#164).
 *
 * What differs per runtime is data, not control flow: each hands over one
 * descriptor per profile — the argv, the request, and the recogniser for that
 * runtime's answer — built by its own module, which is where §6.1 keeps every
 * runtime difference.
 *
 * @param {object} io the transport
 * @param {object} input
 * @param {string} input.kind the runtime kind
 * @param {string} input.label the harness's operator-facing name
 * @param {string} input.binary
 * @param {ReadonlyArray<{ profile: object, flags: ReadonlyArray<string>, args: string[],
 *   input: string[], answered: (parsed: object | null) => boolean }>} input.sessions
 *   one descriptor per distinct profile, in the order they are reported
 * @param {{ env?: object, cwd?: string }} [input.where]
 * @param {number} input.timeoutMs
 * @returns {Promise<Readonly<object>>} `{ kind, binary, checked, findings }`
 */
export async function proveProfileFlags(io, { kind, label, binary, sessions, where = {}, timeoutMs }) {
	const checked = [];
	const findings = [];

	for (const session of sessions) {
		const finding = await proveFlagSpelling(io, { label, binary, ...session, where, timeoutMs });

		checked.push(Object.freeze({ profile: session.profile.name, flags: [...session.flags] }));
		if (finding !== null) findings.push(finding);
	}

	return Object.freeze({ kind, binary, checked: Object.freeze(checked), findings: Object.freeze(findings) });
}

/** The flag names an argument list carries — derived, never a second list (#164). */
export function flagNames(args) {
	return args.filter((argument) => argument.startsWith("--"));
}

/**
 * The one line of a refusing harness's stderr worth quoting: **the binary's own
 * words about a flag we passed.**
 *
 * The last line is the wrong default here, unlike everywhere else in this module.
 * Measured against Claude 2.1.233, a rejected spelling prints the diagnosis
 * first and a hint after it — `error: unknown option '--efffort'` then `(Did you
 * mean --effort?)` — so `.at(-1)` keeps the half that names no flag. Where
 * nothing mentions one of our flags the harness is complaining about something
 * else, and the last line is the best available answer again.
 *
 * The match is on whole words, never a substring: `--model` occurs inside pi's
 * unrelated `--models`, and a line about the wrong flag is worse than the
 * fallback because it reads as a diagnosis.
 */
function complaint(stderr, flags) {
	const lines = stderr
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");

	if (lines.length === 0) return null;
	return lines.find((line) => flags.some((flag) => words(line).includes(flag))) ?? lines.at(-1);
}

/** A line's flag-shaped words, with the harness's quoting and punctuation dropped. */
function words(line) {
	return line.split(/[^\w-]+/).filter((word) => word !== "");
}

/**
 * §6.8's binding as `child_process` options, with the absent halves dropped.
 *
 * Dropping rather than passing `undefined` is what keeps a probe with no
 * binding — a test's, or a caller that has none — inheriting this process's own
 * environment instead of being handed an empty one.
 *
 * @param {{ env?: object, cwd?: string }} where
 * @returns {{ env?: object, cwd?: string }}
 */
export function runIn({ env, cwd } = {}) {
	return { ...(env === undefined ? {} : { env }), ...(cwd === undefined ? {} : { cwd }) };
}

/** A line of harness output, or null — a probe judges shapes, it never throws on one. */
export function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * The §6.1 preflight operation both runtime adapters share: one probe per
 * pinned revision (§6.2's "one request"), then each role's closure proven
 * against that same observation.
 *
 * @param {{ probe: (packageRev: string) => Promise<object>,
 *           prove: (runtime: object, closure: ReadonlyArray<string>) => ReadonlyArray<object>,
 *           kind: string }} runtime
 * @returns {(role: object, packageRev: string) => Promise<Readonly<object>>}
 */
export function memoizedPreflight({ kind, probe, prove }) {
	let probed = null;

	return async (role, packageRev) => {
		if (probed === null || probed.packageRev !== packageRev) {
			probed = { packageRev, answer: probe(packageRev) };
		}
		const runtime = await probed.answer;
		const findings = runtime.ok ? [...runtime.failures, ...prove(runtime, role.closure ?? [])] : [...runtime.failures];

		return Object.freeze({
			kind,
			role: role.name,
			packageRev,
			ok: findings.length === 0,
			findings: Object.freeze(findings),
			runtime,
		});
	};
}
