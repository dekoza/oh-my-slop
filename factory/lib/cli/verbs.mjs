import { FOREGROUND_FLAG } from "../controller/launch.mjs";
import { PARENT_FLAG } from "../controller/scope.mjs";
import { NEW_RUN_FLAG, runStart } from "../controller/start.mjs";
import { runStop } from "../controller/stop.mjs";
import { runDoctor } from "../doctor/verb.mjs";
import { runReconcile } from "../reconcile/verb.mjs";

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
		summary: "report the current and recent runs",
		missing: "the durable state projections it reads (#90)",
		spec: "§4.4, §10.2",
	},
	doctor: {
		requiresConfig: true,
		handler: runDoctor,
		summary: "diagnose the factory without mutating it, and classify a scope's members",
		// §10.5's `--baseline` executes the declared checks in a throwaway
		// worktree. It is accepted here and refused with the ticket that owes it,
		// because an operator reading §10.5 will type it — and "unknown flag"
		// would be a worse answer than "that subsystem has not landed".
		flags: {
			"--baseline": {
				missing: "the check runner and the throwaway-worktree baseline (#104)",
				spec: "§8.3, §10.5",
			},
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
	"cleanup-plan": {
		requiresConfig: true,
		summary: "derive a reviewable reclamation plan",
		missing: "the artifact ledger and the cleanup target whitelist (#118)",
		spec: "§12.8",
	},
	"cleanup-execute": {
		requiresConfig: true,
		summary: "execute a plan whose digest still matches",
		missing: "the artifact ledger and the cleanup target whitelist (#118)",
		spec: "§12.8",
	},
	migrate: {
		requiresConfig: false,
		summary: "rewrite a v1 config as schemaVersion 2, reporting every key",
		missing: "the legacy key disposition table and the TODO holes it leaves (#116)",
		spec: "§11.8",
	},
});

export const VERBS = Object.freeze(Object.keys(VERB_TABLE));
