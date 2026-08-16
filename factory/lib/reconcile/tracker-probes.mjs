import { commentIsEffect } from "../tracker/claims.mjs";
import { DISPOSITION_LABELS } from "../tracker/disposition.mjs";
import { CLAIM_ANNOUNCING_OPERANDS, commentTarget } from "../tracker/mutations.mjs";
import { FactoryReconcileError } from "./errors.mjs";
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
		 * §8.9's label half of a disposition. `present` settles the add; the
		 * `absent` match is declared for a removal this factory never performs
		 * (§14.20), and one read answers both.
		 *
		 * **Served from the issue rather than from `/labels`**, exactly as
		 * `issue.assignees` is: the read is declared by what it asks about, and one
		 * fetch of the issue answers labels and assignees alike. A second endpoint
		 * would be a second round trip for a field the first one already carried.
		 */
		"issue.labels": async ({ effect, probe }) => {
			const issue = await reader.readIssue(effect.ticket);
			// The operand of a label effect **is** the label it named, so a probe of
			// an older record still asks about the right label.
			const present = issue.labels.includes(effect.operand);

			return {
				matched: probe.match === "absent" ? !present : present,
				result: { labels: [...issue.labels] },
				foreignSourceId: issue.foreign_id,
				occurredAtRaw: issue.updated_at_raw,
				detail: { ticket: effect.ticket, labels: [...issue.labels], looked_for: effect.operand },
			};
		},

		/**
		 * §7.5's stale-PR sweep, settled by asking whether that pull request is
		 * closed. The operand is its number, because a `pr-create` effect's ticket
		 * slot names the ticket execution and a pull request is not it.
		 */
		"issue.state": async ({ effect, probe }) => {
			const issue = await reader.readIssue(Number.parseInt(effect.operand, 10));
			return {
				matched: probe.match === "state-equals" ? issue.state === "closed" : issue.state !== "closed",
				result: { number: issue.number, state: issue.state, updated_at_raw: issue.updated_at_raw },
				foreignSourceId: issue.foreign_id,
				occurredAtRaw: issue.updated_at_raw,
				detail: { number: issue.number, state: issue.state },
			};
		},

		/**
		 * §7.5's publication, settled by the branch it was opened from — which §7.3
		 * derives from the identity tuple, so the probe re-finds the pull request
		 * from the effect key alone (§5.3).
		 *
		 * **Open only**, exactly as the read is: a crash between opening a PR and
		 * recording it, followed by a human closing that PR unmerged, is §7.6's redo
		 * path — and reading the closed PR as the mutation having landed is how the
		 * factory would resurrect one.
		 */
		"pulls.by-head-branch": async ({ effect, probe }) => {
			const pull = await reader.pullByHeadBranch(effect.operand);
			const present = pull !== null;

			// §4.5 declares this read under two matches. `digest-rehash` settles
			// `pr-body-update`, which nothing issues yet — answering `false` for it
			// would report a mutation as not having landed rather than as not having
			// been asked about, so it refuses instead (§12.4's alarm, not a guess).
			if (probe.match === "digest-rehash") {
				throw new FactoryReconcileError(
					"probe-unimplemented",
					`§4.5 settles pr-body-update by re-hashing the PR body, and no verb writes one (§7.5, §14.12). This ` +
						"probe answers presence; an effect asking for the rehash is reported rather than guessed at.",
					{ at: "match", found: probe.match, effect: effect.effect_key },
				);
			}

			return {
				matched: probe.match === "absent" ? !present : present,
				result: present
					? { number: pull.number, html_url: pull.html_url, head_branch: pull.head_branch, head_sha: pull.head_sha }
					: null,
				foreignSourceId: present ? pull.foreign_id : `gitea:pulls:${effect.operand}`,
				// The tracker's own clock, which every answer carries: git's probes use
				// a directory mtime for an absence, and the tracker's equivalent is the
				// instant it says it is.
				occurredAtRaw: present ? pull.updated_at_raw : new Date(reader.serverTime() ?? Date.now()).toISOString(),
				detail: { head_branch: effect.operand, number: present ? pull.number : null },
			};
		},

		/**
		 * §4.5's `embedded-key` match: **exact on the key carried in an HTML
		 * comment, never a prefix** — and then §5.2's corroboration when the comment
		 * is not there.
		 */
		"issue.comments": async ({ effect }) => {
			// §7.5's superseding comment is posted on the pull request it closes, not
			// on the ticket, and the operand is what says so.
			const target = commentTarget(effect);
			const found = (await reader.comments(target)).find((comment) => commentIsEffect(comment, effect.effect_key));

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
			// **The corroborator is the durable state the comment announced**, which
			// is why it is not simply "an assignee is present": a claim comment says
			// this factory took the ticket, so a standing assignee agrees with it; a
			// disposition comment says the ticket execution ended, so what agrees with
			// *that* is the state its disposition left behind. Granting the reading to
			// claims alone would leave every deleted disposition comment unresolved
			// forever, pinning its run's artifacts under §12.4 with no verb able to
			// discharge it — §5.2's sentence is about comments, not about claims.
			//
			// §8.9 leaves exactly two shapes, and the probe accepts either because the
			// effect row names the operand and not the disposition: `released` drops
			// the claim, and the other three add one of `DISPOSITION_LABELS` while
			// **retaining** the assignee. Requiring an absent assignee for all four
			// would call every deleted pause and failure comment uncorroborated —
			// which is the same error as reading a missing comment as never posted.
			const issue = await reader.readIssue(effect.ticket);
			const announcesClaim = CLAIM_ANNOUNCING_OPERANDS.includes(effect.operand);
			const holdsClaim = issue.assignees.includes(assignee);
			const disposed = issue.labels.some((label) => DISPOSITION_LABELS.includes(label));
			const corroborated = announcesClaim ? holdsClaim : !holdsClaim || disposed;

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
							: disposed
								? `the ${issue.labels.filter((label) => DISPOSITION_LABELS.includes(label)).join(", ")} label, which the disposition this comment announced would have added`
								: "no durable assignee, which the release this comment announced would have left"
						: null,
					assignees: issue.assignees,
					labels: issue.labels,
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
