import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_FACTORY_CONFIG = Object.freeze({
	version: 1,
	tracker: Object.freeze({
		kind: "gitea",
		repo: "",
		remote: "gitea",
		login: "gitea",
		assignee: "",
	}),
	git: Object.freeze({
		baseBranch: "main",
		remote: "gitea",
	}),
	herdr: Object.freeze({
		agentKind: "pi",
		maxWorkers: 1,
	}),
	retry: Object.freeze({
		repairAttempts: 1,
		freshAgentRetries: 1,
	}),
	completion: Object.freeze({
		closeAfterIntegration: true,
		finalMerge: "manual",
		createPullRequest: true,
		deploy: false,
	}),
});

export class FactoryConfigError extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "FactoryConfigError";
	}
}

function requireNonEmptyString(value, path) {
	if (typeof value !== "string" || value.trim() === "") {
		throw new FactoryConfigError(`${path} must be a non-empty string.`);
	}
	return value;
}

function requireCount(value, path) {
	if (!Number.isInteger(value) || value < 0) {
		throw new FactoryConfigError(`${path} must be a non-negative integer.`);
	}
	return value;
}

function parseConfig(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new FactoryConfigError("Factory configuration must be a JSON object.");
	}
	if (value.version !== 1) {
		throw new FactoryConfigError("version must be 1.");
	}
	if (!value.tracker || value.tracker.kind !== "gitea") {
		throw new FactoryConfigError('tracker.kind must be "gitea" in this release.');
	}

	const tracker = {
		kind: "gitea",
		repo: requireNonEmptyString(value.tracker.repo, "tracker.repo"),
		remote: requireNonEmptyString(value.tracker.remote ?? "gitea", "tracker.remote"),
		login: requireNonEmptyString(value.tracker.login ?? value.tracker.remote ?? "gitea", "tracker.login"),
		assignee: requireNonEmptyString(value.tracker.assignee, "tracker.assignee"),
	};
	if (value.tracker.labels !== undefined) {
		tracker.labels = {
			implementation: requireNonEmptyString(value.tracker.labels?.implementation, "tracker.labels.implementation"),
			readyForAgent: requireNonEmptyString(value.tracker.labels?.readyForAgent, "tracker.labels.readyForAgent"),
			readyForHuman: requireNonEmptyString(value.tracker.labels?.readyForHuman, "tracker.labels.readyForHuman"),
		};
	}
	if (!/^[^/\s]+\/[^/\s]+$/.test(tracker.repo)) {
		throw new FactoryConfigError('tracker.repo must have the form "owner/repository".');
	}

	const git = {
		...DEFAULT_FACTORY_CONFIG.git,
		...(value.git ?? {}),
	};
	requireNonEmptyString(git.baseBranch, "git.baseBranch");
	requireNonEmptyString(git.remote, "git.remote");

	const herdr = {
		...DEFAULT_FACTORY_CONFIG.herdr,
		...(value.herdr ?? {}),
	};
	if (herdr.agentKind !== "pi") {
		throw new FactoryConfigError('herdr.agentKind must be "pi" in this release.');
	}
	if (herdr.maxWorkers !== 1) {
		throw new FactoryConfigError("herdr.maxWorkers must be 1 in this release.");
	}

	const retry = {
		...DEFAULT_FACTORY_CONFIG.retry,
		...(value.retry ?? {}),
	};
	requireCount(retry.repairAttempts, "retry.repairAttempts");
	requireCount(retry.freshAgentRetries, "retry.freshAgentRetries");
	if (retry.repairAttempts !== 1) {
		throw new FactoryConfigError("retry.repairAttempts must be 1 in this release.");
	}
	if (retry.freshAgentRetries !== 1) {
		throw new FactoryConfigError("retry.freshAgentRetries must be 1 in this release.");
	}

	const completion = {
		...DEFAULT_FACTORY_CONFIG.completion,
		...(value.completion ?? {}),
	};
	if (completion.closeAfterIntegration !== true) {
		throw new FactoryConfigError("completion.closeAfterIntegration must be true in this release.");
	}
	if (completion.finalMerge !== "manual") {
		throw new FactoryConfigError('completion.finalMerge must be "manual".');
	}
	if (completion.createPullRequest !== true) {
		throw new FactoryConfigError("completion.createPullRequest must be true in this release.");
	}
	if (completion.deploy !== false) {
		throw new FactoryConfigError("completion.deploy must be false; deployment is outside the factory boundary.");
	}

	return {
		version: 1,
		tracker,
		git,
		herdr,
		retry,
		completion,
	};
}

export async function loadFactoryConfig(cwd, configDirName = ".pi") {
	const path = join(cwd, configDirName, "factory.json");
	let source;
	try {
		source = await readFile(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new FactoryConfigError(
				`Missing ${configDirName}/factory.json. Run setup-project-skills to configure this project first.`,
				{ cause: error },
			);
		}
		throw new FactoryConfigError(`Cannot read ${path}: ${error.message}`, { cause: error });
	}

	try {
		return parseConfig(JSON.parse(source));
	} catch (error) {
		if (error instanceof FactoryConfigError) throw error;
		throw new FactoryConfigError(`Invalid JSON in ${path}: ${error.message}`, { cause: error });
	}
}
