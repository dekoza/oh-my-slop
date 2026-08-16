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
 * Operations answer in typed values and typed refusals; the controller is what
 * turns those into journal events (`preflight.checked`, `attempt.launched`,
 * `attempt.rechecked`), because events are appended under the controller's
 * hold and an adapter holding a store write path would be a second writer.
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
 * The prompt template slot may be null until #107's per-role templates land;
 * the lifecycle operations that would render one refuse as unbuilt anyway.
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

/**
 * The three lifecycle operations, as the typed refusal #107 replaces. The seam
 * ships whole — a pipeline can compile and dispatch against it today — and a
 * call reaching one of these fails the attempt as an automation failure rather
 * than half-running a worker nothing can harvest (§6.4–§6.6).
 *
 * @param {string} kind
 * @returns {Record<string, Function>}
 */
export function unbuiltLifecycleOperations(kind) {
	const refuse = (operation) => () => {
		throw new FactoryWorkerError(
			"worker-lifecycle-unbuilt",
			`${operation}(attempt) for the ${kind} runtime is not built in this package: launching a worker and ` +
				"harvesting a typed outbox are #107's slice (§6.4–§6.6). The adapter seam exists; nothing behind it half-runs.",
			{ operation, kind, missing: "launching a worker and harvesting a typed outbox (#107)" },
		);
	};

	return Object.freeze({
		launch: refuse("launch"),
		awaitCompletion: refuse("awaitCompletion"),
		cancel: refuse("cancel"),
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
