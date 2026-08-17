import { ARTIFACT_WRITE_OPERATIONS } from "../artifacts/writes.mjs";
import { DISPOSITION_RELEASED, TICKET_DISPOSITIONS } from "../domain/vocabulary.mjs";
import { dispositionForReasonClass } from "../pipeline/dispositions.mjs";
import { outcomeChain } from "../pipeline/stages.mjs";
import { dispatchedAttempts } from "../worker/attempt.mjs";
import { FactoryTrackerError } from "./errors.mjs";
import { FACTORY_LABELS } from "./labels.mjs";
import { COMMENT_OPERANDS, performEffect, postComment } from "./mutations.mjs";

/**
 * §8.9: **the four dispositions become facts on Gitea**, and every one of them
 * carries the same machine-parseable comment block.
 *
 * The table below is §8.9's own, as data. Three of its rows add a label and
 * retain the assignee; the fourth drops the claim and adds nothing. Two
 * properties fall out of writing it this way rather than as four functions:
 *
 * - **`paused` and `failed` differ only in which label they add**, which is the
 *   whole point of there being two of them. Both need a human and both resume by
 *   label removal, but the label tells the human at a glance whether they owe an
 *   *answer* or an *investigation* — a two-minute reply, or opening a terminal.
 * - **Retaining the assignee is the absence of a mutation**, and it is visible
 *   here as one. A row that dropped the claim while adding a label would put the
 *   ticket back in the frontier carrying a label that excludes it, which is two
 *   halves of two different dispositions.
 *
 * **There is no automatic requeue** (§14.20). No row removes a label, no row adds
 * `ready-for-agent`, and `writer.mjs` has no removal to reach for: legacy's
 * `failAutomation` removed `ready-for-human` and added `ready-for-agent` back,
 * re-arming a ticket for the next run to die on identically with nobody watching.
 * **A human removing the label is what makes the label mean "someone has
 * acknowledged this".**
 */

/** The version a machine reading a disposition comment branches on. */
export const DISPOSITION_BLOCK_SCHEMA_VERSION = 1;

/**
 * §8.9's table. `label: null` is `released`'s "no label" — the ticket returns to
 * the frontier untouched, which is about eligibility and is why a comment is not
 * a contradiction of it.
 *
 * `guidance` is on the row rather than in a cascade of its own, because **what
 * the human owes is per row exactly as the label is**. For the two that resume by
 * label removal it says both halves — answer *and* remove — since the factory
 * never guesses whether a comment is an answer (§3.4).
 */
export const DISPOSITION_ACTIONS = Object.freeze({
	published: Object.freeze({
		label: FACTORY_LABELS.awaitingMerge,
		dropsClaim: false,
		guidance: (block) =>
			`The work is on a pull request: ${block.pr.url}. It stays assigned and carries \`${FACTORY_LABELS.awaitingMerge}\` ` +
			"until a human merges it, and the merge is what closes this ticket (§7.5, §8.9).",
	}),
	paused: Object.freeze({
		label: FACTORY_LABELS.needsHuman,
		dropsClaim: false,
		guidance: () =>
			`A worker stopped and needs an answer. **Answer in a comment and remove the \`${FACTORY_LABELS.needsHuman}\` ` +
			"label** — the factory never guesses whether a comment is an answer, and it never requeues a ticket by itself " +
			"(§3.4). The next run then claims this ticket as a fresh ticket execution.",
	}),
	failed: Object.freeze({
		label: FACTORY_LABELS.failed,
		dropsClaim: false,
		guidance: () =>
			`This ticket execution failed and needs an investigation. **Remove the \`${FACTORY_LABELS.failed}\` label** when ` +
			"it has been dealt with; the label stays until a human clears it, and the next run then claims this ticket as a " +
			"fresh ticket execution (§8.9, §14.20).",
	}),
	[DISPOSITION_RELEASED]: Object.freeze({
		label: null,
		dropsClaim: true,
		guidance: () =>
			"The claim is dropped and the ticket returns to the frontier untouched — an honest state rather than a lock " +
			"nobody holds (§8.9).",
	}),
});

/**
 * The labels a disposition can leave on a ticket — derived from the table, never
 * a second list. `comment-post`'s probe reads it: a disposition comment announces
 * the end of a ticket execution, and one of these labels is the durable state
 * that announcement would have left (§5.2).
 */
export const DISPOSITION_LABELS = Object.freeze(
	Object.values(DISPOSITION_ACTIONS)
		.map((row) => row.label)
		.filter((label) => label !== null),
);

/**
 * Settle a ticket execution on the tracker (§8.9).
 *
 * **The order is the eligibility change first, the announcement second**, and
 * the two crashes it decides between are not symmetric. A label written with no
 * comment behind it leaves a human a ticket they can see is stopped and cannot
 * yet see why — an unresolved effect §12.4 reports as an alarm. A comment written
 * with no label behind it leaves the ticket *claimable*, and the next run picks
 * it up and dies on it identically. The second is the failure §14.20 exists to
 * prevent, so the label goes first; `released` drops the claim first for the same
 * reason, since its eligibility change is the un-assign.
 *
 * @param {object} store an open store
 * @param {object} settlement
 * @param {object} settlement.writer a `createGiteaWriter` client
 * @param {object} settlement.hold the controller's hold — §4.5's fencing generation
 * @param {string} settlement.run
 * @param {number} settlement.ticket
 * @param {string} settlement.attempt the last attempt of this ticket execution
 * @param {string} settlement.assignee the factory's own tracker identity
 * @param {number} settlement.at
 * @param {string} settlement.disposition one of §8.8's four
 * @param {string | null} [settlement.reasonClass] §8.8's class, where the row has one
 * @param {string | null} [settlement.fault] §8.10's "`failed` / automation"
 * @param {string | null} [settlement.question] **the exact question**, for `paused`
 * @param {{ number: number, url: string } | null} [settlement.pr] the PR, for `published`
 * @param {string | null} [settlement.reason] one line of prose for a human —
 *   §8.7's summary, on the disposition that has one
 * @param {ReadonlyArray<object> | null} [settlement.advisory] §8.7's advisory
 *   findings, surfaced in the comment. **Blocking findings are never passed
 *   here**: a blocking finding is one a repair already answered, and publishing
 *   it would be a criticism of code that is no longer there
 * @param {Readonly<object> | null} [settlement.parked] #151's read of this ticket
 *   execution's attempt branches (`git/parked.mjs`), or `null` where no git read
 *   was made. The caller reads it because the read is git's to answer and this
 *   module never shells out; `null` is carried rather than omitted, because
 *   "nobody looked" is a different fact from "nothing was built". It lands in the
 *   comment and **not** in the digested payload — see below
 * @returns {Promise<Readonly<object>>}
 * @throws {FactoryTrackerError} `disposition-unknown` · `disposition-incomplete`
 * @throws {FactoryPipelineError} `reason-class-unknown` — a class in neither of
 *   §8.8's lists. It comes from `pipeline/dispositions.mjs` rather than being
 *   re-raised here, because §14.18's rule has exactly one home and a second
 *   spelling of "that is not a reason class" would be a second vocabulary.
 */
export async function applyDisposition(
	store,
	{
		writer,
		hold,
		run,
		ticket,
		attempt,
		assignee,
		at,
		disposition,
		reasonClass = null,
		fault = null,
		question = null,
		pr = null,
		reason = null,
		advisory = null,
		parked = null,
	},
) {
	const row = actionFor(disposition);
	requireComplete(disposition, { reasonClass, fault, question, pr });

	const intent = dispositionBlock(store, {
		run,
		ticket,
		attempt,
		disposition,
		reasonClass,
		fault,
		question,
		pr,
		reason,
		advisory,
	});

	// #151's read sits **in the block and outside the intent**, which is the split
	// the payload/body pair below exists for. Everything in `intent` is a function
	// of durable state, so a re-entered settlement recomputes it exactly; a branch
	// head is a fact about the world at the moment of reading, and §4.5 compares the
	// payload digest — so digesting it would turn an ordinary §10.4 re-entry that
	// read a moved head into a payload conflict instead of returning the comment
	// already posted. The first rendering is the one on the ticket, exactly as it
	// already is for the prose.
	const block = { ...intent, attempt_branches: parked };

	const labelled =
		row.label === null
			? null
			: await performEffect(store, {
					hold,
					run,
					ticket,
					at,
					operation: "label-add",
					// §4.5's natural discriminator: the label's own name. The operand is
					// what a `label-add` probe looks for on the ticket, so a key that
					// named anything else would have to carry a second copy of it.
					operand: row.label,
					payload: { labels: [row.label] },
					perform: () => writer.addLabels(ticket, [row.label]),
					result: (answer) => ({ labels: [...answer] }),
				});

	const unassigned = !row.dropsClaim
		? null
		: await performEffect(store, {
				hold,
				run,
				ticket,
				at,
				operation: "issue-unassign",
				operand: assignee,
				payload: { assignees: [] },
				perform: () => writer.unassign(ticket),
				result: (answer) => ({ assignees: answer.assignees, updated_at_raw: answer.updated_at_raw }),
			});

	const comment = await postComment(store, {
		writer,
		hold,
		run,
		ticket,
		at,
		operand: COMMENT_OPERANDS.disposition,
		body: renderDisposition(row, block),
		// **The block is the intent, and the prose is this factory's rendering of
		// it.** Digesting the rendering instead would make a re-entry that
		// re-rendered the same facts a §4.5 payload conflict the moment a word of
		// the prose changed — and the block is what a machine reads anyway.
		payload: intent,
	});

	return Object.freeze({ disposition, run, ticket, attempt, label: row.label, block, labelled, unassigned, comment });
}

/**
 * §8.9's machine-parseable block, in the half that is **intent**: identity tuple,
 * outcome chain, evidence references by digest — the same shape for all four
 * dispositions, so a machine reading a ticket's history parses one thing.
 *
 * **Every field here is a function of durable state, and nothing here reads a
 * clock or the world.** Every comment has the tracker's own creation date on it,
 * and §3.3 is explicit that the tracker's clock is the one that counts — while a
 * clock reading, or any other fact observed at settlement time, would make the
 * block non-deterministic, and a re-entered settlement would then arrive as §4.5's
 * payload conflict instead of returning the comment already posted. That is the
 * whole reason #151's git read is added to the block by the caller and is not a
 * field of this function.
 */
function dispositionBlock(
	store,
	{ run, ticket, attempt, disposition, reasonClass, fault, question, pr, reason, advisory },
) {
	return {
		schema_version: DISPOSITION_BLOCK_SCHEMA_VERSION,
		// §2.1's identities, whole: the ticket execution is `(run, ticket)` and the
		// attempt is the one that produced the last stage result.
		identity: { run, ticket, attempt },
		disposition,
		reason_class: reasonClass,
		fault,
		question,
		reason,
		pr,
		// §8.7: the summary lands in the PR body block **and in the ticket
		// comment**, with advisory findings surfaced and blocking findings never.
		// The comment is the half a human reads without leaving the tracker, so
		// leaving the findings to the PR alone would put them behind a click on the
		// one disposition where nobody has to make it.
		advisory,
		// §8.10's re-entry: read back from the journal rather than accumulated,
		// because the walk that produced it may have been a previous controller's.
		// The **shape** of the chain is what a human's next action depends on, so it
		// is never summarised to its last element.
		outcome_chain: outcomeChain(store, { run, ticket }).map((step) => ({ ...step })),
		// #155: **what actually did the work.** A reroute runs a profile other than
		// the one §11.5 declared, and a disposition that named neither would leave a
		// green ticket unable to answer "what wrote this?" — which is the auditing
		// hole a silent substitution opens, and the reason §6.5 re-asserts a
		// declared model against the observed one at all. It rides the digested
		// intent rather than the prose beside it because it is a function of durable
		// state: a re-entered settlement recomputes it exactly.
		dispatch: dispatchedAttempts(store, { run, ticket }).map((entry) => ({ ...entry })),
		evidence: evidenceFor(store, { run, ticket }),
	};
}

/**
 * §8.9's "evidence references by digest", read from **this ticket execution's own
 * artifact-write effects**.
 *
 * Not from §12.1's ledger, and the difference matters: the ledger is keyed by
 * content and its producer columns name the *most recent* production, so a later
 * run writing byte-identical output moves the row — and a block built from it
 * would change under a settlement that had already been requested. An effect row
 * is this ticket execution's own record, and it never moves.
 *
 * The key names the producer — run, ticket, phase, attempt, role — so a digest
 * here is addressable without the block carrying a path (§14.28).
 */
function evidenceFor(store, { run, ticket }) {
	const placeholders = ARTIFACT_WRITE_OPERATIONS.map(() => "?").join(", ");

	return store
		.read((db) =>
			db
				.prepare(
					`SELECT effect_key, result FROM effect
					 WHERE run_id = ? AND ticket = ? AND state = 'resolved' AND operation IN (${placeholders})
					 ORDER BY resolved_seq`,
				)
				.all(run, ticket, ...ARTIFACT_WRITE_OPERATIONS),
		)
		.map((entry) => {
			const written = JSON.parse(entry.result);
			return {
				produced_by: entry.effect_key,
				algorithm: written.algorithm,
				digest: written.digest,
				bytes: written.bytes,
			};
		});
}

/**
 * The comment a human reads, with the block inside it.
 *
 * **JSON rather than the claim comment's YAML**, for one reason worth stating:
 * this block carries a worker's exact question and a controller's reasons —
 * arbitrary multi-line text — and hand-rolled YAML quoting is precisely where
 * that gets mangled. JSON has one escaping rule and the standard library
 * implements it.
 *
 * The fence is sized to the content for the same reason: a question containing a
 * fenced code block would otherwise close the block early, and the machine half
 * of the comment would end mid-object.
 */
function renderDisposition(row, block) {
	const machine = JSON.stringify(block, null, 2);
	const fence = "`".repeat(Math.max(3, longestBacktickRun(machine) + 1, longestBacktickRun(block.question ?? "") + 1));

	return [
		`🤖 **factory — ${block.disposition}**${block.reason_class === null ? "" : ` · \`${block.reason_class}\``}`,
		"",
		row.guidance(block),
		...(block.question === null ? [] : ["", quote(block.question)]),
		...parkedProse(block),
		"",
		`${fence}json`,
		machine,
		fence,
	].join("\n");
}

/**
 * #151's read, in the half a human acts on.
 *
 * The JSON block already carries it, and that is not enough: the work this names
 * was recoverable on #114 only because an operator went looking inside the
 * factory-private clone by hand. So the branch and the head are prose, one line
 * per attempt, saying **which answer the read got** — commits, no commits, no
 * branch, no answer from git, or no base recorded to count against. None of them
 * is spelled as the absence of another (§11.2).
 */
function parkedProse(block) {
	const read = block.attempt_branches;
	if (read === null) return [];

	if (read.unreadable !== null) {
		return [
			"",
			`**The attempt branches could not be listed**: ${read.unreadable}. Whether this ticket execution left commits ` +
				"behind is therefore unknown here rather than answered — the private clone is where to look (§7.7, §11.2).",
		];
	}

	if (read.branches.length === 0) {
		return [
			"",
			"**No attempt branch exists for this ticket execution**, read from the factory's private clone at settlement — " +
				"nothing was built, rather than nothing having been looked for (§8.9, §11.2).",
		];
	}

	// Every branch git did not say was empty, which is not the same as every branch
	// git said had commits: a head with no countable base is work that may well be
	// there, and treating an unknown count as zero is the absence-standing-in-for-a-
	// value §11.2 forbids — here it would drop the one paragraph naming where the
	// work is.
	const parked = read.branches.filter((branch) => branch.head !== null && branch.commits_ahead !== 0);
	return [
		"",
		"**Attempt branches**, read from the factory's private clone at settlement:",
		...read.branches.map((branch) => `- \`${branch.branch}\` — ${describeBranch(branch)}`),
		// Said only where it is the operator's next move: on a `published`
		// disposition the branch is on the PR the guidance already links.
		...(parked.length === 0 || block.disposition === "published"
			? []
			: [
					"",
					`**Nothing non-integrated is ever pushed** (§7.7), so ${parked.length === 1 ? "that branch is" : "those branches are"} ` +
						"in the factory's private clone and nowhere else. The branch and head SHA above are what recovers that " +
						"work, without reopening a worktree integration may already have removed.",
				]),
	];
}

/**
 * One branch, as the answer the read got about it.
 *
 * The reason is kept in the reporting subsystem's own words, on one line: a git
 * diagnostic is often several, and a newline inside a list item ends the list —
 * with the branches after it rendered as a paragraph. The JSON block above carries
 * the message unaltered.
 */
function describeBranch(branch) {
	const role = `(${branch.role})`;
	const refused = branch.unreadable === null ? null : branch.unreadable.replace(/\s+/g, " ");
	if (branch.head === null) {
		return refused === null ? `no branch in the clone ${role}` : `git could not answer: ${refused} ${role}`;
	}
	if (branch.commits_ahead === null) {
		return `head \`${branch.head}\`, commit count unavailable: ${refused} ${role}`;
	}
	if (branch.commits_ahead === 0) {
		return `no commits — head \`${branch.head}\` is still its base ${role}`;
	}
	const commits = `${branch.commits_ahead} commit${branch.commits_ahead === 1 ? "" : "s"}`;
	return `head \`${branch.head}\`, ${commits} ahead of \`${branch.base_commit}\` ${role}`;
}

/** §8.8's four, and the refusal that keeps a fifth from being invented at a call site. */
function actionFor(disposition) {
	const row = DISPOSITION_ACTIONS[disposition];
	if (row === undefined) {
		throw new FactoryTrackerError(
			"disposition-unknown",
			`${JSON.stringify(disposition ?? null)} is not one of §8.9's dispositions (${TICKET_DISPOSITIONS.join(", ")}); ` +
				"a ticket execution settles as one of four, and a fifth word would be a tracker state nothing can read back.",
			{ at: "disposition", found: disposition ?? null, expected: TICKET_DISPOSITIONS.join("|") },
		);
	}
	return row;
}

/**
 * What each disposition may not be filed without.
 *
 * Fail-closed, because every one of these is what the comment exists to carry: a
 * `paused` with no question puts a ticket in front of a human with no way to know
 * what to answer, and a `published` with no PR link is a ticket whose work nobody
 * can find. §11.2's "no silent guessing" applied to the tracker.
 *
 * **The reason class is checked against §14.18's rule rather than re-listed**: a
 * class decides its own disposition, so a `failed` filed under a worker-writable
 * class — or a `paused` under a controller-derived one — is refused by the one
 * function that owns that mapping.
 */
function requireComplete(disposition, { reasonClass, fault, question, pr }) {
	if (reasonClass !== null && dispositionForReasonClass(reasonClass) !== disposition) {
		throw incomplete(
			disposition,
			"reasonClass",
			`reason class ${JSON.stringify(reasonClass)} settles as ${dispositionForReasonClass(reasonClass)} under §14.18's rule`,
		);
	}

	if (disposition === "paused") {
		if (reasonClass === null) throw incomplete(disposition, "reasonClass", "§3.4 pauses with a reason class");
		if (typeof question !== "string" || question.trim() === "") {
			throw incomplete(disposition, "question", "§3.4 carries **the exact question** a human must answer");
		}
	}

	if (disposition === "failed" && reasonClass === null && fault === null) {
		throw incomplete(disposition, "reasonClass", "§8.10 fails with a reason class or an automation fault");
	}

	if (disposition === "published" && (typeof pr?.url !== "string" || pr.url === "")) {
		throw incomplete(disposition, "pr", "§8.9 links the pull request the work is on");
	}
}

function incomplete(disposition, at, wanted) {
	return new FactoryTrackerError(
		"disposition-incomplete",
		`A ${disposition} disposition is missing its ${at}: ${wanted}.`,
		{ at, disposition },
	);
}

function longestBacktickRun(text) {
	return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

/** The worker's own words, marked as theirs and left exactly as they were. */
function quote(text) {
	return text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}
