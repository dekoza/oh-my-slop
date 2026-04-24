import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWorkerMonitorEvent,
  createWorkerMonitorState,
  getSelectedWorker,
  getWorkerLogLines,
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
