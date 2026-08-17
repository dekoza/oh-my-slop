import { agentAlive, FACTORY_ATTEMPT_TOKEN } from "../controller/herdr-control.mjs";
import { createProbeRegistry } from "../reconcile/probes.mjs";
import { runWorkspaceLabel } from "./workspace.mjs";

/**
 * §5.3: each effect kind's probe ships with the subsystem that introduces the
 * kind, and the attempt path introduces `agent-start`, `agent-stop`, and #156's
 * run-scoped `workspace-open`.
 *
 * **Two reads, because they are two questions.** `herdr.pane-list` answers about
 * a *worker* and serves three effect kinds — `agent-start`, `agent-stop`, and
 * §12.8's `pane-delete` — since they are three questions about one list, and
 * registering by the read is what keeps them one implementation.
 * `herdr.workspace-list` answers about the *run's* workspace, which no pane
 * reading can: Herdr stamps no token on a workspace, and the pane that would
 * carry one is a pane no attempt occupies.
 *
 * **What the pane read can answer is exactly one fact**: §5.2 gives Herdr
 * authority over whether a worker process is alive right now, and nothing else.
 * So a probe here never reports how an attempt went, only whether the pane
 * carrying its token still hosts a live agent — and its three matches are three
 * readings of that single fact:
 *
 * - `token-matches` (`agent-start`) — a pane carries this attempt's token *and*
 *   hosts a live agent. Both halves: a stamped pane whose agent never started
 *   is precisely the crash the launch orders its steps to make visible.
 * - `agent-stopped` (`agent-stop`) — no live agent in the pane, whether the
 *   pane went with it or stayed at a shell prompt. §13.B leaves the pane.
 * - `absent` (`pane-delete`) — no pane carries the token at all.
 *
 * The effect row carries no payload, so each probe recomputes its target from
 * the key — the attempt segment for a pane, the run segment for a workspace,
 * whose label is derived from it. That is the same property §7.3's deterministic
 * paths give the git probes.
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
 * The `herdr.workspace-list` implementation: **does this run's workspace exist**
 * (#156)?
 *
 * The target is recomputed from the key's run segment, exactly as the pane probe
 * recomputes its attempt — and it has to be, because the thing an unresolved
 * open is missing *is* the workspace id. What the world is asked for is the
 * label, which is derived from the run and nothing else, and the answer carries
 * the id back so the settled effect names the workspace every later attempt will
 * open a tab in.
 *
 * @param {{ herdr: object }} where
 * @returns {Function} the probe
 */
export function herdrWorkspaceListProbe({ herdr }) {
	return async ({ effect, probe }) => {
		if (probe.match !== "present") {
			throw new Error(`"${probe.match}" is not a match herdr.workspace-list can answer; it reports existence.`);
		}

		const label = runWorkspaceLabel(effect.run_id);
		const listed = await herdr.workspaceLabelled(label);
		if (!listed.ok) {
			// §12.4 again: a multiplexer that will not answer taught this process
			// nothing, and "unanswerable" is not "absent".
			throw new Error(`${listed.message} The run's workspace is unanswerable, not absent (§5.2).`);
		}

		const workspace = listed.workspace?.workspace_id ?? null;
		return {
			matched: workspace !== null,
			result: workspace === null ? null : { workspace, label },
			// The fact rather than the object, for the reason the pane probe names:
			// keyed on the run alone, the first reading would suppress every later
			// one through §5.1's dedup index.
			foreignSourceId: `herdr:workspace:${label}:${workspace ?? "absent"}`,
			detail: { run: effect.run_id, label, workspace },
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
	registry.register("herdr.workspace-list", herdrWorkspaceListProbe({ herdr }));
	return registry;
}

function matchFor(match, { present, alive }) {
	if (match === "token-matches") return present && alive;
	if (match === "agent-stopped") return !alive;
	if (match === "absent") return !present;

	throw new Error(`"${match}" is not a match herdr.pane-list can answer; §5.2 gives Herdr one fact.`);
}
