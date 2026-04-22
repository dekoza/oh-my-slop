import test from 'node:test';
import assert from 'node:assert/strict';

import { ROLE_THINKING_LEVELS, getRoleThinkingLevel } from '../../extensions/job-pipeline/lib/thinking.mjs';

test('ROLE_THINKING_LEVELS exposes the agreed per-role defaults', () => {
  assert.deepEqual(ROLE_THINKING_LEVELS, {
    scout: 'low',
    planner: 'high',
    jester: 'high',
    'task-writer': 'medium',
    worker: 'medium',
    reviewer: 'high',
  });
});

test('getRoleThinkingLevel returns low for scout', () => {
  assert.equal(getRoleThinkingLevel('scout'), 'low');
});

test('getRoleThinkingLevel returns medium for worker', () => {
  assert.equal(getRoleThinkingLevel('worker'), 'medium');
});

test('getRoleThinkingLevel returns medium for task-writer', () => {
  assert.equal(getRoleThinkingLevel('task-writer'), 'medium');
});

test('getRoleThinkingLevel returns high for planner, jester, and reviewer', () => {
  assert.equal(getRoleThinkingLevel('planner'), 'high');
  assert.equal(getRoleThinkingLevel('jester'), 'high');
  assert.equal(getRoleThinkingLevel('reviewer'), 'high');
});

test('getRoleThinkingLevel falls back to medium for unknown roles', () => {
  assert.equal(getRoleThinkingLevel('unknown-role'), 'medium');
});
