import { agentAlive, FACTORY_ATTEMPT_TOKEN } from "../controller/herdr-control.mjs";
import { createProbeRegistry } from "../reconcile/probes.mjs";

/**
 * §5.3: each effect kind's probe ships with the subsystem that introduces the
 * kind, and the attempt path introduces `agent-start` and `agent-stop`. **One
 * read serves both**, and §12.8's `pane-delete` besides — they are three
 * questions about the same list, and registering by the read is what keeps
 * them one implementation.
 *
 * **The question the read can answer is exactly one**: §5.2 gives Herdr
 * authority over whether a worker process is alive right now, and nothing else.
 * So a probe here never reports how an attempt went, only whether the pane
 * carrying its token still hosts a live agent — and the three matches are three
 * readings of that single fact:
 *
 * - `token-matches` (`agent-start`) — a pane carries this attempt's token *and*
 *   hosts a live agent. Both halves: a stamped pane whose agent never started
 *   is precisely the crash the launch orders its steps to make visible.
 * - `agent-stopped` (`agent-stop`) — no live agent in the pane, whether the
 *   pane went with it or stayed at a shell prompt. §13.B leaves the pane.
 * - `absent` (`pane-delete`) — no pane carries the token at all.
 *
 * The effect row carries no payload, so the target is recomputed from the key's
 * attempt segment — the same property §7.3's deterministic paths give the git
 * probes.
 *
 * **Herdr dates nothing.** Its API carries no timestamp on any answer, so an
 * observation from it has no `occurredAtRaw` to keep verbatim; `observed_at`
 * dates the reading, and inventing a foreign timestamp would be our clock
 * wearing Herdr's name (§4.3).
 */

/**
 * The `herdr.pane-list` implementation, closed over one Herdr control surface.
 *
 * @param {{ herdr: object }} where
 * @returns {Function} the probe
 */
export function herdrPaneListProbe({ herdr }) {
	return async ({ effect, probe }) => {
		const attempt = effect.attempt_id;
		const listed = await herdr.paneForAttempt(attempt);
		if (!listed.ok) {
			// A multiplexer that will not answer taught this process nothing, and
			// "unanswerable" is not "absent" (§12.4): throwing leaves the effect
			// exactly as it was and reports it, which is §12.4's alarm.
			throw new Error(`${listed.message} The attempt's liveness is unanswerable, not absent (§5.2).`);
		}

		const pane = listed.pane;
		const alive = agentAlive(pane);
		const present = pane !== null;

		return {
			matched: matchFor(probe.match, { present, alive }),
			result: { pane: pane?.pane_id ?? null, agent: pane?.agent ?? null, alive },
			// The fact, not the object: a pane's liveness read twice is two facts,
			// and dating them by the pane id alone would make the first sighting
			// suppress every later one through §5.1's dedup index.
			foreignSourceId: `herdr:${FACTORY_ATTEMPT_TOKEN}:${attempt}:${present ? pane.pane_id : "absent"}:${alive}`,
			detail: { attempt, pane: pane?.pane_id ?? null, present, alive, status: pane?.agent_status ?? null },
		};
	};
}

/**
 * `base`'s probes plus Herdr's, in a registry of their own — the tracker
 * probes' shape, and for the same reason: the implementation closes over a
 * control surface bound to one environment, so registering it into the module
 * singleton would let one run's multiplexer client answer another's probes.
 *
 * @param {object} base an existing registry (`createProbeRegistry`)
 * @param {{ herdr: object }} where
 * @returns {object} a registry carrying both
 */
export function withHerdrProbes(base, { herdr }) {
	const registry = createProbeRegistry();
	for (const call of base.calls) registry.register(call, base.implementationFor(call));
	registry.register("herdr.pane-list", herdrPaneListProbe({ herdr }));
	return registry;
}

function matchFor(match, { present, alive }) {
	if (match === "token-matches") return present && alive;
	if (match === "agent-stopped") return !alive;
	if (match === "absent") return !present;

	throw new Error(`"${match}" is not a match herdr.pane-list can answer; §5.2 gives Herdr one fact.`);
}
