/**
 * §4.5's probe catalogue, **declared as data**.
 *
 * Every mutation outside the database is an effect, and every effect kind
 * declares how it is re-probed. Keeping the catalogue as data is what lets the
 * registry refuse a kind with no probe at construction (§14.3) — a rule written
 * in prose would be a code-review convention, and §5.3's reconciliation
 * invariant would rest on nobody forgetting.
 *
 * **Reads are not effects.** They appear in this file only in a probe's `call`
 * slot and in `READ_OPERATIONS`, never as an operation: a read gets a durable
 * observation cursor (§5.1), not a requested/resolved pair.
 */

/**
 * Where a probe's answer comes from. These are §5.4's evidence classes, and
 * deliberately the same words: a probe result *is* an entry in a reconcile
 * evidence basis, and the operator's question is which source decided.
 * `journal-intent` is not among them — that is how §14.1 gets teeth.
 */
export const PROBE_SOURCES = Object.freeze(["tracker", "git-remote", "git-local", "harness", "artifact"]);

/**
 * The reads a probe performs. Closed, because a probe that invents its own call
 * is a probe nothing has implemented.
 */
export const PROBE_CALLS = Object.freeze([
	"issue.assignees",
	"issue.labels",
	"issue.state",
	"issue.comments",
	"pulls.by-head-branch",
	"git.rev-parse",
	"git.ls-remote",
	"git.worktree-list",
	"herdr.pane-list",
	"artifact.blob",
]);

/**
 * How the probe's answer settles the effect.
 *
 * `embedded-key` is §4.5's exact match on an effect key carried as an HTML
 * comment — never a marker prefix, because bodies are silently editable and
 * deletable, and a prefix would be the weakest link in the scheme.
 */
export const PROBE_MATCHES = Object.freeze([
	"present",
	"absent",
	"state-equals",
	"sha-equals",
	"digest-rehash",
	"embedded-key",
	"token-matches",
	"agent-stopped",
]);

/**
 * Every read the factory performs, and therefore every name that may **not** be
 * an effect operation (§4.5). The probe calls are reads by definition; the rest
 * are §5.1's observation ingestion, which is cursor-driven.
 */
export const READ_OPERATIONS = Object.freeze([
	...PROBE_CALLS,
	"issue.timeline",
	"issue.dependencies",
	"issue.list",
	"git.fetch",
	"herdr.events-subscribe",
]);

/**
 * §4.5's mutation inventory, each row carrying the probe that settles it.
 *
 * The cleanup rows are keyed by the *class of thing deleted* rather than by
 * §12.8's six plan target kinds, because that is the granularity at which the
 * probe differs — a worktree is a path, a branch is a ref, a pane is a pane.
 * §12.8's whitelist and its `--kind` vocabulary belong to the cleanup planner.
 */
export const PROBE_CATALOGUE = Object.freeze({
	// ── Tracker writes ──────────────────────────────────────────────────────
	"issue-assign": probe("tracker", "issue.assignees", "present"),
	"issue-unassign": probe("tracker", "issue.assignees", "absent"),
	"label-add": probe("tracker", "issue.labels", "present"),
	"label-remove": probe("tracker", "issue.labels", "absent"),
	"issue-close": probe("tracker", "issue.state", "state-equals"),
	"comment-post": probe("tracker", "issue.comments", "embedded-key"),
	"pr-create": probe("tracker", "pulls.by-head-branch", "present"),
	// A PR body is a comment body: the same embedded key survives an edit to the
	// prose, and the digest block §7.5 writes there is not evidence it landed.
	"pr-body-update": probe("tracker", "pulls.by-head-branch", "embedded-key"),

	// ── Git writes ──────────────────────────────────────────────────────────
	"branch-create": probe("git-local", "git.rev-parse", "present"),
	"push": probe("git-remote", "git.ls-remote", "sha-equals"),
	// Writing the ref and pushing it are two mutations, so they are two effects;
	// this one is settled locally.
	"evidence-ref": probe("git-local", "git.rev-parse", "present"),
	"worktree-create": probe("git-local", "git.worktree-list", "present"),
	"worktree-delete": probe("git-local", "git.worktree-list", "absent"),

	// ── Harness writes ──────────────────────────────────────────────────────
	// §5.2: Herdr is authoritative for exactly one fact — whether a worker
	// process is alive right now — so both probes ask only that.
	"agent-start": probe("harness", "herdr.pane-list", "token-matches"),
	"agent-stop": probe("harness", "herdr.pane-list", "agent-stopped"),

	// ── Artifact writes ─────────────────────────────────────────────────────
	"artifact-write": probe("artifact", "artifact.blob", "digest-rehash"),
	"attestation-write": probe("artifact", "artifact.blob", "digest-rehash"),

	// ── Cleanup deletions ───────────────────────────────────────────────────
	"cleanup-worktree": probe("git-local", "git.worktree-list", "absent"),
	"cleanup-branch": probe("git-local", "git.rev-parse", "absent"),
	"cleanup-pane": probe("harness", "herdr.pane-list", "absent"),
	"cleanup-artifact": probe("artifact", "artifact.blob", "absent"),
});

function probe(source, call, match) {
	return Object.freeze({ probe: Object.freeze({ source, call, match }) });
}
