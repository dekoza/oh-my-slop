import { execFile } from "node:child_process";

import { READ_OPERATIONS } from "../effects/catalogue.mjs";
import { FactoryTrackerError } from "./errors.mjs";

/**
 * The Gitea **read** path (§5.1) — and nothing else.
 *
 * There is no write here and there is no room for one: the transport hardcodes
 * `--method GET` and takes no method argument, so another verb is not a thing
 * this module can be *told* to perform rather than a thing it checks for. §4.5
 * puts every mutation behind a requested/resolved effect pair, so a write that
 * reached the tracker from here would be a mutation with no effect record and
 * nothing able to re-probe it.
 *
 * **Credentials are `tea`'s, and deliberately so.** `.pi/factory.json` carries
 * `tracker.repo`, `tracker.remote`, and `tracker.login` — and no base URL and no
 * token. That is not an omission: §6.8 states plainly that on this host `tea`
 * credentials are ambient, and §11.2 forbids env overrides for policy, so there
 * is no second place a URL or a secret could come from. `tracker.login` names a
 * `tea` login, `tea` resolves the instance and the token from it, and the
 * factory never holds a secret it would then have to keep out of a journal, an
 * artifact, and a worker's environment. It is also why §6.8's deny floor lists
 * `Bash(tea *)`: the scheduler's credentials are exactly what a worker must not
 * reach.
 *
 * **Status comes from `--include`, not from the exit code.** `tea api` exits `0`
 * on a 404 and prints the error body on stdout, so a client reading the exit
 * code would parse `{"message":"not found"}` as an answer. `--include` writes
 * the status line to stderr, and a non-2xx is a refusal here (§11.2's
 * no-silent-guessing, applied to the tracker instead of to the config file).
 * The same header block carries the tracker's `Date`, which §5.1's cursor needs
 * because its watermark lives in the tracker's clock and not in ours.
 *
 * **Webhooks are not used** (§5.1): this module opens no listener, binds no
 * port, and has no inbound surface at all. Ingestion is the cursor in
 * `observation.mjs` polling these reads.
 */

/** The credentialed client, named once. */
export const TEA_BINARY = "tea";

/** Gitea's own cap is 50 for most list endpoints; asking for more just truncates. */
export const PAGE_LIMIT = 50;

/**
 * A stop on the paging walk. A scope large enough to reach it is a scope the
 * operator should hear about rather than one this client should silently
 * truncate — and an unbounded `while` over a foreign system's paging is how a
 * controller hangs on a tracker bug.
 */
export const MAX_PAGES = 200;

/** Long enough for a busy instance, short enough that a hung tracker is not a hung run. */
export const READ_TIMEOUT_MS = 30_000;

/**
 * How many reads may be in flight at once.
 *
 * Every read is a `tea` subprocess, so an unbounded fan-out over a scope's
 * members is one `execFile` per member simultaneously — a scope of eighty
 * tickets forking eighty processes at a tracker that then rate-limits them. The
 * paging walk is bounded for the same reason (`MAX_PAGES`); this bounds the
 * other axis.
 */
export const MAX_CONCURRENT_READS = 4;

/**
 * `Promise.all` with a ceiling, so a caller can fan out over a scope without
 * counting its members first.
 *
 * @template T, R
 * @param {readonly T[]} items
 * @param {(item: T) => Promise<R>} read
 * @param {number} [limit]
 * @returns {Promise<R[]>} answers in the order the items were given
 */
export async function readEach(items, read, limit = MAX_CONCURRENT_READS) {
	const answers = new Array(items.length);
	let next = 0;

	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			answers[index] = await read(items[index]);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return answers;
}

/**
 * §4.3's foreign id, namespaced by the record kind it names.
 *
 * `dependencies` is not a record Gitea hands back with an id of its own — it is
 * the edge set as of some moment. It is a kind here anyway, because the
 * alternative is a fourth spelling built by hand somewhere else, and a grammar
 * with a second home has already started to drift.
 */
export const FOREIGN_ID_KINDS = Object.freeze({
	issue: "issue",
	comment: "comment",
	timeline: "timeline",
	dependencies: "dependencies",
});

/**
 * A tracker **fact's** stable id, as §4.3 and §5.1 need it — the id §5.1 dedups
 * on, and the one every `observation.recorded` carries.
 *
 * Two decisions are baked in, and both are what make re-polling idempotent *by
 * construction* rather than merely non-fatal:
 *
 * - **Namespaced by kind**, because the ids are not one sequence. An issue id
 *   comes from Gitea's issue table while comment and timeline ids share the
 *   comment sequence, so a bare `1150` from `/issues` and a `1150` from
 *   `/issues/comments` are two different records; dedup on a bare number would
 *   drop the second and never say so.
 * - **Qualified by the record's own revision**, because the cheap `?since=`
 *   endpoints answer with *current state*, not with an append-only log. Keying
 *   an issue on its id alone would mean the first observation of #42 suppressed
 *   every later one — the ticket would be labelled, closed, and reassigned
 *   without a single fact being recorded. Keying it on `(id, updated_at)` makes
 *   the 60-second overlap free and an edit a new fact, which is exactly the
 *   behaviour §5.1 asks for.
 *
 * @param {"issue" | "comment" | "timeline"} kind
 * @param {number | string} id the tracker's own id for the record
 * @param {string} revision that record's raw `updated_at`, verbatim (§4.3)
 * @returns {string}
 */
export function foreignId(kind, id, revision) {
	return `gitea:${kind}:${id}@${revision}`;
}

/**
 * @param {object} where
 * @param {string} where.repo `owner/repository`, from `tracker.repo`
 * @param {string} where.login the `tea` login, from `tracker.login`
 * @param {(read: { call: string, path: string, login: string, repo: string })
 *   => Promise<{ status: number, body: unknown, date?: number | null }>} [where.request]
 *   the transport, injectable so a suite drives real answer shapes without a Gitea.
 *   `date` is the instant the tracker says it is; a transport that omits it simply
 *   leaves `serverTime()` null.
 * @returns {Readonly<object>} the reads, each named by its §4.5 read operation
 */
export function createGiteaReader({ repo, login, request = teaRequest }) {
	const base = `/repos/${repo}`;
	// The tracker's own clock, as of the last answer. Every HTTP response carries
	// a `Date` header, so this costs nothing — and §5.1's cursor is compared
	// against `updated_at` **by the tracker's clock**, which makes "what time does
	// it think it is" a fact the cursor needs rather than a curiosity.
	let serverTime = null;

	/** Every read goes through here, so an undeclared one cannot be performed. */
	async function read(call, path) {
		if (!READ_OPERATIONS.includes(call)) {
			throw new FactoryTrackerError(
				"tracker-read-undeclared",
				`"${call}" is not one of §4.5's declared reads; reads are not effects, so this list is the whole inventory of what the factory asks the tracker.`,
				{ at: "call", found: call ?? null, expected: READ_OPERATIONS.join("|") },
			);
		}

		const answer = await request({ call, path, login, repo });
		if (Number.isInteger(answer?.date)) serverTime = answer.date;
		if (!Number.isInteger(answer?.status) || answer.status < 200 || answer.status >= 300) {
			throw new FactoryTrackerError(
				"tracker-unreachable",
				`${repo} answered ${answer?.status ?? "nothing"} for ${path}; this process learned nothing about the tracker.`,
				{ at: call, path, status: answer?.status ?? null, body: answer?.body ?? null },
			);
		}
		return answer.body;
	}

	/** A list read, walked to its end. Gitea pages every list endpoint. */
	async function readAll(call, path) {
		const collected = [];

		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const body = await read(call, `${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=${PAGE_LIMIT}`);
			const rows = requireArray(body, call, path);
			collected.push(...rows);
			if (rows.length < PAGE_LIMIT) return collected;
		}

		throw new FactoryTrackerError(
			"tracker-answer-invalid",
			`${path} is still paging after ${MAX_PAGES} pages of ${PAGE_LIMIT}; the factory stops rather than walking a tracker without end.`,
			{ at: call, path, pages: MAX_PAGES },
		);
	}

	return Object.freeze({
		repo,
		login,

		/**
		 * What the tracker's clock said on the last answer, or `null` before the
		 * first read. §5.1's cursor lives in this clock, so a fresh cursor with no
		 * record to anchor to asks here rather than reaching for `Date.now()`.
		 */
		serverTime: () => serverTime,

		/**
		 * §3.1's server-side candidate query: **the label does the filtering**, so
		 * the factory never walks a repository's whole issue list to find a scope.
		 *
		 * @param {{ labels?: string[], state?: "open" | "closed" | "all" }} query
		 */
		listIssues: async ({ labels = [], state = "open" } = {}) => {
			const parameters = new URLSearchParams({ state });
			if (labels.length > 0) parameters.set("labels", labels.join(","));
			return (await readAll("issue.list", `${base}/issues?${parameters}`)).map(normaliseIssue);
		},

		/** One issue by number — §3.1's direct-ticket set, which no filter selects. */
		readIssue: async (number) => normaliseIssue(await read("issue.get", `${base}/issues/${number}`)),

		/**
		 * §5.1's first cheap endpoint. `?since=` is `updated_at`-based, so an
		 * overlap costs duplicates and never gaps.
		 */
		issuesSince: async (since) => {
			const parameters = new URLSearchParams({ since, state: "all" });
			return (await readAll("issue.list", `${base}/issues?${parameters}`)).map(normaliseIssue);
		},

		/** §5.1's second cheap endpoint: every comment in the repository, since. */
		commentsSince: async (since) => {
			const parameters = new URLSearchParams({ since });
			return (await readAll("issue.comments", `${base}/issues/comments?${parameters}`)).map(normaliseComment);
		},

		/**
		 * One issue's comments — the same declared read, narrowed to a ticket.
		 *
		 * It exists for §4.5's `embedded-key` match and §3.3's arbitration, both of
		 * which ask a question about *one* ticket: does a comment carrying this
		 * effect key exist, and which claim comment has the lowest id. Answering
		 * either from the repository-wide `?since=` walk would mean paging every
		 * comment in the repository to look at one issue's.
		 */
		comments: async (number) =>
			(await readAll("issue.comments", `${base}/issues/${number}/comments`)).map(normaliseComment),

		/**
		 * §5.1: **only for issues the cheap pass flagged.** The per-issue timeline
		 * is the expensive read, and running it across a scope every 15 seconds is
		 * the polling cost the cursor exists to avoid.
		 */
		timelineSince: async (number, since) => {
			const parameters = new URLSearchParams({ since });
			return (await readAll("issue.timeline", `${base}/issues/${number}/timeline?${parameters}`)).map((entry) =>
				normaliseTimelineEntry(number, entry),
			);
		},

		/**
		 * §7.5's **one live PR per ticket**, found by the branch it is built from.
		 *
		 * Gitea's pulls endpoint has no `head=` filter — that is GitHub's — so the
		 * selection happens here, over the open list. It is still one declared read
		 * (`pulls.by-head-branch`), because what the factory asks for is "the pull
		 * request whose head is this branch" and the paging is how this instance
		 * answers it.
		 *
		 * **Open only.** §7.6's redo path is a human closing a PR unmerged, and
		 * §7.5 says the factory never resurrects a closed one; a closed PR found
		 * here would be exactly the resurrection.
		 *
		 * @param {string} branch the attempt branch
		 * @returns {Promise<object | null>}
		 */
		pullByHeadBranch: async (branch) =>
			(await readAll("pulls.by-head-branch", `${base}/pulls?state=open`))
				.map(normalisePull)
				.find((pull) => pull.head_branch === branch) ?? null,

		/**
		 * Every open PR built from a branch under `prefix` — §7.5's stale-PR sweep,
		 * whose whole question is "which other attempt branches of this ticket still
		 * have a PR open". The prefix is `factory/t<ticket>/`, which §7.3 makes
		 * derivable from the ticket alone.
		 */
		pullsByHeadPrefix: async (prefix) =>
			(await readAll("pulls.by-head-branch", `${base}/pulls?state=open`))
				.map(normalisePull)
				.filter((pull) => pull.head_branch !== null && pull.head_branch.startsWith(prefix)),

		/** What this issue is blocked by (§3.2). Read on resolve, and on `add_dependency`. */
		dependencies: async (number) =>
			(await readAll("issue.dependencies", `${base}/issues/${number}/dependencies`)).map(normaliseIssue),

		/** What this issue blocks — the same edge from the other end. */
		blocks: async (number) =>
			(await readAll("issue.dependencies", `${base}/issues/${number}/blocks`)).map(normaliseIssue),
	});
}

/**
 * A Gitea issue as the factory reads it.
 *
 * The raw timestamp string is kept verbatim beside the parsed one, because §4.3
 * requires it on every foreign fact: Gitea returns RFC3339 with the server's
 * local offset, and normalising in place destroys the evidence.
 */
export function normaliseIssue(raw) {
	requireRecord(raw, "issue");
	requireNumber(raw.number, "issue.number", raw);
	requireString(raw.state, "issue.state", raw);
	requireString(raw.updated_at, "issue.updated_at", raw);

	return Object.freeze({
		kind: FOREIGN_ID_KINDS.issue,
		foreign_id: foreignId(FOREIGN_ID_KINDS.issue, raw.id ?? raw.number, raw.updated_at),
		number: raw.number,
		state: raw.state,
		title: raw.title ?? "",
		body: raw.body ?? "",
		labels: Object.freeze((raw.labels ?? []).map((label) => label?.name).filter((name) => typeof name === "string")),
		// Gitea answers `null` for an unassigned issue rather than an empty list,
		// and §3.3 turns "who is assigned" into an absolute human claim — so the
		// two spellings must not become two different answers here.
		assignees: Object.freeze(
			(raw.assignees ?? []).map((user) => user?.login).filter((login) => typeof login === "string"),
		),
		// §5.1's cheap body-edit detector. Absent on an older Gitea, and `null`
		// says "this instance does not tell us" rather than "the body never
		// changed" — the plausible zero §10.5 refuses everywhere else.
		content_version: Number.isInteger(raw.content_version) ? raw.content_version : null,
		comments: Number.isInteger(raw.comments) ? raw.comments : null,
		updated_at: epochMillis(raw.updated_at, "issue.updated_at", raw),
		updated_at_raw: raw.updated_at,
		html_url: raw.html_url ?? null,
	});
}

/**
 * A comment, as evidence of *existence* only — never of its text (§5.2).
 *
 * `body` rides along for exactly one purpose: §4.5's `embedded-key` match, which
 * is a **string search for a key the factory itself wrote** and not a reading of
 * what the comment says. §5.2 excludes comment text from every authority row, and
 * `authority.mjs` refuses `comment.text` from any source at all — so a caller
 * that classified a ticket from this field would be refused at the write. What
 * the field supports is recognising our own record, and nothing beyond it.
 */
export function normaliseComment(raw) {
	requireRecord(raw, "comment");
	requireNumber(raw.id, "comment.id", raw);
	requireString(raw.updated_at, "comment.updated_at", raw);

	return Object.freeze({
		kind: FOREIGN_ID_KINDS.comment,
		foreign_id: foreignId(FOREIGN_ID_KINDS.comment, raw.id, raw.updated_at),
		id: raw.id,
		body: typeof raw.body === "string" ? raw.body : "",
		// The repository-wide comments endpoint identifies the issue by URL only.
		ticket: issueNumberFromUrl(raw.issue_url),
		author: raw.user?.login ?? null,
		updated_at: epochMillis(raw.updated_at, "comment.updated_at", raw),
		updated_at_raw: raw.updated_at,
		// §3.3's contest window is about when a claim was *made*, so an edited
		// comment must not slide out of it: `updated_at` moves on an edit and
		// `created_at` does not.
		created_at: epochMillis(raw.created_at ?? raw.updated_at, "comment.created_at", raw),
		created_at_raw: raw.created_at ?? raw.updated_at,
		html_url: raw.html_url ?? null,
	});
}

/**
 * A pull request as the factory reads it (§7.5).
 *
 * The head **branch** rather than the head repository or sha: §7.3 derives the
 * branch deterministically from the identity tuple, so the branch is what makes
 * a PR findable from a ticket and an attempt without the factory keeping a map.
 * The sha rides along as evidence of what is open, never as the handle.
 *
 * Gitea numbers pull requests in the issue sequence, which is why the same
 * `issue-close` mutation and the same comment endpoint serve both — and why
 * `number` here is comparable with a ticket number and must never be confused
 * for one.
 */
export function normalisePull(raw) {
	requireRecord(raw, "pull request");
	requireNumber(raw.number, "pull.number", raw);
	requireString(raw.state, "pull.state", raw);
	requireString(raw.updated_at, "pull.updated_at", raw);

	return Object.freeze({
		kind: FOREIGN_ID_KINDS.issue,
		foreign_id: foreignId(FOREIGN_ID_KINDS.issue, raw.id ?? raw.number, raw.updated_at),
		number: raw.number,
		// `state` is validated and kept because §7.5's reads are scoped to open
		// pull requests and a record that could not say which it is would make
		// that scoping unverifiable from the record alone.
		state: raw.state,
		// `body` is what `parsePullBody` reads to decide whether a PR is ours.
		body: raw.body ?? "",
		head_branch: typeof raw.head?.ref === "string" ? raw.head.ref : null,
		head_sha: typeof raw.head?.sha === "string" ? raw.head.sha : null,
		// §4.3's raw timestamp, verbatim, for the probe's `occurredAtRaw`. The
		// parsed form has no reader here — `normaliseIssue` carries one because
		// §5.1's cursor compares against it, and a pull request is on no cursor.
		updated_at_raw: raw.updated_at,
		html_url: raw.html_url ?? null,
	});
}

/**
 * The label **names** on an issue, as the labels endpoint answers them.
 *
 * Names rather than the records: the factory's label vocabulary is fixed
 * constants (`labels.mjs`) and a label id is this instance's own number, so
 * nothing the factory writes or probes has a use for one. `normaliseIssue`
 * projects the same field the same way, which is what lets the `issue.labels`
 * probe be served from either read.
 *
 * @param {unknown} raw the endpoint's answer — an array of label records
 * @returns {ReadonlyArray<string>}
 */
export function normaliseLabelNames(raw) {
	if (!Array.isArray(raw)) {
		throw new FactoryTrackerError(
			"tracker-answer-invalid",
			`An issue's labels come back as a list; found ${JSON.stringify(raw ?? null)}.`,
			{ at: "labels", found: raw ?? null },
		);
	}

	return Object.freeze(raw.map((label) => label?.name).filter((name) => typeof name === "string"));
}

/**
 * A timeline entry. `type` is Gitea's own vocabulary and is passed through
 * rather than mapped: §5.1 keys one behaviour off exactly one member
 * (`add_dependency`), and a translation table would be a second vocabulary that
 * silently drops whatever this build has not heard of.
 */
export function normaliseTimelineEntry(ticket, raw) {
	requireRecord(raw, "timeline entry");
	requireNumber(raw.id, "timeline.id", raw);
	requireString(raw.type, "timeline.type", raw);
	requireString(raw.created_at, "timeline.created_at", raw);

	return Object.freeze({
		kind: FOREIGN_ID_KINDS.timeline,
		foreign_id: foreignId(FOREIGN_ID_KINDS.timeline, raw.id, raw.updated_at ?? raw.created_at),
		id: raw.id,
		ticket,
		type: raw.type,
		dependent_issue: Number.isInteger(raw.dependent_issue?.number) ? raw.dependent_issue.number : null,
		label: raw.label?.name ?? null,
		assignee: raw.assignee?.login ?? null,
		removed_assignee: raw.removed_assignee === true,
		updated_at: epochMillis(raw.updated_at ?? raw.created_at, "timeline.updated_at", raw),
		updated_at_raw: raw.updated_at ?? raw.created_at,
		created_at_raw: raw.created_at,
	});
}

/** The `?since=` argument: RFC3339 in UTC, from §4.3's epoch milliseconds. */
export function sinceParameter(millis) {
	return new Date(Math.max(0, millis)).toISOString();
}

/**
 * The default transport: one `tea api` call, read-only by construction.
 *
 * `execFile` rather than a shell, so a repository slug or a `since` value can
 * never become shell syntax — the argument vector is the argument vector.
 */
async function teaRequest({ path, login }) {
	const argv = ["api", "--include", "--method", "GET"];
	if (typeof login === "string" && login.length > 0) argv.push("--login", login);
	argv.push(path);

	const { stdout, stderr } = await run(TEA_BINARY, argv);
	return { status: statusOf(stderr, path), body: parseBody(stdout, path), date: dateOf(stderr) };
}

/**
 * The `Date` response header — the tracker stating its own clock. Optional by
 * design: a proxy that strips it leaves `null`, and the caller falls back rather
 * than refusing a read that otherwise succeeded.
 */
function dateOf(stderr) {
	const matched = /^Date:\s*(.+)$/im.exec(stderr ?? "");
	if (matched === null) return null;
	const parsed = Date.parse(matched[1].trim());
	return Number.isNaN(parsed) ? null : parsed;
}

function run(binary, argv) {
	return new Promise((resolve, reject) => {
		execFile(binary, argv, { timeout: READ_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error === null) return resolve({ stdout, stderr });

			// A `tea` that is missing, unconfigured, or refused by the instance all
			// arrive here, and all mean the same thing: nothing was learned.
			reject(
				new FactoryTrackerError(
					"tracker-unreachable",
					`\`${binary} ${argv.join(" ")}\` failed: ${(stderr || error.message).trim()}`,
					{ at: "tea", command: `${binary} ${argv.join(" ")}`, code: error.code ?? null },
				),
			);
		});
	});
}

/**
 * The status line `--include` writes to stderr. It is the only trustworthy
 * verdict `tea api` offers: the exit code is `0` for a 404 whose body reads like
 * an answer.
 */
function statusOf(stderr, path) {
	const matched = /^HTTP\/[\d.]+ (\d{3})/m.exec(stderr ?? "");
	if (matched === null) {
		throw new FactoryTrackerError(
			"tracker-answer-invalid",
			`No HTTP status came back for ${path}; \`tea api --include\` writes one to stderr, and without it a 404 body is indistinguishable from an answer.`,
			{ at: "status", path, stderr: (stderr ?? "").slice(0, 500) },
		);
	}
	return Number.parseInt(matched[1], 10);
}

function parseBody(stdout, path) {
	const text = (stdout ?? "").trim();
	if (text === "") return null;

	try {
		return JSON.parse(text);
	} catch (error) {
		throw new FactoryTrackerError("tracker-answer-invalid", `${path} did not answer JSON: ${error.message}`, {
			at: "body",
			path,
			body: text.slice(0, 500),
		});
	}
}

function requireArray(body, call, path) {
	if (Array.isArray(body)) return body;
	throw new FactoryTrackerError(
		"tracker-answer-invalid",
		`${path} answered ${describe(body)} where ${call} returns a list.`,
		{ at: call, path, expected: "array", found: describe(body) },
	);
}

function requireRecord(raw, what) {
	if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return raw;
	throw new FactoryTrackerError("tracker-answer-invalid", `A ${what} came back as ${describe(raw)}.`, {
		at: what,
		expected: "object",
		found: describe(raw),
	});
}

function requireNumber(value, at, raw) {
	if (Number.isInteger(value) && value > 0) return value;
	throw new FactoryTrackerError("tracker-answer-invalid", `${at} is ${describe(value)}, not an issue number.`, {
		at,
		found: value ?? null,
		record: identify(raw),
	});
}

function requireString(value, at, raw) {
	if (typeof value === "string" && value.length > 0) return value;
	throw new FactoryTrackerError("tracker-answer-invalid", `${at} is ${describe(value)}, not a string.`, {
		at,
		found: value ?? null,
		record: identify(raw),
	});
}

/** §4.3's UTC epoch milliseconds, from the offset-carrying RFC3339 Gitea returns. */
function epochMillis(raw, at, record) {
	const parsed = Date.parse(raw);
	if (Number.isNaN(parsed)) {
		throw new FactoryTrackerError("tracker-answer-invalid", `${at} is not an RFC3339 timestamp: ${describe(raw)}.`, {
			at,
			found: raw ?? null,
			record: identify(record),
		});
	}
	return parsed;
}

/** `…/issues/134` → `134`; anything else is a comment we cannot attribute. */
function issueNumberFromUrl(url) {
	const matched = typeof url === "string" ? /\/issues\/([1-9][0-9]*)(?:$|[?#])/.exec(url) : null;
	return matched === null ? null : Number.parseInt(matched[1], 10);
}

function identify(raw) {
	return raw?.number ?? raw?.id ?? null;
}

function describe(value) {
	if (Array.isArray(value)) return "an array";
	if (value === null || value === undefined) return "nothing";
	if (typeof value === "object") return "an object";
	return JSON.stringify(value);
}
