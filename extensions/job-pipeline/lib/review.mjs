/**
 * Build a reviewer-facing summary that combines task requirements, worker
 * results, and proof artifact hints. The reviewer still has read-only tools,
 * but this summary gives it an explicit checklist and starting point.
 *
 * @param {{ tasks?: Array<{ id: string, title?: string, description?: string, testRequirement?: string }> } | null | undefined} taskGraph
 * @param {Array<{ taskId: string, success: boolean, summary?: string, artifactFiles?: string[], failureReport?: { attempted?: string, found?: string, reason?: string } }> | null | undefined} workerResults
 * @returns {string}
 */
export function buildReviewTaskContext(taskGraph, workerResults) {
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : [];
  const results = Array.isArray(workerResults) ? workerResults : [];

  if (results.length === 0) {
    return 'No worker results available.';
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return results
    .map((result) => {
      const task = tasksById.get(result.taskId) ?? {};
      const lines = [
        `Task ${result.taskId}${task.title ? ` — ${task.title}` : ''}`,
        `Requirement: ${task.description ?? '(not provided)'}`,
        `Test requirement: ${task.testRequirement ?? '(not provided)'}`,
        `Worker status: ${result.success ? 'success' : 'failed'}`,
        `Worker summary: ${result.summary || '(none provided)'}`,
        `Reported artifacts: ${Array.isArray(result.artifactFiles) && result.artifactFiles.length > 0 ? result.artifactFiles.join(', ') : 'none reported'}`,
      ];

      if (!result.success && result.failureReport) {
        lines.push(`Failure attempted: ${result.failureReport.attempted ?? '(not provided)'}`);
        lines.push(`Failure found: ${result.failureReport.found ?? '(not provided)'}`);
        lines.push(`Failure reason: ${result.failureReport.reason ?? '(not provided)'}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}
