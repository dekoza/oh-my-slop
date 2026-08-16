import { spawn } from "node:child_process";

import { BINARY } from "./herdr.mjs";

/**
 * The commands the attempt path issues against Herdr: open a pane, stamp it,
 * start an agent, prompt it, list panes, stop an agent.
 *
 * It is separate from `herdr.mjs` on purpose. That module is §10.3's
 * availability *probe*, and the checkable form of "the factory checks the
 * multiplexer, it does not manage one" is that the probe imports no
 * process-spawning API — so the module that does run commands is this one, and
 * the two cannot be confused for each other.
 *
 * Everything here goes through the CLI, which talks to the same socket the
 * probe connects to. §5.1's `events.subscribe` is the one exception and lives
 * in `herdr-events.mjs`, because Herdr does not expose it in the CLI at all.
 *
 * **Herdr exposes no exit code anywhere in its API** (§5.2: `exit_code` occurs
 * once in the whole schema, on plugin command logs), so nothing here can say
 * *how* a worker ended. It answers exactly one question — whether a worker
 * process is alive right now — and the outbox is the completion signal.
 */

/**
 * The one Herdr command runner. **Exit codes are answers, not exceptions** —
 * `pane list` for a pane that is gone and `agent start` refusing a busy pane
 * are both facts a caller judges — so only a command that could not run at all
 * rejects, and that surfaces as exit 1 with the spawn error on stderr.
 *
 * @param {string[]} args
 * @param {{ env?: object, binary?: string }} [where]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export function runHerdr(args, { env, binary = BINARY } = {}) {
	return new Promise((resolve) => {
		const child = spawn(binary, args, {
			// The caller's env is the operator's environment when the CLI carries
			// one; a direct call without one still means "as this shell would run it".
			env: { ...(env ?? process.env) },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) => resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }));
		child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
	});
}

/**
 * The `result` object of a CLI JSON answer, or null when it is not there.
 *
 * Exported because "exit 0 and nothing readable" is a distinct failure from a
 * non-zero exit, and every caller that reads a Herdr answer has to tell them
 * apart: the first means a command ran and the factory learned nothing.
 *
 * @param {string} stdout
 * @returns {object | null}
 */
export function herdrResult(stdout) {
	try {
		return JSON.parse(stdout)?.result ?? null;
	} catch {
		return null;
	}
}

/**
 * §5.5's adoption handle and §14.27's cleanup guard, read off a pane: the
 * `FACTORY_ATTEMPT` token nothing else in the multiplexer uses.
 */
export const FACTORY_ATTEMPT_TOKEN = "FACTORY_ATTEMPT";

/**
 * The metadata source this factory reports under. Herdr requires one on every
 * `report-metadata` call and scopes a clear to it, so a single name means the
 * factory can only ever clear its own tokens.
 */
export const METADATA_SOURCE = "software-factory";

/**
 * How the controller stops an **agent** without closing its **pane** (§13.B).
 *
 * Verified against the installed Herdr (protocol 19): there is no `agent stop`
 * in the CLI and no `agent.stop` in the socket API — `exit_code` aside, the
 * whole agent surface is list/get/read/send-keys/prompt/rename/focus/wait/
 * attach/start/explain. What Herdr does expose is `agent send-keys`, which is
 * exactly the operation §13.B describes: the agent's own interrupt and quit
 * sequence, leaving the pane at its shell prompt. Escalation to a pane kill is
 * superseded, so an agent that ignores these keys leaves a wedged pane, and a
 * wedged pane is evidence reclaimed later by `cleanup-plan`.
 *
 * `esc` first: both runtimes treat it as "interrupt the current turn", and a
 * `ctrl+c` arriving mid-turn is interpreted by neither as "exit".
 */
export const AGENT_STOP_KEYS = Object.freeze(["esc", "ctrl+c", "ctrl+c"]);

/**
 * The typed operations the attempt path performs against Herdr.
 *
 * `run` is injected so a test drives every answer without a multiplexer on the
 * machine — the pattern the runtime probes' transports use one layer down.
 *
 * @param {{ binary?: string, env?: object, run?: Function }} [io]
 * @returns {Readonly<object>}
 */
export function createHerdrControl({ binary = BINARY, env, run = runHerdr } = {}) {
	const call = (args) => run(args, { env, binary });

	/**
	 * Every pane Herdr currently has, with its tokens and agent session. Hoisted
	 * out of the returned object so `paneForAttempt` calls it directly: a method
	 * reaching for `this` would break the moment a caller destructured the
	 * surface, which is exactly how a control object gets used.
	 */
	async function panes() {
		const listed = await call(["pane", "list"]);
		if (listed.exitCode !== 0) return failed("pane list", listed);

		const result = herdrResult(listed.stdout);
		const found = result?.panes ?? result;
		if (!Array.isArray(found)) return unreadable("pane list", listed);

		return Object.freeze({ ok: true, panes: Object.freeze(found) });
	}

	return Object.freeze({
		/**
		 * A workspace of its own per attempt, opened at the attempt's worktree.
		 *
		 * A workspace rather than a split of whatever pane the controller happens
		 * to be in: `factory start --foreground` runs in a terminal that may not be
		 * a Herdr pane at all, and a topology that only works when the controller
		 * was launched detached is a topology that fails on the operator's second
		 * invocation. `--no-focus`, because the operator is watching something else.
		 */
		async openPane({ cwd, label }) {
			const created = await call(["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"]);
			if (created.exitCode !== 0) return failed("workspace create", created);

			const result = herdrResult(created.stdout);
			if (result?.workspace?.workspace_id === undefined || result?.root_pane?.pane_id === undefined) {
				return unreadable("workspace create", created);
			}

			return Object.freeze({
				ok: true,
				workspace: result.workspace.workspace_id,
				tab: result.tab?.tab_id ?? null,
				pane: result.root_pane.pane_id,
				label,
			});
		},

		/**
		 * §5.5's stamp, **before the agent starts**.
		 *
		 * Order matters and is the opposite of the obvious one: a crash between
		 * the pane and the agent must leave a pane the factory can still recognise,
		 * or reconcile concludes nothing ever started while a worker runs on. The
		 * `agent-start` probe asks for the token *and* a live agent, so stamping
		 * early can never make an unstarted agent look started.
		 */
		async stamp(pane, { attempt, title }) {
			// Herdr's report-metadata parser requires the positional pane before its
			// options, despite rendering the positional last in `--help`. With the
			// pane last it consumes the source value as an option and exits 2.
			const stamped = await call([
				"pane",
				"report-metadata",
				pane,
				"--source",
				METADATA_SOURCE,
				"--token",
				`${FACTORY_ATTEMPT_TOKEN}=${attempt}`,
				"--title",
				title,
			]);
			return stamped.exitCode === 0 ? Object.freeze({ ok: true, pane }) : failed("pane report-metadata", stamped);
		},

		/**
		 * §6.5's second identity channel: **environment variables in the pane the
		 * agent will run in.**
		 *
		 * Neither `workspace create` nor `agent start` takes an environment, so
		 * the exports are typed into the pane's own shell before the agent occupies
		 * it — which is also why they survive into everything the worker starts,
		 * rather than only into the harness process. The prompt carries the same
		 * tuple; two channels because a worker that lost track of the prompt can
		 * still read `$FACTORY_ATTEMPT`, and a script it writes can too.
		 *
		 * Every value is single-quoted with the shell's own escape for an embedded
		 * quote. The identity segments are §2.1-charset by construction and the
		 * paths are controller-derived, so this guards against a repository path
		 * with a space in it rather than against a hostile value.
		 */
		async exportIdentity(pane, variables) {
			const exports = Object.entries(variables)
				.map(([name, value]) => `${name}=${shellQuote(String(value))}`)
				.join(" ");
			const exported = await call(["pane", "run", pane, `export ${exports}`]);
			return exported.exitCode === 0 ? Object.freeze({ ok: true, exported }) : failed("pane run", exported);
		},

		/**
		 * §6.4: **an interactive pane, never a headless run.** `agent start`
		 * returns only once Herdr has detected the expected agent in that pane and
		 * considers it ready for input, so a runtime that failed to come up is this
		 * call's non-zero exit rather than a prompt sent into a dead shell.
		 */
		async startAgent({ name, kind, pane, args = [], timeoutMs = null }) {
			const started = await call([
				"agent",
				"start",
				name,
				"--kind",
				kind,
				"--pane",
				pane,
				...(timeoutMs === null ? [] : ["--timeout", String(timeoutMs)]),
				...(args.length === 0 ? [] : ["--", ...args]),
			]);
			return started.exitCode === 0 ? Object.freeze({ ok: true, agent: name }) : failed("agent start", started);
		},

		/**
		 * The first prompt, submitted through the agent surface so text and Enter
		 * arrive atomically under the pane's live bracketed-paste mode. **No
		 * `--wait`**: §6.6's wait is first-signal-wins over the outbox and the
		 * lifecycle stream, and blocking here would make the harness's idea of
		 * "settled" the completion signal instead.
		 */
		async prompt({ target, text }) {
			const sent = await call(["agent", "prompt", target, text]);
			return sent.exitCode === 0 ? Object.freeze({ ok: true }) : failed("agent prompt", sent);
		},

		panes,

		/**
		 * §5.5's correlation, the whole of it: the pane carrying this attempt's
		 * token. `null` when no pane does — which is what a pane that exited looks
		 * like, and is the only fact Herdr is authoritative for (§5.2).
		 */
		async paneForAttempt(attempt) {
			const listed = await panes();
			if (!listed.ok) return listed;

			const pane = listed.panes.find((entry) => entry?.tokens?.[FACTORY_ATTEMPT_TOKEN] === attempt) ?? null;
			return Object.freeze({ ok: true, pane });
		},

		/**
		 * §13.B's stop: the agent's own quit sequence, and nothing that closes a
		 * pane. Whether it worked is not this call's answer — the keys are
		 * delivered or they are not, and *aliveness afterwards* is read back from
		 * `paneForAttempt`, because a harness that ignores its own quit keys is
		 * precisely the case §13.B accepts and records.
		 */
		async stopAgent(target) {
			const sent = await call(["agent", "send-keys", target, ...AGENT_STOP_KEYS]);
			return sent.exitCode === 0 ? Object.freeze({ ok: true }) : failed("agent send-keys", sent);
		},
	});
}

/**
 * §6.5's transcript pointer, **captured from Herdr and never computed.**
 *
 * Herdr persists `AgentSessionInfo {source, agent, kind: "id"|"path", value}`
 * per pane, pushed by the agent's own `SessionStart` hook — Claude reports a
 * session id, pi a literal `.jsonl` path. One seam covers both runtimes, and
 * because worker and reviewer are different panes it disambiguates them *as a
 * fact*; computing the path cannot, since pi keys sessions on cwd and both
 * roles share a worktree.
 *
 * @param {object | null} pane a `PaneInfo` as `pane list` renders it
 * @returns {Readonly<{ kind: string, value: string }> | null}
 */
export function transcriptPointerOf(pane) {
	const session = pane?.agent_session;
	if (session === null || session === undefined) return null;
	if (typeof session.kind !== "string" || typeof session.value !== "string" || session.value.length === 0) return null;
	return Object.freeze({ kind: session.kind, value: session.value });
}

/**
 * Whether a pane hosts a live agent right now — §5.2's one Herdr fact.
 *
 * A pane with no agent is a pane back at its shell prompt, which is what a
 * stopped agent leaves behind (§13.B). `unknown` counts as alive: Herdr's own
 * documentation says it means an agent is present but unclassified, and it
 * "does not prove completion" — reading it as dead would harvest a worker
 * mid-turn.
 */
export function agentAlive(pane) {
	if (pane === null || pane === undefined) return false;
	return typeof pane.agent === "string" && pane.agent.length > 0;
}

/** POSIX single-quoting: everything is literal inside, and `'` closes-escapes-reopens. */
function shellQuote(value) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function failed(command, answer) {
	return Object.freeze({
		ok: false,
		command,
		exit_code: answer.exitCode,
		stderr: answer.stderr.trim() || null,
		message:
			`Herdr refused \`${command}\` (exit ${answer.exitCode})` +
			(answer.stderr.trim() === "" ? "" : `: ${answer.stderr.trim().split("\n").at(-1)}`),
	});
}

function unreadable(command, answer) {
	return Object.freeze({
		ok: false,
		command,
		exit_code: answer.exitCode,
		stderr: answer.stderr.trim() || null,
		message:
			`Herdr's \`${command}\` answered exit ${answer.exitCode} with no readable result, so this controller ` +
			`learned nothing about the multiplexer. Nothing was closed, because nothing here closes anything (§13.B).`,
	});
}

