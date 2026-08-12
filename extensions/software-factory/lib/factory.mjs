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

	try {
	await save();
	await git.preflight();
	const initialFrontier = await tracker.listFrontier(parentIndex);
	if (initialFrontier.length === 0) {
		state.status = await tracker.countOpenChildren(parentIndex) > 0
			? "waiting-for-human"
			: "nothing-to-do";
		await save();
		await tracker.reportRun(parentIndex, state);
		return state;
	}
	const run = await git.createRun(runId);
	state.integrationBranch = run.integrationBranch;
	state.integrationPath = run.integrationPath;
	state.workspaceId = await herdr.createWorkspace(run.integrationPath, runId);
	state.status = "running";
	await save();

	let firstFrontier = true;
	while (true) {
		const frontier = firstFrontier ? initialFrontier : await tracker.listFrontier(parentIndex);
		firstFrontier = false;
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
		let worker = await herdr.createWorker({
			workspaceId: state.workspaceId,
			cwd: ticketWorktree.path,
			name,
			label: `#${ticket.index} ${ticket.title}`,
		});
		const initialPrompt = buildWorkerPrompt({ repo: config.tracker.repo, ticket });
		let result;
		let lastError;
		for (let attempt = 0; attempt <= config.retry.repairAttempts; attempt++) {
			const prompt = attempt === 0
				? initialPrompt
				: [
					"The factory could not verify your previous attempt.",
					`Failure: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
					"Inspect the current worktree, repair the implementation or completion evidence, rerun the required checks, and end with the required FACTORY_RESULT line.",
				].join("\n");
			try {
				result = await herdr.promptWorker(worker.name, prompt);
				if (result.status === "blocked") {
					lastError = undefined;
					break;
				}
				await git.verifyTicket(run, ticketWorktree);
				lastError = undefined;
				break;
			} catch (error) {
				lastError = error;
			}
		}

		for (let retry = 1; lastError && retry <= config.retry.freshAgentRetries; retry++) {
			await herdr.retireWorker?.(worker.tabId);
			worker = await herdr.createWorker({
				workspaceId: state.workspaceId,
				cwd: ticketWorktree.path,
				name: workerName(runId, ticket.index, `-r${retry}`),
				label: `#${ticket.index} ${ticket.title} (retry ${retry})`,
			});
			try {
				result = await herdr.promptWorker(worker.name, [
					initialPrompt,
					"",
					"A previous worker failed verification. Inspect and recover the existing worktree rather than assuming it is clean.",
				].join("\n"));
				if (result.status !== "blocked") await git.verifyTicket(run, ticketWorktree);
				lastError = undefined;
			} catch (error) {
				lastError = error;
			}
		}

		if (!result || lastError) {
			result = {
				status: "blocked",
				reason: `Automation failed after the repair and fresh-worker retry budgets were exhausted: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
			};
		}
		if (result.status === "blocked") {
			await tracker.block(ticket.index, result.reason);
			state.blocked.push(ticket.index);
			state.currentTicket = undefined;
			await save();
			continue;
		}

		try {
			await git.integrate(run, ticketWorktree, ticket.index);
			await git.verifyIntegration?.(run, ticketWorktree);
		} catch (error) {
			const reason = `Integration requires human resolution: ${error instanceof Error ? error.message : String(error)}`;
			await tracker.block(ticket.index, reason);
			state.blocked.push(ticket.index);
			state.currentTicket = undefined;
			state.status = "waiting-for-human";
			await save();
			await tracker.reportRun(parentIndex, state);
			return state;
		}
		await herdr.retireWorker?.(worker.tabId);
		await tracker.complete(ticket.index, result, run);
		state.completed.push(ticket.index);
		state.currentTicket = undefined;
		await save();
	}
	} catch (error) {
		state.status = "failed";
		state.error = error instanceof Error ? error.message : String(error);
		await save();
		if (state.integrationBranch) {
			try {
				await tracker.reportRun(parentIndex, state);
			} catch {
				// Preserve the execution error; tracker reporting is secondary evidence.
			}
		}
		throw error;
	}
}
