/**
 * Phase executors for the two suites that drive `walkStages` — the stage
 * machine's own and the retry seam's.
 *
 * They live here rather than in either file because both need the same two
 * shapes and the walk is the thing under test in both: a helper cloned into two
 * suites is two places for "what a phase answered" to come to mean different
 * things.
 */

/**
 * Executors that answer the same thing every time a phase is entered, and
 * record the order phases were called in.
 *
 * @param {Record<string, string | object>} outcomes a §8.10 outcome per phase,
 *   or the whole `{outcome, detail}` answer where the detail matters
 * @returns {{ phases: Record<string, Function>, calls: string[] }}
 */
export function answering(outcomes) {
	const calls = [];
	const phases = {};
	for (const [phase, answer] of Object.entries(outcomes)) {
		phases[phase] = async () => {
			calls.push(phase);
			return typeof answer === "string" ? { outcome: answer, detail: null } : answer;
		};
	}
	return { phases, calls };
}

/**
 * Executors whose answers are a **queue per phase**: the first entry answers the
 * first pass, the next answers the next, and the last one repeats.
 *
 * A controller phase's automation retry re-enters under the attempt it is
 * already on (#146), so a test of one cannot vary its answer by reading an
 * attempt id — there is nothing there to read. The queue is what lets a phase
 * fail once and pass the second time.
 *
 * `calls` records the attempt each pass ran under, which is the fact those tests
 * are actually about.
 *
 * @param {Record<string, ReadonlyArray<string | object>>} script
 * @returns {{ phases: Record<string, Function>, calls: Array<{phase: string, attempt: string}> }}
 */
export function answeringInTurn(script) {
	const calls = [];
	const phases = {};
	for (const [phase, answers] of Object.entries(script)) {
		const queue = [...answers];
		phases[phase] = async ({ attempt }) => {
			calls.push({ phase, attempt });
			const answer = queue.length > 1 ? queue.shift() : queue[0];
			return typeof answer === "string" ? { outcome: answer, detail: null } : answer;
		};
	}
	return { phases, calls };
}
