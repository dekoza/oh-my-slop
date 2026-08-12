import { drawSessionPool } from './pool.mjs';

export function prepareInterviewState({ jobState, config, availableModels }) {
  const nextState = {
    ...(jobState ?? {}),
  };

  if (!nextState.pool) {
    nextState.pool = drawSessionPool(config, availableModels);
  }

  const plannerModelId = nextState.pool?.planner;
  if (typeof plannerModelId !== 'string' || plannerModelId.trim().length === 0) {
    throw new Error('Interview preparation requires a planner model in the job pool.');
  }

  return {
    jobState: nextState,
    plannerModelId,
  };
}
