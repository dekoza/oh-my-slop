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
		maxWorkers: 1,
	}),
	workers: Object.freeze({
		profiles: Object.freeze({
			default: Object.freeze({ kind: "pi" }),
		}),
		routing: Object.freeze({
			defaults: Object.freeze({
				implement: "default",
				freshRetry: "default",
				review: "default",
				finalReview: "default",
			}),
			rules: Object.freeze([]),
		}),
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

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CLAUDE_PERMISSION_MODES = new Set(["acceptEdits", "auto", "manual", "dontAsk", "plan"]);
const ROUTING_PHASES = ["implement", "freshRetry", "review", "finalReview"];

function parseProfile(name, value) {
	const path = `workers.profiles.${name}`;
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
		throw new FactoryConfigError(`${path} has an invalid profile name.`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new FactoryConfigError(`${path} must be an object.`);
	}
	if (value.kind !== "pi" && value.kind !== "claude") {
		throw new FactoryConfigError(`${path}.kind must be "pi" or "claude".`);
	}
	const allowedFields = value.kind === "pi"
		? new Set(["kind", "model", "thinking", "startupTimeoutMs"])
		: new Set(["kind", "model", "effort", "permissionMode", "startupTimeoutMs"]);
	for (const field of Object.keys(value)) {
		if (!allowedFields.has(field)) throw new FactoryConfigError(`${path} has unknown field "${field}".`);
	}
	const profile = { kind: value.kind };
	if (value.model !== undefined) profile.model = requireNonEmptyString(value.model, `${path}.model`);
	if (value.kind === "pi" && profile.model !== undefined && !/^[^/\s]+\/[^\s]+$/.test(profile.model)) {
		throw new FactoryConfigError(`${path}.model must be an exact provider/model selector.`);
	}
	if (value.startupTimeoutMs !== undefined) {
		if (!Number.isInteger(value.startupTimeoutMs) || value.startupTimeoutMs < 30_000) {
			throw new FactoryConfigError(`${path}.startupTimeoutMs must be an integer of at least 30000.`);
		}
		profile.startupTimeoutMs = value.startupTimeoutMs;
	}
	if (value.kind === "pi") {
		if (value.thinking !== undefined && !THINKING_LEVELS.has(value.thinking)) {
			throw new FactoryConfigError(`${path}.thinking is not a supported pi thinking level.`);
		}
		if (value.thinking !== undefined) profile.thinking = value.thinking;
		if (value.effort !== undefined || value.permissionMode !== undefined) {
			throw new FactoryConfigError(`${path} uses Claude-only options on a pi profile.`);
		}
	} else {
		if (value.effort !== undefined && !CLAUDE_EFFORTS.has(value.effort)) {
			throw new FactoryConfigError(`${path}.effort is not a supported Claude effort level.`);
		}
		if (value.permissionMode !== undefined && !CLAUDE_PERMISSION_MODES.has(value.permissionMode)) {
			throw new FactoryConfigError(`${path}.permissionMode is not an allowed Claude permission mode.`);
		}
		if (value.effort !== undefined) profile.effort = value.effort;
		if (value.permissionMode !== undefined) profile.permissionMode = value.permissionMode;
		if (value.thinking !== undefined) {
			throw new FactoryConfigError(`${path}.thinking is a pi-only option.`);
		}
	}
	return profile;
}

function parseWorkers(value) {
	if (value === undefined) return DEFAULT_FACTORY_CONFIG.workers;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new FactoryConfigError("workers must be an object.");
	}
	const entries = Object.entries(value.profiles ?? {});
	if (entries.length === 0) throw new FactoryConfigError("workers.profiles must define at least one profile.");
	const profiles = Object.fromEntries(entries.map(([name, profile]) => [name, parseProfile(name, profile)]));
	const defaults = value.routing?.defaults;
	if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
		throw new FactoryConfigError("workers.routing.defaults must be an object.");
	}
	const parsedDefaults = {};
	for (const phase of ROUTING_PHASES) {
		const profile = requireNonEmptyString(defaults[phase], `workers.routing.defaults.${phase}`);
		if (!profiles[profile]) throw new FactoryConfigError(`workers.routing.defaults.${phase} references unknown profile "${profile}".`);
		parsedDefaults[phase] = profile;
	}
	const rules = value.routing?.rules ?? [];
	if (!Array.isArray(rules)) throw new FactoryConfigError("workers.routing.rules must be an array.");
	const parsedRules = rules.map((rule, index) => {
		const path = `workers.routing.rules[${index}]`;
		if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new FactoryConfigError(`${path} must be an object.`);
		if (!Array.isArray(rule.labelsAny) || rule.labelsAny.length === 0) throw new FactoryConfigError(`${path}.labelsAny must be a non-empty array.`);
		if (!Array.isArray(rule.phases) || rule.phases.length === 0 || rule.phases.some((phase) => !ROUTING_PHASES.includes(phase))) {
			throw new FactoryConfigError(`${path}.phases contains an unsupported routing phase.`);
		}
		if (rule.phases.includes("finalReview")) {
			throw new FactoryConfigError(`${path}: finalReview is run-level and cannot use ticket-label rules.`);
		}
		const profile = requireNonEmptyString(rule.profile, `${path}.profile`);
		if (!profiles[profile]) throw new FactoryConfigError(`${path}.profile references unknown profile "${profile}".`);
		return {
			labelsAny: rule.labelsAny.map((label, labelIndex) => requireNonEmptyString(label, `${path}.labelsAny[${labelIndex}]`)),
			phases: [...new Set(rule.phases)],
			profile,
		};
	});
	return { profiles, routing: { defaults: parsedDefaults, rules: parsedRules } };
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
	if (herdr.agentKind !== undefined && herdr.agentKind !== "pi") {
		throw new FactoryConfigError('legacy herdr.agentKind must be "pi" when present.');
	}
	delete herdr.agentKind;
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
		workers: parseWorkers(value.workers),
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
