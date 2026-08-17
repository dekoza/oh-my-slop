/**
 * Which event names does Herdr actually deliver on the §5.1 socket, and does the factory's own
 * subscription request accept them?
 *
 * Costs no model session: the pane's status is driven directly with `herdr pane report-agent`,
 * so what is under test is the wire contract and nothing else.
 *
 * Two connections, one pane:
 *   A — the factory's exact request, from the shipped `subscribeRequest`
 *   B — the same three events with no `pane_id` filter, to establish whether the filter is optional
 *
 * Usage: node tests/live/herdr-subscription-frames.mjs
 */
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { subscribeRequest, SUBSCRIBED_EVENTS } from "../../factory/lib/controller/herdr-events.mjs";

const SOCKET = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock");
const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

const created = herdr(["workspace", "create", "--cwd", homedir(), "--label", "herdr-probe", "--no-focus"]);
const pane = created.root_pane.pane_id;
const workspace = created.workspace.workspace_id;
log("pane", pane);

const a = open("A(factory)", subscribeRequest(pane));
const b = open("B(unfiltered)", {
	id: "probe-unfiltered",
	method: "events.subscribe",
	params: { subscriptions: SUBSCRIBED_EVENTS.map((type) => ({ type })) },
});

await sleep(1500);
for (const state of ["working", "idle", "blocked", "working"]) {
	log(`-- report-agent --state ${state}`);
	herdr(["pane", "report-agent", pane, "--source", "probe", "--agent", "claude", "--state", state]);
	await sleep(1500);
}
await sleep(1000);

log("-- done --");
a.destroy();
b.destroy();
herdr(["workspace", "close", workspace]);

/**
 * Every line verbatim. A frame printed here is the fixture a unit test of `fromFrame` should
 * carry: a parser cannot be tested against frames written to match it.
 */
function open(name, request) {
	const stream = createConnection(SOCKET);
	let buffer = "";
	stream.once("connect", () => {
		log(`${name} >>`, JSON.stringify(request));
		stream.write(`${JSON.stringify(request)}\n`);
	});
	stream.on("data", (chunk) => {
		buffer += chunk;
		let index;
		while ((index = buffer.indexOf("\n")) !== -1) {
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			// Two of the three subscriptions are server-wide, so frames for other
			// panes arrive here too and are the noise this filter drops.
			if (line.trim() !== "" && (!line.includes('"pane_id"') || line.includes(pane))) log(`${name} <<`, line);
		}
	});
	stream.once("error", (error) => log(`${name} ERROR`, error.message));
	return stream;
}

function herdr(args) {
	const answer = spawnSync("herdr", args, { encoding: "utf8" });
	if (answer.status !== 0) {
		log(`herdr ${args.join(" ")} EXIT ${answer.status}`, (answer.stderr ?? "").trim());
		return null;
	}
	try {
		const parsed = JSON.parse(answer.stdout);
		return parsed?.result ?? parsed;
	} catch {
		return answer.stdout;
	}
}

function sleep(ms) {
	return new Promise((wake) => setTimeout(wake, ms));
}
