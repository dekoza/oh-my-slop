import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getActiveJobId,
  getJobSnapshotPath,
  getLegacyJobStatePath,
  loadJobSnapshot,
} from '../../extensions/job-pipeline/lib/job-store.mjs';
import { appendJobEvent } from '../../extensions/job-pipeline/lib/job-events.mjs';
import { captureInterviewSpec, recordPoolDraw, startTrackedJob } from '../../extensions/job-pipeline/lib/job-lifecycle.mjs';
import {
  clearJobState,
  readJobState,
  writeJobState,
} from '../../extensions/job-pipeline/lib/state.mjs';

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-state-'));
}

function buildJobState(overrides = {}) {
  return {
    id: 'job-2026-04-25-state0001',
    description: 'Ship a safer OAuth callback flow',
    cwd: '/tmp/project',
    step: 'planning',
    createdAt: 1_761_000_000_000,
    updatedAt: 1_761_000_000_001,
    cycleIndex: 1,
    replanCount: 0,
    ...overrides,
  };
}

test('writeJobState persists the snapshot in the per-job store and marks it active', () => {
  const agentDir = createAgentDir();
  const state = buildJobState();

  writeJobState(agentDir, state);

  assert.equal(getActiveJobId(agentDir), state.id);
  assert.ok(existsSync(getJobSnapshotPath(agentDir, state.id)));
  assert.deepEqual(loadJobSnapshot(agentDir, state.id), state);
});

test('readJobState returns the active job snapshot from the per-job store', () => {
  const agentDir = createAgentDir();
  const state = buildJobState({ step: 'workers' });

  writeJobState(agentDir, state);

  assert.deepEqual(readJobState(agentDir), state);
});

test('readJobState migrates legacy job-state.json into the per-job store on first access', () => {
  const agentDir = createAgentDir();
  const legacyState = buildJobState({
    id: 'job-2026-04-25-statelegacy',
    step: 'pipeline-ready',
    spec: { goal: 'Preserve login flow' },
  });
  const legacyPath = getLegacyJobStatePath(agentDir);

  mkdirSync(join(agentDir, 'extensions', 'job-pipeline'), { recursive: true });
  writeFileSync(legacyPath, `${JSON.stringify(legacyState, null, 2)}\n`, 'utf8');

  assert.deepEqual(readJobState(agentDir), legacyState);
  assert.equal(getActiveJobId(agentDir), legacyState.id);
  assert.deepEqual(loadJobSnapshot(agentDir, legacyState.id), legacyState);
});

test('readJobState prefers replayed state when events reach the same or later step', () => {
  const agentDir = createAgentDir();
  const started = startTrackedJob(agentDir, buildJobState({ step: 'interview' }));
  const interviewed = captureInterviewSpec(agentDir, started, {
    goal: 'Ship OAuth login',
    context: 'Keep auth UI unchanged.',
    constraints: [],
    outOfScope: [],
    questionsToScout: [],
    evidenceHint: 'both',
  }, { now: 200 });
  recordPoolDraw(agentDir, interviewed, {
    scout: 'mock/scout',
    planner: 'mock/planner',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  }, { now: 300 });
  appendJobEvent(agentDir, started.id, 'STAGE_COMPLETED', {
    stage: 'planning',
    step: 'task-writing',
    result: { finalPlan: 'Replay plan', planCritiques: ['Looks fine.'] },
  }, { recordedAt: 400 });

  writeJobState(agentDir, {
    ...started,
    step: 'task-writing',
    finalPlan: 'Stale snapshot plan',
    updatedAt: 450,
  });

  const resolved = readJobState(agentDir);

  assert.equal(resolved.step, 'task-writing');
  assert.equal(resolved.finalPlan, 'Replay plan');
  assert.equal(loadJobSnapshot(agentDir, started.id)?.finalPlan, 'Replay plan');
  assert.equal(loadJobSnapshot(agentDir, started.id)?.step, 'task-writing');
});

test('readJobState falls back to the stored snapshot when replayed events are behind it', () => {
  const agentDir = createAgentDir();
  const started = startTrackedJob(agentDir, buildJobState({ step: 'interview' }));
  const interviewed = captureInterviewSpec(agentDir, started, {
    goal: 'Ship OAuth login',
    context: 'Keep auth UI unchanged.',
    constraints: [],
    outOfScope: [],
    questionsToScout: [],
    evidenceHint: 'both',
  }, { now: 200 });
  recordPoolDraw(agentDir, interviewed, {
    scout: 'mock/scout',
    planner: 'mock/planner',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  }, { now: 300 });

  const advancedSnapshot = {
    ...interviewed,
    pool: {
      scout: 'mock/scout',
      planner: 'mock/planner',
      jester: 'mock/jester',
      'task-writer': 'mock/task-writer',
      worker: 'mock/worker',
      reviewer: 'mock/reviewer',
    },
    step: 'workers',
    finalPlan: 'Stored snapshot plan',
    updatedAt: 500,
  };
  writeJobState(agentDir, advancedSnapshot);

  const resolved = readJobState(agentDir);

  assert.deepEqual(resolved, advancedSnapshot);
});

test('readJobState rebuilds a missing snapshot from events and persists it', () => {
  const agentDir = createAgentDir();
  const started = startTrackedJob(agentDir, buildJobState({ step: 'interview' }));
  const interviewed = captureInterviewSpec(agentDir, started, {
    goal: 'Ship OAuth login',
    context: 'Keep auth UI unchanged.',
    constraints: [],
    outOfScope: [],
    questionsToScout: [],
    evidenceHint: 'both',
  }, { now: 200 });
  recordPoolDraw(agentDir, interviewed, {
    scout: 'mock/scout',
    planner: 'mock/planner',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  }, { now: 300 });

  rmSync(getJobSnapshotPath(agentDir, started.id));

  const resolved = readJobState(agentDir);

  assert.equal(resolved.step, 'pipeline-ready');
  assert.deepEqual(resolved.spec.goal, 'Ship OAuth login');
  assert.ok(existsSync(getJobSnapshotPath(agentDir, started.id)));
});

test('clearJobState removes the active pointer but preserves historical job snapshots', () => {
  const agentDir = createAgentDir();
  const state = buildJobState();

  writeJobState(agentDir, state);
  clearJobState(agentDir);

  assert.equal(getActiveJobId(agentDir), null);
  assert.equal(readJobState(agentDir), null);
  assert.deepEqual(loadJobSnapshot(agentDir, state.id), state);
});
