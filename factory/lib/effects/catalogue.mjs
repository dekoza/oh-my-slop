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
 * Where a probe's answer comes from — §5.4's evidence classes, deliberately the
 * same words, minus `outbox`: a probe reads the world, and the outbox holds what
 * the *worker* claimed, which §5.2 rules evidence and never proof. A probe
 * result is an entry in a reconcile evidence basis, and the operator's question
 * is which source decided. `journal-intent` is not among them either — that is
 * how §14.1 gets teeth.
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
 *
 * `digest-rehash` re-hashes what the probe fetched against the digest stored
 * beside the key: §4.5's "file exists and re-hashes to its digest", and the same
 * move for a body the factory wrote rather than a blob.
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
	// #100: one issue by number. The list read cannot express it — §3.1's
	// direct-ticket scope is an explicit set of numbers, and no label filter
	// selects them — and a read the factory performs that this list omits would
	// make the list a lie about what the factory asks the world.
	"issue.get",
	"git.fetch",
	"herdr.events-subscribe",
]);

/**
 * §4.5's mutation inventory, each row carrying the probe that settles it.
 *
 * **An operation names what is mutated; the key's phase segment says why.** So
 * there is one `worktree-delete`, not an eager one and a cleanup one — the same
 * mutation with the same probe, keyed `…/integrate/…` when §12.7 reclaims a
 * merged attempt's worktree and `…/cleanup/…` when §12.8's planner does. A
 * second name for one mutation would dilute "the database itself enforces
 * unique" from a whole-system property into a per-caller one.
 *
 * Deletions are therefore keyed by the *class of thing deleted* rather than by
 * §12.8's six plan target kinds, because that is the granularity at which the
 * probe differs — a worktree is a path, a branch is a ref, a pane is a pane.
 * §12.8's whitelist and its `--kind` vocabulary stay the cleanup planner's, and
 * it maps them onto these four.
 */
export const PROBE_CATALOGUE = Object.freeze({
	// ── Tracker writes ──────────────────────────────────────────────────────
	"issue-assign": probe("tracker", "issue.assignees", "present"),
	// §4.5's list names only "assign", but §3.3 has the loser of a claim
	// collision un-assign itself, and §3.5 releases a drained claim. Both are
	// mutations, so both are effects.
	"issue-unassign": probe("tracker", "issue.assignees", "absent"),
	"label-add": probe("tracker", "issue.labels", "present"),
	"label-remove": probe("tracker", "issue.labels", "absent"),
	"issue-close": probe("tracker", "issue.state", "state-equals"),
	"comment-post": probe("tracker", "issue.comments", "embedded-key"),
	"pr-create": probe("tracker", "pulls.by-head-branch", "present"),
	// Not `embedded-key`: §7.5 fixes the PR body as a machine-parseable
	// key-value block followed by `Closes #N`, and nothing there carries an
	// effect key. So the probe fetches the body and re-hashes it against the
	// digest stored beside the key — the same move as an artifact, over a body
	// instead of a blob.
	"pr-body-update": probe("tracker", "pulls.by-head-branch", "digest-rehash"),

	// ── Git writes ──────────────────────────────────────────────────────────
	"branch-create": probe("git-local", "git.rev-parse", "present"),
	"push": probe("git-remote", "git.ls-remote", "sha-equals"),
	// Writing the ref and pushing it are two mutations, so they are two effects;
	// this one is settled locally.
	"evidence-ref": probe("git-local", "git.rev-parse", "present"),
	"worktree-create": probe("git-local", "git.worktree-list", "present"),
	"worktree-delete": probe("git-local", "git.worktree-list", "absent"),

	// ── Harness writes ──────────────────────────────────────────────────────
	// §5.2: Herdr is authoritative for liveness and the pane output it holds,
	// so these probes ask only for the fact they are about — whether a worker
	// is alive right now.
	"agent-start": probe("harness", "herdr.pane-list", "token-matches"),
	"agent-stop": probe("harness", "herdr.pane-list", "agent-stopped"),

	// ── Artifact writes ─────────────────────────────────────────────────────
	"artifact-write": probe("artifact", "artifact.blob", "digest-rehash"),
	"attestation-write": probe("artifact", "artifact.blob", "digest-rehash"),

	// ── Deletions ───────────────────────────────────────────────────────────
	// `worktree-delete` above serves §12.8's worktree targets too; these are the
	// classes that only cleanup ever deletes. A pane is here and nowhere else:
	// §13.B says the controller stops *agents* and never closes a pane, so pane
	// reclamation exists only as a cleanup-plan entry.
	"branch-delete": probe("git-local", "git.rev-parse", "absent"),
	"pane-delete": probe("harness", "herdr.pane-list", "absent"),
	"artifact-delete": probe("artifact", "artifact.blob", "absent"),
});

function probe(source, call, match) {
	return Object.freeze({ probe: Object.freeze({ source, call, match }) });
}
