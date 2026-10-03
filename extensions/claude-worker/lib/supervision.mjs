import { createHash } from "node:crypto";

const strings = { type: "array", items: { type: "string" } };
// Native task states that end a task; a killed task is reported to the model as stopped.
const NATIVE_TERMINAL_STATUS = { completed: "completed", failed: "failed", killed: "stopped" };

export function completionSchema(taskId) {
	return {
		type: "object", additionalProperties: false,
		required: ["task_id", "disposition", "outcomes", "outstanding", "unverified", "question", "background_task_ids"],
		properties: {
			task_id: { type: "string", const: taskId },
			disposition: { type: "string", enum: ["waiting", "finished", "needs_input", "unfinished"] },
			outcomes: { type: "array", items: {
				type: "object", additionalProperties: false, required: ["requirement", "status", "evidence"],
				properties: { requirement: { type: "string" }, status: { type: "string", enum: ["verified", "unverified"] }, evidence: strings },
			} },
			outstanding: strings, unverified: strings, question: { type: "string" }, background_task_ids: strings,
			resolved_failures: { type: "array", items: {
				type: "object", additionalProperties: false, required: ["task_id", "replacement_task_id", "evidence"],
				properties: { task_id: { type: "string" }, replacement_task_id: { type: "string" }, evidence: strings },
			} },
		},
	};
}

export function supervisionInstructions(taskId) {
	return `The host supervises the approved task across turns. Stay within its original scope and existing permissions; do not expand authority. Keep working until finished or genuinely needing input. Report through StructuredOutput using task_id ${taskId}. Map EVERY requested outcome to evidence (tests/checks/artifacts), including unchanged verified outcomes. Keep the exact requirement wording stable across reports; do not omit previously declared required outcomes. Every item declared in outstanding or unverified is also a retained obligation: reconcile it explicitly as an outcome with the same exact wording and current evidence before claiming finished. Identify all unverified requirements and outstanding actions. Use finished only when every requested outcome is verified and no required work remains; this is your evidence-backed report, not independent Pi certification. Use waiting when required background work is running, list its task IDs, and consume its native notifications before continuing outstanding actions. Use needs_input only for an intentional pause, with the precise question; saved-session follow-ups supply the answer to the same task. A failed intermediate check is not failure of the approved task: consume its result, repair within scope, and rerun verification. For a fresh-ID rerun, explicitly attribute resolution in resolved_failures entries containing the failed task_id, completed replacement_task_id, and nonempty evidence explaining the repair and passing rerun. Do not claim unresolved, stopped or unknown work as resolved. Use unfinished when unable to continue, preserving recovery information. Never use ordinary done prose or a successful turn as completion evidence. Do not stop required background work merely to end a turn.`;
}

function validReport(report, taskId) {
	if (!report || Array.isArray(report) || typeof report !== "object" || report.task_id !== taskId ||
		!["waiting", "finished", "needs_input", "unfinished"].includes(report.disposition)) return false;
	const fields = ["task_id", "disposition", "outcomes", "outstanding", "unverified", "question", "background_task_ids", "resolved_failures"];
	if (Object.keys(report).some((key) => !fields.includes(key)) || typeof report.question !== "string") return false;
	for (const key of ["outstanding", "unverified", "background_task_ids"]) {
		if (!Array.isArray(report[key]) || report[key].some((item) => typeof item !== "string" || !item.trim())) return false;
	}
	if (report.resolved_failures !== undefined && (!Array.isArray(report.resolved_failures) ||
		report.resolved_failures.some((item) => !item || Array.isArray(item) || typeof item !== "object" ||
			Object.keys(item).some((key) => !["task_id", "replacement_task_id", "evidence"].includes(key)) ||
			![item.task_id, item.replacement_task_id].every((id) => typeof id === "string" && id.trim()) ||
			!Array.isArray(item.evidence) || !item.evidence.length ||
			item.evidence.some((evidence) => typeof evidence !== "string" || !evidence.trim())))) return false;
	return Array.isArray(report.outcomes) && report.outcomes.every((item) => item &&
		Object.keys(item).every((key) => ["requirement", "status", "evidence"].includes(key)) &&
		typeof item.requirement === "string" && item.requirement.trim() &&
		["verified", "unverified"].includes(item.status) && Array.isArray(item.evidence) &&
		item.evidence.every((evidence) => typeof evidence === "string" && evidence.trim()));
}

// Hash exact wording before display sanitization; retained labels are not identities.
const requirementId = (requirement) => createHash("sha256").update(requirement).digest("hex");
const identifiedOutcome = (outcome) => ({ ...outcome, requirementId: outcome.requirementId || requirementId(outcome.requirement) });

// Tracks current non-ambient lifecycles separately from retained terminal evidence.
export function createTaskSupervision(taskId, resumeState) {
	const tasks = new Map((resumeState?.taskOutcomes || []).map((task) => {
		// A deliberate follow-up may recover stopped work, but old running state is not live evidence.
		const restored = { ...task, status: task.status === "running" ? "unknown" : task.status };
		if (restored.terminalStatus === "stopped") delete restored.terminalStatus;
		return [restored.taskId, restored];
	}));
	const declarations = (value) => [...(value?.outstanding || []), ...(value?.unverified || [])]
		.map((requirement) => ({ requirement, status: "unverified", evidence: [] }));
	// New checkpoints contain the complete identified ledger. Legacy reports are a fallback,
	// not another source of identities computed from already redacted/truncated labels.
	const savedOutcomes = resumeState?.requiredOutcomes?.length && resumeState.requiredOutcomes.every((outcome) => outcome.requirementId)
		? resumeState.requiredOutcomes
		: [...declarations(resumeState?.report), ...(resumeState?.requiredOutcomes || []), ...(resumeState?.report?.outcomes || []), ...(resumeState?.omittedOutcomes || [])];
	const declaredOutcomes = new Map(savedOutcomes.map(identifiedOutcome).map((outcome) => [outcome.requirementId, outcome]));
	const omittedOutcomes = () => [...declaredOutcomes.values()].filter((outcome) => !report?.outcomes.some((item) => requirementId(item.requirement) === outcome.requirementId));
	const seenNotifications = new Set(resumeState?.notificationDeliveries || []);
	const resultDeliveries = new Set(resumeState?.resultDeliveries || []);
	// Native result_index restarts with each CLI process, so it identifies deliveries only within this run.
	const resultIndexes = new Set();
	let terminalSequence = Math.max(0, ...[...tasks.values()].map((task) => task.terminalSequence || 0));
	const markRunning = (id, description, explicitResume = false, isBackgrounded) => {
		const task = tasks.get(id);
		// A stop ends this invocation's required work; recovery needs a deliberate follow-up.
		if (task?.terminalStatus === "stopped") return;
		// Live evidence can resolve snapshot uncertainty; failures/unknowns need a resume.
		if (["failed", "unknown"].includes(task?.terminalStatus) && !explicitResume) return;
		tasks.set(id, { taskId: id, status: "running", isBackgrounded: isBackgrounded ?? task?.isBackgrounded,
			description: description || task?.description, history: task?.history || [] });
	};
	const recordTerminal = (id, identity, description, outcome) => {
		// Fixed-size fingerprints survive sanitized/capped persistence without retaining raw secrets.
		const delivery = createHash("sha256").update(identity).digest("hex");
		if (seenNotifications.has(delivery)) return;
		seenNotifications.add(delivery);
		const task = tasks.get(id) || { taskId: id, description };
		// Later terminal evidence is retained but cannot replace this invocation's stop barrier.
		// Other explicit terminal uncertainty needs a resume; snapshot uncertainty can resolve late.
		const conflicting = task.terminalStatus === "stopped" ||
			(outcome.status === "completed" && ["failed", "unknown"].includes(task.terminalStatus));
		tasks.set(id, { ...task, ...(conflicting ? {} : { ...outcome, terminalStatus: outcome.status, terminalSequence: ++terminalSequence }), history: [...(task.history || []), outcome] });
	};
	let report;
	let reason = "No explicit evidence-backed completion report was received.";
	return {
		record(event) {
			if (event.type !== "system" || event.ambient) return;
			if (event.subtype === "task_started" && event.task_id) markRunning(event.task_id, event.description, false, event.is_backgrounded);
			if (event.subtype === "task_updated" && event.task_id &&
				(event.patch?.status === "running" || typeof event.patch?.is_backgrounded === "boolean")) {
				markRunning(event.task_id, event.patch.description, event.patch.status === "running", event.patch.is_backgrounded);
			}
			// Interruption can prevent the separate notification, so a terminal patch is terminal evidence.
			if (event.subtype === "task_updated" && event.task_id && Object.hasOwn(NATIVE_TERMINAL_STATUS, event.patch?.status)) {
				const status = NATIVE_TERMINAL_STATUS[event.patch.status];
				const identity = event.uuid ? `uuid:${event.uuid}` : JSON.stringify(["task_updated", event.task_id, event.patch.status, event.patch.error, event.patch.end_time]);
				recordTerminal(event.task_id, identity, event.patch.description, { status, summary: event.patch.error });
			}
			if (event.subtype === "task_notification" && event.task_id) {
				// Without a delivery ID, identical content cannot prove a new completion.
				const identity = event.uuid ? `uuid:${event.uuid}` : JSON.stringify([event.task_id, event.status, event.summary, event.output_file, event.description]);
				recordTerminal(event.task_id, identity, event.description, { status: event.status || "unknown", summary: event.summary, outputFile: event.output_file });
			}
			if (event.subtype === "background_tasks_changed") {
				const active = new Set();
				for (const task of event.tasks || []) if (!task.ambient && task.task_id) {
					active.add(task.task_id);
					markRunning(task.task_id, task.description, false, true);
				}
				// This snapshot contains only background work; foreground omission says nothing.
				for (const task of tasks.values()) if (task.status === "running" && task.isBackgrounded !== false && !active.has(task.taskId)) task.status = "unknown";
			}
		},
		// Returns false for a result delivery already consumed by this task, including before a resume.
		acceptResult(event, untaggedNative) {
			if (!event.uuid && event.result_index !== undefined) {
				if (resultIndexes.has(event.result_index)) return false;
				resultIndexes.add(event.result_index);
				return true;
			}
			// An identical untagged native delivery cannot prove a new queue drain.
			const identity = event.uuid ? `uuid:${event.uuid}` : untaggedNative ? `native:${JSON.stringify(event)}` : undefined;
			if (!identity) return true;
			const delivery = createHash("sha256").update(identity).digest("hex");
			if (resultDeliveries.has(delivery)) return false;
			resultDeliveries.add(delivery);
			return true;
		},
		assess(value) {
			if (!validReport(value, taskId)) {
				reason = "Missing or unsupported explicit completion report; completion remains unresolved.";
				return { action: "continue", reason };
			}
			report = value;
			for (const outcome of declarations(report).map(identifiedOutcome)) if (!declaredOutcomes.has(outcome.requirementId)) declaredOutcomes.set(outcome.requirementId, outcome);
			for (const outcome of report.outcomes.map(identifiedOutcome)) declaredOutcomes.set(outcome.requirementId, outcome);
			for (const id of report.background_task_ids) if (!tasks.has(id)) tasks.set(id, { taskId: id, status: "running", description: "Required by Claude Code's task report" });
			if (report.disposition === "needs_input" && report.question.trim()) return { action: "end", disposition: "needs_input", reason: report.question };
			if (report.disposition === "unfinished") return { action: "end", disposition: "unfinished", reason: report.outstanding.join("; ") || "Claude Code reported that work is unfinished." };
			const stopped = [...tasks.values()].filter((task) => task.status === "stopped");
			if (stopped.length) return { action: "end", disposition: "unfinished", reason: `Required background work stopped: ${stopped.map((task) => `${task.taskId} (${task.status})`).join(", ")}.` };
			// Accept Claude's attribution, not a host inference from arbitrary passing work.
			const resolved = new Set();
			for (const resolution of report.resolved_failures || []) {
				const failed = tasks.get(resolution.task_id);
				const replacement = tasks.get(resolution.replacement_task_id);
				if (failed?.status !== "failed" || replacement?.status !== "completed" ||
					!(replacement.terminalSequence > failed.terminalSequence)) {
					reason = "Failure resolution lacks an observed failed check and fresh completed replacement; completion remains unresolved.";
					return { action: "continue", reason };
				}
				resolved.add(failed.taskId);
			}
			const unfinished = (task) => task.status !== "completed" && !resolved.has(task.taskId);
			const pendingIds = report.background_task_ids.filter((id) => unfinished(tasks.get(id)));
			const unfinishedTasks = [...tasks.values()].some(unfinished);
			const omitted = omittedOutcomes();
			if (omitted.length) {
				reason = `Known required outcomes omitted: ${omitted.map((outcome) => outcome.requirement).join("; ")}. Include every declared requirement with current evidence in the completion report.`;
				return { action: "continue", reason };
			}
			if (report.disposition === "finished" && report.outcomes.length &&
				report.outcomes.every((item) => item.status === "verified" && item.evidence.length) &&
				!report.outstanding.length && !report.unverified.length && !report.question.trim() && !pendingIds.length && !unfinishedTasks) {
				return { action: "end", disposition: "finished", reason: "Claude Code reported every requested outcome with evidence; not independently certified by Pi." };
			}
			const failed = [...tasks.values()].filter((task) => task.status === "failed" && !resolved.has(task.taskId));
			reason = failed.length
				? `Failed verification remains unresolved: ${failed.map((task) => `${task.taskId} (${task.status})`).join(", ")}. Continue the approved repair and verification.`
				: "Required work or evidence remains unresolved; request a complete, attributable report after finishing it.";
			return { action: "continue", reason };
		},
		get waiting() {
			return [...tasks.values()].some((task) => task.status === "running") ||
				(report?.background_task_ids || []).some((id) => !tasks.has(id));
		},
		snapshot() { return { taskId, requiredOutcomes: [...declaredOutcomes.values()], notificationDeliveries: [...seenNotifications], resultDeliveries: [...resultDeliveries], report, reason, taskOutcomes: [...tasks.values()], omittedOutcomes: omittedOutcomes() }; },
	};
}
