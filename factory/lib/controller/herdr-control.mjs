import { spawn } from "node:child_process";

import { BINARY } from "./herdr.mjs";

/**
 * The commands the run and its attempts issue against Herdr: open the run's
 * workspace, open a tab in it under the worker's environment, stamp that tab's
 * pane, start an agent, prompt it, list panes, stop an agent.
 *
 * **Only two of them take an environment.** `workspace create` and `tab create`
 * carry `--env KEY=VALUE` in Herdr 0.8.0; `agent start` has none, in the CLI or
 * in the socket API. That is the whole reason the worker's binding is assembled
 * at the tab (#157) — it is the last point before the agent at which anything
 * can be put in front of it.
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
		const listed = await listOf(["pane", "list"], "panes");
		return listed.ok ? Object.freeze({ ok: true, panes: listed.entries }) : listed;
	}

	/**
	 * One `<thing> list` command, read the same way for every thing.
	 *
	 * The `result?.<key> ?? result` shrug is Herdr's envelope quirk — a list
	 * answer is sometimes the array itself — and it belongs in one place: a
	 * second spelling of it is a second thing to correct when the envelope
	 * settles down.
	 */
	async function listOf(args, key) {
		const command = args.join(" ");
		const listed = await call(args);
		if (listed.exitCode !== 0) return failed(command, listed);

		const result = herdrResult(listed.stdout);
		const entries = result?.[key] ?? result;
		if (!Array.isArray(entries)) return unreadable(command, listed);

		return Object.freeze({ ok: true, entries: Object.freeze(entries) });
	}

	return Object.freeze({
		/**
		 * **The run's** workspace, opened once and shared by every attempt of that
		 * run (#156).
		 *
		 * A workspace rather than a split of whatever pane the controller happens
		 * to be in: `factory start --foreground` runs in a terminal that may not be
		 * a Herdr pane at all, and a topology that only works when the controller
		 * was launched detached is a topology that fails on the operator's second
		 * invocation. That argument rules out the controller's own pane; it never
		 * argued for one workspace *per attempt*, and the workspace list is the
		 * operator's top-level navigation — four workspaces for one ticket, filed
		 * among their real projects, is what the run-scoped one replaces.
		 * `--no-focus`, because the operator is watching something else.
		 */
		async openWorkspace({ cwd, label }) {
			const created = await call(["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"]);
			if (created.exitCode !== 0) return failed("workspace create", created);

			// The id and nothing else. Herdr answers with the workspace's root tab
			// and root pane too, but no attempt runs in them — every attempt gets a
			// tab of its own — and gating on a field nobody reads would turn a
			// created workspace into a launch failure over an unused key.
			const result = herdrResult(created.stdout);
			if (result?.workspace?.workspace_id === undefined) return unreadable("workspace create", created);

			return Object.freeze({ ok: true, workspace: result.workspace.workspace_id, label });
		},

		/**
		 * One attempt's pane: **a tab in the run's workspace**, at the attempt's
		 * worktree (§6.4, #156).
		 *
		 * The answer shape is the installed Herdr's own, read off a live
		 * `tab create` (0.8.0): a `tab` and its `root_pane`, and no `workspace` —
		 * the tab was created in one. A workspace this controller no longer has is
		 * exit 1 with `workspace_not_found`, and that is reported rather than
		 * repaired: an operator who closed the run's workspace ends its live lanes,
		 * which is #156's stated cost, and opening a replacement behind their back
		 * would re-create the topology they closed.
		 *
		 * **`env` is §6.5's identity and §6.8's session binding, declared to the
		 * server rather than typed at the pane** (#157). Herdr 0.8.0 sets them on
		 * the shell it launches for the tab, and an agent `agent start` puts in that
		 * shell later inherits them — established live before this path replaced the
		 * typed one (`tests/live/herdr-tab-env-reaches-agent.mjs`), because whether
		 * the agent *process* or only the shell sees them is exactly the assumption
		 * this repository probes rather than believes. Each value crosses as one
		 * argv element, so nothing here quotes anything: a space or an apostrophe in
		 * a path is the CLI's problem, and it does not have one.
		 */
		async openTab({ workspace, cwd, label, env = {} }) {
			const created = await call([
				"tab",
				"create",
				"--workspace",
				workspace,
				"--cwd",
				cwd,
				"--label",
				label,
				...Object.entries(env).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
				"--no-focus",
			]);
			if (created.exitCode !== 0) return failed("tab create", created);

			const result = herdrResult(created.stdout);
			if (result?.tab?.tab_id === undefined || result?.root_pane?.pane_id === undefined) {
				return unreadable("tab create", created);
			}

			return Object.freeze({
				ok: true,
				workspace,
				tab: result.tab.tab_id,
				pane: result.root_pane.pane_id,
				label,
			});
		},

		/**
		 * The workspace carrying a given label, or `null` when none does — which is
		 * what a workspace the operator closed looks like.
		 *
		 * The label is how a run's workspace is recognised at all: Herdr's answers
		 * carry no metadata tokens on a workspace the way they do on a pane, so the
		 * deterministic label is the only handle a probe has on a workspace whose
		 * id was never recorded (§5.3). The list is asked for and filtered here
		 * rather than handed out, because that identity question is the only one
		 * anything has of the workspace list.
		 */
		async workspaceLabelled(label) {
			const listed = await listOf(["workspace", "list"], "workspaces");
			if (!listed.ok) return listed;

			return Object.freeze({ ok: true, workspace: listed.entries.find((entry) => entry?.label === label) ?? null });
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

		/**
		 * §6.6's progress half, sampled: the pane's own terminal output. Herdr
		 * exposes no output stream in `events.subscribe` — the subscribed kinds are
		 * the pane-lifecycle three — so growth is read here, on the CLI, and judged
		 * by the caller against its last snapshot rather than trusted to be
		 * monotonic (#150).
		 *
		 * Bounded deliberately: §6.6 sends large output to artifacts, and the
		 * recent-window digest only has to *differ* from the last one to be
		 * progress, so the whole scrollback is never read into the controller.
		 */
		async readPaneOutput(pane, { lines = 200 } = {}) {
			const read = await call(["pane", "read", pane, "--raw", "--lines", String(lines)]);
			if (read.exitCode !== 0) return failed("pane read", read);
			return Object.freeze({ ok: true, text: read.stdout, bytes: read.stdout.length });
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

