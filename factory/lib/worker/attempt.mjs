import { join } from "node:path";

import { PHASES } from "../domain/vocabulary.mjs";
import { attemptBranch, attemptWorktreePath } from "../git/isolation.mjs";
import { containPath, PATH_REFUSALS } from "../identity/paths.mjs";
import { canonicalJson, runStream } from "../state/events.mjs";
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
 * **What actually ran each attempt of one ticket execution** (#155): the role,
 * the profile it was dispatched under, and what §11.5 declared for it.
 *
 * One reader, because two consumers ask the same question of the same records
 * for the same reason. §8.9's disposition block names what did the work, and a
 * reroute bounds itself on what this execution has already spent — and a green
 * ticket that cannot answer "what wrote this?" is the auditing hole a silent
 * substitution opens.
 *
 * It is a pure function of durable state, which is what lets it ride §8.9's
 * digested intent rather than the comment prose beside it (#151's split): a
 * re-entered settlement recomputes it exactly.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number }} where
 * @returns {ReadonlyArray<Readonly<{ attempt: string, role: string, profile: string | null,
 *   declared: string | null, rerouted: boolean, reason: string | null }>>} in mint order
 */
export function dispatchedAttempts(store, { run, ticket }) {
	return Object.freeze(
		store
			.readEvents({ stream: runStream(run), kind: "attempt.launched" })
			.filter((record) => record.ticket === ticket)
			.map((record) =>
				Object.freeze({
					attempt: record.attempt,
					role: record.payload.role,
					profile: record.payload.profile ?? null,
					// `null` on a **pinned** attempt rather than a copy of the profile:
					// §8.5's repair and §8.10's automation retry made no dispatch
					// decision, and saying they declared what they ran would read as a
					// routing that happened to land where the pin already was.
					declared: record.payload.routing?.declared ?? null,
					rerouted: record.payload.routing?.rerouted ?? false,
					reason: record.payload.routing?.reason ?? null,
				}),
			),
	);
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
 * it is minting *for* — §8.5's tier and the attempt it answers, §8.4's axis, work
 * and try — and if a record already names that purpose the same id comes back, so
 * a controller that died between the mint and the work it opened re-enters onto
 * the attempt it already has rather than allocating a second one. The purpose is
 * the same object `mintAttempt` writes into the record, so the key that is
 * matched and the key that was written cannot come to be spelled differently.
 *
 * @param {object} store an open store
 * @param {object} where
 * @param {string} where.run
 * @param {number} where.ticket
 * @param {object} where.purpose why this attempt is being minted, as `mintAttempt`
 *   records it
 * @returns {Readonly<{ attempt: string, ordinal: number, state: string }>}
 *   `state` is `already-minted` or `allocated`
 */
export function allocateAttempt(store, { run, ticket, purpose }) {
	const minted = store
		.readEvents({ stream: runStream(run), kind: "attempt.launched" })
		.filter((record) => record.ticket === ticket);

	// The last rather than the first: a purpose that can repeat — a review axis
	// retried on the automation budget — names its own try, so at most one record
	// matches, and the most recent is the one whose work is open.
	const existing = minted.findLast((record) => mintsPurpose(record.payload, purpose));
	if (existing !== undefined) {
		return Object.freeze({ attempt: existing.attempt, ordinal: ordinalOf(existing.attempt), state: "already-minted" });
	}

	const ordinal = minted.reduce((highest, record) => Math.max(highest, ordinalOf(record.attempt) ?? 0), 0) + 1;
	return Object.freeze({ attempt: attemptIdOf({ run, ticket, ordinal }), ordinal, state: "allocated" });
}

/**
 * Every attempt one ticket execution minted, as the identities a git read of
 * their branches needs (#151).
 *
 * **The branch is derived, never read off the payload.** §7.3 mints it
 * deterministically from `(ticket, attempt)`, so deriving it here means a journal
 * record cannot point a later read at a ref the attempt never owned — the same
 * reason `git/probes.mjs` recomputes a probe's target from the effect's identity.
 *
 * The base commit has no such second source: it is what §7.2 pinned for this
 * attempt, and for a repair it is the prior attempt's tip (§8.5) — which is why a
 * count against the run's base would credit a repair with the work it branched
 * from (§7.4). A record minted before the field existed carries `null`, and a
 * reader says so rather than counting from somewhere else (§11.2).
 *
 * It lives here rather than beside the git read because **this is the journal
 * half**: §5.2 makes the journal intent only, and the two halves are separate
 * functions so the seam between "which attempts exist" and "what their refs are
 * now" is visible in the signatures rather than buried in one call.
 *
 * @param {object} store an open store
 * @param {{ run: string, ticket: number }} where
 * @returns {ReadonlyArray<Readonly<{ attempt: string, role: string, branch: string, baseCommit: string | null }>>}
 *   in mint order
 */
export function mintedAttemptBranches(store, { run, ticket }) {
	return Object.freeze(
		store
			.readEvents({ stream: runStream(run), kind: "attempt.launched" })
			.filter((record) => record.ticket === ticket)
			.map((record) =>
				Object.freeze({
					attempt: record.attempt,
					role: record.payload.role,
					branch: attemptBranch({ ticket, attempt: record.attempt }),
					baseCommit: record.payload.base_commit ?? null,
				}),
			),
	);
}

/**
 * Whether one `attempt.launched` payload was minted for a purpose.
 *
 * Compared field by field against the purpose's **own** keys, canonically, so a
 * payload carrying more than the purpose still matches and a nested block — the
 * review one — is compared whole rather than by reference.
 */
function mintsPurpose(payload, purpose) {
	return Object.entries(purpose).every(([key, value]) => canonicalJson(payload[key] ?? null) === canonicalJson(value));
}

/**
 * §6.5's mint, for an attempt whose minter is not its launcher.
 *
 * **The mint comes before the work, and everything knowable at mint time is
 * written here.** The projections refuse an attempt-scoped record — and a branch
 * and a worktree are both effects — for a tuple nothing minted, so §8.5's tiers
 * and §8.4's axes both write this before they open anything. What is knowable
 * only at launch (the runtime, the declared model, the manifest and prompt
 * digests) stays in the attempt manifest on disk: the `attempt` projector inserts
 * one row per `attempt.launched`, so `launchWorker` cannot append a second and
 * does not try.
 *
 * A record already there is left exactly as it is, which is what makes a
 * re-entered mint free rather than a duplicate.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold (`controller/lease-guard.mjs`)
 * @param {Readonly<object>} context.identity the minted tuple (`requireAttemptIdentity`)
 * @param {string} context.role the role this attempt runs
 * @param {string} context.profile the dispatched profile
 * @param {Readonly<object> | null} [context.routing] **the dispatch decision that
 *   chose that profile** (#155, `worker/dispatch.mjs`): what §11.5 declared, what
 *   will run, why they differ, and every candidate passed over. `null` where no
 *   decision was made — §8.5's repair and §8.10's automation retry are pinned to
 *   the originating attempt, and a record on those would read as a routing that
 *   happened to land where the pin already was.
 *
 *   It rides the mint rather than a record of its own because §6.5 re-asserts a
 *   *declared* model against the observed one, and the mint is where the declared
 *   one is written down. A substitution recorded somewhere else would be a second
 *   answer to "what ran", which is the question this exists to keep answerable
 * @param {string} context.baseCommit the commit its branch starts at
 * @param {object} context.purpose **why this attempt exists**, in the minter's own
 *   words — §8.5's tier and the attempt it answers, or §8.4's axis, work and try.
 *   It is also the allocation key `allocateAttempt` reads back, so a journal an
 *   operator can explain and a re-entry that converges are the same field
 * @param {number} context.at
 * @returns {boolean} whether this call wrote the record
 */
export function mintAttempt(store, { hold, identity, role, profile, routing = null, baseCommit, purpose, at }) {
	if (launchedAttempt(store, identity.attempt) !== null) return false;

	hold.append({
		kind: "attempt.launched",
		source: "controller",
		run: identity.run,
		ticket: identity.ticket,
		phase: identity.phase,
		attempt: identity.attempt,
		occurredAt: at,
		observedAt: at,
		payload: {
			role,
			profile,
			routing,
			...purpose,
			base_commit: baseCommit,
			// The three derived paths cost nothing to compute and are what an
			// operator greps for during an incident (§2.1, §6.6, §7.3).
			branch: attemptBranch({ ticket: identity.ticket, attempt: identity.attempt }),
			worktree: attemptWorktreePath(store.storeDir, identity.attempt),
			outbox: attemptOutboxPath(store.storeDir, identity.attempt),
		},
	});

	return true;
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

/**
 * The label on the tab one attempt runs in (#156).
 *
 * Beside the agent name and the pane title because it is the third name derived
 * from an attempt id for Herdr's benefit, and a derived name with a second home
 * is a name that drifts. The run's *workspace* label is not here: it is derived
 * from the run, and it lives with the effect it is the probe's handle on
 * (`worker/workspace.mjs`).
 */
export function herdrTabLabel(attempt) {
	return `factory-${attempt}`;
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
