import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_READ_ONLY_TOOL_NAMES,
  DEFAULT_CODING_TOOL_NAMES,
  resolveAgentToolNames,
} from '../../extensions/job-pipeline/lib/agents.mjs';

test('DEFAULT_READ_ONLY_TOOL_NAMES uses string tool allowlist expected by createAgentSession', () => {
  assert.deepEqual(DEFAULT_READ_ONLY_TOOL_NAMES, ['read', 'grep', 'find', 'ls']);
  assert.ok(DEFAULT_READ_ONLY_TOOL_NAMES.every((name) => typeof name === 'string'));
});

test('DEFAULT_CODING_TOOL_NAMES grants workers the required coding tools', () => {
  assert.deepEqual(DEFAULT_CODING_TOOL_NAMES, ['read', 'bash', 'edit', 'write']);
  assert.ok(DEFAULT_CODING_TOOL_NAMES.every((name) => typeof name === 'string'));
});

test('resolveAgentToolNames falls back to the read-only allowlist when no override is provided', () => {
  assert.deepEqual(resolveAgentToolNames(), DEFAULT_READ_ONLY_TOOL_NAMES);
});

test('resolveAgentToolNames preserves explicit tool selections for specialized roles', () => {
  assert.deepEqual(resolveAgentToolNames(['read', 'bash', 'grep']), ['read', 'bash', 'grep']);
});
