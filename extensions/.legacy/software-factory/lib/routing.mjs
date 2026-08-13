export function selectWorkerProfile(workers, phase, ticket = { labels: [] }) {
	const labels = new Set(ticket?.labels ?? []);
	const rule = workers.routing.rules.find((candidate) =>
		candidate.phases.includes(phase)
		&& candidate.labelsAny.some((label) => labels.has(label)),
	);
	const name = rule?.profile ?? workers.routing.defaults[phase];
	return { name, ...workers.profiles[name] };
}
