import { addressFromOperand, probeArtifactBlob } from "./blobs.mjs";
import { FactoryArtifactError } from "./errors.mjs";

/**
 * §5.3: each effect kind's probe ships with the subsystem that introduces the
 * kind, and §12.1's artifact store introduces `artifact-delete`.
 *
 * **One read (`artifact.blob`), and it answers one of §4.5's matches.**
 * `absent` is cleanup's: an orphaned blob is a file with no ledger row, so the
 * only durable record that anything meant to remove it is the requested/resolved
 * pair, and the probe that settles it asks the filesystem whether the bytes are
 * gone (§12.8).
 *
 * **`digest-rehash` is deliberately unanswered here.** `artifact-write` and
 * `attestation-write` are keyed by *role and name* — a check's name, a review
 * axis — because that is the natural discriminator §4.5 asks for, so their keys
 * carry no address for a probe to recompute from, and an effect row carries no
 * payload. Answering them would mean guessing which blob a key meant. Reporting
 * that plainly leaves the effect exactly as it was, which is §12.4's alarm; a
 * probe that guessed would be the engine inferring a fact it cannot read.
 */

/**
 * Register the artifact reads on a probe registry. The shipped `PROBES` registry
 * is populated once, from the binary's composition root (`cli/main.mjs`).
 */
export function registerArtifactProbes(registry) {
	registry.register("artifact.blob", probeArtifact);
}

async function probeArtifact({ effect, probe, store }) {
	if (probe.match !== "absent") {
		throw new FactoryArtifactError(
			"artifact-unavailable",
			`Effect ${effect.effect_key} declares match "${probe.match}", which no key alone can answer: ` +
				"only §12.8's deletions name their blob's address in the key (§4.5, §14.28).",
			{ key: effect.effect_key, match: probe.match },
		);
	}

	const address = addressFromOperand(effect.operand);
	const found = probeArtifactBlob(store.storeDir, address);

	return {
		matched: !found.present,
		// The settled fact is the address and whether the bytes are gone. The byte
		// count belongs beside it in the basis rather than in the resolution: a
		// blob that is still there has a size, and a resolution committed for a
		// deletion never does.
		result: { ...address, present: found.present },
		// §5.3 requires a foreign source id of every source but `artifact`, whose
		// store is the factory's own disk — there is no foreign system to have one.
		detail: { ...address, present: found.present, bytes: found.bytes },
	};
}
