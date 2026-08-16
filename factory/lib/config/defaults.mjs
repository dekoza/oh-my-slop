import { requireInteger, requireNoUnknownKeys } from "./shape.mjs";

/**
 * The two blocks whose every key an upstream decision already fixed (§11.6):
 * `budgets` and `retention`. Both may be omitted whole or in part, and both
 * refuse anything outside their declared numbers.
 *
 * These are the only **values** the loader supplies. Everywhere else, absence is
 * a refusal — a default is legitimate here precisely because the value was
 * decided somewhere the operator can read (§8.6, §12.10), not guessed at load
 * time.
 *
 * `config/worker.mjs` supplies no value: §6.8's override channels are *additions*
 * to floors that live in code, so the absent form of each is the empty addition.
 * That is the identity of the channel rather than a policy anyone chose, and
 * spelling it once in the block's own module is what keeps every consumer from
 * branching on `undefined`.
 */

/**
 * §8.6: 1 repair + 1 fresh-retry is the product budget; the automation budget is
 * independent and never charged to the worker. The ceiling is 2 + 2 — declared
 * policy rather than legacy's refusal to have a knob, and the answer to
 * `job-pipeline`'s `replanCount`, which was incremented forever and compared to
 * nothing.
 *
 * **`circuitBreaker` is bounded below and not above, and that is not an
 * oversight.** The other three are *allowances a ticket may spend*, and §8.6
 * caps them because an uncapped one is the foreclosed counter. N is a different
 * quantity — a count of **ticket executions** that failed consecutively before
 * the run stops claiming — so the ceiling that keeps one ticket's repair chain
 * finite has nothing to say about it, and borrowing it would cap a run's
 * tolerance at 2 for a reason that does not apply to it. The floor is what
 * matters: at 0 the breaker would trip on a run that has failed nothing.
 */
const BUDGET_CEILING = 2;
const BUDGET_BOUNDS = Object.freeze({
	repair: { fallback: 1, max: BUDGET_CEILING },
	freshRetry: { fallback: 1, max: BUDGET_CEILING },
	automation: { fallback: 1, max: BUDGET_CEILING },
	circuitBreaker: { fallback: 2 },
});

/** §12.10: exactly two numbers, floor of 1 each. */
const RETENTION_BOUNDS = Object.freeze({
	fullDetailRuns: { fallback: 20 },
	fullDetailDays: { fallback: 30 },
});

export function validateBudgets(budgets, configPath) {
	return validateCounts(budgets, BUDGET_BOUNDS, "budgets", configPath, {
		because: "§8.6 caps the two product budgets and the automation budget at 2 + 2; §8.6's N is bounded below only.",
	});
}

/**
 * The four pins, the permanence of the tier-2 digest, the heartbeat horizon, and
 * the artifact store root are deliberately unreachable from here — a pin you can
 * switch off is not a pin (§14.32). Naming one is an unknown key, not an option.
 */
export function validateRetention(retention, configPath) {
	return validateCounts(retention, RETENTION_BOUNDS, "retention", configPath, {
		because: "§12.10 puts a floor of 1 on both retention numbers.",
	});
}

/**
 * A block of declared counts, each with its own bound.
 *
 * The bounds are **per key** rather than per block because a block's numbers are
 * not always the same quantity: §8.6's three retry allowances share a ceiling
 * that its consecutive-failure threshold has no business inheriting. A single
 * block-wide `max` reads as tidier right up to the first key it is wrong for,
 * and then it is wrong silently — the loader would simply refuse a value the
 * spec permits.
 */
function validateCounts(block, perKeyBounds, blockName, configPath, shared) {
	const keys = Object.keys(perKeyBounds);
	requireNoUnknownKeys(block ?? {}, keys, blockName, configPath);

	const validated = {};
	for (const key of keys) {
		const { fallback, ...bounds } = perKeyBounds[key];
		const declared = block?.[key];
		validated[key] =
			declared === undefined
				? fallback
				: requireInteger(declared, `${blockName}.${key}`, configPath, { ...shared, ...bounds });
	}

	return Object.freeze(validated);
}
