import { PROBE_CALLS } from "../effects/catalogue.mjs";
import { FactoryReconcileError } from "./errors.mjs";

/**
 * The probe seam (§5.3).
 *
 * > A `requested` record with no `resolved` record is never settled by
 * > reasoning, only by re-probing the external system.
 *
 * §4.5's catalogue declares *that* every effect kind has a probe and what it
 * reads; this registry holds the code that performs the read. The two are
 * separate on purpose: **the engine ships once, and each effect kind's probe
 * ships with the subsystem that introduces that effect kind** — the tracker
 * probes with tracker scheduling, the git probes with git isolation, the harness
 * probe with the worker adapter. A registry keyed by the *read* rather than by
 * the operation is what lets `label-add` and `label-remove` share one
 * implementation: it is one call to Gitea, and §4.5's `match` is the data that
 * says which answer settles which effect.
 *
 * An unimplemented read is not an error here. It is reported by the engine as an
 * effect nothing could settle — which is §12.4's alarm, and a far better outcome
 * than an engine that infers the answer it cannot read.
 */

/**
 * What a probe is handed and what it must answer.
 *
 * @typedef {(request: { effect: object, probe: { source: string, call: string, match: string },
 *                       store: object, at: number }) => Promise<ProbeAnswer> | ProbeAnswer} ProbeImplementation
 *
 * @typedef {object} ProbeAnswer
 * @property {boolean} matched whether §4.5's declared match held — that is, whether
 *   the mutation the effect asked for is what the external system now shows
 * @property {unknown} [result] what the external system answered, committed as the
 *   effect's resolution when `matched`
 * @property {string} [foreignSourceId] that system's own stable id (§4.3); required
 *   of every source but `artifact`, whose store is the factory's own disk
 * @property {string} [occurredAtRaw] that system's raw timestamp string, kept verbatim
 * @property {object} [detail] JSON-safe fields the operator reads in the basis
 */

/**
 * @returns {Readonly<{ calls: readonly string[], register: (call: string, implementation: Function) => void,
 *                      implementationFor: (call: string) => Function | null }>}
 */
export function createProbeRegistry() {
	const implementations = new Map();

	return Object.freeze({
		get calls() {
			return Object.freeze([...implementations.keys()]);
		},

		/**
		 * @throws {FactoryReconcileError} `probe-call-unknown` · `probe-already-registered`
		 */
		register(call, implementation) {
			if (!PROBE_CALLS.includes(call)) {
				throw new FactoryReconcileError(
					"probe-call-unknown",
					`"${call}" is not one of §4.5's probe calls; a probe that invents its own read is a probe nothing declared.`,
					{ at: "call", found: call ?? null, expected: PROBE_CALLS.join("|") },
				);
			}

			// Two implementations of one read is the split-brain this whole
			// subsystem exists to end: whichever won would decide what the world
			// says, and nothing would record that there had been a choice.
			if (implementations.has(call)) {
				throw new FactoryReconcileError(
					"probe-already-registered",
					`The read "${call}" already has a probe; one read has one implementation.`,
					{ at: "call", found: call },
				);
			}

			implementations.set(call, implementation);
		},

		implementationFor: (call) => implementations.get(call) ?? null,
	});
}

/**
 * The shipped registry, which subsystems populate as they land. It is empty in
 * a package carrying only the engine, and that is visible rather than assumed:
 * the engine reports every effect it could not probe.
 */
export const PROBES = createProbeRegistry();
