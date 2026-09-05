import { canonicalJson } from "../state/events.mjs";
import { requireAuthority } from "./authority.mjs";
import { FactoryTrackerError } from "./errors.mjs";
import { FOREIGN_ID_KINDS, foreignId, sinceParameter } from "./gitea.mjs";

/**
 * §5.1's Gitea ingestion: **a durable cursor, two cheap `since` endpoints, and
 * every foreign fact entering as `observation.recorded`.**
 *
 * > Poll the two cheap `since` endpoints at **15s** during a run with a **60s
 * > overlap**, deduping on foreign event id — safe because timeline and comment
 * > ids share one monotonic sequence, and because `?since=` is
 * > `updated_at`-based, so overlap costs duplicates and never gaps.
 *
 * The overlap is the design: a cursor that resumed exactly where it stopped
 * would lose whatever moved in the same second it recorded, and `updated_at`
 * has no sub-second guarantee worth betting a frontier on. Paying for
 * duplicates and deleting them structurally is strictly better than paying for
 * gaps and never noticing.
 *
 * **Idempotency is by construction, not by care.** Every fact carries the
 * tracker's own id for that fact — `gitea:<kind>:<id>@<updated_at>` — and a poll
 * records only the ids the journal does not already hold. So the 60-second
 * overlap costs a lookup per record and nothing else, and a controller that
 * crashed mid-poll and re-ran it writes the same journal either way.
 *
 * **The cheap endpoints are repository-wide, and the facts are kept that way.**
 * Gitea has no "issues in this set, since T" endpoint, so `?since=` answers for
 * the whole repository — and filtering the answer down to the scope would throw
 * away exactly what §3.1 needs: an out-of-scope blocker's state is what decides
 * whether its dependent is `blocked-external` or claimable. The *cursor* is
 * scoped because two runs watching different selectors advance at different
 * rates; the *facts* are not, because the graph does not stop at a scope's edge.
 *
 * **Webhooks are not used** (§5.1): the repository has none configured and the
 * controller has no inbound HTTP surface. Nothing here listens; it polls.
 *
 * `observation.degraded` is deliberately not emitted from this module. §5.1
 * scopes that event to the Herdr socket falling back to polling — Gitea *is*
 * polled, so there is no degraded mode to announce, and a tracker that cannot be
 * read is a refusal rather than a quieter kind of success.
 *
 * **The `observation_cursor` row is canonical, not a projection** (§5.1), and
 * there is no rebuild path to fall back on: the records that would anchor a
 * rebuilt watermark live on run streams that expire, so a rebuild would silently
 * re-poll a repository's whole history.
 */

/** §5.1's cadence. Not 5s: the factory's tempo is minutes. */
export const POLL_INTERVAL_MS = 15_000;

/** §5.1's overlap. Four polls wide, so a slow poll still overlaps its predecessor. */
export const POLL_OVERLAP_MS = 60_000;

/** The only source this module ingests from. §5.2 decides what it may assert. */
export const OBSERVATION_SOURCE = "gitea";

/** The timeline entry type that — and only that — costs a dependency read (§5.1). */
export const DEPENDENCY_TIMELINE_TYPE = "add_dependency";

/**
 * The cursor's key: §3.1's selector, canonically serialised.
 *
 * Canonical because it is a primary key — `{kind, tickets}` and `{tickets,
 * kind}` are the same selector, and two rows for one scope would be two
 * watermarks, one of which is always behind.
 *
 * @param {object} scope
 * @returns {string}
 */
export function cursorKey(scope) {
	return canonicalJson(scope);
}

/**
 * The cursor for this scope, or `null` when this scope has never been observed.
 *
 * @param {object} store an open store
 * @param {object} scope §3.1's selector
 * @returns {Readonly<object> | null}
 */
export function readCursor(store, scope) {
	const key = cursorKey(scope);
	const row = store.read((db) => db.prepare("SELECT * FROM observation_cursor WHERE scope = ?").get(key));
	return row === undefined ? null : Object.freeze({ ...row, scope });
}

/**
 * The fact class that establishes a ticket's labels (§5.2). Named because the
 * reader below selects on it, and a second spelling would select nothing while
 * looking exactly right.
 */
const TICKET_LABELS_FACT = "ticket.labels";

/**
 * **What durable state last heard about one ticket** — its state, and the label
 * set of the newest record that actually stated one.
 *
 * It lives here because both halves are this module's: `observed_issue` is
 * §5.1's per-issue row, and the label set is a shape *this file writes* into an
 * `observation.recorded` payload. A reader elsewhere would be a second place
 * that knows where a label hides in a fact.
 *
 * The two are read from different places because they keep differently. The row
 * is canonical and outlives every run stream; a label set lives only in the
 * fact that carried it, and that fact expires with the run whose poll recorded
 * it. So this is "the freshest thing durable state knows", which is what §12.4's
 * label pin needs — and `labels: null` where it knows nothing, never an empty
 * set, because "no labels" and "never asked" are opposite answers.
 *
 * **The selection is by fact class, not by recency alone.** Most
 * `observation.recorded` records carry a ticket and establish nothing about its
 * labels — a herdr liveness reading, a probe answer — and taking the newest
 * record of *any* class would read a missing label set as "nothing is known",
 * which for a pin that fails closed means re-engaging a pin a human already
 * cleared.
 *
 * @param {object} store an open store, controller or read-only
 * @param {number} ticket
 * @returns {Readonly<{ state: string | null, labels: ReadonlyArray<string> | null }>}
 */
export function lastObservedTicket(store, ticket) {
	return store.read((db) => {
		const issue = db.prepare("SELECT state FROM observed_issue WHERE ticket = ?").get(ticket);

		// Newest by sequence, never by clock (§14.37) — and across every stream: a
		// poll with no run records on `controller` and one inside a run records on
		// the run's own stream, which says nothing about how fresh it is.
		const fact = db
			.prepare(
				`SELECT payload FROM event
				 WHERE kind = 'observation.recorded' AND ticket = ?
				   AND EXISTS (SELECT 1 FROM json_each(event.payload, '$.fact_classes') WHERE value = ?)
				 ORDER BY seq DESC LIMIT 1`,
			)
			.get(ticket, TICKET_LABELS_FACT);

		const labels = fact === undefined ? null : (JSON.parse(fact.payload).observed?.labels ?? null);

		return Object.freeze({
			state: issue?.state ?? null,
			labels: Array.isArray(labels) ? Object.freeze([...labels]) : null,
		});
	});
}

/**
 * Open this scope's cursor, or return the one that is already there.
 *
 * The watermark starts at **now** rather than at the epoch, and that is a real
 * decision: a fresh cursor set to zero would ingest a repository's entire
 * comment history on its first poll, as though every comment ever written had
 * just happened. The frontier's *state* comes from `readScope` reading the graph
 * whole (§3.1); the cursor's job is only to catch what moves after that.
 *
 * This is the **one** moment our own clock reaches the watermark — there is no
 * record yet to take a timestamp from — and `advance` treats it as provisional
 * for exactly that reason: the first fact replaces it outright, and a first poll
 * that sees nothing anchors to the tracker's `Date` header instead. A cursor
 * left on our clock against a tracker running behind us would ask for a window
 * that had already passed, forever.
 *
 * @param {object} store an open store
 * @param {{ scope: object, at?: number }} where
 * @returns {Readonly<object>}
 */
export function openCursor(store, { scope, at = Date.now() }) {
	const existing = readCursor(store, scope);
	if (existing !== null) return existing;

	const key = cursorKey(scope);
	store.transaction(({ db }) =>
		db
			.prepare(
				`INSERT INTO observation_cursor(scope, source, last_updated_at, last_updated_at_raw, last_foreign_id,
				                                opened_at, polled_at, polls)
				 VALUES (?, ?, ?, NULL, NULL, ?, NULL, 0)`,
			)
			.run(key, OBSERVATION_SOURCE, at, at),
	);

	return readCursor(store, scope);
}

/**
 * The `?since=` this poll asks for: the watermark, **less the overlap**.
 *
 * @param {{ last_updated_at: number }} cursor
 * @returns {number} UTC epoch milliseconds
 */
export function sinceMillis(cursor) {
	return Math.max(0, cursor.last_updated_at - POLL_OVERLAP_MS);
}

/**
 * Whether §5.1's 15-second cadence has come round again.
 *
 * The interval lives with the cursor rather than inside a loop, because the loop
 * is the scheduler's (#101) and a cadence buried in it would be a number nobody
 * outside could read — including the operator asking why the frontier is stale.
 *
 * @param {{ polled_at: number | null }} cursor
 * @param {number} at
 * @returns {boolean}
 */
export function isDue(cursor, at) {
	return cursor.polled_at === null || at - cursor.polled_at >= POLL_INTERVAL_MS;
}

/**
 * One poll: the two cheap endpoints, the flagged issues' timelines, and the
 * dependency reads an `add_dependency` earns.
 *
 * Reads happen first and the writes are one transaction, so a poll either lands
 * whole or not at all — a half-ingested poll would leave a watermark ahead of
 * the facts it claims to have recorded.
 *
 * @param {object} store an open store
 * @param {object} poll
 * @param {object} poll.reader a `createGiteaReader` client
 * @param {object} poll.scope §3.1's selector
 * @param {string | null} [poll.run] the run whose stream these facts belong to
 * @param {number} [poll.at] UTC epoch milliseconds
 * @returns {Promise<Readonly<object>>} what this poll saw, recorded, and skipped
 */
export async function observe(store, { reader, scope, run = null, at = Date.now() }) {
	const cursor = openCursor(store, { scope, at });
	if (!isDue(cursor, at)) {
		return Object.freeze({
			polled: false,
			reason: `the last poll was ${at - cursor.polled_at}ms ago; §5.1's cadence is ${POLL_INTERVAL_MS}ms.`,
			since: null,
			recorded: Object.freeze([]),
			deduped: 0,
			flagged: Object.freeze([]),
			body_edits: Object.freeze([]),
			cursor,
		});
	}

	const since = sinceParameter(sinceMillis(cursor));

	// ── The two cheap endpoints (§5.1) ───────────────────────────────────────
	const issues = await reader.issuesSince(since);
	const comments = await reader.commentsSince(since);

	const observedIssues = store.read((db) => readObservedIssues(db));
	const candidates = [
		...issues.map((issue) => issueFact(issue, observedIssues.get(issue.number) ?? null)),
		...comments.map((comment) => commentFact(comment)),
	];
	const seenBefore = store.read((db) => alreadyRecorded(db, candidates.map((fact) => fact.foreign_id)));
	const facts = candidates.filter((fact) => !seenBefore.has(fact.foreign_id));

	// §5.1: **only for issues the cheap pass flagged.** "Flagged" is what the
	// dedup left standing — a record the overlap merely showed us again has
	// nothing new to look at, and running a timeline read for it every 15
	// seconds is precisely the cost the cursor exists to avoid.
	const flagged = [...new Set(facts.map((fact) => fact.ticket).filter((ticket) => ticket !== null))].sort(
		(a, b) => a - b,
	);

	// Every foreign record this poll looked at, dedup included — the denominator
	// the `deduped` count is honest about.
	let seenRecords = issues.length + comments.length;

	const dependencyReads = [];
	for (const ticket of flagged) {
		const timeline = await reader.timelineSince(ticket, since);
		seenRecords += timeline.length;
		const held = store.read((db) => alreadyRecorded(db, timeline.map((entry) => entry.foreign_id)));
		const entries = timeline.filter((entry) => !held.has(entry.foreign_id));
		facts.push(...entries.map((entry) => timelineFact(entry)));

		// §5.1: `dependencies`/`blocks` **only on an `add_dependency`.** The edge
		// set changes rarely and costs two reads per issue; asking for it on every
		// poll would make the graph the expensive part of a cheap pass.
		const triggers = entries.filter((entry) => entry.type === DEPENDENCY_TIMELINE_TYPE);
		if (triggers.length === 0) continue;

		const blockedBy = await reader.dependencies(ticket);
		const blocks = await reader.blocks(ticket);
		dependencyReads.push(ticket);
		facts.push(dependencyFact(ticket, { blockedBy, blocks, trigger: triggers.at(-1) }));
	}

	const bodyEdits = facts.filter((fact) => fact.body_edited === true).map((fact) => fact.ticket);
	// Deterministic order, because the watermark's third component names *the*
	// last fact at its timestamp and several records routinely share a second.
	facts.sort((a, b) => a.occurred_at - b.occurred_at || (a.foreign_id < b.foreign_id ? -1 : 1));
	const advanced = advance(cursor, facts, reader.serverTime?.() ?? null);

	// ── One transaction: the facts, the per-issue state, and the watermark ───
	const committed = store.transaction((tx) => {
		const written = [];
		// Re-asked inside the transaction, then grown as we write. A fact can
		// arrive twice within one poll — an issue touched again while its own
		// timeline was being read — and it must still be one record.
		const held = alreadyRecorded(tx.db, facts.map((fact) => fact.foreign_id));

		for (const fact of facts) {
			if (held.has(fact.foreign_id)) continue;
			held.add(fact.foreign_id);

			for (const factClass of fact.fact_classes) requireAuthority(factClass, OBSERVATION_SOURCE);
			requireForeignId(fact);

			tx.appendEvent({
				kind: "observation.recorded",
				source: OBSERVATION_SOURCE,
				run,
				ticket: fact.ticket,
				foreignSourceId: fact.foreign_id,
				occurredAt: fact.occurred_at,
				observedAt: at,
				payload: {
					fact_classes: fact.fact_classes,
					source: OBSERVATION_SOURCE,
					foreign_id: fact.foreign_id,
					// §4.3: the foreign system's raw timestamp string, verbatim.
					occurred_at_raw: fact.occurred_at_raw,
					observed: fact.observed,
				},
			});
			written.push(fact.foreign_id);

			if (fact.issue !== undefined) upsertObservedIssue(tx.db, fact.issue, at);
		}

		tx.db
			.prepare(
				`UPDATE observation_cursor
				 SET last_updated_at = ?, last_updated_at_raw = ?, last_foreign_id = ?, polled_at = ?, polls = polls + 1
				 WHERE scope = ?`,
			)
			.run(advanced.last_updated_at, advanced.last_updated_at_raw, advanced.last_foreign_id, at, cursorKey(scope));

		return written;
	});

	return Object.freeze({
		polled: true,
		reason: null,
		since,
		issues_seen: issues.length,
		comments_seen: comments.length,
		records_seen: seenRecords,
		recorded: Object.freeze(committed),
		// What the overlap cost, stated rather than hidden: an operator reading a
		// poll that saw forty records and recorded none is reading a healthy poll,
		// not a broken one. The graph facts come off the count because they are not
		// records the tracker offered — they are reads this poll chose to make, one
		// per ticket in `dependency_reads`.
		deduped: seenRecords - (committed.length - dependencyReads.length),
		flagged: Object.freeze(flagged),
		dependency_reads: Object.freeze(dependencyReads),
		body_edits: Object.freeze(bodyEdits),
		cursor: readCursor(store, scope),
	});
}

/**
 * The watermark this poll leaves behind: **the newest record's `updated_at`,
 * and never our own clock.**
 *
 * §5.1 names the component `last_updated_at`, and it has to be a *record's*
 * timestamp for the overlap to mean what §5.1 says it means. `?since=` is
 * compared against `updated_at` by the **tracker's** clock, so a watermark taken
 * from ours is two clocks in one comparison: a Gitea whose clock lags ours by
 * more than the overlap would have every record written just before a poll fall
 * below the next poll's `since` and never be seen again. That is the gap §5.1
 * promises the overlap cannot produce, reintroduced by the watermark itself.
 *
 * Anchoring to the newest record costs nothing during a quiet stretch. The
 * window is `newest − 60s`, so it holds whatever happened in the minute before
 * the last thing that happened — not everything since. It stops growing the
 * moment the tracker goes quiet, because the anchor stops moving too.
 *
 * Once anchored it only moves forward. The **bootstrap** is the one moment our
 * clock appears at all — `openCursor` has no record to anchor to — and the first
 * fact replaces it outright rather than maxing against it, or a cursor opened on
 * a machine running ahead of the tracker would never leave our clock.
 *
 * `last_foreign_id` names the newest fact this poll saw. That is §5.1's third
 * component doing its job: several records routinely share a timestamp, and the
 * operator's question is *which one we got to*.
 */
function advance(cursor, facts, serverTime) {
	const newest = facts.at(-1) ?? null;
	// `last_foreign_id` is the mark: a cursor that has recorded a fact is anchored
	// in the tracker's clock, and one that has not is still on the bootstrap.
	const bootstrapped = cursor.last_foreign_id !== null;

	if (newest === null) {
		// A quiet poll keeps its watermark — there is no record to move it to, and
		// moving it to `now` is the clock mixing this function exists to avoid.
		//
		// Unless the cursor has never anchored, in which case that bootstrap *is*
		// our clock, and a tracker running behind us would never produce a record
		// newer than it: every poll would ask for a window that had already passed,
		// and the cursor would sit on the wrong clock forever. The tracker's own
		// `Date` header settles it.
		if (bootstrapped || serverTime === null) return { ...cursor };
		return { ...cursor, last_updated_at: serverTime };
	}

	return {
		last_updated_at: bootstrapped ? Math.max(cursor.last_updated_at, newest.occurred_at) : newest.occurred_at,
		last_updated_at_raw: newest.occurred_at_raw,
		last_foreign_id: newest.foreign_id,
	};
}

/**
 * An issue snapshot from the cheap pass.
 *
 * The fact classes are §5.2's, every one of them Gitea's to establish — which is
 * why they are listed rather than implied: `requireAuthority` runs over this
 * list at write time, so a class Gitea may not assert cannot be smuggled into an
 * observation payload.
 */
function issueFact(issue, previous) {
	const bodyEdited =
		previous !== null &&
		previous.content_version !== null &&
		issue.content_version !== null &&
		previous.content_version !== issue.content_version;

	return {
		kind: "issue",
		ticket: issue.number,
		foreign_id: issue.foreign_id,
		occurred_at: issue.updated_at,
		occurred_at_raw: issue.updated_at_raw,
		fact_classes: Object.freeze([
			"ticket.state",
			"ticket.labels",
			"ticket.assignee",
			"ticket.content-version",
		]),
		body_edited: bodyEdited,
		observed: {
			ticket: issue.number,
			state: issue.state,
			labels: [...issue.labels],
			assignees: [...issue.assignees],
			content_version: issue.content_version,
			// The detector's verdict, recorded beside the counter that produced it:
			// §5.1 wants a *cheap* body-edit signal, and a consumer re-deriving it
			// would need the previous value this row is the only record of.
			body_edited: bodyEdited,
			previous_content_version: previous?.content_version ?? null,
		},
		issue,
	};
}

/**
 * A comment, recorded as **existence only**.
 *
 * The body is deliberately absent. §5.2 makes comment text authoritative for
 * nothing, and `authority.mjs` refuses to let `comment.text` be asserted at all
 * — so a payload carrying the body would be a fact the journal holds and no
 * rule permits anyone to use.
 */
function commentFact(comment) {
	return {
		kind: "comment",
		ticket: comment.ticket,
		foreign_id: comment.foreign_id,
		occurred_at: comment.updated_at,
		occurred_at_raw: comment.updated_at_raw,
		fact_classes: Object.freeze(["comment.observed"]),
		observed: {
			ticket: comment.ticket,
			comment_id: comment.id,
			author: comment.author,
			html_url: comment.html_url,
			// Stated in the record itself, because this is the fact whose absence is
			// most often misread: a comment that is not there may have been posted
			// and deleted (§5.2).
			absence_means: "possibly-deleted",
		},
	};
}

function timelineFact(entry) {
	return {
		kind: "timeline",
		ticket: entry.ticket,
		foreign_id: entry.foreign_id,
		occurred_at: entry.updated_at,
		occurred_at_raw: entry.updated_at_raw,
		fact_classes: Object.freeze(["timeline.entry"]),
		observed: {
			ticket: entry.ticket,
			timeline_id: entry.id,
			type: entry.type,
			dependent_issue: entry.dependent_issue,
			label: entry.label,
			assignee: entry.assignee,
			removed_assignee: entry.removed_assignee,
		},
	};
}

/**
 * The edge set after an `add_dependency`.
 *
 * **Keyed by the timeline entry that caused the read**, not by the clock. The
 * graph is the one fact here that Gitea offers no id for, and dating it `now`
 * would make it the single fact class that is *not* idempotent by construction:
 * a poll that failed after its reads and re-ran would dedup every issue and
 * comment and then write a second edge set under a fresh id. The triggering
 * entry is foreign, stable, and already deduped, so re-running the poll records
 * the graph exactly once.
 *
 * Several `add_dependency` entries in one poll collapse into one read keyed by
 * the last of them, which is correct: the graph has one current shape, and the
 * newest entry is the one that produced it.
 */
function dependencyFact(ticket, { blockedBy, blocks, trigger }) {
	return {
		kind: FOREIGN_ID_KINDS.dependencies,
		ticket,
		foreign_id: foreignId(FOREIGN_ID_KINDS.dependencies, ticket, trigger.foreign_id),
		occurred_at: trigger.updated_at,
		occurred_at_raw: trigger.updated_at_raw,
		fact_classes: Object.freeze(["ticket.dependencies"]),
		observed: {
			ticket,
			blocked_by: blockedBy.map((issue) => ({ ticket: issue.number, state: issue.state })),
			blocks: blocks.map((issue) => ({ ticket: issue.number, state: issue.state })),
		},
	};
}

function requireForeignId(fact) {
	if (typeof fact.foreign_id === "string" && fact.foreign_id.length > 0) return;
	throw new FactoryTrackerError(
		"observation-unidentified",
		`A ${fact.kind} fact arrived without the tracker's own id for it; §5.1's idempotency is by construction, and an id-less fact would be re-recorded on every poll.`,
		{ at: "foreign_id", kind: fact.kind, ticket: fact.ticket ?? null },
	);
}

/**
 * Which of *these* foreign ids the journal already holds.
 *
 * Asked about the poll's own candidates rather than by loading every observation
 * ever recorded: the second shape is a table scan that grows with the repository
 * for the life of the store, run four times a minute. This is the lookup
 * `event_by_foreign_source` exists to serve.
 *
 * @param {object} db
 * @param {string[]} ids
 * @returns {Set<string>}
 */
function alreadyRecorded(db, ids) {
	if (ids.length === 0) return new Set();

	const placeholders = ids.map(() => "?").join(", ");
	return new Set(
		db
			.prepare(
				`SELECT foreign_source_id FROM event
				 WHERE kind = 'observation.recorded' AND foreign_source_id IN (${placeholders})`,
			)
			.all(...ids)
			.map((row) => row.foreign_source_id),
	);
}

function readObservedIssues(db) {
	return new Map(db.prepare("SELECT * FROM observed_issue").all().map((row) => [row.ticket, row]));
}

function upsertObservedIssue(db, issue, at) {
	db.prepare(
		`INSERT INTO observed_issue(ticket, content_version, state, updated_at, observed_at, last_seq)
		 VALUES (?, ?, ?, ?, ?, (SELECT last_seq FROM journal_head WHERE id = 1))
		 ON CONFLICT(ticket) DO UPDATE SET
		   content_version = excluded.content_version,
		   state = excluded.state,
		   updated_at = excluded.updated_at,
		   observed_at = excluded.observed_at,
		   last_seq = excluded.last_seq`,
	).run(issue.number, issue.content_version, issue.state, issue.updated_at, at);
}
