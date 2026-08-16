import {
	CONTROLLER_DERIVED_REASON_CLASSES,
	WORKER_WRITABLE_REASON_CLASSES,
} from "../domain/vocabulary.mjs";
import { ACTIONS, BUDGETS } from "./table.mjs";
import { FactoryPipelineError } from "./errors.mjs";

/**
 * §14.18, **the rule**: *every worker-writable reason class ⇒ `paused`; every
 * controller-derived one ⇒ `failed`.*
 *
 * It is a function of the class rather than a column on §8.10's rows because a
 * column is filled in by whoever adds the row, and the failure it permits is
 * silent: a new controller-derived class filed as `paused` puts a ticket in
 * front of a human who owes an answer to a question nobody asked, and every test
 * still passes. Here, adding a class to either list in `vocabulary.mjs` settles
 * its disposition, and adding it to neither settles nothing at all.
 */

/**
 * @param {string} reasonClass one of §8.8's two lists
 * @param {ReadonlyArray<string>} [allowed] the classes this caller may file
 *   under. Defaults to both lists; the worker path narrows it to the
 *   worker-writable six, which is what makes §6.6's "controller-derived reason
 *   classes are never worker-writable" a refusal rather than a convention.
 * @returns {"paused" | "failed"}
 * @throws {FactoryPipelineError} `reason-class-unknown`
 */
export function dispositionForReasonClass(reasonClass, allowed = null) {
	if (allowed !== null && !allowed.includes(reasonClass)) {
		throw new FactoryPipelineError(
			"reason-class-unknown",
			`Reason class ${JSON.stringify(reasonClass)} is not one this caller may file under (${allowed.join(", ")}); ` +
				"a worker-writable class is the only kind a worker may name, because the rest are counters it cannot see (§6.6, §8.8).",
			{ at: "reason_class", reasonClass, allowed: [...allowed] },
		);
	}

	if (WORKER_WRITABLE_REASON_CLASSES.includes(reasonClass)) return "paused";
	if (CONTROLLER_DERIVED_REASON_CLASSES.includes(reasonClass)) return "failed";

	throw new FactoryPipelineError(
		"reason-class-unknown",
		`Reason class ${JSON.stringify(reasonClass)} is in neither of §8.8's lists, so §14.18's rule has no disposition ` +
			"for it. Add it to the list it belongs to; the disposition follows from that and from nothing else.",
		{ at: "reason_class", reasonClass },
	);
}

/**
 * How a `dispose` row settles, as the record shape the journal and the outcome
 * chain both carry.
 *
 * Three sources, in the order §8.9 and §14.18 give them:
 *
 * 1. a row naming a disposition outright — `published` and `released`, the two
 *    that carry no reason class and therefore have no rule to follow;
 * 2. a reason class — the row's own, or the worker's for the one row that reads
 *    it off the outbox — put through §14.18's rule;
 * 3. a row naming an automation fault and no class (§8.10's "`failed` /
 *    automation"): an automation fault is controller-derived by definition, so
 *    the same rule answers `failed` without a class to name.
 *
 * @param {Readonly<object>} row a `dispose` row from §8.10's table
 * @param {{ reasonClass?: string | null }} [context] the worker's own class,
 *   where the row defers to it
 * @returns {Readonly<{ disposition: string, reason_class: string | null, fault: string | null }>}
 */
export function dispositionOf(row, { reasonClass = null } = {}) {
	if (row.action !== ACTIONS.dispose) {
		throw new FactoryPipelineError(
			"outcome-unmapped",
			`Phase ${row.phase} × ${row.outcome} is ${row.action}, not a disposition; only a dispose row settles a ticket execution (§8.9).`,
			{ at: "action", phase: row.phase, outcome: row.outcome, action: row.action },
		);
	}

	if (row.disposition !== null) {
		return Object.freeze({ disposition: row.disposition, reason_class: null, fault: null });
	}

	if (row.reasonClass !== null) {
		return Object.freeze({
			disposition: dispositionForReasonClass(row.reasonClass),
			reason_class: row.reasonClass,
			fault: null,
		});
	}

	if (row.fault === BUDGETS.automation) {
		return Object.freeze({ disposition: "failed", reason_class: null, fault: BUDGETS.automation });
	}

	// The row defers to the worker: §8.10's `needs-human` rows, where the class is
	// the worker's own and the question it carries is what the human answers.
	return Object.freeze({
		disposition: dispositionForReasonClass(reasonClass, WORKER_WRITABLE_REASON_CLASSES),
		reason_class: reasonClass,
		fault: null,
	});
}
