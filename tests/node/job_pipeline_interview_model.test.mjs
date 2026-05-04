import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareInterviewState } from '../../extensions/job-pipeline/lib/interview-model.mjs';

const CONFIG = {
  pools: {
    scout: { models: ['mock/scout'] },
    planner: { models: ['mock/planner'] },
    jester: { models: ['mock/jester'] },
    'task-writer': { models: ['mock/task-writer'] },
    worker: { models: ['mock/worker'] },
    reviewer: { models: ['mock/reviewer'] },
  },
};

const AVAILABLE_MODELS = [
  'mock/scout',
  'mock/planner',
  'mock/jester',
  'mock/task-writer',
  'mock/worker',
  'mock/reviewer',
];

test('prepareInterviewState draws the pool before the interview begins', () => {
  const initialState = {
    id: 'job-1',
    description: 'Add OAuth login',
    cwd: '/tmp/project',
    step: 'interview',
  };

  const prepared = prepareInterviewState({
    jobState: initialState,
    config: CONFIG,
    availableModels: AVAILABLE_MODELS,
  });

  assert.equal(prepared.plannerModelId, 'mock/planner');
  assert.deepEqual(prepared.jobState.pool, {
    scout: 'mock/scout',
    planner: 'mock/planner',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  });
});

test('prepareInterviewState preserves an already drawn pool on resume', () => {
  const existingPool = {
    scout: 'mock/scout',
    planner: 'mock/planner-existing',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  };
  const prepared = prepareInterviewState({
    jobState: {
      id: 'job-2',
      description: 'Resume interview',
      cwd: '/tmp/project',
      step: 'interview',
      pool: existingPool,
    },
    config: CONFIG,
    availableModels: AVAILABLE_MODELS,
  });

  assert.equal(prepared.plannerModelId, 'mock/planner-existing');
  assert.deepEqual(prepared.jobState.pool, existingPool);
});

test('prepareInterviewState throws when the resulting pool has no planner model', () => {
  assert.throws(
    () => prepareInterviewState({
      jobState: {
        id: 'job-3',
        description: 'Broken config',
        cwd: '/tmp/project',
        step: 'interview',
        pool: {
          scout: 'mock/scout',
        },
      },
      config: CONFIG,
      availableModels: AVAILABLE_MODELS,
    }),
    /planner model/i,
  );
});
