import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readJobEvents } from '../../extensions/job-pipeline/lib/job-events.mjs';
import {
  captureInterviewSpec,
  recordPoolDraw,
  startTrackedJob,
} from '../../extensions/job-pipeline/lib/job-lifecycle.mjs';
import { loadJobSnapshot, getActiveJobId } from '../../extensions/job-pipeline/lib/job-store.mjs';

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-lifecycle-'));
}

function buildJobState(overrides = {}) {
  return {
    id: 'job-2026-04-25-life0001',
    description: 'Add OAuth login',
    cwd: '/tmp/project',
    step: 'interview',
    createdAt: 1_761_000_000_000,
    updatedAt: 1_761_000_000_000,
    cycleIndex: 1,
    replanCount: 0,
    ...overrides,
  };
}

test('startTrackedJob persists the snapshot and appends a RUN_CREATED event', () => {
  const agentDir = createAgentDir();
  const state = buildJobState();

  const persisted = startTrackedJob(agentDir, state);

  assert.deepEqual(loadJobSnapshot(agentDir, state.id), persisted);
  assert.equal(getActiveJobId(agentDir), state.id);

  const events = readJobEvents(agentDir, state.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'RUN_CREATED');
  assert.equal(events[0].data.id, state.id);
  assert.equal(events[0].data.description, state.description);
  assert.equal(events[0].data.cwd, state.cwd);
  assert.equal(events[0].data.step, 'interview');
});

test('captureInterviewSpec updates the snapshot and appends INTERVIEW_CAPTURED', () => {
  const agentDir = createAgentDir();
  const state = startTrackedJob(agentDir, buildJobState());
  const spec = {
    goal: 'Ship OAuth login',
    context: 'Keep the auth UI unchanged.',
    constraints: ['Preserve existing routes'],
    outOfScope: ['Social login redesign'],
    questionsToScout: ['Which auth files matter?'],
    evidenceHint: 'both',
  };

  const updated = captureInterviewSpec(agentDir, state, spec, { now: 1_761_000_000_500 });

  assert.deepEqual(loadJobSnapshot(agentDir, state.id), updated);
  assert.equal(updated.step, 'pipeline-ready');
  assert.deepEqual(updated.spec, spec);
  assert.equal(updated.updatedAt, 1_761_000_000_500);

  const events = readJobEvents(agentDir, state.id);
  assert.equal(events.at(-1)?.type, 'INTERVIEW_CAPTURED');
  assert.deepEqual(events.at(-1)?.data.spec, spec);
  assert.equal(events.at(-1)?.data.step, 'pipeline-ready');
});

test('recordPoolDraw stores the pool in the snapshot and appends POOL_DRAWN', () => {
  const agentDir = createAgentDir();
  const state = captureInterviewSpec(
    agentDir,
    startTrackedJob(agentDir, buildJobState()),
    {
      goal: 'Ship OAuth login',
      context: 'Keep the auth UI unchanged.',
      constraints: [],
      outOfScope: [],
      questionsToScout: [],
      evidenceHint: 'both',
    },
    { now: 1_761_000_000_100 },
  );
  const pool = {
    scout: 'mock/scout',
    planner: 'mock/planner',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  };

  const updated = recordPoolDraw(agentDir, state, pool, { now: 1_761_000_000_700 });

  assert.deepEqual(loadJobSnapshot(agentDir, state.id), updated);
  assert.deepEqual(updated.pool, pool);
  assert.equal(updated.updatedAt, 1_761_000_000_700);

  const events = readJobEvents(agentDir, state.id);
  assert.equal(events.at(-1)?.type, 'POOL_DRAWN');
  assert.deepEqual(events.at(-1)?.data.pool, pool);
});
