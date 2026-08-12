export const ROLE_THINKING_LEVELS = {
  scout: 'low',
  planner: 'high',
  jester: 'high',
  'task-writer': 'medium',
  worker: 'medium',
  reviewer: 'high',
};

/**
 * Return the configured default thinking level for a pipeline role.
 * Unknown roles intentionally fall back to medium rather than crashing.
 *
 * @param {string} role
 * @returns {'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'}
 */
export function getRoleThinkingLevel(role) {
  return ROLE_THINKING_LEVELS[role] ?? 'medium';
}
