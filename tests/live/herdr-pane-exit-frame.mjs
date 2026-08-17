/**
 * Does closing a pane emit a frame on the §5.1 socket, and under which name?
 *
 * `pane.exited` is the only thing in Herdr's API that comes close to a termination signal, and
 * §6.6's `dead-worker` row depends on recognising it. Its wire spelling is **not** established:
 * `pane.agent_detected` arrives underscored while `pane.agent_status_changed` arrives dotted, so
 * neither spelling can be assumed for the third.
 *
 * Costs no model session. Closing the pane is the whole experiment.
 *
 * Usage: node tests/live/herdr-pane-exit-frame.mjs
 */
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { subscribeRequest } from "../../factory/lib/controller/herdr-events.mjs";

const SOCKET = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock");
const startedAt = Date.now();
const log = (...parts) => console.log(`[${String((Date.now() - startedAt) / 1000).padStart(7)}s]`, ...parts);

const created = herdr(["workspace", "create", "--cwd", homedir(), "--label", "herdr-probe", "--no-focus"]);
const pane = created.root_pane.pane_id;
const workspace = created.workspace.workspace_id;
log("pane", pane, "workspace", workspace);

const stream = createConnection(SOCKET);
let buffer = "";
stream.once("connect", () => stream.write(`${JSON.stringify(subscribeRequest(pane))}\n`));
stream.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (line.trim() !== "" && (!line.includes('"pane_id"') || line.includes(pane))) log("<<", line);
	}
});

await sleep(1500);

// Two ways for a pane to end, because they may not be the same event: the pane closed out from
// under the process, and the process exiting on its own.
log("-- running `exit` in the pane --");
herdr(["pane", "run", pane, "exit"]);
await sleep(2500);

// A shell that exited takes its pane — and a single-pane workspace — with it, so both of these
// answering `not_found` is the ordinary path rather than a failure.
log("-- closing the pane --");
herdr(["pane", "close", pane], { optional: true });
await sleep(2500);

log("-- done --");
stream.destroy();
herdr(["workspace", "close", workspace], { optional: true });

function herdr(args, { optional = false } = {}) {
	const answer = spawnSync("herdr", args, { encoding: "utf8" });
	if (answer.status !== 0) {
		if (!optional) log(`herdr ${args.join(" ")} EXIT ${answer.status}`, (answer.stderr ?? "").trim());
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
