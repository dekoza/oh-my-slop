import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
	const canonical = canonicalize(path);
	if (!canonical.startsWith(canonicalize(root) + "/")) {
		return Object.freeze({ ok: false, reason: PATH_REFUSALS.escape, found: canonical, expected: root });
	}

	return Object.freeze({ ok: true, path });
}

/**
 * The prefix assertion compares canonical spellings: a symlink planted inside
 * the root must not launder a path out of it. The path itself may not exist yet
 * — worktrees and attempt directories are asserted before they are created — so
 * resolution walks to the nearest existing ancestor.
 */
function canonicalize(path) {
	const absolute = resolve(path);
	let probe = absolute;
	let suffix = "";
	for (;;) {
		try {
			return join(realpathSync(probe), suffix);
		} catch {
			suffix = join(probe.slice(dirname(probe).length + 1), suffix);
			const parent = dirname(probe);
			if (parent === probe) return absolute;
			probe = parent;
		}
	}
}
