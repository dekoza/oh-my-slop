import { openPrivateClone } from "./clone.mjs";
import { FactoryGitError } from "./errors.mjs";
import { resolveRemoteUrl } from "./repo.mjs";

/**
 * The git half of §9.7's runtime probes, as one named preflight check:
 *
 * - §7.1 — the factory-private clone exists (created here if missing);
 * - §7.2 — the base branch is fetchable from the configured remote right now;
 * - §7.8 — the repo is **plain**: no `.gitmodules`, no LFS attributes, failed
 *   closed with a diagnostic naming the file. No silent degradation.
 *
 * The plainness read runs against the *fetched base tree*, never against the
 * operator's checkout — §7.1's topology holds even for preflight. The one
 * checkout read anywhere in this subsystem is the remote's URL from the
 * checkout's git config, which §11.3's `git.remote` key sanctions: the config
 * names the remote, and only the checkout knows where that name points.
 */

const LFS_ATTRIBUTE = /(^|\s)filter\s*=\s*lfs(\s|$)/m;

/**
 * @param {object} where the repository this runs for: **a store satisfies it**,
 *   and so does a `doctor` that has none yet — the check needs the checkout's
 *   path and the state directory the clone hangs under, and neither is a fact
 *   about the journal
 * @param {string} where.canonicalPath the operator's checkout, read only for the
 *   remote URL `git.remote` names (§11.3)
 * @param {string} where.storeDir the repository's store directory
 * @param {object} config the validated configuration
 * @returns {Promise<{ check: string, class: string, result: string, message: string,
 *   detail: object, clone?: object, base?: object }>}
 *   a check in `controller/preflight.mjs`'s shape; never throws for a fact
 *   about the repository — a red repository is a result, not a crash. A passing
 *   check carries the opened clone and the pinned base **beside** the reported
 *   fields, because §8.3's baseline runs in that clone at that commit and
 *   re-deriving them would be a second answer to "what is the base".
 */
export async function gitIsolationCheck({ canonicalPath, storeDir }, config) {
	const remoteName = config.git.remote;
	const baseBranch = config.git.baseBranch;

	const remoteUrl = resolveRemoteUrl(canonicalPath, remoteName);
	if (remoteUrl === null) {
		return failed(`The checkout defines no git remote "${remoteName}", which git.remote names (§11.3).`, {
			remote: remoteName,
		});
	}

	let clone;
	let base;
	try {
		clone = await openPrivateClone({ storeDir, remoteUrl });
		base = await clone.fetchBase({ baseBranch });
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		return failed(
			`The private clone cannot pin ${baseBranch} from ${remoteUrl}: ${error.message} (§7.1, §7.2).`,
			{ reason: error.reason, remote: remoteName, url: remoteUrl, base_branch: baseBranch },
		);
	}

	const refusals = await plainRepoRefusals(clone, base.commit);
	if (refusals.length > 0) {
		return failed(
			`v1 supports plain repos only, and ${baseBranch}@${base.commit.slice(0, 12)} carries ` +
				`${refusals.join(" and ")} (§7.8). The factory refuses rather than degrading silently.`,
			{ base_branch: baseBranch, base_commit: base.commit, found: refusals },
		);
	}

	return {
		...passed(
			`The private clone is healthy and ${baseBranch} pins to ${base.commit} — a plain repo, fetchable now.`,
			{ clone: clone.dir, remote: remoteName, url: remoteUrl, base_branch: baseBranch, base_commit: base.commit },
		),
		clone,
		base,
	};
}

/** §7.8's two refusal classes, read from the fetched tree. */
async function plainRepoRefusals(clone, commit) {
	const refusals = [];
	const paths = (await clone.git(["ls-tree", "-r", "--name-only", commit])).split("\n");

	if (paths.includes(".gitmodules")) refusals.push("submodules (.gitmodules)");

	for (const path of paths.filter((candidate) => candidate.split("/").at(-1) === ".gitattributes")) {
		const attributes = await clone.git(["cat-file", "blob", `${commit}:${path}`]);
		if (LFS_ATTRIBUTE.test(attributes)) {
			refusals.push(`LFS attributes (${path})`);
		}
	}

	return refusals;
}

function failed(message, detail) {
	return verdict("failed", message, detail);
}

function passed(message, detail) {
	return verdict("passed", message, detail);
}

function verdict(result, message, detail) {
	return { check: "git-isolation", class: "probe", result, message, detail };
}
