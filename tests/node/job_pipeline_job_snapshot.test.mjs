import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rebuildSnapshotFromEvents,
  reduceJobEvent,
} from '../../extensions/job-pipeline/lib/job-snapshot.mjs';

function buildEvent(type, data, recordedAt) {
  return {
    seq: recordedAt,
    type,
    recordedAt,
    data,
    checksum: 'not-used-in-reducer-tests',
  };
}

test('rebuildSnapshotFromEvents reconstructs a newly created job', () => {
  const snapshot = rebuildSnapshotFromEvents([
    buildEvent('RUN_CREATED', {
      id: 'job-2026-04-25-replay0001',
      description: 'Add OAuth login',
      cwd: '/tmp/project',
      step: 'interview',
    }, 100),
  ]);

  assert.equal(snapshot.id, 'job-2026-04-25-replay0001');
  assert.equal(snapshot.description, 'Add OAuth login');
  assert.equal(snapshot.cwd, '/tmp/project');
  assert.equal(snapshot.step, 'interview');
  assert.equal(snapshot.createdAt, 100);
  assert.equal(snapshot.updatedAt, 100);
});

test('rebuildSnapshotFromEvents applies interview capture and pool draw events', () => {
  const snapshot = rebuildSnapshotFromEvents([
    buildEvent('RUN_CREATED', {
      id: 'job-2026-04-25-replay0002',
      description: 'Add OAuth login',
      cwd: '/tmp/project',
      step: 'interview',
    }, 100),
    buildEvent('INTERVIEW_CAPTURED', {
      spec: { goal: 'Ship OAuth login', evidenceHint: 'both' },
      step: 'pipeline-ready',
    }, 200),
    buildEvent('POOL_DRAWN', {
      pool: { planner: 'github-copilot/gpt-5', reviewer: 'github-copilot/claude-sonnet-4-5' },
    }, 300),
  ]);

  assert.deepEqual(snapshot.spec, { goal: 'Ship OAuth login', evidenceHint: 'both' });
  assert.deepEqual(snapshot.pool, {
    planner: 'github-copilot/gpt-5',
    reviewer: 'github-copilot/claude-sonnet-4-5',
  });
  assert.equal(snapshot.step, 'pipeline-ready');
  assert.equal(snapshot.updatedAt, 300);
});

test('rebuildSnapshotFromEvents tracks gate denial without marking the job complete', () => {
  const snapshot = rebuildSnapshotFromEvents([
    buildEvent('RUN_CREATED', {
      id: 'job-2026-04-25-replay0003',
      description: 'Add OAuth login',
      cwd: '/tmp/project',
      step: 'planning',
    }, 100),
    buildEvent('GATE_DENIED', {
      gate: 'plan-approval',
      step: 'planning',
    }, 200),
  ]);

  assert.equal(snapshot.pausedGate, 'plan-approval');
  assert.equal(snapshot.step, 'planning');
  assert.equal(snapshot.humanApproved, undefined);
  assert.equal(snapshot.merged, undefined);
});

test('rebuildSnapshotFromEvents resets planning state after worker failure replan', () => {
  const snapshot = rebuildSnapshotFromEvents([
    buildEvent('RUN_CREATED', {
      id: 'job-2026-04-25-replay0004',
      description: 'Add OAuth login',
      cwd: '/tmp/project',
      step: 'planning',
    }, 100),
    buildEvent('STAGE_COMPLETED', {
      stage: 'planning',
      result: {
        finalPlan: 'Implement OAuth login carefully.',
        planCritiques: ['Round 1 critique'],
      },
    }, 200),
    buildEvent('STAGE_COMPLETED', {
      stage: 'task-writing',
      result: {
        taskGraph: { tasks: [{ id: 'task-1', dependsOn: [] }] },
      },
    }, 300),
    buildEvent('TASK_FAILED', {
      taskId: 'task-1',
      failureReport: { reason: 'Tests still fail.' },
    }, 400),
    buildEvent('REPLAN_REQUESTED', {
      reason: 'Worker failure',
      step: 'planning',
      replanCount: 1,
    }, 500),
  ]);

  assert.equal(snapshot.step, 'planning');
  assert.equal(snapshot.replanCount, 1);
  assert.equal(snapshot.finalPlan, undefined);
  assert.equal(snapshot.planCritiques, undefined);
  assert.equal(snapshot.taskGraph, undefined);
  assert.equal(snapshot.lastError?.reason, 'Worker failure');
});

test('rebuildSnapshotFromEvents increments cycle after proof review denial', () => {
  const snapshot = rebuildSnapshotFromEvents([
    buildEvent('RUN_CREATED', {
      id: 'job-2026-04-25-replay0005',
      description: 'Add OAuth login',
      cwd: '/tmp/project',
      step: 'proof',
      cycleIndex: 1,
    }, 100),
    buildEvent('PROOF_WRITTEN', {
      proofDeckPath: '/tmp/proof-cycle-1.html',
    }, 200),
    buildEvent('REVIEW_COMPLETED', {
      reviewVerdict: 'changes-required',
      reviewNotes: 'Add more tests.',
    }, 300),
    buildEvent('GATE_DENIED', {
      gate: 'proof-review',
      step: 'human-review',
    }, 400),
    buildEvent('CYCLE_INCREMENTED', {
      cycleIndex: 2,
      reason: 'proof-review-denied',
    }, 500),
  ]);

  assert.equal(snapshot.cycleIndex, 2);
  assert.equal(snapshot.proofDeckPath, undefined);
  assert.equal(snapshot.previousProofDeckPath, '/tmp/proof-cycle-1.html');
  assert.equal(snapshot.reviewVerdict, undefined);
  assert.equal(snapshot.reviewNotes, undefined);
});

test('reduceJobEvent updates updatedAt on every applied event', () => {
  const initial = rebuildSnapshotFromEvents([
    buildEvent('RUN_CREATED', {
      id: 'job-2026-04-25-replay0006',
      description: 'Add OAuth login',
      cwd: '/tmp/project',
      step: 'interview',
    }, 100),
  ]);

  const next = reduceJobEvent(initial, buildEvent('INTERVIEW_CAPTURED', {
    spec: { goal: 'Ship OAuth login' },
    step: 'pipeline-ready',
  }, 200));

  assert.equal(next.updatedAt, 200);
});
