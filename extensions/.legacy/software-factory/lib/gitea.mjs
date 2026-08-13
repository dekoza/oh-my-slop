export class GiteaTrackerError extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "GiteaTrackerError";
	}
}

function parseJson(stdout, purpose) {
	try {
		const value = JSON.parse(stdout || "[]");
		if (value && !Array.isArray(value) && typeof value.message === "string") {
			throw new GiteaTrackerError(`Gitea rejected the request while ${purpose}: ${value.message}`);
		}
		return value;
	} catch (error) {
		if (error instanceof GiteaTrackerError) throw error;
		throw new GiteaTrackerError(`tea returned invalid JSON while ${purpose}.`, { cause: error });
	}
}

function hasAssignees(value) {
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "string") return value.trim() !== "";
	return Boolean(value);
}

function referencesParent(body, parentIndex) {
	if (typeof body !== "string") return false;
	const marker = new RegExp(`^Part of #${parentIndex}(?:\\D|$)`, "m");
	if (marker.test(body)) return true;

	const section = body.match(/^## Parent\s*$([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? "";
	return new RegExp(`(^|\\D)#${parentIndex}(?!\\d)`).test(section);
}

export function createGiteaTracker({ exec, cwd, config }) {
	const login = config.login ?? config.remote;
	const labels = {
		implementation: "workflow:implement",
		readyForAgent: "ready-for-agent",
		readyForHuman: "ready-for-human",
		...(config.labels ?? {}),
	};

	async function run(args, purpose) {
		const scopedArgs = args[0] === "api"
			? ["api", "--login", login, ...args.slice(1)]
			: [...args, "--login", login];
		const response = await exec("tea", scopedArgs, { cwd });
		if (response.code !== 0) {
			throw new GiteaTrackerError(
				`tea failed while ${purpose}: ${response.stderr.trim() || `exit ${response.code}`}`,
			);
		}
		return response.stdout;
	}

	function issueLabels(issue) {
		return (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name);
	}

	function normalizeIssue(issue) {
		return { ...issue, index: Number(issue.number), labels: issueLabels(issue) };
	}

	async function getIssue(index) {
		const output = await run([
			"api",
			`/repos/${config.repo}/issues/${Number(index)}`,
		], `reading factory target #${index}`);
		return normalizeIssue(parseJson(output, `reading factory target #${index}`));
	}

	async function listChildren(parentIndex, requiredLabels = [labels.implementation]) {
		const issues = [];
		for (let page = 1; ; page++) {
			const endpoint = `/repos/${config.repo}/issues?state=open&type=issues&limit=50&page=${page}`;
			const output = await run(["api", endpoint], "listing implementation tickets");
			const batch = parseJson(output, "listing implementation tickets");
			if (!Array.isArray(batch)) {
				throw new GiteaTrackerError("Gitea did not return an issue list.");
			}
			issues.push(...batch);
			if (batch.length < 50) break;
		}
		return issues
			.map(normalizeIssue)
			.filter((issue) => requiredLabels.every((required) => issue.labels.includes(required)))
			.filter((issue) => referencesParent(issue.body, parentIndex))
			.sort((left, right) => left.index - right.index);
	}

	async function listTargets(targetIndex, requiredLabels) {
		const target = await getIssue(targetIndex);
		if (target.labels.includes(labels.implementation)) {
			return target.state === "open"
				&& requiredLabels.every((required) => target.labels.includes(required))
				? [target]
				: [];
		}
		return listChildren(targetIndex, requiredLabels);
	}

	async function listFrontier(parentIndex) {
		const issues = (await listTargets(parentIndex, [labels.implementation, labels.readyForAgent]))
			.filter((issue) => !hasAssignees(issue.assignees));

		const frontier = [];
		for (const issue of issues) {
			const dependenciesOutput = await run([
				"api",
				`/repos/${config.repo}/issues/${Number(issue.index)}/dependencies`,
			], `reading blockers for #${issue.index}`);
			const dependencies = parseJson(dependenciesOutput, `reading blockers for #${issue.index}`);
			if (dependencies.every((dependency) => dependency.state === "closed")) {
				frontier.push({
					index: Number(issue.index),
					title: String(issue.title),
					labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
				});
			}
		}
		return frontier;
	}

	async function claim(index) {
		await run([
			"issues", "edit", String(index),
			"--repo", config.repo,
			"--add-assignees", config.assignee,
		], `claiming #${index}`);
	}

	async function upsertComment(index, marker, body) {
		const output = await run([
			"comments", "list", String(index),
			"--repo", config.repo,
			"--limit", "100",
			"--output", "json",
		], `reading factory comments on #${index}`);
		const normalizedOutput = output.replace(/\u001b\[[0-9;]*[mK]/g, "").trim();
		const comments = normalizedOutput === "No comments found"
			? []
			: parseJson(output, `reading factory comments on #${index}`);
		const existing = comments.find((comment) => String(comment.body ?? "").startsWith(marker));
		const content = `${marker}\n\n${body}`;
		if (existing) {
			await run([
				"comments", "edit", String(existing.id), content,
				"--repo", config.repo,
			], `updating factory comment on #${index}`);
			return;
		}
		await run([
			"comments", "add", String(index), content,
			"--repo", config.repo,
		], `commenting on #${index}`);
	}

	async function countOpenTargets(parentIndex) {
		return (await listTargets(parentIndex, [labels.implementation])).length;
	}

	async function complete(index, result, runState) {
		const evidence = result.tests.map((test) => `- ${test}`).join("\n");
		await upsertComment(index, "🤖 `software-factory` — ticket integration", [
			result.summary,
			"",
			`Integrated into \`${runState.integrationBranch}\`.`,
			`Implementation profile: \`${result.workerProfile}\``,
			"",
			"Test evidence:",
			evidence,
			"",
			`Independent review (\`${result.review.profile}\`): ${result.review.summary}`,
		].join("\n"));
		await run(["issues", "close", String(index), "--repo", config.repo], `closing #${index}`);
	}

	async function failAutomation(index, reason) {
		await upsertComment(index, "🤖 `software-factory` — automation failure", reason);
		await run([
			"issues", "edit", String(index),
			"--repo", config.repo,
			"--remove-labels", labels.readyForHuman,
			"--add-labels", labels.readyForAgent,
			"--remove-assignees", config.assignee,
		], `releasing #${index} after automation failure`);
	}

	async function block(index, reason) {
		await upsertComment(index, "🤖 `software-factory` — human blocker", reason);
		await run([
			"issues", "edit", String(index),
			"--repo", config.repo,
			"--remove-labels", labels.readyForAgent,
			"--add-labels", labels.readyForHuman,
			"--remove-assignees", config.assignee,
		], `routing #${index} to a human`);
	}

	async function createPullRequest(runState, parentIndex, baseBranch) {
		const output = await run([
			"pulls", "create",
			"--repo", config.repo,
			"--head", runState.integrationBranch,
			"--base", baseBranch,
			"--title", `Factory implementation for #${parentIndex}`,
			"--description", `Implements the agent-ready tickets under #${parentIndex}. Final merge remains manual.`,
		], "creating the factory pull request");
		return output.match(/https?:\/\/\S+/)?.[0] ?? output.trim();
	}

	async function reportRun(parentIndex, state) {
		const lines = [
			`Status: **${state.status}**`,
			state.integrationBranch ? `Integration branch: \`${state.integrationBranch}\`` : undefined,
			`Completed tickets: ${state.completed.length > 0 ? state.completed.map((index) => `#${index}`).join(", ") : "none"}`,
			`Human-blocked tickets: ${state.blocked.length > 0 ? state.blocked.map((index) => `#${index}`).join(", ") : "none"}`,
			`Automation-failed tickets: ${state.automationFailed?.length > 0 ? state.automationFailed.map((index) => `#${index}`).join(", ") : "none"}`,
		];
		if (state.error) lines.push(`Automation error: ${state.error}`);
		if (state.finalReview?.summary) {
			lines.push(`Final integration review (\`${state.finalReview.profile}\`): **${state.finalReview.status}** — ${state.finalReview.summary}`);
		}
		if (state.finalReview?.reason) lines.push(`Final review blocker: ${state.finalReview.reason}`);
		for (const finding of state.finalReview?.findings ?? []) lines.push(`- ${finding}`);
		if (state.pullRequest) lines.push(`Pull request: ${state.pullRequest}`);
		await upsertComment(parentIndex, `🤖 \`software-factory\` — run ${state.id}`, lines.filter(Boolean).join("\n"));
	}

	return {
		listFrontier,
		countOpenTargets,
		claim,
		complete,
		failAutomation,
		block,
		createPullRequest,
		reportRun,
	};
}
