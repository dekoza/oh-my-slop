import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialJobState,
  buildInterviewCapturedMessage,
  formatPipelineError,
  buildSubagentLoaderOptions,
} from '../../extensions/job-pipeline/lib/runtime-helpers.mjs';

test('createInitialJobState persists cwd and required defaults', () => {
  const state = createInitialJobState({
    id: 'job-123',
    description: 'demo',
    cwd: '/tmp/project',
    now: 123,
  });

  assert.equal(state.id, 'job-123');
  assert.equal(state.description, 'demo');
  assert.equal(state.cwd, '/tmp/project');
  assert.equal(state.step, 'interview');
  assert.equal(state.createdAt, 123);
  assert.equal(state.updatedAt, 123);
  assert.equal(state.replanCount, 0);
  assert.equal(state.cycleIndex, 1);
  assert.deepEqual(state.jesterFlags, []);
  assert.deepEqual(state.tokenCosts, {});
});

test('buildInterviewCapturedMessage says ready, not starting', () => {
  const message = buildInterviewCapturedMessage();
  assert.match(message, /ready to run pipeline/i);
  assert.doesNotMatch(message, /starting pipeline/i);
});

test('formatPipelineError includes message and stack headline for Error objects', () => {
  const err = new Error('boom');
  err.stack = 'Error: boom\n    at first\n    at second';
  const formatted = formatPipelineError(err);
  assert.match(formatted.text, /Pipeline error: boom/);
  assert.equal(formatted.details.errorName, 'Error');
  assert.match(formatted.details.stack, /at first/);
});

test('formatPipelineError falls back cleanly for non-Error values', () => {
  const formatted = formatPipelineError('bad');
  assert.equal(formatted.text, 'Pipeline error: bad');
  assert.equal(formatted.details.errorName, 'UnknownError');
  assert.equal(formatted.details.stack, undefined);
});

test('buildSubagentLoaderOptions forwards agentDir and cwd', () => {
  const options = buildSubagentLoaderOptions({
    cwd: '/tmp/project',
    agentDir: '/tmp/agent',
    systemPrompt: 'ROLE',
  });

  assert.equal(options.cwd, '/tmp/project');
  assert.equal(options.agentDir, '/tmp/agent');
  const overrideResult = options.agentsFilesOverride({ agentsFiles: [] });
  assert.deepEqual(overrideResult.agentsFiles, [
    { path: '/virtual/ROLE.md', content: 'ROLE' },
  ]);
});

test('buildSubagentLoaderOptions preserves existing agents files', () => {
  const options = buildSubagentLoaderOptions({
    cwd: '/tmp/project',
    agentDir: '/tmp/agent',
    systemPrompt: 'ROLE',
  });
  const existing = { agentsFiles: [{ path: '/x/AGENTS.md', content: 'A' }] };
  const overrideResult = options.agentsFilesOverride(existing);
  assert.deepEqual(overrideResult.agentsFiles, [
    { path: '/x/AGENTS.md', content: 'A' },
    { path: '/virtual/ROLE.md', content: 'ROLE' },
  ]);
});
