import { writeArtifact } from "../artifacts/writes.mjs";
import { FINDING_SEVERITIES, PHASE_INTEGRATE, PHASE_REVIEW } from "../domain/vocabulary.mjs";
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
 * @param {ReadonlyArray<object>} what.checks `checkRecord`s from the run that
 *   attested `publishedCommit` — every declared check, required and advisory
 * @param {object} what.integration what §7.5's steps did: the rebase, the
 *   evidence ref, and §7.4's predicate verdict
 * @returns {Readonly<object>}
 * @throws {FactoryPipelineError} `attestation-incomplete`
 */
export function buildAttestation(
	store,
	{ run, ticket, attempt, publishedCommit, branch, baseCommit, packageRevision = null, checks, integration },
) {
	requireCommit(publishedCommit);
	requireChecks(checks);
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
		// §8.7 names the required flag explicitly, so it is a field rather than
		// something a reader derives from `severity` — the two words are the same
		// fact, and a reader that had to know that is a reader that can get it wrong.
		checks: checks.map((check) => ({ ...check, required: check.severity === "required" })),
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
	const advisory = document.review.advisory.length;

	return (
		`${required.length} required check(s) green at ${document.published.commit.slice(0, 12)}` +
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
		role: "attestation",
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

function requireChecks(checks) {
	if (Array.isArray(checks) && checks.length > 0) return;

	throw new FactoryPipelineError(
		"attestation-incomplete",
		"§8.7 records **every check** with its command, exit code, duration, and required flag, and this attestation was " +
			"handed none. §14.16 makes the controller's rerun the only attestation boundary, so an artifact with no " +
			"check results is a claim with nothing behind it.",
		{ at: "checks", found: Array.isArray(checks) ? checks.length : null },
	);
}
