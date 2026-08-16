import { WORKER_WRITABLE_OUTCOMES } from "../domain/vocabulary.mjs";
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
