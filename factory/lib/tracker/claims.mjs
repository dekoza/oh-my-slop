import { commentCarriesEffectKey } from "../effects/keys.mjs";
import { FactoryTrackerError } from "./errors.mjs";
import { COMMENT_OPERANDS, performEffect, postComment } from "./mutations.mjs";

/**
 * §3.3's claim, whole: **assignee plus a structured claim comment, then a
 * re-read** — and everything the re-read is for.
 *
 * The order is the load-bearing part and it is not the obvious one. Capacity is
 * acquired **before** any of this (§9.4, §14.21), by the scheduler; this module
 * is never reached by a ticket whose slots are not already held. §3.3 says why in
 * one sentence: *claiming work that cannot start puts an assignee and a claim
 * comment on the tracker for work that is not moving — visible to humans and
 * other tooling as a falsehood.*
 *
 * **Every mutation here is one half of a §4.5 pair.** `requestEffect` records the
 * intent, `writer` performs the mutation, `resolveEffect` records what the world
 * did — so a crash between the two leaves a `requested` record that §5.3 settles
 * by re-probing, never by reasoning. The effect key is what makes a re-run
 * idempotent: the same run, ticket, attempt and operation produce the same key,
 * and the second request returns the committed result instead of assigning twice.
 *
 * **What decides, and what merely informs.** §5.2 excludes comment *text* from
 * every authority row, so nothing here classifies a ticket from what a comment
 * says. Arbitration is on the comment **id**, which is Gitea's own and monotonic;
 * the marker test is a string search for a marker the factory itself wrote, in
 * the same class of operation as §4.5's `embedded-key` probe; and our own comment
 * is recognised by the id the tracker handed back, never by parsing the body we
 * wrote. A missing comment is therefore *possibly deleted* and never *no claim
 * was made* — the effect record and the durable assignee corroborate (§5.2), and
 * the probe in `reconcile/tracker-probes.mjs` is where that reading lives.
 */

/**
 * How a claim attempt ended. All seven are ordinary answers rather than errors:
 * the scheduler's next move differs for each, and a `human-claimed` ticket
 * reaching a caller as a thrown exception would make "somebody is working on
 * this" look like a fault.
 */
export const CLAIM_OUTCOMES = Object.freeze({
	/** The ticket is this run's. */
	claimed: "claimed",
	/** Already this run's, from an earlier pass over the same ticket. */
	alreadyClaimed: "already-claimed",
	/** A stale claim was taken over — comment posted first (§3.3). */
	takenOver: "taken-over",
	/** §3.3: an assignee the factory did not set. Absolute, never contested. */
	humanClaimed: "human-claimed",
	/** §3.3: **a live claim is never contested.** */
	liveClaim: "live-claim",
	/** A foreign claim younger than the staleness window, with ticket trace. */
	notStale: "not-stale",
	/** §3.3: a lower claim-comment id won, and this run moved on. */
	lostCollision: "lost-collision",
});

/**
 * §3.3's second staleness tier: **24h without ticket trace**, for a claim this
 * factory cannot prove is its own.
 *
 * There is no first-tier window and there must not be one — same-factory
 * staleness is *proven from durable state*, so waiting would be waiting for a
 * clock to confirm something already known.
 */
export const FOREIGN_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The marker that makes a comment recognisable as a claim without reading it.
 *
 * An HTML comment for the same reason §4.5's effect key is one: it survives an
 * operator rewriting the prose around it, and it never appears in the rendered
 * ticket. It is not an *authority* — §5.2 gives comment text none — it is how a
 * contender is spotted so its **id** can decide.
 */
const CLAIM_MARKER = "<!-- factory-claim -->";

/**
 * Claim a ticket for this run (§3.3).
 *
 * @param {object} store an open store
 * @param {object} claim
 * @param {object} claim.reader a `createGiteaReader` client
 * @param {object} claim.writer a `createGiteaWriter` client
 * @param {object} claim.hold the controller hold — §4.5's fencing generation
 * @param {string} claim.run
 * @param {number} claim.ticket
 * @param {string} claim.attempt the implement attempt this claim is for — §3.3
 *   requires it in the comment. **A ticket execution claims once**, and §7.3
 *   derives attempt ids deterministically from the identity tuple, so a
 *   re-entered run rebuilds the same body and §4.5's duplicate check returns the
 *   committed claim. Two *different* attempts claiming one ticket execution is a
 *   disagreement about what the tracker should say, and it surfaces as §4.5's
 *   typed payload conflict rather than as a second comment.
 * @param {string} claim.assignee the factory's own tracker identity (`tracker.assignee`)
 * @param {number} claim.at
 * @param {number} [claim.staleAfterMs] §3.3's foreign staleness window
 * @returns {Promise<Readonly<object>>} the outcome, and the evidence behind it
 */
export async function claimTicket(
	store,
	{ reader, writer, hold, run, ticket, attempt, assignee, at, staleAfterMs = FOREIGN_STALE_AFTER_MS },
) {
	const issue = await reader.readIssue(ticket);

	// **The tracker's clock, and no fallback to ours.** Every timestamp compared
	// below is Gitea's — a comment's `created_at`, an issue's `updated_at` — and
	// substituting our own would put two clocks in one comparison: a host running
	// ten minutes fast would push the contest window into the future and drop a
	// rival's claim comment posted three minutes ago, so both factories would
	// conclude they had claimed the ticket. The same skew moves §3.3's 24h
	// staleness window. `Date` is mandatory on an HTTP/1.1 response, so its absence
	// is a broken path rather than a condition to degrade around (§11.2).
	const now = reader.serverTime();
	if (!Number.isInteger(now)) {
		throw new FactoryTrackerError(
			"tracker-clock-unknown",
			`${reader.repo} answered without a Date header, so this process does not know the tracker's clock; §3.3's arbitration and its staleness window are both comparisons against it, and substituting ours would decide them by the skew between two machines.`,
			{ at: "serverTime", ticket },
		);
	}

	const standing = await assessClaim(store, { reader, issue, assignee, run, ticket, now, staleAfterMs });
	if (standing.outcome !== null) return standing;

	// §3.3's takeover comment is posted **first**: a ticket whose assignee changed
	// with no record of why is exactly the "lock nobody holds" confusion §8.9 ends.
	const takeoverComment =
		standing.takeover === null
			? null
			: await postComment(store, {
					writer,
					hold,
					run,
					ticket,
					at,
					operand: COMMENT_OPERANDS.takeover,
					body: takeoverBody({ run, ticket, attempt, at, takeover: standing.takeover }),
					// What is being taken over, and from whom. The prose around it is
					// dated and says how long the displaced claim had been idle — both
					// clock readings, and neither one part of the intent.
					payload: {
						run,
						ticket,
						attempt,
						taken_over_from: standing.takeover.claimed_by,
						tier: standing.takeover.tier,
					},
				});

	const assigned = await performEffect(store, {
		hold,
		run,
		ticket,
		at,
		operation: "issue-assign",
		operand: assignee,
		payload: { assignees: [assignee] },
		perform: () => writer.assign(ticket, [assignee]),
		result: (answer) => ({ assignees: answer.assignees, updated_at_raw: answer.updated_at_raw }),
	});

	const comment = await postComment(store, {
		writer,
		hold,
		run,
		ticket,
		at,
		operand: COMMENT_OPERANDS.claim,
		body: claimBody({ run, ticket, attempt, at }),
		// **§3.3's three identities, and not its timestamp.** The comment carries the
		// stamp because §3.3 asks for it; the *intent* is which run claims which
		// ticket under which attempt, and digesting the rendered body instead would
		// make a re-entered claim a §4.5 payload conflict for no reason but the hour
		// it happened at — the one failure that leaves a ticket permanently
		// unclaimable by the run that already holds it.
		payload: { run, ticket, attempt },
	});

	// §3.3's re-read. Two things can have happened while the two writes above were
	// in flight, and only a read of the tracker can tell: somebody else's PATCH
	// replaced the assignee set (Gitea's endpoint takes the whole set), or a second
	// factory claimed simultaneously and both comments landed.
	return arbitrate(store, {
		reader,
		run,
		ticket,
		attempt,
		assignee,
		since: now,
		ours: comment,
		assigned,
		takeover: standing.takeover === null ? null : { ...standing.takeover, comment: takeoverComment.id },
	});
}

/**
 * What the tracker's current assignee means for this run's claim.
 *
 * The order is §3.3's own, and it runs from the answer that forbids every write
 * to the one that permits them all. `outcome` non-null is a verdict with no
 * mutation behind it; `outcome: null` means the claim may proceed, and `takeover`
 * says whether §3.3's comment is owed first.
 */
async function assessClaim(store, { reader, issue, assignee, run, ticket, now, staleAfterMs }) {
	const held = issue.assignees.filter((login) => login !== assignee);

	// §3.3, and it comes first because it is absolute: **any assignee the factory
	// did not set is a human claim.** Never contested, ticket unclaimable — and
	// specifically not "unless it looks stale", which is why no clock is consulted
	// on this path at all.
	if (held.length > 0) {
		return verdict(CLAIM_OUTCOMES.humanClaimed, {
			ticket,
			assignees: issue.assignees,
			reason: `#${ticket} is assigned to ${held.join(", ")}, which the factory did not set; a human claim is never contested (§3.3).`,
		});
	}

	if (issue.assignees.length === 0) return proceed(null);

	// The assignee is the factory's own identity. Whose claim it is, is a question
	// about **durable state** and never about the comment that announced it.
	const claimants = factoryClaims(store, ticket);
	const ours = claimants.find((claim) => claim.run === run);
	if (ours !== undefined) {
		return verdict(CLAIM_OUTCOMES.alreadyClaimed, {
			ticket,
			reason: `#${ticket} is already claimed by this run; the effect record ${ours.key} is the proof (§4.5).`,
			effect: ours.key,
		});
	}

	// §3.3, first tier — *same-factory*: this store holds the effect record, so the
	// claiming run is nameable and its state is readable. **No waiting period**,
	// because there is nothing a clock could add to a fact already proven.
	const sameFactory = claimants.at(-1) ?? null;
	if (sameFactory !== null) {
		const claimingRun = store.readRun(sameFactory.run);
		if (claimingRun !== null && claimingRun.lifecycle !== "ended") {
			// §3.3: **a live claim is never contested.**
			return verdict(CLAIM_OUTCOMES.liveClaim, {
				ticket,
				reason: `#${ticket} is claimed by run ${sameFactory.run}, which is ${claimingRun.lifecycle}; a live claim is never contested (§3.3).`,
				claimed_by: sameFactory.run,
			});
		}
		return proceed({
			tier: "same-factory",
			claimed_by: sameFactory.run,
			proof: sameFactory.key,
			reason:
				claimingRun === null
					? `run ${sameFactory.run} left no record of ever having started`
					: `run ${sameFactory.run} ended ${claimingRun.end_reason ?? "with no reason recorded"}`,
		});
	}

	// §3.3, second tier — *foreign or unprovable*: the assignee is the factory's
	// identity but nothing in this store claimed it. Another install, or our own
	// state lost. Only here does a clock decide, and only after 24h with no trace.
	const trace = await lastTrace(reader, issue);
	const idle = now - trace.at;
	if (idle < staleAfterMs) {
		return verdict(CLAIM_OUTCOMES.notStale, {
			ticket,
			reason: `#${ticket} carries a claim this factory cannot prove is its own, and ${trace.what} is ${Math.round(idle / 60000)} minute(s) old; §3.3 waits ${Math.round(staleAfterMs / 3600000)}h without ticket trace.`,
			idle_ms: idle,
		});
	}

	return proceed({
		tier: "foreign",
		claimed_by: null,
		proof: null,
		reason: `no trace on #${ticket} for ${Math.round(idle / 3600000)}h, and no record in this factory's state names the claim`,
	});
}

/**
 * §3.3's re-read, and the arbitration it exists for.
 *
 * Two independent questions, in the order that makes the second worth asking:
 * did our assignment survive at all, and — if two claims landed together — is
 * ours the lower comment id.
 *
 * **Comment ids arbitrate between factories, never inside one.** Every claim
 * comment this store's own effect records account for is excluded: within one
 * factory the question was already settled from durable state above — a live
 * claim is never contested, a proven-dead one is taken over — and letting the
 * displaced claim's comment back in here would have the taking-over run lose to
 * the run it just buried. It is also what stops this run's own takeover comment,
 * which carries the claim marker because it *is* a claim announcement, from
 * beating the claim comment it precedes.
 *
 * **The contest window opens at the pre-claim read.** A foreign claim comment
 * older than the moment we saw this ticket unassigned belongs to a claim that has
 * already concluded; treating it as a contender would make every
 * previously-claimed ticket permanently unclaimable, since its old comment id is
 * lower than every future one. Both timestamps are the tracker's own, so the
 * comparison never crosses two clocks.
 */
async function arbitrate(store, { reader, run, ticket, attempt, assignee, since, ours, assigned, takeover }) {
	const issue = await reader.readIssue(ticket);

	// Gitea's assignee endpoint replaces the whole set, so a simultaneous claim
	// does not merge — one PATCH is simply last. If ours is not the one standing,
	// there is nothing to un-assign and nothing to arbitrate.
	if (!issue.assignees.includes(assignee)) {
		return verdict(CLAIM_OUTCOMES.lostCollision, {
			ticket,
			reason: `#${ticket} is assigned to ${issue.assignees.join(", ") || "nobody"} on the re-read; this run's assignment did not survive (§3.3).`,
			comment: ours.id,
			assigned,
		});
	}

	const ourKeys = postedCommentKeys(store, ticket);
	const contenders = (await reader.comments(ticket)).filter(
		(comment) =>
			isClaimComment(comment.body) &&
			comment.created_at >= since &&
			!ourKeys.some((key) => commentIsEffect(comment, key)),
	);
	const lower = contenders.filter((comment) => comment.id < ours.id);

	if (lower.length > 0) {
		// §3.3: **the loser un-assigns itself and moves on** — and here that sentence
		// and "**a live claim is never contested**" collide, because the premise
		// under them does not hold.
		//
		// Id arbitration is only *reachable* between two installs sharing one
		// tracker identity: a claim under any other login was answered as an
		// absolute human claim before a single write, and a true race under two
		// logins comes back from the re-read above as somebody else's assignee. So
		// the assignee standing on this ticket is spelled with the same string as
		// ours, and "un-assign myself" would be a `PATCH` clearing **the winner's**
		// claim — leaving it holding a claim comment on an unassigned ticket, which
		// is §8.9's lock nobody holds with the two halves swapped.
		//
		// So the loser leaves the field exactly as it is and moves on. Nothing of
		// this run's survives on the tracker: the assignment it wrote and the one
		// the winner wrote are the same value, and its claim comment is a comment
		// the winner's lower id has already beaten.
		return verdict(CLAIM_OUTCOMES.lostCollision, {
			ticket,
			reason: `#${ticket} was claimed by comment ${lower[0].id} before this run's ${ours.id}; the lowest claim-comment id wins (§3.3).`,
			comment: ours.id,
			lost_to: lower.map((comment) => comment.id),
			assigned,
			assignee_left_standing: assignee,
			assignee_note:
				"un-assigning would have cleared the winner's claim: a contest is only reachable between installs " +
				"sharing one tracker identity, so the loser's assignee and the winner's are one field (§3.3).",
		});
	}

	return verdict(takeover === null ? CLAIM_OUTCOMES.claimed : CLAIM_OUTCOMES.takenOver, {
		ticket,
		run,
		attempt,
		assignee,
		reason:
			takeover === null
				? `#${ticket} is claimed by run ${run}, attempt ${attempt}; the re-read confirms the assignee and comment ${ours.id} is the lowest contending claim (§3.3).`
				: `#${ticket} was taken over from a ${takeover.tier} claim — ${takeover.reason} — with the takeover comment posted first (§3.3).`,
		comment: ours.id,
		contested: contenders.map((comment) => comment.id),
		takeover,
		assigned,
	});
}

/**
 * The claims this factory's own state says are **still standing** on a ticket,
 * oldest first — §5.2's "our own effect record corroborates", as the query it is.
 *
 * Two rules, and both matter for the tiering above.
 *
 * Only **resolved** rows count. A `requested` row is intent, and §14.1 forbids
 * reading intent as an external fact: the assignment may never have reached
 * Gitea, and treating it as a claim would let a crashed run's unsent intent block
 * a ticket forever.
 *
 * And a run's claim ends at its own release. Without that, a ticket this factory
 * claimed and released long ago, and a **foreign** install then claimed, would
 * still match on the old assign row — and §3.3's first tier would take it over
 * with no waiting period, on the strength of a record that describes a claim this
 * factory already gave up. Two factories would then work one ticket, which is the
 * exact outcome the two tiers exist to prevent. So the last thing this store
 * recorded about each run's hold is what decides whether that run still has one.
 */
function factoryClaims(store, ticket) {
	const rows = store.read((db) =>
		db
			.prepare(
				`SELECT effect_key AS key, run_id AS run, operation, resolved_seq
				 FROM effect
				 WHERE ticket = ? AND operation IN ('issue-assign', 'issue-unassign') AND state = 'resolved'
				 ORDER BY resolved_seq`,
			)
			.all(ticket),
	);

	// §14.37: by sequence, never by clock — so the last row wins per run.
	const latest = new Map();
	for (const row of rows) latest.set(row.run, row);

	return [...latest.values()]
		.filter((row) => row.operation === "issue-assign")
		.sort((left, right) => left.resolved_seq - right.resolved_seq);
}

/**
 * Every comment key this factory's own state records for a ticket — across runs,
 * because a run that ended still posted the comments it posted.
 *
 * Both states count here, unlike `factoryClaims`: an intent that was in fact
 * carried out and then crashed before its resolution committed is precisely the
 * case §5.3 leaves standing, and treating that comment as somebody else's
 * contender would have this factory lose a contest to itself.
 */
function postedCommentKeys(store, ticket) {
	return store
		.read((db) =>
			db.prepare("SELECT effect_key FROM effect WHERE ticket = ? AND operation = 'comment-post'").all(ticket),
		)
		.map((row) => row.effect_key);
}

/**
 * §3.3's "without ticket trace": the most recent thing that happened on the
 * ticket, by the tracker's clock.
 *
 * The issue's own `updated_at` covers labels, state, assignment and body edits;
 * comments are read too, because a human discussing a ticket for an hour without
 * changing a field is precisely the activity a 24h staleness rule must not
 * ignore. A read that fails leaves the issue's timestamp standing — a takeover is
 * the destructive direction, so an unreadable comment list must not make a ticket
 * look *more* abandoned than it is.
 */
async function lastTrace(reader, issue) {
	let newest = { at: issue.updated_at, what: `the last change to #${issue.number}` };

	try {
		for (const comment of await reader.comments(issue.number)) {
			if (comment.updated_at > newest.at) {
				newest = { at: comment.updated_at, what: `the last comment on #${issue.number}` };
			}
		}
	} catch {
		return newest;
	}

	return newest;
}

/**
 * §3.3's structured claim comment: **run id, ticket, attempt id, and timestamp**,
 * in a block a machine can read and a human can skim.
 */
function claimBody({ run, ticket, attempt, at }) {
	return [
		CLAIM_MARKER,
		"🤖 **factory — claimed**",
		"",
		"```yaml",
		`run: ${run}`,
		`ticket: ${ticket}`,
		`attempt: ${attempt}`,
		`at: ${new Date(at).toISOString()}`,
		"```",
	].join("\n");
}

/**
 * §3.3's takeover comment. It carries the claim block, plus what it displaced.
 *
 * `takeover` is `assessClaim`'s **inner** verdict — the tier, the displaced run,
 * and why it is displaceable — not the wrapper that carries it. Reading the
 * wrapper's absent fields rendered `undefined` into a comment a human is meant to
 * read, silently, because nothing that reads a comment body could catch it: §5.2
 * makes comment text authoritative for nothing, so no probe ever compares it.
 */
function takeoverBody({ run, ticket, attempt, at, takeover }) {
	return [
		CLAIM_MARKER,
		"🤖 **factory — claim taken over**",
		"",
		`The previous claim is ${takeover.tier === "same-factory" ? "this factory's" : "not provably this factory's"}: ${takeover.reason}.`,
		"",
		"```yaml",
		`run: ${run}`,
		`ticket: ${ticket}`,
		`attempt: ${attempt}`,
		`at: ${new Date(at).toISOString()}`,
		`taken_over_from: ${takeover.claimed_by ?? "unknown"}`,
		`tier: ${takeover.tier}`,
		"```",
	].join("\n");
}

/**
 * Whether a body carries the claim marker — a **string search for a marker this
 * factory writes**, and not a reading of what the comment says (§5.2). It
 * identifies a contender so that its id can decide; it decides nothing itself.
 *
 * @param {string} body
 * @returns {boolean}
 */
export function isClaimComment(body) {
	return typeof body === "string" && body.includes(CLAIM_MARKER);
}

/**
 * Whether a comment is the one a given effect posted (§4.5). Exported because
 * `comment-post`'s probe is the other caller, and one spelling of "is this ours"
 * is the point of the embedded key.
 *
 * @param {{ body?: string }} comment
 * @param {string} key
 * @returns {boolean}
 */
export function commentIsEffect(comment, key) {
	return commentCarriesEffectKey(comment?.body ?? "", key);
}

function verdict(outcome, detail) {
	return Object.freeze({ outcome, takeover: null, ...detail });
}

function proceed(takeover) {
	return Object.freeze({ outcome: null, takeover });
}
