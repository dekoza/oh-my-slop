import { PAGE_LIMIT } from "../../../factory/lib/tracker/gitea.mjs";

/**
 * A Gitea standing in for the real one, answering **the shapes the real
 * instance answers** — the records here were captured from a live
 * `tea api` against Gitea 1.24 and trimmed to the fields the factory reads.
 *
 * It is a transport rather than a stubbed client: the reader's own URL building,
 * paging walk, status handling, and normalisation all run. A stub of
 * `listIssues` would have proved that the tests agree with themselves.
 *
 * This file lives one level down so `node --test tests/node/*.mjs` does not pick
 * it up as a test file of its own.
 */

/** The instant the tracker fixtures are dated around. */
export const TRACKER_NOW = Date.parse("2026-08-15T12:00:00Z");

/**
 * @param {object} raw the fields this ticket cares about
 * @returns {object} a Gitea issue record
 */
export function giteaIssue({
	number,
	id = 1000 + number,
	state = "open",
	title = `ticket ${number}`,
	body = "",
	labels = ["workflow:implement", "ready-for-agent"],
	assignees = null,
	contentVersion = 0,
	comments = 0,
	updatedAt = "2026-08-15T13:40:34+02:00",
}) {
	return {
		id,
		number,
		state,
		title,
		body,
		labels: labels.map((name, index) => ({ id: 60 + index, name, color: "0052cc" })),
		assignees: assignees === null ? null : assignees.map((login) => ({ id: 1, login, username: login })),
		milestone: null,
		comments,
		created_at: "2026-08-15T13:21:25+02:00",
		updated_at: updatedAt,
		closed_at: state === "closed" ? updatedAt : null,
		html_url: `http://gitea.example/acme/widgets/issues/${number}`,
		pull_request: null,
		content_version: contentVersion,
	};
}

/** A repository-wide comment record, as `/issues/comments?since=` returns it. */
export function giteaComment({ id, ticket, author = "minder", updatedAt = "2026-08-15T13:57:24+02:00" }) {
	return {
		id,
		html_url: `http://gitea.example/acme/widgets/issues/${ticket}#issuecomment-${id}`,
		pull_request_url: "",
		issue_url: `http://gitea.example/acme/widgets/issues/${ticket}`,
		user: { id: 1, login: author, username: author },
		body: "the text of a comment, which is authoritative for nothing (§5.2)",
		created_at: "2026-08-15T13:57:24+02:00",
		updated_at: updatedAt,
	};
}

/** A timeline entry. `type` is Gitea's own vocabulary — `add_dependency` included. */
export function giteaTimelineEntry({
	id,
	type,
	dependentIssue = null,
	label = null,
	createdAt = "2026-08-15T13:23:36+02:00",
}) {
	return {
		id,
		type,
		user: { id: 1, login: "minder", username: "minder" },
		body: "",
		created_at: createdAt,
		updated_at: createdAt,
		label: label === null ? null : { id: 67, name: label },
		assignee: null,
		removed_assignee: false,
		dependent_issue: dependentIssue === null ? null : { id: 1000 + dependentIssue, number: dependentIssue },
	};
}

/**
 * @param {object} world
 * @param {object[]} [world.issues] every issue in the repository, raw
 * @param {object[]} [world.comments] every comment, raw
 * @param {Record<number, object[]>} [world.timeline] per-issue timeline entries
 * @param {Record<number, number[]>} [world.dependencies] issue → the issues it is blocked by
 * @param {Record<string, number>} [world.status] path prefix → the status to answer with
 * @param {number | null} [world.serverTime] what the tracker's own clock says, as its
 *   `Date` response header would — the instant a fresh cursor anchors to when the
 *   first poll sees nothing
 * @returns {{ request: Function, calls: Array<{ call: string, path: string }>, pathsFor: Function }}
 */
export function fakeGitea({
	issues = [],
	comments = [],
	timeline = {},
	dependencies = {},
	status = {},
	serverTime = TRACKER_NOW,
} = {}) {
	const calls = [];

	const answer = async ({ call, path }) => {
		calls.push({ call, path });

		const override = Object.entries(status).find(([prefix]) => path.includes(prefix));
		if (override !== undefined) {
			return { status: override[1], body: { message: "refused by the fixture" } };
		}

		const [route, query] = split(path);
		const parameters = new URLSearchParams(query);

		if (route.endsWith("/issues/comments")) {
			return page(sinceFilter(comments, parameters), parameters);
		}

		const timelineMatch = /\/issues\/([0-9]+)\/timeline$/.exec(route);
		if (timelineMatch !== null) {
			return page(sinceFilter(timeline[Number(timelineMatch[1])] ?? [], parameters), parameters);
		}

		const dependencyMatch = /\/issues\/([0-9]+)\/(dependencies|blocks)$/.exec(route);
		if (dependencyMatch !== null) {
			const ticket = Number(dependencyMatch[1]);
			const numbers =
				dependencyMatch[2] === "dependencies"
					? (dependencies[ticket] ?? [])
					: Object.entries(dependencies)
							.filter(([, blockers]) => blockers.includes(ticket))
							.map(([dependent]) => Number(dependent));
			return page(
				numbers.map((number) => issues.find((issue) => issue.number === number)).filter(Boolean),
				parameters,
			);
		}

		const issueMatch = /\/issues\/([0-9]+)$/.exec(route);
		if (issueMatch !== null) {
			const issue = issues.find((candidate) => candidate.number === Number(issueMatch[1]));
			return issue === undefined
				? { status: 404, body: { message: "not found" } }
				: { status: 200, body: issue };
		}

		if (route.endsWith("/issues")) {
			return page(labelFilter(stateFilter(sinceFilter(issues, parameters), parameters), parameters), parameters);
		}

		return { status: 404, body: { message: `the fixture serves no ${route}` } };
	};

	// Every answer carries the tracker's clock, exactly as a real `Date` response
	// header does — attached once here so no route can forget it.
	const request = async (read) => ({ ...(await answer(read)), date: serverTime });

	return { request, calls, pathsFor: (call) => calls.filter((entry) => entry.call === call).map((e) => e.path) };
}

function split(path) {
	const index = path.indexOf("?");
	return index === -1 ? [path, ""] : [path.slice(0, index), path.slice(index + 1)];
}

/** Gitea's `?since=` is `updated_at`-based and inclusive of the boundary. */
function sinceFilter(records, parameters) {
	const since = parameters.get("since");
	if (since === null) return records;
	const boundary = Date.parse(since);
	return records.filter((record) => Date.parse(record.updated_at ?? record.created_at) >= boundary);
}

function stateFilter(records, parameters) {
	const state = parameters.get("state") ?? "open";
	return state === "all" ? records : records.filter((record) => record.state === state);
}

function labelFilter(records, parameters) {
	const labels = parameters.get("labels");
	if (labels === null) return records;
	const wanted = labels.split(",");
	return records.filter((record) => wanted.every((name) => record.labels.some((label) => label.name === name)));
}

function page(records, parameters) {
	const limit = Number(parameters.get("limit") ?? PAGE_LIMIT);
	const number = Number(parameters.get("page") ?? 1);
	return { status: 200, body: records.slice((number - 1) * limit, number * limit) };
}
