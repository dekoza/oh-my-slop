const strings = { type: "array", items: { type: "string" } };

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
		},
	};
}

export function supervisionInstructions(taskId) {
	return `The host supervises the approved task across turns. Stay within its original scope and existing permissions; do not expand authority. Keep working until finished or genuinely needing input. Report through StructuredOutput using task_id ${taskId}. Map EVERY requested outcome to evidence (tests/checks/artifacts), including unchanged verified outcomes. Identify all unverified requirements and outstanding actions. Use finished only when every requested outcome is verified and no required work remains; this is your evidence-backed report, not independent Pi certification. Use waiting when required background work is running, list its task IDs, and consume its native notifications before continuing outstanding actions. Use needs_input only for an intentional pause, with the precise question; saved-session follow-ups supply the answer to the same task. Use unfinished when unable to continue, preserving recovery information. Never use ordinary done prose or a successful turn as completion evidence. Do not stop required background work merely to end a turn.`;
}

function validReport(report, taskId) {
	if (!report || Array.isArray(report) || typeof report !== "object" || report.task_id !== taskId ||
		!["waiting", "finished", "needs_input", "unfinished"].includes(report.disposition)) return false;
	const fields = ["task_id", "disposition", "outcomes", "outstanding", "unverified", "question", "background_task_ids"];
	if (Object.keys(report).some((key) => !fields.includes(key)) || typeof report.question !== "string") return false;
	for (const key of ["outstanding", "unverified", "background_task_ids"]) {
		if (!Array.isArray(report[key]) || report[key].some((item) => typeof item !== "string" || !item.trim())) return false;
	}
	return Array.isArray(report.outcomes) && report.outcomes.every((item) => item &&
		Object.keys(item).every((key) => ["requirement", "status", "evidence"].includes(key)) &&
		typeof item.requirement === "string" && item.requirement.trim() &&
		["verified", "unverified"].includes(item.status) && Array.isArray(item.evidence) &&
		item.evidence.every((evidence) => typeof evidence === "string" && evidence.trim()));
}

// Tracks only this invocation's non-ambient background work. Terminal records survive snapshots.
export function createTaskSupervision(taskId) {
	const tasks = new Map();
	let report;
	let reason = "No explicit evidence-backed completion report was received.";
	return {
		record(event) {
			if (event.type !== "system" || event.ambient) return;
			if (event.subtype === "task_started" && event.task_id && !tasks.has(event.task_id)) {
				tasks.set(event.task_id, { taskId: event.task_id, status: "running", description: event.description });
			}
			if (event.subtype === "task_notification" && event.task_id && tasks.has(event.task_id)) {
				const task = tasks.get(event.task_id);
				if (task.status !== "running" && task.status !== "unknown") return;
				tasks.set(event.task_id, { ...task, status: event.status || "unknown", summary: event.summary, outputFile: event.output_file });
			}
			if (event.subtype === "background_tasks_changed") {
				const active = new Set();
				for (const task of event.tasks || []) if (!task.ambient && task.task_id) {
					active.add(task.task_id);
					if (!tasks.has(task.task_id)) tasks.set(task.task_id, { taskId: task.task_id, status: "running", description: task.description });
				}
				for (const task of tasks.values()) if (task.status === "running" && !active.has(task.taskId)) task.status = "unknown";
			}
		},
		assess(value) {
			if (!validReport(value, taskId)) {
				reason = "Missing or unsupported explicit completion report; completion remains unresolved.";
				return { action: "continue", reason };
			}
			report = value;
			for (const id of report.background_task_ids) if (!tasks.has(id)) tasks.set(id, { taskId: id, status: "running", description: "Required by Claude Code's task report" });
			if (report.disposition === "needs_input" && report.question.trim()) return { action: "end", disposition: "needs_input", reason: report.question };
			if (report.disposition === "unfinished") return { action: "end", disposition: "unfinished", reason: report.outstanding.join("; ") || "Claude Code reported that work is unfinished." };
			const failed = [...tasks.values()].filter((task) => ["stopped", "failed"].includes(task.status));
			if (failed.length) return { action: "end", disposition: "unfinished", reason: `Required background work stopped or failed: ${failed.map((task) => `${task.taskId} (${task.status})`).join(", ")}.` };
			const pendingIds = report.background_task_ids.filter((id) => tasks.get(id)?.status !== "completed");
			const unfinishedTasks = [...tasks.values()].some((task) => task.status !== "completed");
			if (report.disposition === "finished" && report.outcomes.length &&
				report.outcomes.every((item) => item.status === "verified" && item.evidence.length) &&
				!report.outstanding.length && !report.unverified.length && !report.question.trim() && !pendingIds.length && !unfinishedTasks) {
				return { action: "end", disposition: "finished", reason: "Claude Code reported every requested outcome with evidence; not independently certified by Pi." };
			}
			reason = "Required work or evidence remains unresolved; request a complete, attributable report after finishing it.";
			return { action: "continue", reason };
		},
		get waiting() {
			return [...tasks.values()].some((task) => task.status === "running") ||
				(report?.background_task_ids || []).some((id) => !tasks.has(id));
		},
		snapshot() { return { report, reason, taskOutcomes: [...tasks.values()] }; },
	};
}
