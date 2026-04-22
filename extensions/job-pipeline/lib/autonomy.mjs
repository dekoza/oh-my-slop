/**
 * Autonomy state tracker.
 *
 * Counts consecutive retrospectives that produced zero process changes.
 * When the streak reaches the configured threshold, the extension suggests
 * loosening a human gate. Any retro that produces changes resets the streak.
 *
 * State is kept as a plain object so it can be serialised to JSON and
 * persisted across sessions.
 */

/**
 * @param {{ cleanRetroStreak: number, lastRetroAt?: number }} state
 * @returns {{ cleanRetroStreak: number, lastRetroAt: number }}
 */
export function recordCleanRetro(state) {
  return { ...state, cleanRetroStreak: state.cleanRetroStreak + 1, lastRetroAt: Date.now() };
}

/**
 * @param {{ cleanRetroStreak: number, lastRetroAt?: number }} state
 * @returns {{ cleanRetroStreak: number, lastRetroAt: number }}
 */
export function recordRetroWithChanges(state) {
  return { ...state, cleanRetroStreak: 0, lastRetroAt: Date.now() };
}

/**
 * Returns true when the streak has reached the required threshold to
 * suggest granting more autonomy.
 *
 * @param {{ cleanRetroStreak: number }} state
 * @param {{ cleanRetrosRequired: number }} config
 * @returns {boolean}
 */
export function shouldSuggestAutonomy(state, config) {
  return state.cleanRetroStreak >= config.cleanRetrosRequired;
}
