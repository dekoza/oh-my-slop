import { FactoryArtifactError } from "../artifacts/errors.mjs";
import { readArtifact } from "../artifacts/ledger.mjs";
import { artifactWriteKey, writeArtifact } from "../artifacts/writes.mjs";
import { CHECK_RESULTS, FINDING_SEVERITIES, PHASE_INTEGRATE, PHASE_REVIEW } from "../domain/vocabulary.mjs";
import { effectByKey } from "../effects/records.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { stageResults } from "./stages.mjs";

/**
 * §8.7's **per-attempt immutable attestation artifact**, referenced by digest
 * and never embedded.
 *
 * This is what makes "the controller verified this" a **checkable claim** rather
 * than a policy statement, so what it records is exactly §8.7's list and the
 * list is not negotiable per caller:
 *
 * - **the exact published commit** — §14.13's whole content, in one field;
 * - **every check with its command, exit code, duration, and required flag** —
 *   advisory ones included, which is where §8.2's "advisory checks record
 *   evidence and never block" actually lands;
 * - **both review verdicts, with blocking *and* advisory findings** — the
 *   blocking set is here even though §8.7 keeps it off the PR, because the
 *   artifact is the record and the PR is the summary;
 * - **the before/after HEAD guard result** for each axis, which is §6.8's
 *   authoritative proof that a read-only role stayed read-only.
 *
 * **It is built from durable state, never from the caller's memory.** The review
 * half is read back off the stage records the fan-out resolved, so a controller
 * that crashed between the review and the publication attests what the review
 * actually said rather than what a rebuilt lane assumed. The checks are the
 * caller's, and deliberately: §9.5's compare-and-publish loop can re-verify at a
 * *second* commit, and the run that attested the published commit is the one
 * that counts — reading "the verify stage" would attest the earlier one.
 *
 * **Immutable** falls out of being content-addressed: the artifact write is
 * keyed by `(run, ticket, integrate, attempt, attestation-write)`, and the same
 * key with different content is §4.5's typed conflict rather than a second,
 * uncompared version of what the controller claims to have checked.
 */

/** The version a machine reading an attestation branches on. */
export const ATTESTATION_SCHEMA_VERSION = 1;

/** One JSON document per attempt (§12.1's `attestation` role). */
const ATTESTATION_MEDIA_TYPE = "application/json";

/**
 * §12.1's role this module writes and reads back under. Named once, because the
 * write and the read have to agree about it or the reader finds nothing and
 * says so as "nobody wrote one".
 */
const ATTESTATION_ROLE = "attestation";

/**
 * Assemble §8.7's document.
 *
 * @param {object} store an open store
 * @param {object} what
 * @param {string} what.run
 * @param {number} what.ticket
 * @param {string} what.attempt the **builder** attempt being published
 * @param {string} what.publishedCommit the exact commit that will be pushed
 * @param {string} what.branch the attempt branch it is pushed as
 * @param {string} what.baseCommit the base it was rebased onto and verified at
 * @param {string | null} what.packageRevision the pinned revision this ran under (§11.7)
 * @param {ReadonlyArray<object>} what.declared the validated `checks` block
 *   (§11.6) — the list the document is held complete against
 * @param {ReadonlyArray<object>} what.checks `checkRecord`s measuring
 *   `publishedCommit`, from every set that ran: §8.1's `verify` and #211's
 *   publication boundary alike, in any order
 * @param {object} what.integration what §7.5's steps did: the rebase, the
 *   evidence ref, and §7.4's predicate verdict
 * @returns {Readonly<object>}
 * @throws {FactoryPipelineError} `attestation-incomplete`
 */
export function buildAttestation(
	store,
	{ run, ticket, attempt, publishedCommit, branch, baseCommit, packageRevision = null, declared, checks, integration },
) {
	requireCommit(publishedCommit);
	const attested = attestedChecks(declared, checks);
	const verdicts = reviewVerdicts(store, { run, ticket, attempt });

	return Object.freeze({
		schema_version: ATTESTATION_SCHEMA_VERSION,
		identity: { run, ticket, attempt },
		published: {
			commit: publishedCommit,
			branch,
			base_commit: baseCommit,
			package_revision: packageRevision,
		},
		checks: attested,
		review: {
			verdicts,
			blocking: verdicts.flatMap((axis) => axis.blocking),
			advisory: verdicts.flatMap((axis) => axis.advisory),
		},
		integration,
	});
}

/**
 * §8.7's summary — the one sentence that lands in §7.5's PR-body block and in
 * §8.9's ticket comment.
 *
 * **Advisory findings are surfaced and blocking findings never are.** A blocking
 * finding is one a repair already answered, and putting it on a published PR
 * would be a criticism of code that is no longer there. The count of them is not
 * a loophole either: what a reader would infer from "2 blocking findings, since
 * fixed" is the same publication of a resolved objection.
 *
 * @param {Readonly<object>} document a `buildAttestation` document
 * @returns {string}
 */
export function attestationSummary(document) {
	const required = document.checks.filter((check) => check.required);
	// **Counted on the result, not on the flag.** The sentence claims the required
	// set is green, and a count of how many checks were *required* is not that
	// claim — it prints "green" over a red set and reads exactly as convincingly.
	// This string is the human-facing half of §7.5's PR body and §8.9's ticket
	// comment, and the whole point of §8.7 is that "the controller verified this"
	// is checkable rather than asserted.
	const red = required.filter((check) => check.result !== CHECK_RESULTS.passed);
	const advisory = document.review.advisory.length;

	return (
		`${required.length - red.length} of ${required.length} required check(s) green at ` +
		`${document.published.commit.slice(0, 12)}` +
		`${red.length === 0 ? "" : ` — red: ${red.map((check) => check.name).join(", ")}`}` +
		`${document.checks.length > required.length ? `, ${document.checks.length - required.length} advisory recorded` : ""}; ` +
		`${document.review.verdicts.length} review axis verdict(s): ` +
		`${document.review.verdicts.map((axis) => `${axis.axis} ${axis.verdict ?? "—"}`).join(", ")}; ` +
		`${advisory === 0 ? "no advisory findings" : `${advisory} advisory finding(s)`}.`
	);
}

/**
 * Write it, as §12.1's `attestation` artifact — content in, reference out.
 *
 * The caller gets **digest, media type, byte count, producer, retention class**
 * and never a path (§14.28), which is exactly what §7.5's PR body and §8.9's
 * comment carry. The bytes go to the store once and are referenced from
 * everywhere.
 *
 * @param {object} store an open store
 * @param {object} what everything `buildAttestation` takes, plus:
 * @param {object} what.hold the controller's hold — §4.5's fencing generation
 * @param {string} what.actor
 * @param {number} what.at
 * @returns {Readonly<{ document: object, reference: object, summary: string, outcome: string }>}
 */
export function writeAttestation(store, { hold, actor, at, ...what }) {
	const document = buildAttestation(store, what);
	const written = writeArtifact(store, {
		content: `${JSON.stringify(document, null, 2)}\n`,
		mediaType: ATTESTATION_MEDIA_TYPE,
		role: ATTESTATION_ROLE,
		run: what.run,
		ticket: what.ticket,
		phase: PHASE_INTEGRATE,
		attempt: what.attempt,
		actor,
		fencingGeneration: hold.fence().generation,
		at,
	});

	return Object.freeze({
		document,
		reference: written.reference,
		summary: attestationSummary(document),
		outcome: written.outcome,
	});
}

/**
 * **Both** review verdicts, read back off the stage records the fan-out resolved
 * (§8.4).
 *
 * The axis attempts are every `review` stage under this ticket execution other
 * than the builder's own — §8.4 resolves each axis under its own attempt id, and
 * the builder attempt carries the phase's *combined* result. Reading them this
 * way rather than from a list the caller kept is what makes the artifact a
 * record of what happened instead of a restatement of what the lane believed.
 *
 * A retried axis leaves more than one record, and every one of them is here: an
 * attestation that showed only the surviving attempt would hide that a reviewer
 * died under this work, which is exactly the kind of thing an incident review
 * comes looking for.
 */
function reviewVerdicts(store, { run, ticket, attempt }) {
	const axes = stageResults(store, { run, ticket, phase: PHASE_REVIEW }).filter(
		(record) => record.attempt !== attempt,
	);

	if (axes.length === 0) {
		throw new FactoryPipelineError(
			"attestation-incomplete",
			`§8.7 records **both** review verdicts, and this ticket execution has no review stage under any axis attempt. ` +
				"An attestation without them would claim a review that never happened (§14.15, §14.16).",
			{ at: "review", run, ticket, attempt },
		);
	}

	return Object.freeze(
		axes.map((record) => {
			const findings = record.detail?.findings ?? [];
			return Object.freeze({
				axis: record.detail?.axis ?? null,
				attempt: record.attempt,
				outcome: record.outcome,
				verdict: record.detail?.verdict ?? null,
				profile: record.detail?.profile ?? null,
				try: record.detail?.try ?? null,
				// The boundary the axis was briefed on (#165): §14.13's spirit wants an
				// approval's scope checkable against the published diff, not inferred.
				base_commit: record.detail?.base_commit ?? null,
				reviewed_commit: record.detail?.reviewed_commit ?? null,
				blocking: Object.freeze(findings.filter((finding) => finding.severity === FINDING_SEVERITIES.blocking)),
				advisory: Object.freeze(findings.filter((finding) => finding.severity === FINDING_SEVERITIES.advisory)),
				// §6.8's authoritative guard, whatever the review concluded: §8.7 wants
				// the before/after HEAD result on every attestation and not only on the
				// ones where it caught something.
				guard: record.detail?.attestation ?? null,
			});
		}),
	);
}

function requireCommit(commit) {
	if (typeof commit === "string" && /^[0-9a-f]{40}$/i.test(commit)) return;

	throw new FactoryPipelineError(
		"attestation-incomplete",
		`§8.7 records **the exact published commit**, and ${JSON.stringify(commit ?? null)} is not one. An attestation ` +
			"naming no commit attests nothing (§14.13).",
		{ at: "published_commit", found: commit ?? null },
	);
}

/**
 * §8.7's check list: **every declared check exactly once, in declaration order.**
 *
 * Before #211 that was a property of the caller — one `verify` ran the whole
 * list, so handing its results over could not lose one. Now two sets measure the
 * published commit at two moments (§8.2's `verify` and `publication`
 * selections), and "the attestation carries every check" stops being arithmetic
 * the caller cannot get wrong. So it is asserted here, against the declaration
 * itself, and asserted as a **refusal**: a document missing a declared check is
 * a claim about a set that was never completed, and §14.16 makes the
 * controller's own rerun the only attestation boundary there is. Publishing on
 * an incomplete one is the automation failing quietly, which is the one way this
 * artifact stops being a checkable claim.
 *
 * Order is the declaration's, never arrival's: two sets arriving in two moments
 * would otherwise put the checks in whichever order the publication path
 * happened to concatenate them, and a diff between two attestations would show
 * a reordering as a change.
 *
 * `required` is derived from the **declaration's** severity rather than the
 * record's, because the declaration is what §11.6 validated. §8.7 names the flag
 * explicitly, so it is a field rather than something a reader derives from
 * `severity` — the two words are the same fact, and a reader that had to know
 * that is a reader that can get it wrong.
 */
function attestedChecks(declared, recorded) {
	requireDeclaration(declared);
	requireRecords(recorded);

	const byName = new Map();
	for (const record of recorded) {
		if (byName.has(record.name)) {
			throw refuseChecks(
				`§8.7 records every declared check **exactly once**, and two records name "${record.name}". Two results ` +
					"for one check is two answers to what that check said at the published commit, and an artifact that " +
					"carries both is not a claim anybody can check.",
				{ at: "checks", found: record.name },
			);
		}
		byName.set(record.name, record);
	}

	const attested = declared.map((check) => {
		const record = byName.get(check.name);
		if (record === undefined) {
			throw refuseChecks(
				`§8.7 records **every check** with its command, exit code, duration, and required flag, and the declared ` +
					`check "${check.name}" has no result here. §14.16 makes the controller's rerun the only attestation ` +
					"boundary, so a document short of a declared check attests a set that was never completed (#211).",
				{ at: "checks", found: [...byName.keys()], expected: check.name },
			);
		}
		byName.delete(check.name);
		return Object.freeze({ ...record, required: check.severity === "required" });
	});

	if (byName.size > 0) {
		throw refuseChecks(
			`§8.7's check list is the declared one, and ${[...byName.keys()].join(", ")} names no declared check. A result ` +
				"for a check the config does not declare is a set nobody can reproduce from the repository (§8.2).",
			{ at: "checks", found: [...byName.keys()] },
		);
	}

	return Object.freeze(attested);
}

function requireDeclaration(declared) {
	if (Array.isArray(declared) && declared.length > 0) return;

	throw refuseChecks(
		"§8.7's check list is held complete against the declared `checks` block (§11.6), and this attestation was handed " +
			"no declaration to hold it against. Verification is declared, never discovered (§8.2).",
		{ at: "declared", found: Array.isArray(declared) ? declared.length : null },
	);
}

function requireRecords(recorded) {
	if (Array.isArray(recorded) && recorded.length > 0) return;

	throw refuseChecks(
		"§8.7 records **every check** with its command, exit code, duration, and required flag, and this attestation was " +
			"handed none. §14.16 makes the controller's rerun the only attestation boundary, so an artifact with no " +
			"check results is a claim with nothing behind it.",
		{ at: "checks", found: Array.isArray(recorded) ? recorded.length : null },
	);
}

function refuseChecks(message, details) {
	return new FactoryPipelineError("attestation-incomplete", message, details);
}

/**
 * The attestation this attempt already wrote, or `null` when it has not written
 * one.
 *
 * §8.7's artifact is written **before** the push, so a re-entry after any crash
 * from that moment on finds the controller's own record of what it measured. It
 * is read back through the effect that wrote it and the ledger that holds the
 * bytes — never by path (§14.28) — which makes it the durable answer to "what
 * did this publication already establish", the question #211's deferred advisory
 * set has to ask before spending ten minutes answering it again.
 *
 * **`null` means the write has not resolved, and nothing else.** A resolved
 * write whose bytes cannot be read back — expired at §12.2's horizon,
 * tombstoned, failing its re-hash, or not parseable — is a **typed refusal**,
 * because the alternative is worse than it looks: §4.5 keys the write by
 * content, so a caller that treated an unreadable record as no record would
 * re-measure, build a document that differs in a duration, and meet the key's
 * payload conflict at a point where the branch may already be pushed. The
 * refusal names the automation failure it is (§8.10 retries it) instead of
 * letting §4.5 report it as a disagreement about what was checked.
 *
 * @param {object} store an open store
 * @param {{ run: string, ticket: number, attempt: string }} where
 * @returns {Readonly<object> | null} the §8.7 document as it was written
 * @throws {FactoryPipelineError} `attestation-unreadable`
 */
export function attestedDocument(store, { run, ticket, attempt }) {
	const written = effectByKey(
		store,
		artifactWriteKey({ role: ATTESTATION_ROLE, run, ticket, phase: PHASE_INTEGRATE, attempt }),
	);
	if (written?.state !== "resolved" || written.result === null) return null;

	try {
		return Object.freeze(JSON.parse(readArtifact(store, written.result).toString("utf8")));
	} catch (error) {
		if (!(error instanceof FactoryArtifactError) && !(error instanceof SyntaxError)) throw error;

		throw new FactoryPipelineError(
			"attestation-unreadable",
			`Ticket execution ${run}/${ticket} has written its §8.7 attestation, and its bytes cannot be read back: ` +
				`${error.message}. The document is content-addressed (§4.5), so it cannot be rebuilt from a second ` +
				"measurement — this is an automation failure over evidence storage, not a verdict on the work.",
			{ at: "attestation", run, ticket, attempt, digest: written.result.digest ?? null },
		);
	}
}
