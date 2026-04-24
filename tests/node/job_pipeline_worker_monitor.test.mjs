import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWorkerMonitorEvent,
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
