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
 * quiet: the subsystem that owes it, and the section that specifies it.
 */
export const VERB_TABLE = Object.freeze({
	start: {
		requiresConfig: true,
		summary: "run one drain of a ticket or parent's scope",
		missing: "the controller lease, the run lifecycle, and the end-reason report (#97)",
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
		implemented: true,
		summary: "diagnose the factory without mutating it",
		// §10.5's `--baseline` executes the declared checks in a throwaway
		// worktree. It is accepted here and refused with the ticket that owes it,
		// because an operator reading §10.5 will type it — and "unknown flag"
		// would be a worse answer than "that subsystem has not landed".
		flags: {
			"--baseline": {
				missing: "the check runner and the throwaway-worktree baseline (#104)",
				spec: "§8.3, §10.5",
			},
		},
		spec: "§10.5",
	},
	reconcile: {
		requiresConfig: true,
		implemented: true,
		summary: "settle unresolved effects by re-probing",
		spec: "§5.4, §10.5",
	},
	stop: {
		requiresConfig: true,
		summary: "request a drain at the next ticket boundary",
		missing: "the durable stop-request record (#98)",
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
