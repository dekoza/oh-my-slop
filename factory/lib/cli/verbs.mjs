import { KIND_FLAG, RUN_FLAG, runCleanupExecute, runCleanupPlan } from "../cleanup/verb.mjs";
import { FOREGROUND_FLAG } from "../controller/launch.mjs";
import { PARENT_FLAG } from "../controller/scope.mjs";
import { NEW_RUN_FLAG, runStart } from "../controller/start.mjs";
import { runStop } from "../controller/stop.mjs";
import { BASELINE_FLAG, runDoctor } from "../doctor/verb.mjs";
import { runMigrate } from "../migrate/verb.mjs";
import { runReconcile } from "../reconcile/verb.mjs";
import { runStatus } from "../status/verb.mjs";

/**
 * The §10.2 verb set. Every operator verb lives in this one deterministic
 * binary — nothing is reachable only from a pi session, because the moment
 * `doctor` matters most is when the controller is dead and possibly pi with it.
 *
 * `requiresConfig` is false for exactly one verb: `migrate` is what turns an
 * unloadable v1 file into a loadable one, so making it depend on a successful
 * load would make it unreachable precisely when it is needed.
 *
 * `missing` and `spec` are what a not-yet-built verb says instead of going
 * quiet: the subsystem that owes it, and the section that specifies it. A verb
 * that *is* built names its `handler` here rather than being matched by name
 * where it is dispatched: a table row and a branch elsewhere are two places to
 * remember, and the one that gets forgotten runs the other verb's code.
 */
export const VERB_TABLE = Object.freeze({
	start: {
		requiresConfig: true,
		handler: runStart,
		summary: "run one drain of a ticket or parent's scope",
		// §3.1's two scope forms need telling apart on one line, and `<ticket>`
		// and `<parent>` are both issue numbers. The flag is the discriminator —
		// bare numbers are the direct-ticket set, and `--parent` says the single
		// number given is the parent whose members the run covers.
		//
		// `--foreground` is §10.1's process-shape decision: the default launch is
		// detached into a Herdr pane, and the flag runs the invocation as the
		// controller in the invoking terminal — the shape a dying SSH connection
		// would otherwise take with it.
		flags: {
			[NEW_RUN_FLAG]: { spec: "§10.4" },
			[PARENT_FLAG]: { spec: "§3.1" },
			[FOREGROUND_FLAG]: { spec: "§10.1" },
		},
		spec: "§10.1, §10.3",
	},
	status: {
		requiresConfig: true,
		handler: runStatus,
		summary: "report the current and recent runs",
		spec: "§4.4, §10.2",
	},
	doctor: {
		requiresConfig: true,
		handler: runDoctor,
		summary: "diagnose the factory without mutating it, and classify a scope's members",
		// §10.5's `--baseline` executes the declared required set in a throwaway
		// worktree inside the factory-private clone. Without it, `doctor` reports
		// the last recorded result and re-runs nothing — the expensive mode is
		// asked for, never inferred from how stale the record looks.
		flags: {
			[BASELINE_FLAG]: { spec: "§8.3, §10.5" },
			// The same discriminator `start` uses, for the same reason: `<ticket>`
			// and `<parent>` are both issue numbers, and one flag tells them apart.
			// `doctor` reads what `start` would claim, so the two must be asked the
			// question in exactly one way.
			[PARENT_FLAG]: { spec: "§3.1" },
		},
		spec: "§3.1, §3.2, §10.5",
	},
	reconcile: {
		requiresConfig: true,
		handler: runReconcile,
		summary: "settle unresolved effects by re-probing",
		spec: "§5.4, §10.5",
	},
	stop: {
		requiresConfig: true,
		handler: runStop,
		summary: "request a drain at the next ticket boundary",
		spec: "§10.5",
	},
	// §12.8's pair, and the asymmetry between them is the specification's:
	// planning is a read that is *always* permitted, executing takes the
	// controller lease so it can never race a live run (§14.25).
	//
	// **Neither declares a `--force`, and neither ever will** (§14.26). A force
	// flag on a guard whose entire purpose is "a human may have work here" is a
	// guard with an off switch, and the verb table is where such a flag would
	// have to be typed to exist.
	"cleanup-plan": {
		requiresConfig: true,
		handler: runCleanupPlan,
		summary: "derive a reviewable reclamation plan",
		// §12.8's two narrowings. Both carry their value on the flag, because the
		// verb is not known while the line is being read and a flag that swallowed
		// the next token could not tell a run id from `cleanup-execute`'s digest.
		flags: {
			[RUN_FLAG]: { spec: "§12.8", value: "run id" },
			[KIND_FLAG]: { spec: "§12.8", value: "target kind" },
		},
		spec: "§12.8",
	},
	"cleanup-execute": {
		requiresConfig: true,
		handler: runCleanupExecute,
		summary: "execute a plan whose digest still matches",
		flags: {
			[RUN_FLAG]: { spec: "§12.8", value: "run id" },
			[KIND_FLAG]: { spec: "§12.8", value: "target kind" },
		},
		spec: "§12.8, §14.25",
	},
	migrate: {
		requiresConfig: false,
		handler: runMigrate,
		summary: "rewrite a v1 config as schemaVersion 2, reporting every key",
		spec: "§11.8",
	},
});

export const VERBS = Object.freeze(Object.keys(VERB_TABLE));
