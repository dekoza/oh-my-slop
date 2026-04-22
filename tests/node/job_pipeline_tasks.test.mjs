import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveExecutionBatches,
  validateTaskGraph,
} from '../../extensions/job-pipeline/lib/tasks.mjs';

test('resolveExecutionBatches: tasks with no deps form a single batch', () => {
  const tasks = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: [] },
    { id: 'c', dependsOn: [] },
  ];
  const batches = resolveExecutionBatches(tasks);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
});

test('resolveExecutionBatches: chain a→b→c produces three sequential batches', () => {
  const tasks = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ];
  const batches = resolveExecutionBatches(tasks);
  assert.equal(batches.length, 3);
  assert.equal(batches[0][0].id, 'a');
  assert.equal(batches[1][0].id, 'b');
  assert.equal(batches[2][0].id, 'c');
});

test('resolveExecutionBatches: diamond deps produce correct batches', () => {
  // a → b, a → c, b+c → d
  const tasks = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a'] },
    { id: 'd', dependsOn: ['b', 'c'] },
  ];
  const batches = resolveExecutionBatches(tasks);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 1);
  assert.equal(batches[0][0].id, 'a');
  assert.equal(batches[1].length, 2);
  assert.ok(batches[1].some((t) => t.id === 'b'));
  assert.ok(batches[1].some((t) => t.id === 'c'));
  assert.equal(batches[2].length, 1);
  assert.equal(batches[2][0].id, 'd');
});

test('resolveExecutionBatches: empty input returns empty array', () => {
  assert.deepEqual(resolveExecutionBatches([]), []);
});

test('resolveExecutionBatches: throws on circular dependency', () => {
  const tasks = [
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] },
  ];
  assert.throws(() => resolveExecutionBatches(tasks), /circular/i);
});

test('validateTaskGraph: returns empty array for valid graph', () => {
  const graph = {
    tasks: [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
    ],
  };
  assert.deepEqual(validateTaskGraph(graph), []);
});

test('validateTaskGraph: detects reference to unknown task', () => {
  const graph = {
    tasks: [{ id: 'a', dependsOn: ['nonexistent'] }],
  };
  const errors = validateTaskGraph(graph);
  assert.ok(errors.length > 0);
  assert.ok(errors[0].includes('nonexistent'));
});

test('validateTaskGraph: detects circular dependency', () => {
  const graph = {
    tasks: [
      { id: 'x', dependsOn: ['y'] },
      { id: 'y', dependsOn: ['x'] },
    ],
  };
  const errors = validateTaskGraph(graph);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => /circular/i.test(e)));
});
