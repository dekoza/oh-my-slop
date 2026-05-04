import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendJobEvent } from '../../extensions/job-pipeline/lib/job-events.mjs';
import { createJobRun, writeStageArtifacts, writeTaskArtifacts } from '../../extensions/job-pipeline/lib/job-store.mjs';
import {
  applyWorkerMonitorEvent,
  buildPersistedWorkerMonitorState,
  createWorkerMonitorState,
  getSelectedWorker,
  getWorkerLogLines,
  wrapWorkerLogLines,
} from '../../extensions/job-pipeline/lib/worker-monitor.mjs';

test('worker monitor records queue, start, log, and finish events', () => {
  const state = createWorkerMonitorState();

  applyWorkerMonitorEvent(state, {
    type: 'worker-queued',
    jobId: 'job-1',
    cycleIndex: 2,
    taskId: 'task-3',
    title: 'Render the proof deck',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-1',
    cycleIndex: 2,
    taskId: 'task-3',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-log',
    jobId: 'job-1',
    cycleIndex: 2,
    taskId: 'task-3',
    text: 'running tests\nall green\n',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-finished',
    jobId: 'job-1',
    cycleIndex: 2,
    taskId: 'task-3',
    status: 'success',
  });

  const worker = getSelectedWorker(state);
  assert.equal(worker.taskId, 'task-3');
  assert.equal(worker.cycleIndex, 2);
  assert.equal(worker.status, 'success');
  assert.deepEqual(getWorkerLogLines(worker), ['running tests', 'all green']);
});

test('worker monitor preserves partial log chunks until they are completed', () => {
  const state = createWorkerMonitorState();

  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-2',
    cycleIndex: 1,
    taskId: 'task-1',
    title: 'Initial setup',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-log',
    jobId: 'job-2',
    cycleIndex: 1,
    taskId: 'task-1',
    text: 'hello',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-log',
    jobId: 'job-2',
    cycleIndex: 1,
    taskId: 'task-1',
    text: ' world\nnext line',
  });

  let worker = getSelectedWorker(state);
  assert.deepEqual(getWorkerLogLines(worker), ['hello world', 'next line']);

  applyWorkerMonitorEvent(state, {
    type: 'worker-finished',
    jobId: 'job-2',
    cycleIndex: 1,
    taskId: 'task-1',
    status: 'failed',
  });

  worker = getSelectedWorker(state);
  assert.equal(worker.status, 'failed');
  assert.deepEqual(getWorkerLogLines(worker), ['hello world', 'next line']);
});

test('worker monitor can track scout, task-writer, planner, jester, and reviewer entries alongside workers', () => {
  const state = createWorkerMonitorState();

  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'scout-cycle-4',
    title: 'Scout — reconnaissance (cycle 4)',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-log',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'scout-cycle-4',
    text: 'relevant files located\n',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-finished',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'scout-cycle-4',
    status: 'success',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'task-writer-cycle-4',
    title: 'Task writer — execution graph (cycle 4)',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-finished',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'task-writer-cycle-4',
    status: 'success',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'planner-initial-attempt-2',
    title: 'Planner — initial plan (attempt 2)',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-log',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'planner-initial-attempt-2',
    text: 'outline drafted\n',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-finished',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'planner-initial-attempt-2',
    status: 'success',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'jester-planning-round-1-attempt-2',
    title: 'Jester — planning critique round 1',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-3',
    cycleIndex: 4,
    taskId: 'reviewer-cycle-4',
    title: 'Reviewer — implementation review',
  });

  assert.equal(state.workers.length, 5);
  assert.equal(state.workers[0].title, 'Scout — reconnaissance (cycle 4)');
  assert.equal(state.workers[1].taskId, 'task-writer-cycle-4');
  assert.equal(state.workers[2].title, 'Planner — initial plan (attempt 2)');
  assert.equal(state.workers[3].taskId, 'jester-planning-round-1-attempt-2');
  assert.equal(state.workers[4].taskId, 'reviewer-cycle-4');
  assert.deepEqual(getWorkerLogLines(state.workers[0]), ['relevant files located']);
  assert.deepEqual(getWorkerLogLines(state.workers[2]), ['outline drafted']);
});

test('worker monitor resets automatically when a different job starts', () => {
  const state = createWorkerMonitorState();

  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-1',
    cycleIndex: 1,
    taskId: 'task-1',
    title: 'Old job worker',
  });
  applyWorkerMonitorEvent(state, {
    type: 'worker-log',
    jobId: 'job-1',
    cycleIndex: 1,
    taskId: 'task-1',
    text: 'old output\n',
  });

  applyWorkerMonitorEvent(state, {
    type: 'worker-started',
    jobId: 'job-2',
    cycleIndex: 1,
    taskId: 'task-9',
    title: 'New job worker',
  });

  assert.equal(state.jobId, 'job-2');
  assert.equal(state.workers.length, 1);
  assert.equal(state.workers[0].taskId, 'task-9');
  assert.deepEqual(getWorkerLogLines(state.workers[0]), []);
});

test('wrapWorkerLogLines expands tab characters before slicing viewer rows', () => {
  const wrappedLines = wrapWorkerLogLines(['        1\tfrom django.urls import path'], 20);

  assert.equal(wrappedLines.join(''), '        1    from django.urls import path');
  assert.equal(wrappedLines.some((line) => line.includes('\t')), false);
  assert.equal(wrappedLines.every((line) => line.length <= 19), true);
});

test('buildPersistedWorkerMonitorState reconstructs stage and task logs from stored job artifacts', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-worker-monitor-'));
  const jobState = {
    id: 'job-2026-05-04-monitor0001',
    description: 'Persisted monitor reconstruction',
    cwd: '/tmp/project',
    repoRoot: '/tmp/project',
    step: 'review',
    createdAt: 1,
    updatedAt: 2,
    cycleIndex: 2,
    replanCount: 0,
    proofDeckPath: '/tmp/project/proofs/proof-cycle-2.html',
    taskGraph: {
      tasks: [
        { id: 'task-1', title: 'Implement callback validation' },
        { id: 'task-2', title: 'Re-run review fixes' },
      ],
    },
  };

  createJobRun(agentDir, jobState);
  writeStageArtifacts(agentDir, jobState.id, 1, 'scout', {
    responseText: 'Scout cycle 1',
  });
  writeStageArtifacts(agentDir, jobState.id, 2, 'scout', {
    responseText: 'Scout summary line 1\nScout summary line 2',
  });
  writeTaskArtifacts(agentDir, jobState.id, 1, 'task-1', {
    responseText: 'Worker raw output cycle 1',
    result: {
      taskId: 'task-1',
      success: true,
      summary: 'Implemented callback validation in cycle 1',
      artifactFiles: ['proof-task-1-cycle-1.log'],
    },
  });
  writeTaskArtifacts(agentDir, jobState.id, 2, 'task-2', {
    responseText: 'Worker raw output',
    result: {
      taskId: 'task-2',
      success: true,
      summary: 'Implemented callback validation',
      artifactFiles: ['proof-task-2.log'],
    },
  });
  appendJobEvent(agentDir, jobState.id, 'TASK_QUEUED', {
    cycleIndex: 1,
    taskId: 'task-1',
    title: 'Implement callback validation',
  });
  appendJobEvent(agentDir, jobState.id, 'TASK_SUCCEEDED', {
    cycleIndex: 1,
    taskId: 'task-1',
    title: 'Implement callback validation',
  });
  appendJobEvent(agentDir, jobState.id, 'TASK_QUEUED', {
    cycleIndex: 2,
    taskId: 'task-2',
    title: 'Re-run review fixes',
  });
  appendJobEvent(agentDir, jobState.id, 'TASK_SUCCEEDED', {
    cycleIndex: 2,
    taskId: 'task-2',
    title: 'Re-run review fixes',
  });

  const state = buildPersistedWorkerMonitorState({ agentDir, jobState, cycleFilter: 2 });

  assert.equal(state.jobId, jobState.id);
  assert.deepEqual(state.availableCycles, [1, 2]);
  assert.equal(state.selectedCycle, 2);
  assert.equal(state.workers.length, 3);
  assert.equal(state.workers[0].title, 'Scout — reconnaissance');
  assert.equal(state.workers[0].status, 'success');
  assert.deepEqual(getWorkerLogLines(state.workers[0]), ['Scout summary line 1', 'Scout summary line 2']);
  assert.equal(state.workers[1].title, 'Re-run review fixes');
  assert.equal(state.workers[1].status, 'success');
  assert.deepEqual(getWorkerLogLines(state.workers[1]), [
    'Summary: Implemented callback validation',
    'Artifacts: proof-task-2.log',
    '',
    'Worker raw output',
  ]);
  assert.equal(state.workers[2].title, 'Proof deck — cycle 2');
  assert.equal(state.workers[2].browserPath, '/tmp/project/proofs/proof-cycle-2.html');
});
