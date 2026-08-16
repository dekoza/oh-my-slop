import { CLAIM_ANNOUNCING_OPERANDS, commentIsEffect } from "../tracker/claims.mjs";
import { createProbeRegistry } from "./probes.mjs";

/**
 * The tracker's probes (§5.3, §5.4) — **shipped with the subsystem that
 * introduces the effect kinds they settle**, which is what `probes.mjs` says the
 * split is for.
 *
 * They are keyed by the §4.5 *read* rather than by the operation, so
 * `issue-assign` and `issue-unassign` share one implementation: it is one call to
 * Gitea, and the declared `match` is the data that decides which answer settles
 * which effect. Adding `label-add` later needs no new probe either — it needs the
 * `issue.labels` read this file does not yet have a caller for.
 *
 * **The interesting one is `issue.comments`.** §5.2 excludes comment text from
 * every authority row precisely because a deleted comment vanishes from
 * `/comments` **and** `/timeline` without trace — so a missing claim comment means
 * *possibly deleted*, never *no claim was made*. This is where that reading lives:
 * our own effect record establishes that the mutation was intended, and the
 * durable assignee is what corroborates that it happened. Answering `matched:
 * false` there would leave the controller free to re-post a claim comment onto a
 * ticket it already holds, once per reconcile, forever.
 */

/**
 * @param {object} where
 * @param {object} where.reader a `createGiteaReader` client
 * @param {string} where.assignee the factory's own tracker identity (§3.3)
 * @returns {Record<string, Function>} implementations, keyed by §4.5 read
 */
export function trackerProbes({ reader, assignee }) {
	return {
		/**
		 * §5.2: Gitea is authoritative for the assignee. `present` settles a claim,
		 * `absent` settles a release — one read, two matches.
		 */
		"issue.assignees": async ({ effect, probe }) => {
			const issue = await reader.readIssue(effect.ticket);
			// The operand of an assign effect **is** the login it named, so a probe of
			// somebody else's older record still asks about the right person.
			const present = issue.assignees.includes(effect.operand ?? assignee);

			return {
				matched: probe.match === "absent" ? !present : present,
				result: { assignees: issue.assignees, updated_at_raw: issue.updated_at_raw },
				foreignSourceId: issue.foreign_id,
				occurredAtRaw: issue.updated_at_raw,
				detail: { ticket: effect.ticket, assignees: issue.assignees, looked_for: effect.operand ?? assignee },
			};
		},

		/**
		 * §4.5's `embedded-key` match: **exact on the key carried in an HTML
		 * comment, never a prefix** — and then §5.2's corroboration when the comment
		 * is not there.
		 */
		"issue.comments": async ({ effect }) => {
			const found = (await reader.comments(effect.ticket)).find((comment) =>
				commentIsEffect(comment, effect.effect_key),
			);

			if (found !== undefined) {
				return {
					matched: true,
					result: { comment_id: found.id, created_at_raw: found.created_at_raw, html_url: found.html_url },
					foreignSourceId: found.foreign_id,
					occurredAtRaw: found.created_at_raw,
					detail: { ticket: effect.ticket, comment_id: found.id },
				};
			}

			// §5.2, in full: bodies are silently editable and a deleted comment leaves
			// no trace in `/comments` or `/timeline`. So the absence is not evidence —
			// the corroborators are, and they are named rather than assumed.
			//
			// **The corroborator is the assignee state the comment announced**, which
			// is why it is not simply "an assignee is present": a claim comment says
			// this factory took the ticket, so a standing assignee agrees with it; a
			// disposition comment says it gave the ticket up, so an *absent* assignee
			// agrees with that one exactly as strongly. Granting the reading to claims
			// alone would leave every deleted release comment unresolved forever,
			// pinning its run's artifacts under §12.4 with no verb able to discharge
			// it — §5.2's sentence is about comments, not about claims.
			const issue = await reader.readIssue(effect.ticket);
			const announcesClaim = CLAIM_ANNOUNCING_OPERANDS.includes(effect.operand);
			const holdsClaim = issue.assignees.includes(assignee);
			const corroborated = announcesClaim ? holdsClaim : !holdsClaim;

			return {
				matched: corroborated,
				result: corroborated ? { comment_id: null, absence: "possibly-deleted" } : null,
				foreignSourceId: issue.foreign_id,
				occurredAtRaw: issue.updated_at_raw,
				detail: {
					ticket: effect.ticket,
					// The word matters and is §5.2's own: `never-posted` is the reading
					// this probe exists to refuse.
					absence: corroborated ? "possibly-deleted" : "uncorroborated",
					corroborated_by: corroborated
						? announcesClaim
							? `the durable assignee ${assignee}, which the claim this comment announced would have set`
							: `no durable assignee, which the release this comment announced would have left`
						: null,
					assignees: issue.assignees,
					spec: "§5.2",
				},
			};
		},
	};
}

/**
 * `base`'s probes plus the tracker's, in a registry of their own.
 *
 * A new registry rather than registrations added to the shipped one: `PROBES` is
 * a module singleton and the tracker's implementations close over a reader, so
 * registering into it would make the second invocation in a process refuse — and
 * would let one run's tracker client answer another's probes. One read still has
 * exactly one implementation, so a base that already carries `issue.assignees`
 * refuses here rather than being silently overridden.
 *
 * @param {object} base an existing registry (`createProbeRegistry`)
 * @param {{ reader: object, assignee: string }} tracker
 * @returns {object} a registry carrying both
 */
export function withTrackerProbes(base, { reader, assignee }) {
	const registry = createProbeRegistry();
	for (const call of base.calls) registry.register(call, base.implementationFor(call));
	for (const [call, implementation] of Object.entries(trackerProbes({ reader, assignee }))) {
		registry.register(call, implementation);
	}
	return registry;
}
