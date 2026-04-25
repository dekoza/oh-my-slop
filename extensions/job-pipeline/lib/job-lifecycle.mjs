import { appendJobEvent } from './job-events.mjs';
import { writeJobState } from './state.mjs';

export function startTrackedJob(agentDir, state, { now = Date.now() } = {}) {
  const nextState = {
    ...state,
    createdAt: Number(state.createdAt ?? now),
    updatedAt: Number(state.updatedAt ?? state.createdAt ?? now),
  };

  writeJobState(agentDir, nextState);
  appendJobEvent(agentDir, nextState.id, 'RUN_CREATED', {
    id: nextState.id,
    description: nextState.description ?? '',
    cwd: nextState.cwd ?? '',
    step: nextState.step ?? 'interview',
    createdAt: nextState.createdAt,
    cycleIndex: Number(nextState.cycleIndex ?? 1),
    replanCount: Number(nextState.replanCount ?? 0),
  }, { recordedAt: nextState.createdAt });

  return nextState;
}

export function captureInterviewSpec(agentDir, jobState, spec, { now = Date.now() } = {}) {
  ensureJobState(jobState);

  const nextState = {
    ...jobState,
    spec,
    step: 'pipeline-ready',
    updatedAt: Number(now),
  };

  writeJobState(agentDir, nextState);
  appendJobEvent(agentDir, nextState.id, 'INTERVIEW_CAPTURED', {
    spec,
    step: nextState.step,
  }, { recordedAt: nextState.updatedAt });

  return nextState;
}

export function recordPoolDraw(agentDir, jobState, pool, { now = Date.now() } = {}) {
  ensureJobState(jobState);

  const nextState = {
    ...jobState,
    pool,
    updatedAt: Number(now),
  };

  writeJobState(agentDir, nextState);
  appendJobEvent(agentDir, nextState.id, 'POOL_DRAWN', {
    pool,
  }, { recordedAt: nextState.updatedAt });

  return nextState;
}

function ensureJobState(jobState) {
  if (!jobState || typeof jobState !== 'object' || Array.isArray(jobState)) {
    throw new Error('jobState must be an object.');
  }
  if (typeof jobState.id !== 'string' || jobState.id.trim().length === 0) {
    throw new Error('jobState must include a non-empty id.');
  }
}
