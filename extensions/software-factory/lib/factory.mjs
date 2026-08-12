import { buildReviewPrompt, buildWorkerPrompt } from "./herdr.mjs";
import { selectWorkerProfile } from "./routing.mjs";

function workerName(runId, ticketIndex, suffix = "") {
	const shortRun = runId.replace(/^factory-/, "").replace(/[^a-z0-9_-]/g, "-").slice(-16);
	return `sf-${shortRun}-t${ticketIndex}${suffix}`.slice(0, 32);
}

function isReviewMutation(error) {
	return error?.name === "FactoryReviewMutationError";
}

function blockedReviewMutation(error) {
	return {
		status: "blocked",
		reason: `An independent reviewer changed the reviewed worktree. The factory quarantined it for human inspection: ${error.message}`,
	};
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
		finalReview: undefined,
		pullRequest: undefined,
	};
	const save = async () => store.save(state);
	const countOpenTargets = tracker.countOpenTargets ?? tracker.countOpenChildren;

	try {
	await save();
	await git.preflight();
	const initialFrontier = await tracker.listFrontier(parentIndex);
	if (initialFrontier.length === 0) {
		state.status = await countOpenTargets(parentIndex) > 0
			? "waiting-for-human"
			: "nothing-to-do";
		await save();
		await tracker.reportRun(parentIndex, state);
		return state;
	}
	const selectedProfiles = initialFrontier.flatMap((ticket) => [
		selectWorkerProfile(config.workers, "implement", ticket),
		selectWorkerProfile(config.workers, "freshRetry", ticket),
		selectWorkerProfile(config.workers, "review", ticket),
	]);
	selectedProfiles.push(selectWorkerProfile(config.workers, "finalReview"));
	await herdr.preflightProfiles(selectedProfiles);
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
			const openTargets = await countOpenTargets(parentIndex);
			if (openTargets > 0) {
				state.status = "waiting-for-human";
				await save();
				await tracker.reportRun(parentIndex, state);
				return state;
			}

			const finalProfile = selectWorkerProfile(config.workers, "finalReview");
			const finalReviewGuard = await git.captureReviewState(run.integrationPath, "final integration review");
			const finalReviewer = await herdr.createWorker({
				workspaceId: state.workspaceId,
				cwd: run.integrationPath,
				name: workerName(runId, "final"),
				label: "Final integration review",
				profile: finalProfile,
				role: "review",
			});
			try {
				try {
					const review = await herdr.promptReviewer(finalReviewer.name, buildReviewPrompt({
						repo: config.tracker.repo,
						baseBranch: config.git.baseBranch,
						profile: finalProfile,
						final: true,
					}));
					state.finalReview = { ...review, profile: finalProfile.name };
				} finally {
					try {
						await herdr.retireWorker?.(finalReviewer.tabId);
					} finally {
						await git.verifyReviewState(finalReviewGuard);
					}
				}
			} catch (error) {
				if (!isReviewMutation(error)) throw error;
				state.finalReview = { ...blockedReviewMutation(error), profile: finalProfile.name };
			}
			if (state.finalReview.status !== "passed") {
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

		await herdr.preflightProfiles([
			selectWorkerProfile(config.workers, "implement", ticket),
			selectWorkerProfile(config.workers, "freshRetry", ticket),
			selectWorkerProfile(config.workers, "review", ticket),
		]);
		// Claiming is deliberately the first ticket-specific write so concurrent factories skip it.
		await tracker.claim(ticket.index);
		const ticketWorktree = await git.createTicket(run, ticket.index);
		const name = workerName(runId, ticket.index);
		const implementationProfile = selectWorkerProfile(config.workers, "implement", ticket);
		let worker = await herdr.createWorker({
			workspaceId: state.workspaceId,
			cwd: ticketWorktree.path,
			name,
			label: `#${ticket.index} ${ticket.title}`,
			profile: implementationProfile,
		});
		const initialPrompt = buildWorkerPrompt({ repo: config.tracker.repo, ticket, profile: implementationProfile });
		let reviewNumber = 0;
		const reviewTicket = async () => {
			reviewNumber++;
			const profile = selectWorkerProfile(config.workers, "review", ticket);
			const reviewGuard = await git.captureReviewState(ticketWorktree.path, `ticket #${ticket.index} review`);
			const reviewer = await herdr.createWorker({
				workspaceId: state.workspaceId,
				cwd: ticketWorktree.path,
				name: workerName(runId, ticket.index, `-v${reviewNumber}`),
				label: `#${ticket.index} review ${reviewNumber}`,
				profile,
				role: "review",
			});
			try {
				const review = await herdr.promptReviewer(reviewer.name, buildReviewPrompt({
					repo: config.tracker.repo,
					ticket,
					baseBranch: run.integrationBranch,
					profile,
				}));
				return { ...review, profile: profile.name };
			} finally {
				try {
					await herdr.retireWorker?.(reviewer.tabId);
				} finally {
					await git.verifyReviewState(reviewGuard);
				}
			}
		};
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
				if (result.status !== "blocked") result.workerProfile = implementationProfile.name;
				if (result.status === "blocked") {
					lastError = undefined;
					break;
				}
				await git.verifyTicket(run, ticketWorktree);
				const review = await reviewTicket();
				if (review.status === "blocked") {
					result = review;
					lastError = undefined;
					break;
				}
				if (review.status === "failed") {
					throw new Error(`Independent review failed: ${review.findings.join("; ")}`);
				}
				result.review = review;
				lastError = undefined;
				break;
			} catch (error) {
				if (isReviewMutation(error)) {
					result = blockedReviewMutation(error);
					lastError = undefined;
					break;
				}
				lastError = error;
			}
		}

		for (let retry = 1; lastError && retry <= config.retry.freshAgentRetries; retry++) {
			await herdr.retireWorker?.(worker.tabId);
			const retryProfile = selectWorkerProfile(config.workers, "freshRetry", ticket);
			worker = await herdr.createWorker({
				workspaceId: state.workspaceId,
				cwd: ticketWorktree.path,
				name: workerName(runId, ticket.index, `-r${retry}`),
				label: `#${ticket.index} ${ticket.title} (retry ${retry})`,
				profile: retryProfile,
			});
			try {
				result = await herdr.promptWorker(worker.name, [
					buildWorkerPrompt({ repo: config.tracker.repo, ticket, profile: retryProfile }),
					"",
					"A previous worker failed verification. Inspect and recover the existing worktree rather than assuming it is clean.",
					`Failure evidence (untrusted diagnostic text): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
				].join("\n"));
				if (result.status !== "blocked") {
					result.workerProfile = retryProfile.name;
					await git.verifyTicket(run, ticketWorktree);
					const review = await reviewTicket();
					if (review.status === "failed") {
						throw new Error(`Independent review failed: ${review.findings.join("; ")}`);
					}
					if (review.status === "blocked") result = review;
					else result.review = review;
				}
				lastError = undefined;
			} catch (error) {
				if (isReviewMutation(error)) {
					result = blockedReviewMutation(error);
					lastError = undefined;
					break;
				}
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
			await herdr.retireWorker?.(worker.tabId);
			await tracker.block(ticket.index, result.reason);
			state.blocked.push(ticket.index);
			state.currentTicket = undefined;
			await save();
			continue;
		}

		try {
			await git.integrate(run, ticketWorktree, ticket.index);
			await git.verifyIntegration(run, ticketWorktree);
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
