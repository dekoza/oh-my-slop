import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.1's seam: **one runtime-neutral worker harness adapter**, with operations
 * `preflight(role, package_rev)` · `launch(attempt)` · `await_completion(attempt)`
 * · `cancel(attempt)`.
 *
 * Every pi/Claude difference — flags, plugin dirs, invocation syntax — lives
 * behind an implementation of this shape, and adding a runtime means
 * implementing the four operations and nothing else. The construction is
 * fail-closed the way the effect registry's is: an adapter missing an
 * operation, or carrying one the contract does not name, is refused here
 * rather than discovered mid-run.
 *
 * **The adapter is role-parametric and knows nothing about which roles exist.**
 * That is structural: a role reaches an operation only through `validateRole`,
 * which checks §6.1's five-slot tuple and never a name against a list. The
 * pipeline's actual role inventory lives with the caller (`roles.mjs`).
 *
 * Operations answer in typed values and typed refusals. `preflight` writes
 * nothing at all — its findings become the controller's `preflight.checked`
 * stage. The three lifecycle operations do write, but never as a second writer:
 * they are handed the controller's own hold in the attempt, and every record
 * goes through `hold.append`, which compares the holder token inside the
 * write's own transaction (§14.6).
 */

export const WORKER_OPERATIONS = Object.freeze(["preflight", "launch", "awaitCompletion", "cancel"]);

const NAME_SHAPE = /^[a-z][a-z0-9-]*$/;

/** A skill's name, exactly as `closure.mjs` shapes it: a digit may lead. */
const SKILL_NAME_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * §6.1's tuple: `(name, entry skill, closure, prompt template, result
 * expectations)`. The closure slot may be null on a *declaration* — it is
 * computed from the pinned revision, never hardcoded (§6.2) — but an operation
 * is always handed a role whose closure has been attached; `preflight` refuses
 * a null one rather than probing for an unknown set.
 *
 * The prompt template slot may be null on a declaration too: §6.4's template is
 * one renderer parameterised by the role rather than four strings, so a role
 * declares its *expectations* and the renderer reads them (`prompt.mjs`).
 *
 * @param {object} role
 * @returns {Readonly<object>} the same tuple, frozen
 * @throws {FactoryWorkerError} `role-invalid`
 */
export function validateRole(role) {
	if (role === null || typeof role !== "object") {
		throw refuseRole("a role is §6.1's five-slot tuple, not " + JSON.stringify(role ?? null), {
			found: role ?? null,
		});
	}

	const { name, entrySkill, closure, promptTemplate, resultExpectations } = role;

	if (typeof name !== "string" || !NAME_SHAPE.test(name)) {
		throw refuseRole(`role name ${JSON.stringify(name ?? null)} is not a usable identifier`, { at: "name" });
	}
	if (typeof entrySkill !== "string" || !SKILL_NAME_SHAPE.test(entrySkill)) {
		throw refuseRole(`role "${name}" names no entry skill`, { at: "entrySkill", role: name });
	}
	if (closure !== null && (!Array.isArray(closure) || closure.some((skill) => typeof skill !== "string"))) {
		throw refuseRole(`role "${name}" carries a closure that is not a list of skill names`, {
			at: "closure",
			role: name,
		});
	}
	if (closure !== null && !closure.includes(entrySkill)) {
		throw refuseRole(`role "${name}"'s closure does not contain its own entry skill "${entrySkill}"`, {
			at: "closure",
			role: name,
		});
	}
	if (promptTemplate !== null && typeof promptTemplate !== "string" && typeof promptTemplate !== "function") {
		throw refuseRole(`role "${name}" carries a prompt template that is neither text nor a renderer`, {
			at: "promptTemplate",
			role: name,
		});
	}
	if (resultExpectations === null || typeof resultExpectations !== "object") {
		throw refuseRole(`role "${name}" declares no result expectations`, { at: "resultExpectations", role: name });
	}

	return Object.freeze({
		name,
		entrySkill,
		closure: closure === null ? null : Object.freeze([...closure]),
		promptTemplate,
		resultExpectations,
	});
}

/**
 * Build an adapter from a runtime's four operation implementations.
 *
 * @param {{ kind: string, operations: Record<string, Function> }} runtime
 * @returns {Readonly<object>} `{ kind, preflight, launch, awaitCompletion, cancel }`
 * @throws {FactoryWorkerError} `adapter-invalid`
 */
export function createWorkerAdapter({ kind, operations } = {}) {
	if (typeof kind !== "string" || !NAME_SHAPE.test(kind)) {
		throw refuseAdapter(`an adapter names its runtime kind; found ${JSON.stringify(kind ?? null)}`, {
			at: "kind",
		});
	}
	if (operations === null || typeof operations !== "object") {
		throw refuseAdapter(`the "${kind}" adapter declares no operations`, { at: "operations", kind });
	}

	for (const operation of WORKER_OPERATIONS) {
		if (typeof operations[operation] !== "function") {
			throw refuseAdapter(`the "${kind}" adapter is missing ${operation}(); §6.1's contract has four operations`, {
				at: `operations.${operation}`,
				kind,
				expected: WORKER_OPERATIONS.join("|"),
			});
		}
	}
	for (const operation of Object.keys(operations)) {
		if (!WORKER_OPERATIONS.includes(operation)) {
			throw refuseAdapter(
				`the "${kind}" adapter declares ${operation}(), which §6.1's contract does not name; a fifth operation is a specification change, not an adapter's decision`,
				{ at: `operations.${operation}`, kind, expected: WORKER_OPERATIONS.join("|") },
			);
		}
	}

	return Object.freeze({
		kind,
		/**
		 * §6.2's three-layer proof for one role against one pinned revision. The
		 * role passes through `validateRole` on the way in, so an implementation
		 * only ever sees the checked tuple — role-parametricity is enforced at the
		 * seam, not promised by each runtime.
		 */
		preflight: (role, packageRev, context) => operations.preflight(validateRole(role), packageRev, context),
		launch: (attempt) => operations.launch(requireAttempt(attempt, "launch", kind)),
		awaitCompletion: (attempt) => operations.awaitCompletion(requireAttempt(attempt, "awaitCompletion", kind)),
		cancel: (attempt) => operations.cancel(requireAttempt(attempt, "cancel", kind)),
	});
}

function requireAttempt(attempt, operation, kind) {
	if (attempt === null || typeof attempt !== "object") {
		throw refuseAdapter(`${kind}.${operation}() takes an attempt; found ${JSON.stringify(attempt ?? null)}`, {
			at: "attempt",
			kind,
			operation,
		});
	}
	return attempt;
}

function refuseRole(sentence, details) {
	return new FactoryWorkerError("role-invalid", `${sentence} (§6.1).`, details);
}

function refuseAdapter(sentence, details) {
	return new FactoryWorkerError("adapter-invalid", `${sentence} (§6.1).`, details);
}
