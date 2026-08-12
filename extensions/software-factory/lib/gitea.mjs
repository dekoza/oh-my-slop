export class GiteaTrackerError extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "GiteaTrackerError";
	}
}

function parseJson(stdout, purpose) {
	try {
		return JSON.parse(stdout || "[]");
	} catch (error) {
		throw new GiteaTrackerError(`tea returned invalid JSON while ${purpose}.`, { cause: error });
	}
}

function referencesParent(body, parentIndex) {
	if (typeof body !== "string") return false;
	const marker = new RegExp(`^Part of #${parentIndex}(?:\\D|$)`, "m");
	if (marker.test(body)) return true;

	const section = body.match(/^## Parent\s*$([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? "";
	return new RegExp(`(^|\\D)#${parentIndex}(?!\\d)`).test(section);
}

export function createGiteaTracker({ exec, cwd, config }) {
	async function run(args, purpose) {
		const response = await exec("tea", args, { cwd });
		if (response.code !== 0) {
			throw new GiteaTrackerError(
				`tea failed while ${purpose}: ${response.stderr.trim() || `exit ${response.code}`}`,
			);
		}
		return response.stdout;
	}

	async function listFrontier(parentIndex) {
		const output = await run([
			"issues", "list",
			"--repo", config.repo,
			"--state", "open",
			"--labels", "workflow:implement,ready-for-agent",
			"--fields", "index,title,body,assignees",
			"--limit", "100",
			"--output", "json",
		], "listing implementation tickets");

		const issues = parseJson(output, "listing implementation tickets")
			.filter((issue) => referencesParent(issue.body, parentIndex))
			.filter((issue) => !Array.isArray(issue.assignees) || issue.assignees.length === 0)
			.sort((left, right) => Number(left.index) - Number(right.index));

		const frontier = [];
		for (const issue of issues) {
			const dependenciesOutput = await run([
				"api",
				`/repos/${config.repo}/issues/${Number(issue.index)}/dependencies`,
			], `reading blockers for #${issue.index}`);
			const dependencies = parseJson(dependenciesOutput, `reading blockers for #${issue.index}`);
			if (dependencies.every((dependency) => dependency.state === "closed")) {
				frontier.push({ index: Number(issue.index), title: String(issue.title) });
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

	return { listFrontier, claim };
}
