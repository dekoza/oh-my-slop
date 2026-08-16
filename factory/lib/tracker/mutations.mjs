import { PHASE_IMPLEMENT } from "../domain/vocabulary.mjs";
import { embedEffectKey } from "../effects/keys.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";

/**
 * One tracker mutation as §4.5's pair — **the one place a tracker write becomes
 * a requested/resolved record**, shared by the two subsystems that write to a
 * ticket: §3.3's claim (`claims.mjs`) and §8.9's dispositions
 * (`disposition.mjs`).
 *
 * It is a module of its own rather than a section of either, because both of
 * them post comments and both of them mutate the ticket, and the second copy of
 * "record the intent, perform, record the outcome" is exactly where a write
 * eventually happens with no pair around it. `writer.mjs` performs and records
 * nothing; this is what records.
 */

/**
 * The comment bodies the factory posts, distinguished in the effect key.
 *
 * They are operands rather than three effect kinds: the mutation is one
 * `comment-post`, and §4.5's operand is what discriminates within an operation.
 */
export const COMMENT_OPERANDS = Object.freeze({
	claim: "claim",
	takeover: "takeover",
	disposition: "disposition",
	/**
	 * §7.5's stale-PR sweep: the comment left on a dead earlier attempt's pull
	 * request, linking the one that replaced it.
	 *
	 * It is the one comment the factory posts somewhere other than the ticket, so
	 * it carries its target in the operand — `superseded/<pr number>` — and
	 * `commentTarget` is what reads it back. The effect still belongs to the
	 * ticket execution, because that is what asked for it.
	 */
	superseded: "superseded",
});

/**
 * Which issue a `comment-post` effect's comment was posted on.
 *
 * The ticket, for every comment but one. §7.5's superseding comment goes on the
 * pull request being closed, and the probe that settles it has to read that
 * issue's comments rather than the ticket's — a probe looking in the wrong place
 * would report a posted comment as absent and fall through to §5.2's
 * corroboration, which answers a question nobody asked here.
 *
 * @param {{ ticket: number | null, operand: string | null }} effect
 * @returns {number | null}
 */
export function commentTarget({ ticket, operand }) {
	const matched = typeof operand === "string" ? /^superseded\/([1-9][0-9]*)$/.exec(operand) : null;
	return matched === null ? ticket : Number.parseInt(matched[1], 10);
}

/** The operand a superseding comment carries, so one spelling serves both sides. */
export function supersededOperand(pullNumber) {
	return `${COMMENT_OPERANDS.superseded}/${pullNumber}`;
}

/**
 * The two that **announce a claim**, and therefore the two whose absence the
 * durable assignee corroborates (§5.2). Exported because the `comment-post`
 * probe is what asks: a disposition comment announces the *end* of a ticket
 * execution, so an assignee still standing corroborates nothing about it.
 */
export const CLAIM_ANNOUNCING_OPERANDS = Object.freeze([COMMENT_OPERANDS.claim, COMMENT_OPERANDS.takeover]);

/**
 * Record the intent, perform the mutation, record what the world did.
 *
 * The `already-resolved` short-circuit is what makes a re-entered run idempotent
 * without a second bookkeeping scheme — the key is the same, so the committed
 * result comes back and Gitea is never asked twice.
 *
 * @param {object} store an open store
 * @param {object} mutation
 * @param {object} mutation.hold the controller's hold — §4.5's fencing generation
 * @param {string} mutation.run
 * @param {number} mutation.ticket
 * @param {number} mutation.at
 * @param {string} mutation.operation a registered effect kind (§4.5)
 * @param {string | null} mutation.operand the natural discriminator
 * @param {object} mutation.payload what the mutation carries — digested, never keyed
 * @param {(key: string) => Promise<object>} mutation.perform the `writer.mjs` call,
 *   handed the effect key — a posted comment carries it in its body (§4.5)
 * @param {(answer: object) => object} mutation.result what to record of the answer
 * @returns {Promise<Readonly<object>>}
 */
export async function performEffect(store, { hold, run, ticket, at, operation, operand, payload, perform, result }) {
	const fence = hold.fence();
	const requested = requestEffect(store, {
		operation,
		operand,
		run,
		ticket,
		// §2.2's enum is closed and has no claim phase, deliberately: the claim is
		// what opens a ticket execution's first phase rather than a phase of its
		// own, and widening the enum for it would put a non-phase in the list §13.C
		// widened exactly once, for mutations with nowhere else to go.
		phase: PHASE_IMPLEMENT,
		// **A tracker mutation belongs to the ticket execution, not to an attempt.**
		// §9.4 mints an attempt id before the claim and §8.9 disposes after the last
		// one ended, so an attempt slot here would name the wrong attempt in both
		// directions. §4.5's key has a nullable attempt slot for exactly this, and
		// the comment body carries the attempt id the block needs.
		attempt: null,
		actor: "controller",
		fencingGeneration: fence.generation,
		payload,
		at,
	});

	if (requested.outcome === "already-resolved") {
		return Object.freeze({ key: requested.key, outcome: requested.outcome, ...requested.result });
	}

	const answer = await perform(requested.key);
	const resolved = resolveEffect(store, {
		key: requested.key,
		actor: "controller",
		fencingGeneration: fence.generation,
		result: result(answer),
		at,
	});

	return Object.freeze({ key: requested.key, outcome: resolved.outcome, ...resolved.result });
}

/**
 * A comment, with §4.5's effect key embedded in the body it posts.
 *
 * The key rides invisibly so the probe can find *this* comment exactly, rather
 * than a comment that merely looks like it — §4.5 is explicit that the match is
 * on the embedded key and never a prefix, because a body an operator edited must
 * still be recognisable and a neighbour's must not be mistaken for ours.
 *
 * **The digested payload is the comment's own intent, and the body is rendered
 * from it.** The two are the same thing for a claim, whose body is four scalars;
 * they are not for §8.9's block, where the caller hands over the facts and the
 * prose around them is this factory's rendering of them. Digesting the intent is
 * what makes a re-entry idempotent rather than a §4.5 conflict.
 *
 * @param {object} store an open store
 * @param {object} comment
 * @param {object} comment.writer a `createGiteaWriter` client
 * @param {string} comment.operand which of `COMMENT_OPERANDS` this is
 * @param {string} comment.body the rendered comment
 * @param {object} [comment.payload] the intent to digest; defaults to the body
 * @returns {Promise<Readonly<object>>}
 */
export async function postComment(store, { writer, hold, run, ticket, at, operand, body, payload = null }) {
	const posted = await performEffect(store, {
		hold,
		run,
		ticket,
		at,
		operation: "comment-post",
		operand,
		payload: payload ?? { body },
		perform: (key) => writer.comment(ticket, embedEffectKey(body, key)),
		result: (answer) => ({ comment_id: answer.id, created_at_raw: answer.created_at_raw, html_url: answer.html_url }),
	});

	// The committed result is what a re-entered run reads its own comment id back
	// out of — same field name as the fresh path, so no caller has to know which
	// door it came through.
	return Object.freeze({ ...posted, id: posted.comment_id ?? null });
}
