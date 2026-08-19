import { herdrResult, runHerdr } from "../controller/herdr-control.mjs";

/**
 * **The one module in this package that closes a Herdr pane** (§12.8).
 *
 * §13.B and §14.27 are absolute about who may not: the controller never closes
 * a pane — not at the end of a run, not when an agent ignores its quit keys,
 * not when a worker dies. A wedged pane is the evidence a confused operator
 * needs, and pane reclamation exists *only* as a cleanup-plan entry.
 *
 * Keeping the command out of `controller/herdr-control.mjs` is what makes that
 * checkable rather than aspirational. Every caller of the control surface is on
 * a path the run loop can reach, so a `close` sitting there would be one
 * refactor away from being issued by one — and the tree-wide guard in
 * `tests/node/factory_controller_launch.test.mjs` would have had to be widened
 * to admit it, which is the moment the invariant stops being a property of the
 * tree. Here the guard names exactly one exemption, and the import graph says
 * who may reach it: `cleanup/execute.mjs`, under the controller lease, on a
 * plan an operator reviewed.
 *
 * It closes the **pane**, never the workspace or the tab, because §12.8's
 * whitelist has six entries and none of them is a container.
 */

/**
 * @param {{ run?: Function, binary?: string, env?: object }} [io] the Herdr
 *   command runner, injected for the reason `createHerdrControl` injects it: a
 *   test drives every answer without a multiplexer on the machine
 * @returns {Readonly<{ close: (pane: string) => Promise<object> }>}
 */
export function createPaneReclaimer({ run = runHerdr, binary, env } = {}) {
	return Object.freeze({
		/**
		 * Close one pane the plan named.
		 *
		 * A refusal is **data, not an exception**: `cleanup-execute` is settling a
		 * list, and one pane Herdr will not close must not abandon the worktrees
		 * behind it. The effect stays `requested`, which is exactly the state the
		 * next reconcile re-probes (§4.5).
		 */
		async close(pane) {
			const closed = await run(["pane", "close", pane], { env, binary });
			if (closed.exitCode !== 0) {
				return Object.freeze({
					ok: false,
					pane,
					command: "pane close",
					exit_code: closed.exitCode,
					stderr: closed.stderr.trim() || null,
					message:
						`Herdr refused \`pane close ${pane}\` (exit ${closed.exitCode})` +
						(closed.stderr.trim() === "" ? "" : `: ${closed.stderr.trim().split("\n").at(-1)}`),
				});
			}

			return Object.freeze({ ok: true, pane, result: herdrResult(closed.stdout) });
		},
	});
}
