import { requireInteger, requireNoUnknownKeys } from "./shape.mjs";

/**
 * The two blocks whose every key an upstream decision already fixed (§11.6):
 * `budgets` and `retention`. Both may be omitted whole or in part, and both
 * refuse anything outside their declared numbers.
 *
 * These are the only defaults in the loader. Everywhere else, absence is a
 * refusal — a default is legitimate here precisely because the value was decided
 * somewhere the operator can read (§8.6, §12.10), not guessed at load time.
 */

/**
 * §8.6: 1 repair + 1 fresh-retry is the product budget; the automation budget is
 * independent and never charged to the worker. The ceiling is 2 + 2 — declared
 * policy rather than legacy's refusal to have a knob, and the answer to
 * `job-pipeline`'s `replanCount`, which was incremented forever and compared to
 * nothing.
 */
const BUDGET_DEFAULTS = Object.freeze({ repair: 1, freshRetry: 1, automation: 1 });
const BUDGET_CEILING = 2;

/** §12.10: exactly two numbers, floor of 1 each. */
const RETENTION_DEFAULTS = Object.freeze({ fullDetailRuns: 20, fullDetailDays: 30 });

export function validateBudgets(budgets, configPath) {
	return validateCounts(budgets, BUDGET_DEFAULTS, "budgets", configPath, {
		max: BUDGET_CEILING,
		because: "§8.6 caps the declared budgets at 2 + 2.",
	});
}

/**
 * The four pins, the permanence of the tier-2 digest, the heartbeat horizon, and
 * the artifact store root are deliberately unreachable from here — a pin you can
 * switch off is not a pin (§14.32). Naming one is an unknown key, not an option.
 */
export function validateRetention(retention, configPath) {
	return validateCounts(retention, RETENTION_DEFAULTS, "retention", configPath, {
		because: "§12.10 puts a floor of 1 on both retention numbers.",
	});
}

function validateCounts(block, defaults, blockName, configPath, bounds) {
	const keys = Object.keys(defaults);
	requireNoUnknownKeys(block ?? {}, keys, blockName, configPath);

	const validated = {};
	for (const key of keys) {
		const declared = block?.[key];
		validated[key] =
			declared === undefined
				? defaults[key]
				: requireInteger(declared, `${blockName}.${key}`, configPath, bounds);
	}

	return Object.freeze(validated);
}
