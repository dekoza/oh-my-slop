import { createHash } from "node:crypto";

import { canonicalJson } from "../state/events.mjs";

/**
 * §14.17 and §6.4: **workers get no tracker credential**, so the controller
 * snapshots the ticket into the attempt context at claim time.
 *
 * The Gitea instance rejects every unauthenticated API call, so the alternative
 * to a snapshot is handing a worker the scheduler's own credentials — the exact
 * thing §6.8's deny floor exists to prevent. A dedicated read-only factory
 * token is §6.4's named v2 upgrade path; until then the snapshot is both the
 * mechanism and the audit trail, because it is *deterministic evidence of
 * exactly what the worker saw* rather than a claim about what the tracker said
 * at some point.
 *
 * **Comment text is authoritative for nothing** (§5.2), and the snapshot does
 * not change that: bodies ride along because a human's discussion of a ticket
 * is the context a worker needs, and the prompt says so in as many words. What
 * the factory decides from is the issue's state, labels, and assignee — read
 * through `authority.mjs` — never this text.
 */

/** The snapshot's own shape version; it is recorded in the attempt manifest. */
export const TICKET_SNAPSHOT_VERSION = 1;

/**
 * Read one ticket and its comments as one snapshot.
 *
 * **Every timestamp in it is the tracker's**, kept in the raw spelling the
 * tracker used, exactly as §5.1 requires of the observation cursor and for the
 * same reason: a snapshot dated by our clock puts two clocks in one comparison,
 * and this record's whole value is that it says what the tracker said and when
 * the tracker said it.
 *
 * @param {object} reader a Gitea reader (`gitea.mjs`)
 * @param {number} ticket the issue number
 * @returns {Promise<Readonly<object>>} the snapshot, ready for a prompt and a manifest
 */
export async function snapshotTicket(reader, ticket) {
	const issue = await reader.readIssue(ticket);
	// Ascending by id: Gitea's comment ids share one monotonic sequence (§5.1),
	// so this is the order a human read them in, and it is stable across reads
	// in a way a timestamp sort is not when two comments land in one second.
	const comments = [...(await reader.comments(ticket))].sort((left, right) => left.id - right.id);
	const snapshotAt = reader.serverTime();

	return Object.freeze({
		snapshot_version: TICKET_SNAPSHOT_VERSION,
		number: issue.number,
		title: issue.title,
		body: issue.body,
		state: issue.state,
		labels: Object.freeze([...issue.labels]),
		assignees: Object.freeze([...issue.assignees]),
		// `updated_at_raw` is the tracker's own string, kept verbatim (§4.3).
		// `snapshot_at` is the tracker's clock too — its `Date` response header,
		// never ours — re-spelled as ISO for the prompt to render; the gap between
		// the two is often the interesting number.
		updated_at_raw: issue.updated_at_raw,
		content_version: issue.content_version,
		snapshot_at: snapshotAt,
		snapshot_at_raw: snapshotAt === null ? null : new Date(snapshotAt).toISOString(),
		comments: Object.freeze(
			comments.map((comment) =>
				Object.freeze({
					id: comment.id,
					author: comment.author,
					body: comment.body,
					created_at_raw: comment.created_at_raw,
					updated_at_raw: comment.updated_at_raw,
				}),
			),
		),
	});
}

/**
 * The snapshot's digest, as the attempt manifest and `attempt.launched` cite it.
 *
 * Canonical JSON, so the digest is evidence rather than a property of key
 * order: two controllers reading the same ticket state produce the same digest,
 * and a ticket edited between two attempts produces a different one — which is
 * how "the worker saw a different ticket" becomes visible at all.
 *
 * @param {Readonly<object>} snapshot
 * @returns {string} hex sha256
 */
export function snapshotDigest(snapshot) {
	return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}
