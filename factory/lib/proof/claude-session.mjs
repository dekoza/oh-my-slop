import { claudeSpellingArguments } from "../worker/claude.mjs";
import { parseJson, runIn } from "../worker/probe.mjs";
import { lineSession } from "../worker/transports.mjs";

/**
 * One §6.7 matrix cell, as a Claude session.
 *
 * **The cell runs the worker binding** (#160), by *calling* the composition
 * §6.2's spelling proof already owns rather than rebuilding it — two builders
 * kept equal by care is precisely what #160 found broken.
 *
 * What the matrix needs past that proof is the *answer*: a real turn, its text,
 * and the tool uses in its trace. Hence a prompt where the probe sends a control
 * request, and hence real tokens.
 */

const realTransport = { lineSession };

/**
 * The argv for one cell. Delegated deliberately: `claudeSpellingArguments` is
 * already "the argv a pane receives, plus the probe-only IO flags", which is
 * the cell binding verbatim.
 *
 * @param {{ pluginDir: string, sessionArgs: ReadonlyArray<string>, profile: object }} cell
 * @returns {string[]}
 */
export function claudeCellArguments({ pluginDir, sessionArgs, profile }) {
	return claudeSpellingArguments(pluginDir, sessionArgs, profile);
}

/**
 * The prompt as the one stream-json frame that carries it.
 *
 * @param {string} prompt
 * @returns {string}
 */
export function claudeCellInput(prompt) {
	return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
}

/**
 * Read a finished session into the runtime-neutral transcript a judgement takes.
 *
 * @param {{ status: number | null, lines: string[], stderr: string, timedOut: boolean }} session
 * @returns {Readonly<object>}
 */
export function readClaudeTranscript(session) {
	const texts = [];
	const toolUses = [];
	let sessionId = null;
	let assistantModel = null;
	let billedModel = null;

	for (const line of session.lines) {
		const frame = parseJson(line);
		if (frame === null) continue;

		if (typeof frame.session_id === "string") sessionId = frame.session_id;

		if (frame.type === "assistant") {
			if (typeof frame.message?.model === "string") assistantModel = frame.message.model;
			for (const block of frame.message?.content ?? []) {
				if (block?.type === "text" && typeof block.text === "string") texts.push(block.text);
				if (block?.type === "tool_use") toolUses.push(Object.freeze({ name: block.name, input: block.input ?? {} }));
			}
		}

		if (frame.type === "result") {
			// §11.7 persists the **observed** resolved id, and `modelUsage` is
			// keyed by it — an alias reaches the assistant frame's `model` field
			// on some versions, so the billed key is read first.
			const billed = Object.keys(frame.modelUsage ?? {});
			if (billed.length > 0) billedModel = billed[0];
			if (typeof frame.result === "string") texts.push(frame.result);
		}
	}

	if (texts.length === 0) {
		return transcript({ answered: false, said: whyNot(session), toolUses, sessionId, resolvedModel: null });
	}

	return transcript({
		answered: true,
		text: texts.join("\n"),
		toolUses,
		sessionId,
		resolvedModel: billedModel ?? assistantModel,
	});
}

/**
 * Run one cell.
 *
 * **A session that could not be spawned is a transcript, not a throw.** One
 * unreachable binary must not lose the cells that would have run after it: the
 * matrix records a whole point on its three axes, or it records a hole where a
 * cell should be, and an exception here produces neither.
 *
 * @param {object} io the transport, `{ lineSession }`
 * @param {{ binary: string, pluginDir: string, sessionArgs: ReadonlyArray<string>, profile: object,
 *   prompt: string, timeoutMs: number, where?: { env?: object, cwd?: string } }} cell
 * @returns {Promise<Readonly<object>>}
 */
export async function runClaudeCell(io, { binary, pluginDir, sessionArgs, profile, prompt, timeoutMs, where = {} }) {
	const transport = { ...realTransport, ...io };
	try {
		const session = await transport.lineSession({
			binary,
			args: claudeCellArguments({ pluginDir, sessionArgs, profile }),
			input: [claudeCellInput(prompt)],
			timeoutMs,
			...runIn(where),
		});
		return readClaudeTranscript(session);
	} catch (error) {
		return transcript({ answered: false, said: error.message, toolUses: [], sessionId: null, resolvedModel: null });
	}
}

/** The session's own words about answering nothing — the probe module's idiom. */
function whyNot(session) {
	if (session.timedOut) return "the session took the argv and answered nothing before its timeout";
	const stderr = session.stderr.trim();
	return `exit ${session.status}` + (stderr === "" ? " with nothing on stderr" : `: ${stderr.split("\n")[0]}`);
}

function transcript({ answered, text = "", toolUses, sessionId, resolvedModel, said = null }) {
	return Object.freeze({
		answered,
		text,
		toolUses: Object.freeze([...toolUses]),
		sessionId,
		resolvedModel,
		said,
	});
}
