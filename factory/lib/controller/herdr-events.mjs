import { createConnection } from "node:net";

/**
 * §5.1's **subscribe, don't poll** — the NDJSON socket client Herdr's CLI does
 * not give us.
 *
 * A poll structurally cannot see `working → blocked → working` between two
 * samples, and "the worker asked a question and then carried on" is exactly the
 * transition an operator needs. So agent-status transitions are **recorded as
 * events, not sampled**, and this is the one place a frame becomes one.
 *
 * **Degradation is loud.** If the socket is unavailable the watch falls back to
 * polling *and* emits a typed `observation.degraded` — silent degradation would
 * be indistinguishable from a well-behaved worker, which is the failure mode
 * that makes an operator trust a screen that has stopped telling them anything.
 *
 * The protocol, verified live against protocol 19: a request line
 * `{id, method, params}`, an acknowledgement `{id, result: {type:
 * "subscription_started"}}`, then frames `{event, data}`. Two of the three
 * subscriptions this opens are server-wide — only `pane.agent_status_changed`
 * takes a `pane_id` filter — so every frame is matched against the pane on the
 * way in rather than trusted to be ours.
 */

/**
 * The three §5.1 names, dotted to subscribe. Herdr's wire spelling is
 * inconsistent — measured live against protocol 19, `pane.exited` and
 * `pane.agent_detected` arrive underscored while `pane.agent_status_changed`
 * arrives dotted — so matching is by `EVENT_SPELLINGS` below, never by guessing
 * one form (#149).
 */
export const SUBSCRIBED_EVENTS = Object.freeze(["pane.agent_status_changed", "pane.exited", "pane.agent_detected"]);

/** How often the degraded path samples. Herdr's own tempo, not the tracker's 15s. */
export const DEGRADED_POLL_INTERVAL_MS = 2_000;

/**
 * How long the watch waits before **re-subscribing by pane id** after the
 * socket goes away, growing to a ceiling it then keeps.
 *
 * §5.1 is explicit that *pane ids are persisted in `session.json` v3, stable
 * across a Herdr server restart, and never reused* — which is exactly what makes
 * re-subscription possible: the watch does not have to rediscover anything, it
 * asks for the same pane again. A server restart is otherwise a permanent
 * demotion to polling, and a poll structurally cannot see `working → blocked →
 * working` between two samples, which is the whole reason §5.1 subscribes.
 *
 * Polling stays up for the whole gap. The socket coming back is what ends the
 * degradation, so a server that never returns costs one sampler and a retry
 * every ten seconds rather than a watch that quietly stopped.
 */
export const RESUBSCRIBE_BACKOFF_MS = Object.freeze([250, 1_000, 3_000, 10_000]);

/**
 * Watch one pane's lifecycle.
 *
 * @param {object} input
 * @param {string} input.pane the pane id to watch
 * @param {string} input.socket the Herdr socket path
 * @param {(transition: object) => void} input.onTransition one observed change
 * @param {(degradation: object) => void} input.onDegraded the typed fallback notice
 * @param {(unrecognised: { pane: string, event: string | null }) => void} [input.onUnrecognised]
 *   a frame for this pane whose event name the build does not know — loud, never
 *   the same silent null that means "another pane's frame"
 * @param {(resubscribed: { pane: string, attempts: number }) => void} [input.onResubscribed]
 *   the subscription re-established after the socket went away (#114, §5.1)
 * @param {(socket: string) => object} [input.connect] injectable stream opener
 * @param {(() => Promise<object>) | null} [input.poll] the degraded sampler — the
 *   `paneForAttempt` read, injected so this module holds no CLI knowledge
 * @param {number} [input.intervalMs]
 * @param {ReadonlyArray<number>} [input.resubscribeBackoffMs]
 * @param {{ setInterval: Function, clearInterval: Function, setTimeout: Function, clearTimeout: Function }} [input.timers]
 * @returns {Readonly<{ close: () => void, degraded: () => boolean, resubscribes: () => number }>}
 */
export function watchPane({
	pane,
	socket,
	onTransition,
	onDegraded,
	onUnrecognised = null,
	onResubscribed = null,
	connect = connectToSocket,
	poll = null,
	intervalMs = DEGRADED_POLL_INTERVAL_MS,
	resubscribeBackoffMs = RESUBSCRIBE_BACKOFF_MS,
	timers = { setInterval, clearInterval, setTimeout, clearTimeout },
}) {
	let closed = false;
	let degraded = false;
	let last = null;
	let sampler = null;
	let stream = null;
	let retry = null;
	let attempts = 0;

	/**
	 * A confirmation of no change emits nothing (§5.1) — the controller
	 * heartbeat's "watching N panes" is what keeps *quiet* distinguishable from
	 * *stopped watching*. So the last observed status is remembered here and only
	 * a difference is reported.
	 */
	function transition(observed) {
		if (closed) return;
		if (last !== null && last.status === observed.status && last.alive === observed.alive) return;
		const from = last;
		last = observed;
		onTransition(Object.freeze({ ...observed, from: from === null ? null : from.status }));
	}

	/**
	 * The notice and the fallback are **once per degradation**; the retry is
	 * scheduled on every one, because a reconnection that failed has to lead to
	 * the next attempt rather than to a watch that quietly gave up.
	 */
	function degrade(reason, detail) {
		if (closed) return;

		if (!degraded) {
			degraded = true;
			onDegraded(Object.freeze({ source: "herdr", reason, detail, fallback: "polling", interval_ms: intervalMs }));

			if (poll !== null && sampler === null) {
				sampler = timers.setInterval(async () => {
					const sampled = await poll();
					if (!sampled?.ok) return;
					transition(fromPane(sampled.pane, "poll"));
				}, intervalMs);
				sampler?.unref?.();
			}
		}

		resubscribe();
	}

	/**
	 * §5.1's re-establishment, **by pane id**. The id outlives a Herdr server
	 * restart and is never reused, so the watch asks for the same pane rather
	 * than rediscovering one — and the poll keeps answering about it until the
	 * socket takes the question back.
	 */
	function resubscribe() {
		// One retry in flight at a time: a stream that reports both `error` and
		// `close` degrades twice for one failure, and two retries for it would
		// halve the backoff every time the socket flapped.
		if (closed || retry !== null || resubscribeBackoffMs.length === 0) return;
		const wait = resubscribeBackoffMs[Math.min(attempts, resubscribeBackoffMs.length - 1)];
		attempts += 1;
		retry = timers.setTimeout(() => {
			retry = null;
			if (!closed) open();
		}, wait);
		retry?.unref?.();
	}

	/**
	 * The subscription is back. Polling stops here rather than staying up beside
	 * it: two sources feeding one `transition` would double-report nothing (the
	 * no-change filter drops repeats), but the fault attribution would be wrong —
	 * §6.6 charges the automation for a no-progress verdict reached while the
	 * observation channel is degraded, and a channel that recovered is not.
	 */
	function recover() {
		if (!degraded) return;
		degraded = false;
		if (sampler !== null) {
			timers.clearInterval(sampler);
			sampler = null;
		}
		onResubscribed?.(Object.freeze({ source: "herdr", pane, attempts }));
	}

	/**
	 * One connection to the socket, wired. Called for the first subscription and
	 * for every re-subscription after it — the frames, the filter, and the
	 * request are identical, because it is the same question about the same pane.
	 */
	function open() {
		const previous = stream;
		let opened;
		try {
			opened = connect(socket);
		} catch (error) {
			degrade("socket-unavailable", error.message);
			return;
		}

		stream = opened;
		// A refused subscription degrades a stream that is still open, so the
		// connection this one replaces has to be let go of here rather than left
		// to the garbage collector holding a socket.
		if (previous !== null && previous !== opened) previous.destroy?.();
		let buffer = "";
		// A quiet socket at subscribe time is a **calm worker**, not a broken one.
		// There is no "answered within N ms" guard: node's socket timeout can fire
		// before `connect` when the loop is blocked, which degraded a healthy socket
		// 80 ms before its first frame in #149's live run. Degradation means the
		// socket failed — connect error, stream error, close, or a refused
		// subscription — and nothing else (§5.1).
		opened.once("connect", () => {
			opened.write(`${JSON.stringify(subscribeRequest(pane))}\n`);
			recover();
		});
		opened.on("data", (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				const frame = parse(line);
				if (frame === null) continue;
				if (frame.error !== undefined) {
					degrade("subscription-refused", frame.error?.message ?? "the socket refused the subscription");
					continue;
				}
				const observed = fromFrame(frame, pane);
				if (observed === null) continue;
				if (observed === UNRECOGNISED) {
					onUnrecognised?.(Object.freeze({ pane, event: frame.event ?? null }));
					continue;
				}
				transition(observed);
			}
		});
		// A connection this watch has already replaced says nothing about the one
		// it is on now: its late `close` is the old socket finishing dying, not the
		// new one failing.
		opened.once("error", (error) => {
			if (opened === stream) degrade("socket-unavailable", error.message);
		});
		// A server restart drops the connection; pane ids survive it (§5.1), so the
		// watch re-subscribes for the same pane and polls in the meantime, rather
		// than going quiet and letting the controller read that as a well-behaved
		// worker.
		opened.once("close", () => {
			if (opened === stream) degrade("socket-closed", "the Herdr server closed the subscription");
		});
	}

	open();

	return Object.freeze({
		close() {
			closed = true;
			if (sampler !== null) timers.clearInterval(sampler);
			if (retry !== null) timers.clearTimeout(retry);
			stream?.destroy?.();
		},
		degraded: () => degraded,
		/** How many re-subscriptions this watch has scheduled (§5.1, #114). */
		resubscribes: () => attempts,
	});
}

/** @param {string} pane */
export function subscribeRequest(pane) {
	return {
		id: `factory-watch-${pane}`,
		method: "events.subscribe",
		params: {
			// `pane.agent_status_changed` is the one that takes a filter; the other
			// two are server-wide, and `fromFrame` drops whatever is not this pane's.
			subscriptions: SUBSCRIBED_EVENTS.map((type) =>
				type === "pane.agent_status_changed" ? { type, pane_id: pane } : { type },
			),
		},
	};
}

/**
 * The three §5.1 events, each in Herdr's two spellings: dotted to subscribe,
 * and whichever the wire happens to use. Both forms map to the same handler, so
 * a server that changes one spelling is not a second silent outage (#149).
 */
const EVENT_SPELLINGS = Object.freeze({
	"pane.exited": "pane_exited",
	"pane.agent_detected": "pane_agent_detected",
	"pane.agent_status_changed": "pane_agent_status_changed",
});

/** Every accepted spelling → its canonical dotted name. */
const KNOWN_EVENTS = new Map(
	Object.entries(EVENT_SPELLINGS).flatMap(([dotted, underscored]) => [
		[dotted, dotted],
		[underscored, dotted],
	]),
);

/**
 * Returned by `fromFrame` for a frame that **is** this pane's but matches no
 * known event. Distinct from `null`, which is the silent filter for somebody
 * else's pane and for acknowledgements — the two must never be the same answer
 * (§5.1, §11.2).
 */
export const UNRECOGNISED = Symbol("unrecognised-frame");

/**
 * One frame, as an observation about this pane — `null` when it is somebody
 * else's or an acknowledgement rather than an event, and `UNRECOGNISED` when it
 * is this pane's but matches no known event.
 *
 * `pane.exited` is the one frame that says a worker is gone, and it is the only
 * thing in Herdr's whole API that comes close to a termination signal — it
 * still carries **no exit code** (§5.2), so it says *that* the process ended
 * and never *how*.
 *
 * @param {object} frame
 * @param {string} pane
 * @returns {Readonly<object> | null | typeof UNRECOGNISED}
 */
export function fromFrame(frame, pane) {
	const data = frame?.data;
	if (data?.pane_id !== pane) return null;

	switch (KNOWN_EVENTS.get(frame?.event)) {
		case "pane.exited":
			return Object.freeze({ status: "exited", agent: null, alive: false, source: "subscribe", event: frame.event });
		case "pane.agent_detected":
			return Object.freeze({
				// A detection carrying `released: true` is the agent leaving the pane,
				// which is what an ordinary quit looks like from outside.
				status: data.released === true ? "released" : (data.final_status ?? "unknown"),
				agent: data.agent ?? null,
				alive: data.released !== true && typeof data.agent === "string",
				source: "subscribe",
				event: frame.event,
			});
		case "pane.agent_status_changed":
			return Object.freeze({
				status: data.agent_status,
				agent: data.agent ?? null,
				// Herdr's `unknown` means "an agent is present but unclassified" and its
				// own documentation says it does not prove completion, so it is alive.
				alive: typeof data.agent === "string" && data.agent.length > 0,
				source: "subscribe",
				event: frame.event,
			});
		default:
			return UNRECOGNISED;
	}
}

/** The same observation, read off a sampled `PaneInfo` on the degraded path. */
export function fromPane(pane, source = "poll") {
	if (pane === null || pane === undefined) {
		return Object.freeze({ status: "exited", agent: null, alive: false, source, event: null });
	}
	return Object.freeze({
		status: pane.agent_status ?? "unknown",
		agent: pane.agent ?? null,
		alive: typeof pane.agent === "string" && pane.agent.length > 0,
		source,
		event: null,
	});
}

function parse(line) {
	if (line.trim() === "") return null;
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function connectToSocket(socket) {
	return createConnection(socket);
}
