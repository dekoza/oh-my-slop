import { execFile } from "node:child_process";

import { EFFECT_REGISTRY } from "../effects/registry.mjs";
import { FactoryTrackerError } from "./errors.mjs";
import { normaliseComment, normaliseIssue, normaliseLabelNames, TEA_BINARY } from "./gitea.mjs";

/**
 * The Gitea **write** path (§3.3, §8.9, §4.5) — the mutations a claim and a
 * disposition need, and no others.
 *
 * It is a separate module from the reader rather than a section of it, and that
 * is the point: `gitea.mjs` hardcodes `--method GET` and takes no method
 * argument, so a write is not something that module can be *told* to do. Splitting
 * them keeps that property true as both grow, and it makes the inventory of what
 * the factory can change about a tracker one short table anybody can read.
 *
 * **This module performs mutations and records none of them.** Every call here is
 * the middle of §4.5's requested/resolved pair, and the pair is `claims.mjs`'s to
 * write — the same shape `artifacts/writes.mjs` uses, where the blob write sits
 * between `requestEffect` and `resolveEffect`. A writer that recorded its own
 * effects would put effect writes in a second place, and §4.5 has exactly one.
 *
 * **Credentials are `tea`'s**, exactly as for the reader (§6.8): `tracker.login`
 * names a `tea` login, and `tea` holds the instance and the token. The factory
 * never holds a tracker secret it would then have to keep out of a journal, an
 * artifact, and a worker's environment.
 *
 * **Status comes from `--include`.** `tea api` exits `0` on a 4xx and prints the
 * error body, so a writer trusting the exit code would resolve an effect that
 * never happened — the one failure mode §5.3's whole re-probing discipline exists
 * to make impossible, reintroduced at the moment of the write.
 */

/** Long enough for a busy instance; a hung tracker must not be a hung run. */
export const WRITE_TIMEOUT_MS = 30_000;

/**
 * Every mutation this module can perform, keyed by **the §4.5 effect kind that
 * names it**. Two properties fall out of writing it this way rather than as three
 * methods with URLs inline:
 *
 * - the guard below can ask the effect registry whether the operation is
 *   registrable at all, so a write with no probe cannot be issued (§14.3);
 * - `issue-assign` and `issue-unassign` are visibly *one* Gitea call with two
 *   meanings, which is why §4.5 gives them two probe matches over one read.
 *
 * Gitea has no add/remove endpoint for issue assignees: `PATCH` takes the whole
 * desired set and replaces it. That is not a limitation worth hiding behind a
 * read-modify-write here — §3.3 only ever claims a ticket **nobody** is assigned
 * to, so the desired set is `[us]` or `[]`, and computing it from a set we just
 * read would open a window in which a human's assignment is silently discarded.
 *
 * **Labels are the opposite case, and the verb is what makes it so.** `POST` on
 * an issue's labels *appends*; `PUT` replaces the set. §8.9 adds one label to a
 * ticket a human may have labelled themselves, so the appending verb is the only
 * correct one — replacing would let a disposition silently drop a triage label
 * nobody asked it to touch.
 *
 * **There is no label removal**, and its absence is §14.20: a `factory:failed`
 * or `factory:needs-human` label is cleared by a human or not at all, so the
 * factory has no path to remove one. §4.5's catalogue declares the `label-remove`
 * *probe* because removal is a mutation somebody could perform — but the writer
 * is the inventory of what this factory can change about a tracker, and adding an
 * unreachable removal here is how the automatic requeue comes back.
 */
export const TRACKER_WRITES = Object.freeze({
	"issue-assign": Object.freeze({ method: "PATCH", path: (ticket) => `/issues/${ticket}` }),
	"issue-unassign": Object.freeze({ method: "PATCH", path: (ticket) => `/issues/${ticket}` }),
	"label-add": Object.freeze({ method: "POST", path: (ticket) => `/issues/${ticket}/labels` }),
	"comment-post": Object.freeze({ method: "POST", path: (ticket) => `/issues/${ticket}/comments` }),
});

/**
 * @param {object} where
 * @param {string} where.repo `owner/repository`, from `tracker.repo`
 * @param {string} where.login the `tea` login, from `tracker.login`
 * @param {(write: { operation: string, method: string, path: string, body: object,
 *   login: string, repo: string }) => Promise<{ status: number, body: unknown }>} [where.request]
 *   the transport, injectable so a suite drives real answer shapes without a Gitea
 * @returns {Readonly<object>} the three mutations, each named by its §4.5 effect kind
 */
export function createGiteaWriter({ repo, login, request = teaWrite }) {
	const base = `/repos/${repo}`;

	/** Every write goes through here, so an undeclared one cannot be performed. */
	async function write(operation, ticket, body) {
		const declared = TRACKER_WRITES[operation];
		if (declared === undefined || !EFFECT_REGISTRY.has(operation)) {
			throw new FactoryTrackerError(
				"tracker-write-undeclared",
				`"${operation}" is not a declared tracker mutation; a write outside §4.5's catalogue has no probe, so nothing could ever settle it.`,
				{ at: "operation", found: operation ?? null, expected: Object.keys(TRACKER_WRITES).join("|") },
			);
		}

		const path = `${base}${declared.path(ticket)}`;
		const answer = await request({ operation, method: declared.method, path, body, login, repo });

		if (!Number.isInteger(answer?.status) || answer.status < 200 || answer.status >= 300) {
			throw new FactoryTrackerError(
				"tracker-unreachable",
				`${repo} answered ${answer?.status ?? "nothing"} for ${declared.method} ${path}; whether the mutation landed is unknown to this process (§5.3).`,
				{ at: operation, path, method: declared.method, status: answer?.status ?? null, body: answer?.body ?? null },
			);
		}
		return answer.body;
	}

	return Object.freeze({
		repo,
		login,

		/**
		 * §3.3's assignee half of a claim. The set is passed whole because that is
		 * what the endpoint takes; `claims.mjs` only ever passes a single login,
		 * and only for a ticket it just read as unassigned.
		 */
		assign: async (ticket, assignees) => normaliseIssue(await write("issue-assign", ticket, { assignees })),

		/**
		 * Dropping the claim (§3.3's collision loser, §8.9's `released`). **No
		 * label is touched**: the ticket returns to the frontier exactly as it was,
		 * which is the honest state rather than a lock nobody holds.
		 */
		unassign: async (ticket) => normaliseIssue(await write("issue-unassign", ticket, { assignees: [] })),

		/**
		 * §8.9's label half of a disposition. The endpoint answers with the issue's
		 * labels rather than the issue, so the names are what comes back — and the
		 * names are what the `issue.labels` probe compares, so nothing here has to
		 * carry a label id the factory never chose.
		 */
		addLabels: async (ticket, labels) => normaliseLabelNames(await write("label-add", ticket, { labels })),

		/**
		 * §3.3's structured claim comment, §8.9's disposition block, §3.3's takeover
		 * comment — one mutation with three uses, keyed apart by the effect key each
		 * carries in an HTML comment (§4.5).
		 */
		comment: async (ticket, body) => normaliseComment(await write("comment-post", ticket, { body })),
	});
}

/**
 * The default transport: one `tea api` call with a JSON body on stdin.
 *
 * `--data @-` rather than an argument, because the body carries a whole comment —
 * prose an operator wrote, possibly with quotes and newlines in it — and an
 * argument vector is not where that belongs. `execFile` rather than a shell, so
 * neither the body nor the path can become shell syntax.
 */
async function teaWrite({ method, path, body, login }) {
	const argv = ["api", "--include", "--method", method, "--data", "@-"];
	if (typeof login === "string" && login.length > 0) argv.push("--login", login);
	argv.push(path);

	const { stdout, stderr } = await run(TEA_BINARY, argv, JSON.stringify(body));
	return { status: statusOf(stderr, method, path), body: parseBody(stdout, path) };
}

function run(binary, argv, input) {
	return new Promise((resolve, reject) => {
		const child = execFile(
			binary,
			argv,
			{ timeout: WRITE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error === null) return resolve({ stdout, stderr });

				reject(
					new FactoryTrackerError(
						"tracker-unreachable",
						`\`${binary} ${argv.join(" ")}\` failed: ${(stderr || error.message).trim()}`,
						{ at: "tea", command: `${binary} ${argv.join(" ")}`, code: error.code ?? null },
					),
				);
			},
		);

		// A `tea` that died before reading stdin arrives at the callback above with
		// its own diagnosis; the EPIPE here is a symptom of that and would otherwise
		// reject this promise first with a message about a pipe.
		child.stdin.on("error", () => {});
		child.stdin.end(input);
	});
}

/**
 * The status line `--include` writes to stderr — the only trustworthy verdict
 * `tea api` offers, and for a write the difference between "recorded a mutation
 * that happened" and "recorded one that did not".
 */
function statusOf(stderr, method, path) {
	const matched = /^HTTP\/[\d.]+ (\d{3})/m.exec(stderr ?? "");
	if (matched === null) {
		throw new FactoryTrackerError(
			"tracker-answer-invalid",
			`No HTTP status came back for ${method} ${path}; without one, a refused write is indistinguishable from a performed one.`,
			{ at: "status", path, method, stderr: (stderr ?? "").slice(0, 500) },
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
