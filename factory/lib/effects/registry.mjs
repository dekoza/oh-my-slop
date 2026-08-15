import { PROBE_CALLS, PROBE_CATALOGUE, PROBE_MATCHES, PROBE_SOURCES, READ_OPERATIONS } from "./catalogue.mjs";
import { FactoryEffectError } from "./errors.mjs";
import { OPERATION_SHAPE } from "./keys.mjs";

/**
 * §4.5's effect registry: the set of mutations the factory may perform, and the
 * probe that settles each one.
 *
 * **An effect kind with no probe cannot be registered, enforced at
 * construction** (§14.3). That check is the structural guarantee behind §5.3's
 * reconciliation invariant — a `requested` record with no `resolved` record is
 * settled only by re-probing, and a fire-and-forget effect would be one nothing
 * *can* re-probe. Enforced here, at the seam every effect passes through, it
 * cannot be added by accident.
 */

const READS = new Set(READ_OPERATIONS.map(asOperationName));

function asOperationName(value) {
	return String(value).replaceAll(".", "-");
}

/**
 * @param {Record<string, { probe: { source: string, call: string, match: string } }>} catalogue
 * @returns {{ operations: readonly string[], has: (operation: string) => boolean,
 *             probeFor: (operation: string) => { source: string, call: string, match: string } }}
 * @throws {FactoryEffectError} `effect-kind-without-probe` · `read-is-not-an-effect`
 */
export function createEffectRegistry(catalogue) {
	const probes = new Map();

	for (const [operation, declaration] of Object.entries(catalogue)) {
		requireOperationName(operation);
		probes.set(operation, requireProbe(operation, declaration));
	}

	return Object.freeze({
		operations: Object.freeze([...probes.keys()]),
		has: (operation) => probes.has(operation),

		probeFor(operation) {
			const probe = probes.get(operation);
			if (probe === undefined) {
				throw new FactoryEffectError(
					"effect-kind-unknown",
					`No effect kind "${operation}" is registered; §4.5's catalogue is closed.`,
					{ operation, expected: [...probes.keys()].join("|") },
				);
			}
			return probe;
		},
	});
}

/** The shipped catalogue, constructed once so the check runs at import. */
export const EFFECT_REGISTRY = createEffectRegistry(PROBE_CATALOGUE);

function requireOperationName(operation) {
	// §4.5: reads are not effects — they get durable observation cursors (§5.1).
	// A read registered here would acquire a requested/resolved pair, and §5.3's
	// invariant would be re-probing a fact nothing mutated. Matched on the
	// dash-joined spelling too, because that is how a read would arrive if
	// somebody copied a probe's `call` into the operation slot.
	if (READS.has(asOperationName(operation))) {
		throw new FactoryEffectError(
			"read-is-not-an-effect",
			`"${operation}" is a read. Reads are not effects (§4.5); they get a durable observation cursor.`,
			{ operation },
		);
	}

	if (!OPERATION_SHAPE.test(operation)) {
		throw new FactoryEffectError(
			"effect-kind-unknown",
			`"${operation}" is not an operation name; §4.5's key grammar is fixed-arity and its segments are ${OPERATION_SHAPE}.`,
			{ operation },
		);
	}
}

function requireProbe(operation, declaration) {
	const probe = declaration?.probe;
	if (probe === undefined || probe === null) {
		throw new FactoryEffectError(
			"effect-kind-without-probe",
			`Effect kind "${operation}" declares no probe. An effect nothing can re-probe is a fact the journal would have to assert (§14.1, §14.3).`,
			{ operation },
		);
	}

	requireMember(operation, "source", probe.source, PROBE_SOURCES);
	requireMember(operation, "call", probe.call, PROBE_CALLS);
	requireMember(operation, "match", probe.match, PROBE_MATCHES);

	return Object.freeze({ source: probe.source, call: probe.call, match: probe.match });
}

function requireMember(operation, field, value, vocabulary) {
	if (!vocabulary.includes(value)) {
		throw new FactoryEffectError(
			"effect-kind-without-probe",
			`Effect kind "${operation}" declares probe ${field} ${JSON.stringify(value ?? null)}, which is not one of ${vocabulary.join(", ")}.`,
			{ operation, at: `probe.${field}`, found: value ?? null, expected: vocabulary.join("|") },
		);
	}
}
