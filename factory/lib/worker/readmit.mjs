import { matchRefusal } from "../capacity/exhaustion.mjs";
import { runCommand } from "./transports.mjs";

/**
 * #154: **the probe that re-admits an exhausted class after its expiry.**
 *
 * §5.2 settles the fact by probe, never by the clock: a memo whose `until`
 * passed is `probe-due`, and dispatch asks this probe before it launches into
 * the class again. One cheap completion — the worker binding's environment
 * and flags (#160's rule: the probe runs the session a worker would run), a
 * one-line prompt, no pane, no worktree — and three answers:
 *
 * - `admitted` — the provider answered; the memo is cleared by a recorded
 *   admission;
 * - `refused` — the output carries the refusal signatures again; the memo is
 *   renewed for the full window;
 * - `inconclusive` — anything else; the memo is renewed on the short window,
 *   because opening the class on a read that answered nothing would be the
 *   assumption this probe exists to refuse.
 */

/**
 * The bound on one probe. Sized past a cold local swap-in (measured ~80s) so a
 * size-1 GPU gets its honest answer; a probe that overruns is inconclusive,
 * never an admission.
 */
export const DEFAULT_READMIT_PROBE_TIMEOUT_MS = 120_000;

/** The cheapest completion that still spends one real request on the provider. */
export const READMIT_PROBE_PROMPT = "Reply with exactly the word: ok";

/**
 * @param {object} context
 * @param {object} context.plan §9.1's capacity plan — the class's profiles
 * @param {Record<string, object>} context.profiles the validated profile table
 * @param {object} context.environment §6.8's worker environment handle
 * @param {string} context.repoRoot where the probe runs
 * @param {object} [context.transport] injectable IO, as every probe's is
 * @param {number} [context.timeoutMs]
 * @returns {(className: string) => Promise<Readonly<{ verdict: string, evidence: object }>>}
 */
export function createReadmissionProbe({
	plan,
	profiles,
	environment,
	repoRoot,
	transport = {},
	timeoutMs = DEFAULT_READMIT_PROBE_TIMEOUT_MS,
}) {
	const io = { runCommand, ...transport };

	return async function probeClass(className) {
		const entry = plan.classes.find((candidate) => candidate.class === className);
		if (entry === undefined) {
			return Object.freeze({ verdict: "inconclusive", evidence: Object.freeze({ reason: "class-unknown", class: className }) });
		}

		// The class is the arbitration unit — one endpoint, one cap — so any
		// profile on it probes the same provider. The first in declared order,
		// deterministically.
		const profileName = entry.profiles[0];
		const profile = profiles[profileName];
		if (profile === undefined) {
			return Object.freeze({
				verdict: "inconclusive",
				evidence: Object.freeze({ reason: "profile-unknown", class: className, profile: profileName }),
			});
		}
		const kind = profile.kind;
		const binding = environment.binding({ kind, posture: "builder" });

		const args =
			kind === "pi"
				? [...binding.args, "--print", "--no-session", "--no-tools", "--model", profile.model, READMIT_PROBE_PROMPT]
				: [...binding.args, "--print", "--model", profile.model, READMIT_PROBE_PROMPT];

		let answer;
		try {
			answer = await io.runCommand(kind, args, { timeout: timeoutMs, env: binding.env, cwd: repoRoot });
		} catch (error) {
			return Object.freeze({
				verdict: "inconclusive",
				evidence: Object.freeze({
					reason: `probe-failed: ${error.message}`,
					profile: profileName,
					model: profile.model,
				}),
			});
		}

		const base = Object.freeze({ probe: "readmit", profile: profileName, model: profile.model, status: answer.status });

		// The refusal signatures outrank the exit status: a harness that prints
		// its limit message and exits 0 would otherwise clear the memo with the
		// very refusal it exists to remember.
		const refusal = matchRefusal(`${answer.stdout}\n${answer.stderr}`);
		if (refusal !== null) {
			return Object.freeze({
				verdict: "refused",
				evidence: Object.freeze({ ...base, signatures: [...refusal.signatures], excerpt: refusal.excerpt }),
			});
		}

		if (answer.status === 0 && answer.stdout.trim() !== "") {
			return Object.freeze({ verdict: "admitted", evidence: base });
		}

		return Object.freeze({
			verdict: "inconclusive",
			evidence: Object.freeze({ ...base, excerpt: `${answer.stdout}\n${answer.stderr}`.trim().slice(-400) }),
		});
	};
}
