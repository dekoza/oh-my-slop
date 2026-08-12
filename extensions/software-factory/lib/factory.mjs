import { buildWorkerPrompt } from "./herdr.mjs";

function workerName(runId, ticketIndex, suffix = "") {
	const shortRun = runId.replace(/^factory-/, "").replace(/[^a-z0-9_-]/g, "-").slice(-16);
	return `sf-${shortRun}-t${ticketIndex}${suffix}`.slice(0, 32);
}

export async function runFactory({
	cwd,
	parentIndex,
	runId,
	config,
	tracker,
	git,
	herdr,
	store,
}) {
	const state = {
		id: runId,
		cwd,
		parentIndex,
		status: "starting",
		integrationBranch: undefined,
		integrationPath: undefined,
		workspaceId: undefined,
		currentTicket: undefined,
		completed: [],
		blocked: [],
		pullRequest: undefined,
	};
	const save = async () => store.save(state);

	await save();
	await git.preflight();
	const run = await git.createRun(runId);
	state.integrationBranch = run.integrationBranch;
	state.integrationPath = run.integrationPath;
	state.workspaceId = await herdr.createWorkspace(run.integrationPath, runId);
	state.status = "running";
	await save();

	while (true) {
		const frontier = await tracker.listFrontier(parentIndex);
		if (frontier.length === 0) {
			const openChildren = await tracker.countOpenChildren(parentIndex);
			if (openChildren > 0) {
				state.status = "waiting-for-human";
				await save();
				await tracker.reportRun(parentIndex, state);
				return state;
			}

			await git.publish(run);
			if (config.completion.createPullRequest) {
				state.pullRequest = await tracker.createPullRequest(run, parentIndex, config.git.baseBranch);
			}
			state.status = "awaiting-merge";
			await save();
			await tracker.reportRun(parentIndex, state);
			return state;
		}

		const ticket = frontier[0];
		state.currentTicket = ticket.index;
		await save();

		// Claiming is deliberately the first ticket-specific write so concurrent factories skip it.
		await tracker.claim(ticket.index);
		const ticketWorktree = await git.createTicket(run, ticket.index);
		const name = workerName(runId, ticket.index);
		const worker = await herdr.createWorker({
			workspaceId: state.workspaceId,
			cwd: ticketWorktree.path,
			name,
			label: `#${ticket.index} ${ticket.title}`,
		});
		const result = await herdr.promptWorker(
			worker.name,
			buildWorkerPrompt({ repo: config.tracker.repo, ticket }),
		);

		if (result.status === "blocked") {
			await tracker.block(ticket.index, result.reason);
			state.blocked.push(ticket.index);
			state.currentTicket = undefined;
			await save();
			continue;
		}

		await git.verifyTicket(run, ticketWorktree);
		await git.integrate(run, ticketWorktree, ticket.index);
		await tracker.complete(ticket.index, result, run);
		state.completed.push(ticket.index);
		state.currentTicket = undefined;
		await save();
	}
}
