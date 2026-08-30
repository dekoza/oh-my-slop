import { isMissingRef } from "../git/errors.mjs";
import { attemptBranch } from "../git/isolation.mjs";

/** The stable prose marker on §8.9's machine-readable pause comment. */
const PAUSE_MARKER = "🤖 **factory — paused**";

/**
 * Plan the first attempt of a new ticket execution after a human boundary (#199).
 *
 * The tracker decides which attempt paused; git decides what that attempt's tip is.
 * Durable state is intentionally absent from this interface: the prior run may have
 * crossed the tier-1 horizon by the time a human clears the label (§3.4).
 */
export async function planTicketContinuation({ clone, baseCommit, ticketSnapshot, trackerLogin }) {
	const candidates = ticketSnapshot.comments.filter(
		(comment) =>
			comment.author === trackerLogin && typeof comment.body === "string" && comment.body.includes(PAUSE_MARKER),
	);
	if (candidates.length === 0) {
		return freshPlan({
			baseCommit,
			ticketSnapshot,
			code: "pause-comment-absent",
			message: "No factory pause comment is present; starting from the pinned default-branch base.",
		});
	}

	const latestComment = candidates.at(-1);
	const latest = parsePause(latestComment, ticketSnapshot.number);
	if (latest === null) {
		return freshPlan({
			baseCommit,
			ticketSnapshot,
			code: "pause-comment-unparseable",
			message: `The latest factory pause comment #${latestComment.id} is unparseable; starting from the pinned default-branch base.`,
		});
	}
	const pauses = candidates
		.map((comment) => parsePause(comment, ticketSnapshot.number))
		.filter((entry) => entry !== null);

	const branch = attemptBranch({ ticket: ticketSnapshot.number, attempt: latest.block.identity.attempt });
	let head;
	try {
		head = await clone.git(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
	} catch (error) {
		if (!isMissingRef(error)) throw error;
		return freshPlan({
			baseCommit,
			ticketSnapshot,
			code: "paused-branch-missing",
			message: `The paused attempt branch ${branch} is missing; starting from the pinned default-branch base.`,
		});
	}
	const commitsAhead = Number.parseInt(await clone.git(["rev-list", "--count", `${baseCommit}..${head}`]), 10);
	if (commitsAhead === 0) {
		return freshPlan({
			baseCommit,
			ticketSnapshot,
			code: "paused-branch-empty",
			message: `The paused attempt branch ${branch} carries no commit outside the default branch; starting fresh.`,
		});
	}
	if (!Number.isInteger(commitsAhead) || commitsAhead < 0) {
		throw new TypeError(`git returned an invalid commit delta for paused branch ${branch}: ${commitsAhead}`);
	}

	const exchanges = pauses.map((pause, index) => {
		const nextPauseId = pauses[index + 1]?.comment.id ?? Number.POSITIVE_INFINITY;
		const answers = ticketSnapshot.comments
			.filter(
				(comment) =>
					comment.id > pause.comment.id &&
					comment.id < nextPauseId &&
					comment.author !== trackerLogin,
			)
			.map(({ id, author, body }) => Object.freeze({ id, author, body }));

		return Object.freeze({
			comment: pause.comment.id,
			attempt: pause.block.identity.attempt,
			reason_class: pause.block.reason_class,
			question: pause.block.question,
			answer_status: answers.length === 0 ? "none-found" : "found",
			answers: Object.freeze(answers),
		});
	});
	const latestExchange = exchanges.at(-1);
	const answerIds = new Set(exchanges.flatMap((exchange) => exchange.answers.map((answer) => answer.id)));
	const filteredSnapshot = Object.freeze({
		...ticketSnapshot,
		comments: Object.freeze(ticketSnapshot.comments.filter((comment) => !answerIds.has(comment.id))),
	});
	const answeringComments = Object.freeze(
		latestExchange.answers.map(({ id, author }) => Object.freeze({ id, author })),
	);

	return Object.freeze({
		kind: "resume",
		baseCommit: head,
		acceptedRuns: Object.freeze([...new Set(pauses.map((pause) => pause.block.identity.run))]),
		ticketSnapshot: filteredSnapshot,
		claim: Object.freeze({
			kind: "resume",
			paused_attempt: latest.block.identity.attempt,
			reason_class: latest.block.reason_class,
			pause_comment: latest.comment.id,
			answering_comments: answeringComments,
			resumed_from: head,
		}),
		brief: Object.freeze({
			tier: "resume",
			prior: Object.freeze({ attempt: latest.block.identity.attempt, profile: null }),
			phase: "implement",
			outcome: "needs-human",
			facts: Object.freeze([
				Object.freeze({
					producer: "controller",
					label: "resume",
					value: Object.freeze({
						attempt: latest.block.identity.attempt,
						reason_class: latest.block.reason_class,
						pause_comment: latest.comment.id,
						answering_comments: answeringComments,
						resumed_from: head,
					}),
				}),
			]),
			untrusted: Object.freeze([]),
			resume: Object.freeze({ exchanges: Object.freeze(exchanges) }),
		}),
	});
}

function freshPlan({ baseCommit, ticketSnapshot, code, message }) {
	return Object.freeze({
		kind: "fresh",
		baseCommit,
		acceptedRuns: Object.freeze([]),
		ticketSnapshot,
		claim: Object.freeze({
			kind: "fresh",
			fallback_reason: Object.freeze({ code, message }),
		}),
		brief: null,
	});
}

function parsePause(comment, expectedTicket) {
	if (typeof comment.body !== "string" || !comment.body.includes(PAUSE_MARKER)) return null;
	const fenced = /(^|\n)(`{3,})json\n([\s\S]*?)\n\2(?=\n|$)/.exec(comment.body);
	if (fenced === null) return null;

	let block;
	try {
		block = JSON.parse(fenced[3]);
	} catch {
		return null;
	}
	if (
		block?.schema_version !== 1 ||
		block?.disposition !== "paused" ||
		block?.identity === null ||
		typeof block?.identity?.run !== "string" ||
		block.identity.run === "" ||
		block?.identity?.ticket !== expectedTicket ||
		typeof block?.identity?.attempt !== "string" ||
		!block.identity.attempt.startsWith(`${block.identity.run}-t${expectedTicket}-a`) ||
		!/^\d+$/.test(block.identity.attempt.slice(`${block.identity.run}-t${expectedTicket}-a`.length)) ||
		typeof block?.reason_class !== "string" ||
		block.reason_class === "" ||
		typeof block?.question !== "string" ||
		block.question.trim() === ""
	) {
		return null;
	}
	return Object.freeze({ comment, block: Object.freeze(block) });
}
