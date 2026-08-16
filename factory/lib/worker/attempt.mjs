import { join } from "node:path";

import { PHASES } from "../domain/vocabulary.mjs";
import { containPath, PATH_REFUSALS } from "../identity/paths.mjs";
import { runStream } from "../state/events.mjs";
import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.5's correlation, as names and locations: **the controller mints
 * `{run_id, ticket, phase, attempt_id}` before launch**, and everything the
 * attempt is addressed by afterwards is derived from that tuple deterministically.
 *
 * Derivation rather than allocation is what makes correlation survive a crash:
 * a re-entered attempt recomputes its own outbox path, its own manifest path,
 * and its own Herdr agent name without reading anything, so a controller that
 * died between the launch and its record can still find what it started. It is
 * also why the probes can settle an `agent-start` effect from the key alone.
 *
 * **The controller-owned location is `<state_root>/attempts/<attempt_id>/`** —
 * beside `state.db`, next to the private clone and the worktrees, and outside
 * the worktree by construction (§6.6). Nothing in it is an effect: it is
 * factory infrastructure like the bare clone, the manifest and the prompt being
 * evidence the controller writes about itself and the outbox being the one file
 * the worker writes.
 */

/** The directory every attempt's controller-owned files hang under (§4.1's peers). */
const ATTEMPTS_SEGMENT = "attempts";

/** The outbox, the manifest, and the prompt, as the attempt directory holds them. */
const OUTBOX_LEAF = "outbox.json";
const MANIFEST_LEAF = "manifest.json";
const PROMPT_LEAF = "prompt.md";

/**
 * Herdr's own rule for a live agent name, quoted from its CLI: `[a-z][a-z0-9_-]{0,31}`,
 * unique among live agents. An attempt id satisfies neither bound — a ULID leads
 * with a digit and the tuple runs past 32 characters — so the name is derived
 * from it rather than being it, and the *token* stays the correlation handle.
 */
const HERDR_AGENT_NAME_SHAPE = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * How much of the run id the agent name keeps. A ULID's last ten characters are
 * from its random half, so two runs live in one multiplexer at once collide only
 * by 50 bits of coincidence — and a collision costs a refused `agent start`,
 * never a misattributed result, because the token is what identifies an attempt.
 */
const RUN_SUFFIX_LENGTH = 10;

/** @param {string} storeDir @returns {string} */
export function attemptsRoot(storeDir) {
	return join(storeDir, ATTEMPTS_SEGMENT);
}

/**
 * One attempt's controller-owned directory, contained by §2.1's two checks.
 *
 * @param {string} storeDir the repository's store directory (`store.storeDir`)
 * @param {string} attempt the attempt id
 * @returns {string}
 * @throws {FactoryWorkerError} `attempt-identity-invalid`
 */
export function attemptDir(storeDir, attempt) {
	const contained = containPath(attemptsRoot(storeDir), attempt);
	if (contained.ok) return contained.path;

	throw refuseIdentity(
		contained.reason === PATH_REFUSALS.charset
			? `Attempt id ${JSON.stringify(attempt ?? null)} is not an identity segment (§2.1), so it names no controller-owned directory.`
			: `Attempt ${attempt} derives a directory outside ${attemptsRoot(storeDir)} (§2.1); refusing ${contained.found}.`,
		{ at: "attempt", found: contained.found, expected: contained.expected },
	);
}

/**
 * §6.6's outbox path: **controller-designated, outside the worktree.**
 *
 * Outside is structural rather than a rule anyone follows — the attempts root
 * and the worktrees root are siblings under the state directory — which is what
 * keeps a `git clean` in the worktree, or the eager worktree deletion §12.7
 * performs on an integrated success, from taking the result with it.
 */
export function attemptOutboxPath(storeDir, attempt) {
	return join(attemptDir(storeDir, attempt), OUTBOX_LEAF);
}

/** §6.5's attempt manifest, in the controller-owned location. */
export function attemptManifestPath(storeDir, attempt) {
	return join(attemptDir(storeDir, attempt), MANIFEST_LEAF);
}

/**
 * The rendered first prompt, kept beside the manifest as evidence.
 *
 * §6.4 makes the prompt deterministic, so this file is reproducible rather than
 * unique — but an incident review asking "what exactly did the worker see?"
 * should not have to re-render it from a template that has since changed.
 */
export function attemptPromptPath(storeDir, attempt) {
	return join(attemptDir(storeDir, attempt), PROMPT_LEAF);
}

/**
 * §2.1's attempt id, built from its parts rather than spelled by a caller.
 *
 * @param {{ run: string, ticket: number, ordinal: number }} parts
 * @returns {string} `<run>-t<ticket>-a<n>`
 * @throws {FactoryWorkerError} `attempt-identity-invalid`
 */
export function attemptIdOf({ run, ticket, ordinal }) {
	if (typeof run !== "string" || run.length === 0) {
		throw refuseIdentity(`An attempt id names its run; found ${JSON.stringify(run ?? null)} (§2.1).`, { at: "run" });
	}
	if (!Number.isSafeInteger(ticket) || ticket <= 0) {
		throw refuseIdentity(`An attempt id names a positive issue number; found ${JSON.stringify(ticket ?? null)}.`, {
			at: "ticket",
		});
	}
	if (!Number.isSafeInteger(ordinal) || ordinal <= 0) {
		throw refuseIdentity(`An attempt ordinal is a positive integer; found ${JSON.stringify(ordinal ?? null)}.`, {
			at: "ordinal",
		});
	}
	return `${run}-t${ticket}-a${ordinal}`;
}

/**
 * §6.5's minted tuple, checked once so nothing downstream re-derives it.
 *
 * The consistency check is the point: an attempt id that does not name the run
 * and ticket beside it would put one ticket's identity on another's branch,
 * pane, and outbox — and every one of those is read by a human during an
 * incident.
 *
 * @param {{ run: string, ticket: number, phase: string, attempt: string }} tuple
 * @returns {Readonly<{ run: string, ticket: number, phase: string, attempt: string, ordinal: number }>}
 * @throws {FactoryWorkerError} `attempt-identity-invalid`
 */
export function requireAttemptIdentity({ run, ticket, phase, attempt }) {
	if (!PHASES.includes(phase)) {
		throw refuseIdentity(`An attempt runs in one of §2.2's phases; found ${JSON.stringify(phase ?? null)}.`, {
			at: "phase",
			found: phase ?? null,
			expected: PHASES.join("|"),
		});
	}

	const ordinal = ordinalOf(attempt);
	if (ordinal === null || attemptIdOf({ run, ticket, ordinal }) !== attempt) {
		throw refuseIdentity(
			`Attempt id ${JSON.stringify(attempt ?? null)} does not name run ${JSON.stringify(run ?? null)} ticket ` +
				`${JSON.stringify(ticket ?? null)} (§2.1). The tuple is minted once and read off every derived name.`,
			{ at: "attempt", found: attempt ?? null, expected: `${run}-t${ticket}-a<n>` },
		);
	}

	return Object.freeze({ run, ticket, phase, attempt, ordinal });
}

/**
 * Whether this attempt has already been launched in this store.
 *
 * A launched attempt is never launched again: §5.5 reads "every resume is a
 * fresh attempt" as *a failed or abandoned attempt is never continued*, and a
 * still-running one is adopted rather than restarted (#114). Re-launching would
 * put a second worker on one worktree, which §14.23 forbids outright.
 *
 * @param {object} store an open store
 * @param {string} attempt
 * @returns {object | null} the projected attempt row, or null
 */
export function launchedAttempt(store, attempt) {
	const rows = store.readAttempts({ runId: runOf(attempt), ticket: ticketOf(attempt) });
	return rows.find((row) => row.attempt_id === attempt) ?? null;
}

/**
 * §2.1's ordinal, **allocated against the record rather than derived from a
 * neighbour.**
 *
 * The ordinal is per *ticket execution*, and more than one thing mints into that
 * one space: §8.5's two tiers answer a failed builder attempt, and §8.4's review
 * fans out into two more attempts of its own. "One past the attempt I am
 * answering" is only correct while a single line of attempts exists — the moment
 * review mints two, a repair planned that way lands on a reviewer's id, finds its
 * branch and worktree effects already resolved, and re-enters a phase whose
 * result is recorded under that id. §8.10 then reads the working pipeline as its
 * own conflicting duplicate and fails the ticket. So the allocation reads the
 * record: **one past the highest ordinal this ticket execution has ever minted.**
 *
 * **Idempotency is the minter's purpose, not the counter's.** A caller says what
 * it is minting *for*; if a record already names that purpose the same id comes
 * back, so a controller that died between the mint and the work it opened
 * re-enters onto the attempt it already has rather than allocating a second one.
 *
 * @param {object} store an open store
 * @param {object} where
 * @param {string} where.run
 * @param {number} where.ticket
 * @param {(payload: object, record: object) => boolean} where.mintedFor the
 *   purpose predicate, read against each `attempt.launched` payload of this
 *   ticket execution
 * @returns {Readonly<{ attempt: string, ordinal: number, state: string }>}
 *   `state` is `already-minted` or `allocated`
 */
export function allocateAttempt(store, { run, ticket, mintedFor }) {
	const minted = store
		.readEvents({ stream: runStream(run), kind: "attempt.launched" })
		.filter((record) => record.ticket === ticket);

	// The last rather than the first: a purpose that can repeat — a review axis
	// retried on the automation budget — names its own try, so at most one record
	// matches. Where a caller's predicate is looser, the most recent mint is the
	// one its work is open under.
	const existing = minted.findLast((record) => mintedFor(record.payload, record));
	if (existing !== undefined) {
		return Object.freeze({ attempt: existing.attempt, ordinal: ordinalOf(existing.attempt), state: "already-minted" });
	}

	const ordinal = minted.reduce((highest, record) => Math.max(highest, ordinalOf(record.attempt) ?? 0), 0) + 1;
	return Object.freeze({ attempt: attemptIdOf({ run, ticket, ordinal }), ordinal, state: "allocated" });
}

/**
 * The Herdr agent name for one attempt: deterministic, inside Herdr's own
 * charset, and recomputable from the attempt id alone (§6.5).
 *
 * @param {string} attempt
 * @returns {string}
 * @throws {FactoryWorkerError} `attempt-identity-invalid`
 */
export function herdrAgentName(attempt) {
	const run = runOf(attempt);
	const ticket = ticketOf(attempt);
	const ordinal = ordinalOf(attempt);
	if (run === null || ticket === null || ordinal === null) {
		throw refuseIdentity(`${JSON.stringify(attempt ?? null)} is not a §2.1 attempt id, so it names no Herdr agent.`, {
			at: "attempt",
			found: attempt ?? null,
		});
	}

	// Lowercased because Herdr's charset is, and a ULID's Crockford base32 is
	// upper. The leading letter is a literal: a ULID may begin with a digit.
	const name = `f${run.slice(-RUN_SUFFIX_LENGTH).toLowerCase()}t${ticket}a${ordinal}`;
	if (HERDR_AGENT_NAME_SHAPE.test(name)) return name;

	throw refuseIdentity(
		`Attempt ${attempt} derives the Herdr agent name ${JSON.stringify(name)}, which Herdr's own rule ` +
			`(${HERDR_AGENT_NAME_SHAPE}) refuses. The name is derived, so this is a mint the factory must not make.`,
		{ at: "attempt", found: name, expected: String(HERDR_AGENT_NAME_SHAPE) },
	);
}

/**
 * The pane title one attempt's pane carries — display-only metadata, so the
 * operator scanning a workspace list reads the tuple rather than a shell prompt.
 */
export function herdrPaneTitle(attempt) {
	return `factory ${attempt}`;
}

/** The run half of an attempt id, or null when it is not one. */
export function runOf(attempt) {
	const match = /^(.+)-t[1-9][0-9]*-a[1-9][0-9]*$/.exec(attempt ?? "");
	return match === null ? null : match[1];
}

/** The ticket half of an attempt id, or null when it is not one. */
export function ticketOf(attempt) {
	const match = /-t([1-9][0-9]*)-a[1-9][0-9]*$/.exec(attempt ?? "");
	return match === null ? null : Number.parseInt(match[1], 10);
}

/** The ordinal half of an attempt id, or null when it is not one. */
export function ordinalOf(attempt) {
	const match = /-t[1-9][0-9]*-a([1-9][0-9]*)$/.exec(attempt ?? "");
	return match === null ? null : Number.parseInt(match[1], 10);
}

function refuseIdentity(sentence, details) {
	return new FactoryWorkerError("attempt-identity-invalid", sentence, details);
}
