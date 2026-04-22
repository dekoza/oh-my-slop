/**
 * Resolve a flat list of tasks into ordered execution batches.
 *
 * Tasks within the same batch have no dependency on each other and can run
 * in parallel. Batches are ordered so that all dependencies of a batch are
 * satisfied by prior batches.
 *
 * @param {Array<{ id: string, dependsOn: string[] }>} tasks
 * @returns {Array<Array<{ id: string, dependsOn: string[] }>>}
 * @throws {Error} if a circular dependency is detected.
 */
export function resolveExecutionBatches(tasks) {
  if (tasks.length === 0) return [];

  const completed = new Set();
  const remaining = [...tasks];
  const batches = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((t) => t.dependsOn.every((dep) => completed.has(dep)));

    if (ready.length === 0) {
      const stuck = remaining.map((t) => t.id).join(', ');
      throw new Error(`Circular dependency detected among tasks: ${stuck}`);
    }

    batches.push(ready);
    for (const task of ready) {
      completed.add(task.id);
      remaining.splice(remaining.indexOf(task), 1);
    }
  }

  return batches;
}

/**
 * Validate a task graph for structural errors.
 * Returns an array of human-readable error messages (empty = valid).
 *
 * @param {{ tasks: Array<{ id: string, dependsOn: string[] }> }} graph
 * @returns {string[]}
 */
export function validateTaskGraph(graph) {
  const errors = [];
  const ids = new Set((graph.tasks ?? []).map((t) => t.id));

  for (const task of graph.tasks ?? []) {
    for (const dep of task.dependsOn ?? []) {
      if (!ids.has(dep)) {
        errors.push(`Task "${task.id}" depends on unknown task "${dep}".`);
      }
    }
  }

  if (errors.length > 0) return errors;

  try {
    resolveExecutionBatches(graph.tasks ?? []);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return errors;
}
