import { embedEffectKey } from "../effects/keys.mjs";
import { FACTORY_BRANCH_PREFIX } from "../git/isolation.mjs";
import { FactoryTrackerError } from "./errors.mjs";
import { performEffect, supersededOperand } from "./mutations.mjs";

/**
 * §7.5's pull request: **one per ticket, against the default branch, opened from
 * one attempt branch and never touched again.**
 *
 * Three properties of the shape below are load-bearing, and each answers
 * something a legacy system got wrong or a later slice would otherwise reinvent:
 *
 * - **The body ends in `Closes #N`, and the factory never closes the ticket.**
 *   The *manual* merge closes it through Gitea's own automation, which is how
 *   "manual final merge" and "only the controller closes" are both true at once
 *   (§7.5, §8.9).
 * - **The body carries a machine-parseable block**, so the PR is discoverable
 *   from what is written on it rather than from a map the factory would have to
 *   keep — §7.6 has reconcile double-checking a publication exactly that way,
 *   and `parsePullBody` is the reader that makes the claim checkable.
 * - **One live PR per ticket, always matching one attempt branch.** A dead
 *   earlier attempt's PR is closed with a comment linking the new one, rather
 *   than left open beside it for a human to guess between.
 *
 * **A published branch is never touched again** (§14.12): nothing here updates a
 * body, re-targets a base, force-pushes, or closes a PR that drifted. §7.6 makes
 * a conflicted PR the human's call, and the drain report may note it.
 */

/** The version a machine reading a PR body block branches on. */
export const PULL_BODY_SCHEMA_VERSION = 1;

/**
 * The fence language, and the whole of "machine-parseable".
 *
 * **JSON rather than hand-rolled key-value lines**, for the reason
 * `disposition.mjs` gives about its own block: the values here include check
 * commands, reviewer prose, and file paths — arbitrary text — and a format whose
 * escaping rule is "put a backslash where it looks necessary" is exactly where
 * that gets mangled. JSON has one escaping rule and the standard library
 * implements it. A fenced JSON object is a fenced key-value block; a fenced
 * block of `key: value` lines that cannot round-trip a colon is not.
 */
const BLOCK_LANGUAGE = "json";

/** Where the block starts, so a reader finds ours and not a quoted example. */
const BLOCK_MARKER = "factory-pull";

/**
 * §7.5's title: the ticket's own, plus `(#N)`.
 *
 * The conventional prefix comes from the **ticket** when the ticket has one —
 * this does not invent one. A factory that prefixed every title `chore:` would
 * be asserting a change type nobody classified, and the ticket's own title is
 * the only classification anybody wrote down.
 *
 * @param {{ ticket: number, title: string }} what
 * @returns {string}
 */
export function pullTitle({ ticket, title }) {
	const trimmed = (title ?? "").trim();
    const suffix = `(#${ticket})`;
	if (trimmed === "") return `Ticket ${ticket} ${suffix}`;
	return trimmed.endsWith(suffix) ? trimmed : `${trimmed} ${suffix}`;
}

/**
 * §7.5's body: a fenced key-value block, then `Closes #N`.
 *
 * The block carries **the identity tuple, the base commit, the package
 * revision, the evidence links, and the attestation digest** — §7.5's list, in
 * full — plus §8.7's summary, with **advisory findings surfaced and blocking
 * findings never**. A blocking finding is one a repair already answered; putting
 * it on the PR would publish a criticism of code that is no longer there.
 *
 * **No timestamp of ours.** The tracker dates the PR itself, and a clock reading
 * in the body would make the body non-deterministic — so a re-entered
 * publication would arrive as §4.5's payload conflict instead of finding the
 * effect it already resolved.
 *
 * @param {object} block the facts; `summary` and `advisory` are §8.7's
 * @returns {string}
 */
export function renderPullBody(block) {
	const machine = JSON.stringify({ schema_version: PULL_BODY_SCHEMA_VERSION, ...block }, null, 2);
	const fence = "`".repeat(Math.max(3, longestBacktickRun(machine) + 1));

	return [
		`🤖 **factory — published** · attempt \`${block.identity.attempt}\``,
		"",
		block.summary ?? "",
		"",
		`<!-- ${BLOCK_MARKER} -->`,
		`${fence}${BLOCK_LANGUAGE}`,
		machine,
		fence,
		"",
		// Gitea's own automation, and the reason the factory never closes a ticket
		// itself: the merge a human performs is what discharges it (§7.5, §8.9).
		`Closes #${block.identity.ticket}`,
	].join("\n");
}

/**
 * The inverse — **the reason the block is called machine-parseable** (§7.6).
 *
 * A body an operator has edited around still parses: the marker locates the
 * fence, and everything outside it is prose. A body with no block at all is not
 * ours, and answering `null` rather than throwing is what lets a sweep walk a
 * repository's open PRs without every human-authored one being an exception.
 *
 * @param {string} body
 * @returns {object | null}
 */
export function parsePullBody(body) {
	if (typeof body !== "string") return null;
	const marker = body.indexOf(`<!-- ${BLOCK_MARKER} -->`);
	if (marker === -1) return null;

	const fenced = /^(`{3,})json\n([\s\S]*?)\n\1$/m.exec(body.slice(marker));
	if (fenced === null) return null;

	try {
		const parsed = JSON.parse(fenced[2]);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * §7.5's publication, and §7.7's "PR creation is check-then-create".
 *
 * The check is inside the effect's `perform` rather than in front of it, and
 * that placement is the point: §4.5's pair already makes a *recorded* creation
 * idempotent, and this covers the window the pair cannot — a controller that
 * opened the PR and died before the resolution committed. Re-entering finds the
 * open PR by its head branch and adopts it, instead of opening a second one that
 * a human then has to choose between.
 *
 * **The new PR is opened before the stale ones are closed**, because the comment
 * that closes a stale one links the PR that replaced it, and a link cannot name
 * something that does not exist yet. The window in between is two open PRs on
 * one ticket, which a re-entry closes; the alternative window is a ticket with
 * no live PR at all, which §7.6's `factory:awaiting-merge` would then be
 * pointing at nothing.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.reader a `createGiteaReader` client
 * @param {object} context.writer a `createGiteaWriter` client
 * @param {object} context.hold the controller's hold — §4.5's fencing generation
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt
 * @param {string} context.branch the attempt branch, which is the PR's head
 * @param {string} context.baseBranch the default branch, which is its base
 * @param {string} context.title
 * @param {string} context.body a `renderPullBody` body
 * @param {number} context.at
 * @returns {Promise<Readonly<{ pull: object, superseded: ReadonlyArray<object> }>>}
 * @throws {FactoryTrackerError} `pull-unpublishable`
 */
export async function publishPullRequest(
	store,
	{ reader, writer, hold, run, ticket, attempt, branch, baseBranch, title, body, at },
) {
	requireFactoryBranch(branch, ticket);

	const created = await performEffect(store, {
		hold,
		run,
		ticket,
		at,
		operation: "pr-create",
		// The head branch: §7.3 derives it from the identity tuple, so the probe
		// that settles this effect re-finds the pull request from the key alone.
		operand: branch,
		payload: { head: branch, base: baseBranch, title, body },
		perform: async () => {
			const open = await reader.pullByHeadBranch(branch);
			return open ?? (await writer.createPull({ head: branch, base: baseBranch, title, body }));
		},
		result: (pull) => ({ number: pull.number, html_url: pull.html_url, head_branch: pull.head_branch }),
	});

	const pull = Object.freeze({
		number: created.number,
		url: created.html_url,
		branch: created.head_branch ?? branch,
		outcome: created.outcome,
	});

	return Object.freeze({ pull, superseded: await supersede(store, { reader, writer, hold, run, ticket, pull, at }) });
}

/**
 * §7.5: **one live PR per ticket.** A dead earlier attempt's PR is closed with a
 * comment linking the new one.
 *
 * The sweep is over `factory/t<ticket>/`, which §7.3 makes derivable from the
 * ticket alone — so it finds a PR opened by a *previous run* whose state this
 * one never saw, which is the case that motivates the sweep at all.
 *
 * A PR whose body is not ours is left alone. A human may open a pull request
 * from a factory branch — to fix it up by hand, which §7.6's redo path
 * encourages — and closing it would be the factory reaching into work it did not
 * do.
 */
async function supersede(store, { reader, writer, hold, run, ticket, pull, at }) {
	const stale = (await reader.pullsByHeadPrefix(`${FACTORY_BRANCH_PREFIX}t${ticket}/`)).filter(
		(candidate) => candidate.number !== pull.number && parsePullBody(candidate.body) !== null,
	);

	const closed = [];
	for (const candidate of stale) {
		// The comment first: closing is the eligibility change a human sees, and a
		// PR closed with nothing said about it is the state that leaves them
		// guessing which of two branches carries the work.
		await performEffect(store, {
			hold,
			run,
			ticket,
			at,
			operation: "comment-post",
			operand: supersededOperand(candidate.number),
			payload: { superseded_by: pull.number },
			perform: (key) => writer.comment(candidate.number, embedEffectKey(supersedingComment(pull), key)),
			result: (comment) => ({ comment_id: comment.id, html_url: comment.html_url }),
		});

		const settled = await performEffect(store, {
			hold,
			run,
			ticket,
			at,
			operation: "issue-close",
			operand: String(candidate.number),
			payload: { state: "closed" },
			perform: () => writer.closePull(candidate.number),
			result: (answer) => ({ number: answer.number, state: answer.state }),
		});

		closed.push(Object.freeze({ number: candidate.number, branch: candidate.head_branch, state: settled.state }));
	}

	return Object.freeze(closed);
}

function supersedingComment(pull) {
	return (
		`🤖 **factory — superseded**\n\n` +
		`This pull request belongs to an attempt that did not finish. The work was redone, and the live pull request ` +
		`for this ticket is now ${pull.url ?? `#${pull.number}`}.\n\n` +
		"One live pull request per ticket, always matching one attempt branch (§7.5). The branch behind this one is " +
		"kept; nothing here was deleted."
	);
}

/**
 * A PR is opened from an attempt branch of **this** ticket, and from nothing
 * else. §14.11 already keeps the factory inside its own namespace at the git
 * layer; this is the same rule where the mutation is a tracker write, and it is
 * a separate check because the two systems fail independently.
 */
function requireFactoryBranch(branch, ticket) {
	if (typeof branch === "string" && branch.startsWith(`${FACTORY_BRANCH_PREFIX}t${ticket}/`)) return;

	throw new FactoryTrackerError(
		"pull-unpublishable",
		`A pull request is opened from ticket ${ticket}'s own attempt branch (§7.3, §14.11); found ` +
			`${JSON.stringify(branch ?? null)}.`,
		{ at: "branch", found: branch ?? null, expected: `${FACTORY_BRANCH_PREFIX}t${ticket}/*` },
	);
}

function longestBacktickRun(text) {
	return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}
