import { accessSync, constants } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * §10.3's named preflight check: **is Herdr available?**
 *
 * The factory checks the operator's multiplexer; it does not manage one. So this
 * probes and **fails closed with the exact command to start it**, and there is no
 * path here that starts, installs, or configures anything — a factory that
 * silently brought up the operator's terminal server would be making a decision
 * about their session that is not its to make.
 *
 * **The probe connects to the socket rather than running `herdr status`.** §5.1
 * already establishes that the socket is how the controller talks to Herdr — it
 * subscribes to `events.subscribe` there — so connecting is the same fact the
 * run will depend on, asked cheaply. A binary on `PATH` whose server is down
 * answers a version query happily and cannot host a single pane.
 */

/** What Herdr publishes as the running server's socket, when it is running. */
const SOCKET_ENV = "HERDR_SOCKET_PATH";
const SOCKET_LEAF = join("herdr", "herdr.sock");
const BINARY = "herdr";

/** Short: a socket that exists and does not answer promptly is not available. */
const CONNECT_TIMEOUT_MS = 2_000;

/**
 * The exact commands §10.3 asks the refusal to carry. Two, because "not
 * installed" and "installed but not running" are different problems and a single
 * sentence would be wrong for one of them.
 */
export const HERDR_REMEDIES = Object.freeze({
	install: "install Herdr from https://herdr.dev so `herdr` is on PATH",
	start: BINARY,
	startHeadless: `${BINARY} server`,
});

/**
 * @typedef {object} HerdrAvailability
 * @property {boolean} available
 * @property {string} binary the resolved executable, or null
 * @property {string} socket the socket path that was probed
 * @property {string | null} reason why it is unavailable, or null
 * @property {string | null} command the exact command to fix it, or null
 */

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] the operator's environment
 * @param {(socket: string) => Promise<boolean>} [options.connect] injectable, so a
 *   test can drive both answers without a terminal multiplexer on the machine
 * @returns {Promise<Readonly<HerdrAvailability>>}
 */
export async function probeHerdr({ env = process.env, connect = connectsToSocket } = {}) {
	const socket = socketPath(env);
	const binary = lookupOnPath(BINARY, env);

	if (binary === null) {
		return answer({
			available: false,
			binary,
			socket,
			reason: "herdr-not-installed",
			command: HERDR_REMEDIES.install,
			message:
				`\`${BINARY}\` is not on PATH. The factory runs every worker attempt as a Herdr pane ` +
				`(§6.4) and checks the multiplexer rather than managing it — ${HERDR_REMEDIES.install}.`,
		});
	}

	if (await connect(socket)) {
		return answer({
			available: true,
			binary,
			socket,
			reason: null,
			command: null,
			message: `Herdr answers on ${socket}.`,
		});
	}

	return answer({
		available: false,
		binary,
		socket,
		reason: "herdr-server-down",
		command: HERDR_REMEDIES.start,
		message:
			`\`${BINARY}\` is installed at ${binary}, but nothing answers on ${socket}. Start it with ` +
			`\`${HERDR_REMEDIES.start}\` (or \`${HERDR_REMEDIES.startHeadless}\` for a headless server), ` +
			"then start the run again.",
	});
}

function answer(fields) {
	return Object.freeze(fields);
}

/**
 * The running server publishes its socket into every pane it manages, so a
 * controller launched into one is told outright (§10.1). Outside a pane, the
 * documented default under the operator's config root is the only other place a
 * socket may be — never guessed at from a process list.
 */
function socketPath(env) {
	const declared = env[SOCKET_ENV];
	if (typeof declared === "string" && declared.length > 0) return declared;

	const configHome = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config");
	return join(configHome, SOCKET_LEAF);
}

/**
 * Connect, and let go. Nothing is written and nothing is read: the question is
 * whether a server is accepting, and a probe that spoke the protocol would be a
 * second, weaker copy of the client §5.1's ingestion owns.
 */
function connectsToSocket(socket) {
	return new Promise((resolve) => {
		const connection = createConnection(socket);
		const settle = (answered) => {
			connection.destroy();
			resolve(answered);
		};

		connection.setTimeout(CONNECT_TIMEOUT_MS, () => settle(false));
		connection.once("connect", () => settle(true));
		connection.once("error", () => settle(false));
	});
}

/** The first executable of that name on `PATH`, or null when it is not there. */
function lookupOnPath(name, env) {
	for (const directory of (env.PATH ?? "").split(delimiter)) {
		if (directory.length === 0) continue;
		const candidate = join(directory, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not here, or not executable here. Either way, keep looking.
		}
	}
	return null;
}
