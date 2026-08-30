import { profilesForRole } from "../config/routing.mjs";
import { REVIEW_VERDICTS, WORKER_WRITABLE_OUTCOMES } from "../domain/vocabulary.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { traceWritten } from "./outbox.mjs";
import { WORKER_POSTURES } from "./permissions.mjs";
import { renderAttemptPrompt } from "./prompt.mjs";

/**
 * The pipeline's role inventory — **the caller's knowledge, never the
 * adapter's** (§6.1).
 *
 * A role here is a *declaration*: the §6.1 tuple minus what only the pinned
 * package can answer. The closure slot is null until `closure.mjs` computes it
 * from `requires:` frontmatter — hardcoding it would be exactly the role
 * knowledge §6.2 forbids.
 *
 * **§6.4's "deterministic per-role template" is one renderer, not four
 * strings.** Every role carries the same `renderAttemptPrompt`, and what makes
 * the rendering per-role is the tuple it reads: the entry skill becomes the
 * native invocation and the result expectations become the completion protocol
 * the worker is held to. Four hand-maintained templates would drift from the
 * one validator that reads those same expectations back.
 *
 * The names are code constants for the same reason §3.2's labels are. The
 * entry-skill bindings are the specification's own: `implement` is the builder
 * role's entry skill (§6.2, §11.5 — fresh-retry re-enters through the same
 * skill on a different profile), and §8.4 names `review-standards` and
 * `review-spec` as the two independently invocable review entry skills.
 */

/** §11.5's routing role both review axes dispatch through. */
export const REVIEW_ROUTING_ROLE = "review";

/**
 * #189's requirement trace is declared on the expectations from both ends.
 * `writesTrace` is the builder's obligation — a `completed` record owes one,
 * and `missingResult` below reads the same flag back — and `checksTrace` is the
 * spec axis's: the one reviewer whose question the trace answers (does the
 * change cover what the ticket asked) is briefed with it. The standards axis
 * is deliberately neither: coverage of the ticket is not its axis, and a
 * second reader of the trace would be the cross-axis ranking §8.4 forbids.
 */
const BUILDER_EXPECTATIONS = Object.freeze({ statuses: WORKER_WRITABLE_OUTCOMES, writesTrace: true });
const REVIEW_EXPECTATIONS = Object.freeze({ statuses: WORKER_WRITABLE_OUTCOMES, verdicts: REVIEW_VERDICTS });
const REVIEW_SPEC_EXPECTATIONS = Object.freeze({ ...REVIEW_EXPECTATIONS, checksTrace: true });

export const PIPELINE_ROLES = Object.freeze([
	declare("implement", { entrySkill: "implement", routingRole: "implement", expectations: BUILDER_EXPECTATIONS }),
	declare("fresh-retry", { entrySkill: "implement", routingRole: "freshRetry", expectations: BUILDER_EXPECTATIONS }),
	declare("review-standards", { entrySkill: "review-standards", routingRole: REVIEW_ROUTING_ROLE, expectations: REVIEW_EXPECTATIONS }),
	declare("review-spec", { entrySkill: "review-spec", routingRole: REVIEW_ROUTING_ROLE, expectations: REVIEW_SPEC_EXPECTATIONS }),
]);

/**
 * What a `completed` record **owes its role** and did not write, or `null`.
 *
 * This is the builder-side half of §8.4's "two levels, two owners". `outbox.mjs`
 * judges the shape of a trace that *is* written and has never known which roles
 * exist; whether one is owed is read off the role's own expectations here — the
 * same expectations `prompt.mjs` rendered into the completion protocol, so the
 * obligation the worker was told and the one it is held to are one value. A
 * builder that ended `completed` without a trace produced no result for its
 * role, which is what `invalid-result` means (§6.6) and routes to §8.10's
 * fresh-retry row; the sentence names the block so the next attempt's brief
 * and the journal both say why.
 *
 * Only absence is judged. A trace that is present is `outbox.mjs`'s to judge
 * for shape and review-spec's to judge for truth — the controller reads the
 * rows and never their content (#189).
 *
 * **The record's own status decides, not the attempt's outcome.** A builder
 * still alive at turn end with a valid `completed` file is `wrote-but-hung`,
 * which §8.10 harvests exactly as a completion — so the trace is owed there
 * too, and a `needs-human` record owes none under either outcome.
 *
 * @param {Readonly<object>} role a pipeline role
 * @param {Readonly<object> | null} record the normalised outbox record
 * @returns {string | null}
 */
export function missingResult(role, record) {
	if (role.resultExpectations.writesTrace !== true) return null;
	if (record?.status !== "completed") return null;
	if (traceWritten(record.trace)) return null;

	return (
		"the attempt ended completed and wrote no trace, so this builder produced no result for its role: a completed " +
		"builder record carries a `trace` — one {requirement, evidence} row per line of the ticket it was briefed " +
		"with — and the controller reads its rows, never their truth (§6.6, #189)"
	);
}

/**
 * §8.4's two axes, **in the order §11.5's `review` pair is written in**.
 *
 * The order is load-bearing rather than cosmetic: `routing.roles.review` is a
 * two-element list and the pair maps onto the axes positionally, which is how
 * "model diversity is available as per-run configuration" reaches the fan-out
 * without anything mandating it. Read off `PIPELINE_ROLES` rather than spelled
 * again, so a third axis — were one ever declared — could not be forgotten here.
 */
export const REVIEW_ROLES = Object.freeze(PIPELINE_ROLES.filter((role) => role.routingRole === REVIEW_ROUTING_ROLE));

/**
 * §6.8's posture for one pipeline role — **derived from the role, never from a
 * profile** (§11.4).
 *
 * The inventory is where this belongs and §6.1's tuple is where it does not: the
 * adapter is role-parametric and validates five slots, so a sixth would be role
 * knowledge crossing the seam that exists to keep it out. What a caller needs at
 * dispatch is a function from the role it is about to run, and here it is.
 *
 * **An undeclared role is refused rather than treated as a builder.** The two
 * postures are not symmetric: the wrong answer in one direction is a reviewer
 * that cannot use `git log`, and in the other it is a read-only role holding the
 * edit tools — which is exactly the guarantee §8.4's attestation exists to be the
 * last line of, not the only one.
 *
 * @param {Readonly<object> | string} role a pipeline role, or its name
 * @returns {string} one of `WORKER_POSTURES`
 * @throws {FactoryWorkerError} `role-invalid`
 */
export function postureOf(role) {
	const name = typeof role === "string" ? role : role?.name;
	const declared = PIPELINE_ROLES.find((entry) => entry.name === name);

	if (declared === undefined) {
		throw new FactoryWorkerError(
			"role-invalid",
			`"${name ?? null}" is not a pipeline role, so §6.8 has no posture for it. Answering "builder" for an ` +
				`unrecognised name would hand the edit tools to whatever asked, which is the one direction this must not ` +
				`guess in.`,
			{ at: "role", found: name ?? null, expected: PIPELINE_ROLES.map((entry) => entry.name).join("|") },
		);
	}

	return REVIEW_ROLES.includes(declared) ? WORKER_POSTURES.reviewer : WORKER_POSTURES.builder;
}

function declare(name, { entrySkill, routingRole, expectations }) {
	return Object.freeze({
		name,
		entrySkill,
		routingRole,
		closure: null,
		promptTemplate: renderAttemptPrompt,
		resultExpectations: expectations,
	});
}

/**
 * Each pipeline role with the profiles its routing role can dispatch to under
 * the active routing — the declared role value, every rule that names the role,
 * and **every entry in the role's reroute order** (§11.5, #155). Both review
 * roles carry the whole review reach: §11.5 binds the pair to the phase, and
 * which attempt lands on which axis is dispatch's decision, not a preflight
 * assumption.
 *
 * The reroute order counts for the same reason the rules do. §6.2's preflight
 * asks this to size its proof — one session per distinct profile the active
 * routing can dispatch (#164) — and a fallback profile is by definition one it
 * can dispatch. Leaving them out would prove the flag spelling of every profile
 * except the ones a quota blip makes the only way forward.
 *
 * @param {{ roles: object, rules: ReadonlyArray<object>, fallbacks?: object }} activeRouting
 * @returns {ReadonlyArray<Readonly<object>>} `PIPELINE_ROLES`, each with `profiles`
 */
export function rolesInPlay(activeRouting) {
	return Object.freeze(
		PIPELINE_ROLES.map((role) =>
			Object.freeze({
				...role,
				profiles: Object.freeze([...profilesForRole(activeRouting, role.routingRole)].sort()),
			}),
		),
	);
}

/**
 * §11.5's dispatch, for one routing role and one ticket: `labelsAny × role →
 * profile`, falling back to the role's **declared** profile and to nothing else.
 *
 * The two refusals are the two halves of §11.5's "no implicit fallback":
 *
 * - **A role the routing does not declare is refused**, never answered from a
 *   neighbouring role. The specific accident this forecloses is an implicit
 *   `freshRetry = implement`, which §11.5 names as precisely the silent
 *   runtime-policy guess the section exists to end — and which would be
 *   invisible, because the run would work.
 * - **A ticket matching two rules for one role is refused.** The loader already
 *   refuses rules whose `labelsAny` sets intersect for a role (`config/routing.mjs`),
 *   so what reaches here is two *disjoint* rules and a ticket carrying a label
 *   from each. §11.5 makes that a ticket-scoped automation failure surfaced at
 *   claim time before any work — never legacy's positional first-match, which
 *   would answer with whichever rule the operator happened to type first.
 *
 * @param {{ roles: object, rules: ReadonlyArray<object> }} activeRouting
 * @param {{ role: string, labels?: ReadonlyArray<string> }} where the routing
 *   role to dispatch, and the ticket's labels as the claim-time snapshot has them
 * @returns {string | ReadonlyArray<string>} a profile name, or `review`'s pair
 * @throws {FactoryWorkerError} `routing-ambiguous`
 */
export function profileForRole(activeRouting, { role, labels = [] }) {
	const matched = activeRouting.rules.filter(
		(rule) => rule.role === role && rule.labelsAny.some((label) => labels.includes(label)),
	);

	if (matched.length > 1) {
		const profiles = matched.map((rule) => rule.profile);
		throw new FactoryWorkerError(
			"routing-ambiguous",
			`Ticket labels ${labels.join(", ")} match ${matched.length} routing rules for role "${role}" ` +
				`(${profiles.join(", ")}). §11.5 fails this closed at claim time rather than taking the first match.`,
			{ at: "routing.rules", role, labels: [...labels], profiles },
		);
	}

	if (matched.length === 1) return matched[0].profile;

	const declared = activeRouting.roles[role];
	if (declared === undefined || declared === null) {
		throw new FactoryWorkerError(
			"routing-ambiguous",
			`This routing declares no profile for role "${role}", and no rule matched. §11.5 requires all three roles ` +
				`with no implicit fallback, so there is no other role to answer from.`,
			{ at: "routing.roles", role, labels: [...labels] },
		);
	}

	return declared;
}
