import { join } from "node:path";

import { NO_REPO_ROOT } from "../cli/no-repo-root.mjs";
import { resolveRepoRoot } from "../git/repo.mjs";
import { FactoryConfigError } from "./errors.mjs";

/**
 * The one path the factory ever reads its policy from. There is no `--config`
 * override and no user-level defaults file (§11.1): config is repo-bound, so an
 * override's only distinctive power would be pointing repo A at repo B's policy.
 */
const CONFIG_DIR_NAME = ".pi";
const CONFIG_FILE_NAME = "factory.json";

/**
 * @returns {{ repoRoot: string, configPath: string }}
 * @throws {FactoryConfigError} when the invocation directory belongs to no repo
 */
export function discoverConfigPath(cwd) {
	const repoRoot = resolveRepoRoot(cwd);
	if (repoRoot === null) {
		// The reason and the detail come from the contract the exempt `stop` reads
		// too: the two refusals are different error types on purpose, and identical
		// on the wire by construction rather than by agreement (§10.5, #217).
		throw new FactoryConfigError(
			NO_REPO_ROOT.reason,
			`No git repository root above ${cwd}; factory configuration is repo-bound and there is no --config override.`,
			NO_REPO_ROOT.details(cwd),
		);
	}

	return { repoRoot, configPath: join(repoRoot, CONFIG_DIR_NAME, CONFIG_FILE_NAME) };
}
