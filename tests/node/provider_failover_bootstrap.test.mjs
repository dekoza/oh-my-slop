import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBootstrapWrapperModel,
  buildPersistedWrapperSnapshot,
} from '../../extensions/provider-failover/lib/bootstrap-models.mjs';

test('buildPersistedWrapperSnapshot keeps the wrapper capabilities needed for early registration', () => {
  const wrapperModel = {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'failover',
    api: 'failover-router',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    contextWindow: 272000,
    maxTokens: 128000,
  };

  assert.deepEqual(buildPersistedWrapperSnapshot(wrapperModel), {
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    contextWindow: 272000,
    maxTokens: 128000,
  });
});

test('buildBootstrapWrapperModel uses persisted wrapper metadata when available', () => {
  const model = buildBootstrapWrapperModel({
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    strategy: [
      { provider: 'github-copilot', model: 'claude-opus-4.6' },
      { provider: 'anthropic', model: 'claude-opus-4-6' },
    ],
    sticky: true,
    wrapper: {
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 128000,
    },
  });

  assert.deepEqual(model, {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'failover',
    api: 'failover-router',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 128000,
  });
});

test('buildBootstrapWrapperModel falls back to a conservative placeholder when legacy config has no wrapper metadata', () => {
  const model = buildBootstrapWrapperModel({
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    strategy: [
      { provider: 'github-copilot', model: 'gpt-5.3-codex' },
      { provider: 'openai-codex', model: 'gpt-5.3-codex' },
    ],
    sticky: true,
  });

  assert.deepEqual(model, {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    provider: 'failover',
    api: 'failover-router',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  });
});
