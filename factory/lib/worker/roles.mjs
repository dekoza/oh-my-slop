import { WORKER_WRITABLE_OUTCOMES } from "../domain/vocabulary.mjs";
import { FactoryWorkerError } from "./errors.mjs";
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

/** §8.4's verdict vocabulary, carried as a review role's result expectation. */
const REVIEW_VERDICTS = Object.freeze(["approve", "reject"]);

const BUILDER_EXPECTATIONS = Object.freeze({ statuses: WORKER_WRITABLE_OUTCOMES });
const REVIEW_EXPECTATIONS = Object.freeze({ statuses: WORKER_WRITABLE_OUTCOMES, verdicts: REVIEW_VERDICTS });

export const PIPELINE_ROLES = Object.freeze([
	declare("implement", { entrySkill: "implement", routingRole: "implement", expectations: BUILDER_EXPECTATIONS }),
	declare("fresh-retry", { entrySkill: "implement", routingRole: "freshRetry", expectations: BUILDER_EXPECTATIONS }),
	declare("review-standards", { entrySkill: "review-standards", routingRole: "review", expectations: REVIEW_EXPECTATIONS }),
	declare("review-spec", { entrySkill: "review-spec", routingRole: "review", expectations: REVIEW_EXPECTATIONS }),
]);

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
 * the active routing — the declared role value plus every rule that names the
 * role. Both review roles carry the whole review reach: §11.5 binds the pair to
 * the phase, and which attempt lands on which axis is dispatch's decision, not
 * a preflight assumption.
 *
 * @param {{ roles: object, rules: ReadonlyArray<object> }} activeRouting
 * @returns {ReadonlyArray<Readonly<object>>} `PIPELINE_ROLES`, each with `profiles`
 */
export function rolesInPlay(activeRouting) {
	return Object.freeze(
		PIPELINE_ROLES.map((role) => {
			const reached = new Set([activeRouting.roles[role.routingRole]].flat());
			for (const rule of activeRouting.rules) {
				if (rule.role === role.routingRole) for (const profile of [rule.profile].flat()) reached.add(profile);
			}
			return Object.freeze({ ...role, profiles: Object.freeze([...reached].sort()) });
		}),
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
