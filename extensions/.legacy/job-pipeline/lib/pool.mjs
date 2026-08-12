const ROLES = ['scout', 'planner', 'jester', 'task-writer', 'worker', 'reviewer'];

/**
 * Draw one model per role from the configured pools, filtering to only
 * models currently available in the user's pi setup.
 *
 * Rules:
 * - Each role gets one randomly drawn model from its pool ∩ available.
 * - planner and jester must be different models when the pools allow it.
 * - Throws if any role has no available models after intersection.
 *
 * @param {{ pools: Record<string, { models: string[] }> }} config
 * @param {string[]} availableModels  Full "provider/id" strings.
 * @returns {Record<string, string>}  SessionPool: role → modelId
 */
export function drawSessionPool(config, availableModels) {
  const available = new Set(availableModels);
  const drawn = {};

  for (const role of ROLES) {
    const eligible = (config.pools[role]?.models ?? []).filter((m) => available.has(m));
    if (eligible.length === 0) {
      throw new Error(`No available models for role: ${role}`);
    }

    if (role === 'jester' && drawn.planner && eligible.length > 1) {
      // Prefer a model different from the planner to ensure adversarial diversity.
      const others = eligible.filter((m) => m !== drawn.planner);
      drawn[role] = others[Math.floor(Math.random() * others.length)];
    } else {
      drawn[role] = eligible[Math.floor(Math.random() * eligible.length)];
    }
  }

  return drawn;
}
