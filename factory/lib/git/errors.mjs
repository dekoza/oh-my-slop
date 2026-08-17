/**
 * Git-isolation refusals (§7). Every one of them stops the caller: a branch the
 * factory cannot name, a path that escapes the controller-owned state area, or a
 * ref outside the factory's own namespaces is never written — protection of the
 * operator's checkout is topological, not behavioural (§7.1).
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const GIT_ERROR_REASONS = Object.freeze([
	/** An identity segment outside §2.1's `[0-9A-Za-z-]` charset. */
	"identity-charset",
	/** A derived path that canonicalizes outside its declared root (§2.1). */
	"identity-path-escape",
	/**
	 * An identity slot that does not fit its role (§2.1): a non-number ticket,
	 * an attempt id naming a different ticket or run, an effect key missing the
	 * segment its probe needs.
	 */
	"identity-mismatch",
	/** A ref outside `factory/` and `refs/factory/*` (§14.11). */
	"ref-outside-namespace",
	/** The private clone cannot be created or replaced. */
	"clone-unavailable",
	/** A git command the isolation layer ran and the repository refused. */
	"git-command-failed",
	/** A deterministically-named ref already exists and names a different commit. */
	"branch-collision",
	/**
	 * §7.5's replay guard: a rebase whose result carries fewer non-base commits
	 * than its input, refused rather than adopted (#161) — the silent way a
	 * branch loses the work it publishes.
	 */
	"rebase-dropped-commits",
	/** A worktree path already occupied by something that is not this attempt's. */
	"worktree-occupied",
	/**
	 * §6.8: an attempt worktree asked for without the worker config environment
	 * that makes it safe to hand to a worker — no disabled `pushurl`, no
	 * pre-trust. Refused at creation rather than discovered at launch.
	 */
	"worktree-unusable",
]);

export class FactoryGitError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of GIT_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (ref, path, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!GIT_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown git error reason "${reason}".`);
		}
		this.name = "FactoryGitError";
		this.reason = reason;
		this.details = details;
	}
}

/**
 * Whether a refusal is git saying **"no such ref"** rather than "I could not
 * answer": `rev-parse --verify --quiet` exits 1 for a missing ref with nothing on
 * stderr, while every *other* failure — no repository, corrupt objects — leaves a
 * diagnostic there.
 *
 * It lives here, beside the error it reads, because **"absent" and "unanswerable"
 * are different facts** (§12.4) and every reader of a ref has to draw the line in
 * the same place. A second spelling of it would be a second vocabulary, and the
 * one that drifted would report a broken repository as an empty one.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMissingRef(error) {
	return error instanceof FactoryGitError && error.reason === "git-command-failed" && error.details.stderr === "";
}
