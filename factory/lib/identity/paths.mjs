import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { IDENTITY_CHARSET } from "../domain/vocabulary.mjs";

/**
 * §2.1's containment, in one place: **charset validation plus
 * canonicalize-and-assert-prefix — both, not either.**
 *
 * Two subsystems derive paths from a minted identity — §7.1's worktrees and
 * baselines, and §6.5's per-attempt controller-owned directory — and the
 * predicate that keeps them contained is the same rule in both. It lives here
 * rather than in either of them because a second spelling of a containment
 * check is a second place for it to be subtly weaker.
 *
 * **The answer is data, not an exception.** Each caller raises its own typed
 * refusal (`FactoryGitError`, `FactoryWorkerError`) with its own reason
 * vocabulary; a shared throw would force one subsystem's error type on the
 * other, or a third that neither `--json` consumer knows how to branch on.
 */

/** What a refusal names, so both callers spell their reasons identically. */
export const PATH_REFUSALS = Object.freeze({ charset: "identity-charset", escape: "identity-path-escape" });

/**
 * @param {string} root the directory the derived path must sit under
 * @param {string} segment the identity segment naming it
 * @returns {Readonly<{ ok: true, path: string }
 *   | { ok: false, reason: string, found: unknown, expected: string }>}
 */
export function containPath(root, segment) {
	if (typeof segment !== "string" || !IDENTITY_CHARSET.test(segment)) {
		return Object.freeze({
			ok: false,
			reason: PATH_REFUSALS.charset,
			found: segment ?? null,
			expected: String(IDENTITY_CHARSET),
		});
	}

	const path = join(root, segment);
	const canonical = canonicalPath(path);
	if (!canonical.startsWith(canonicalPath(root) + "/")) {
		return Object.freeze({ ok: false, reason: PATH_REFUSALS.escape, found: canonical, expected: root });
	}

	return Object.freeze({ ok: true, path });
}

/**
 * A path's canonical spelling: absolute, with every symlink in it resolved.
 *
 * The prefix assertion above compares canonical spellings, because a symlink
 * planted inside the root must not launder a path out of it. The path itself may
 * not exist yet — worktrees and attempt directories are asserted before they are
 * created — so resolution walks to the nearest existing ancestor and re-appends
 * the rest.
 *
 * **Exported because a second subsystem needs the same spelling** (#178):
 * §6.8's pi trust store is keyed by the directory *pi* canonicalizes, and pi
 * resolves symlinks before keying it and before walking to the nearest ancestor
 * entry. A store the factory wrote with symlinks unresolved is one pi looks up
 * under a different key, reads back as no decision, and answers with the trust
 * dialog — on a pane nobody is watching. One helper, so the two spellings cannot
 * drift; the non-existent-path handling is the same requirement in both.
 *
 * @param {string} path
 * @returns {string}
 */
export function canonicalPath(path) {
	const absolute = resolve(path);
	let probe = absolute;
	let suffix = "";
	for (;;) {
		try {
			return join(realpathSync(probe), suffix);
		} catch {
			// `basename`, not arithmetic over `dirname`'s length: the parent of a
			// first-level directory is `/`, which carries no separator to skip, and
			// the off-by-one ate that directory's first character — `/state/wt`
			// canonicalized to `/tate/wt` on any host with no `/state`. Invisible
			// while every caller's root existed; #178 gave it a caller whose paths
			// routinely do not.
			suffix = join(basename(probe), suffix);
			const parent = dirname(probe);
			if (parent === probe) return absolute;
			probe = parent;
		}
	}
}
