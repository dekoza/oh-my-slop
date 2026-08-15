import { writeArtifact } from "../artifacts/writes.mjs";
import { canonicalJson } from "../state/events.mjs";
import { SCOPE_FORMS } from "./scope.mjs";

/**
 * §6.8's run manifest: **the declared per-run overrides, recorded as evidence**.
 *
 * "Human overrides — per-run, declared, recorded." An override that is only
 * declared is a claim; an override recorded in an immutable, content-addressed
 * artifact is evidence, and evidence is what an incident review can read months
 * later without trusting that the config file on disk is the one the run used.
 *
 * It is written as an artifact and therefore as an **effect** (§4.5), which buys
 * §3.1's immutable membership for free rather than by a rule anyone follows: the
 * key names the run, so re-entering a run re-issues the same key. Identical
 * declarations return the committed write; **a changed one is a typed payload
 * conflict**, which is exactly what "run membership is immutable for a run's
 * life" means when someone edits `.pi/factory.json` and restarts.
 *
 * The manifest records what was *declared*, never what was inferred — §14.34 —
 * so the two override channels this package cannot yet carry are named as holes
 * rather than defaulted to an empty set that reads as "no overrides".
 */

/** The manifest's own shape version; the artifact is read by future doctors. */
export const RUN_MANIFEST_VERSION = 1;

/**
 * @param {object} store an open store
 * @param {object} context
 * @param {string} context.run the run this manifest pins
 * @param {object} context.scope §3.1's selector
 * @param {object} context.config the validated configuration
 * @param {string} context.configPath where it was read from
 * @param {object} context.activeRouting the routing this run routes by (§11.5)
 * @param {Record<string, ReadonlyArray<string>>} context.declared which override
 *   keys the file actually wrote (§6.8)
 * @param {object | null} context.handshake §11.7's package handshake, or null when
 *   the package could not be anchored at all
 * @param {object} context.hold the controller's hold, for the fencing generation
 * @param {string} context.actor `controller`, or `operator:<verb>`
 * @param {number} context.at
 * @returns {{ key: string, outcome: string, reference: object, content: object }}
 */
export function writeRunManifest(
	store,
	{ run, scope, config, configPath, activeRouting, declared, handshake, hold, actor, at },
) {
	const content = manifestContent({ run, scope, config, configPath, activeRouting, declared, handshake, at });

	const written = writeArtifact(store, {
		content: canonicalJson(content),
		mediaType: "application/json",
		role: "run-manifest",
		run,
		phase: "preflight",
		actor,
		// The hold's gate, not its generation: an effect issued after §14.6 took
		// the lease away is refused here rather than written and fenced later.
		fencingGeneration: hold.fence().generation,
		at,
	});

	return written;
}

/**
 * What the manifest says. Split out from the write so the shape is readable on
 * its own — the blob is what `doctor` and the monitor read back, and a shape
 * assembled inline among the effect plumbing is a shape nobody can find.
 */
function manifestContent({ run, scope, config, configPath, activeRouting, declared, handshake, at }) {
	return {
		manifest_version: RUN_MANIFEST_VERSION,
		run,
		// Rebuilt field by field rather than spread: the selector arrives frozen
		// with an optional half, and `canonicalJson` refuses an `undefined` value
		// outright rather than coercing it to null — which is exactly the
		// property that makes the digest evidence.
		//
		// It carries no timestamp, either. A manifest re-issued on re-entry must
		// be byte-identical or the effect is a conflict, and a clock would make
		// every re-entry one.
		scope: recordedScope(scope),
		config: {
			path: configPath,
			tracker: { repo: config.tracker.repo, remote: config.tracker.remote, assignee: config.tracker.assignee },
			git: { base_branch: config.git.baseBranch, remote: config.git.remote },
			checks: config.checks.map((check) => ({ name: check.name, severity: check.severity })),
			concurrency: { max_ticket_executions: config.concurrency.maxTicketExecutions },
		},
		overrides: overrides({ config, activeRouting, declared }),
		package: packagePin(handshake),
	};
}

/**
 * §6.8's four override channels, each answered or named as a hole.
 *
 * The hard floor no override may cross — no force-push, no default-branch
 * writes, no auto-merge, no skipping the independent review verdict, no
 * subtracting from the deny floor — is deliberately **not** recorded here. A
 * floor written into a per-run record is a floor that reads as per-run policy;
 * it lives in the code that enforces it.
 */
function overrides({ config, activeRouting, declared }) {
	return {
		// Declared keys only. `budgets.repair: 1` because nobody wrote the block
		// is not an override, and recording it as one would put a decision in
		// evidence that no human made.
		budgets: Object.fromEntries((declared.budgets ?? []).map((key) => [key, config.budgets[key]])),

		// §6.8's "model choices": which profile each role resolved to, and what
		// that profile actually names. The profile name alone would let a config
		// edit change the model without changing the manifest.
		models: {
			routing_set: activeRouting.set,
			roles: Object.fromEntries(
				Object.entries(activeRouting.roles).map(([role, bound]) => [
					role,
					Array.isArray(bound)
						? bound.map((name) => profilePin(config.profiles, name))
						: profilePin(config.profiles, bound),
				]),
			),
			// Rules decide the model for matching tickets. A count would let a
			// one-for-one rule edit keep the same manifest digest and silently
			// re-route an immutable run.
			rules: activeRouting.rules.map((rule) => ({
				labels_any: [...rule.labelsAny],
				role: rule.role,
				profile: Array.isArray(rule.profile)
					? rule.profile.map((name) => profilePin(config.profiles, name))
					: profilePin(config.profiles, rule.profile),
			})),
		},

		// The two channels whose config surface has not landed. `null` here means
		// "this package cannot carry one", which is a different fact from "none
		// was declared" — and §14.34 forbids inferring the difference away.
		extra_denies: {
			declared: null,
			missing: "the worker deny floor and its per-run additions (#106)",
			spec: "§6.8",
		},
		worker_context_file: {
			declared: null,
			missing: "the controller-owned config environment and its context file (#106)",
			spec: "§6.8",
		},
	};
}

/**
 * The selector as the digest carries it — a value, not `scope.mjs`'s operator
 * sentence. The two must not share a name: one of them is evidence.
 */
function recordedScope(scope) {
	return scope.kind === SCOPE_FORMS.parent
		? { kind: scope.kind, parent: scope.parent }
		: { kind: scope.kind, tickets: [...scope.tickets] };
}

function profilePin(profiles, name) {
	const profile = profiles[name];
	return { profile: name, kind: profile.kind, model: profile.model };
}

/**
 * §11.7's pin, cited rather than re-embedded: the handshake is its own artifact,
 * and the manifest carries the identity an operator reads without opening it.
 *
 * **The deterministic tree digest, and not the commit or the dirty flag.** §11.7
 * makes those two metadata beside the digest rather than part of it, and the
 * distinction is load-bearing here for a reason it is not there: this content is
 * an effect payload, so whatever it carries is what a re-entry must reproduce
 * byte for byte. A dirty flag that flips because somebody left an untracked file
 * in the checkout would make re-entering a run impossible over a fact §11.7 says
 * is not authoritative. The handshake artifact keeps both, and is reachable from
 * the digest.
 */
function packagePin(handshake) {
	if (handshake === null || handshake === undefined || handshake.package === undefined) {
		return { name: null, version: null, tree_digest: null };
	}

	return {
		name: handshake.package.name,
		version: handshake.package.version,
		tree_digest: handshake.tree.digest,
	};
}
