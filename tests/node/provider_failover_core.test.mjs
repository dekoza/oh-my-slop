import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAILOVER_API,
  FAILOVER_PROVIDER_NAME,
  buildWrapperModel,
  isRateLimitLike,
  orderCandidates,
  pipeFailoverStream,
} from '../../extensions/provider-failover/lib/failover-core.mjs';

function toAsyncStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

test('isRateLimitLike detects common provider throttle errors', () => {
  assert.equal(isRateLimitLike('429 Too Many Requests'), true);
  assert.equal(isRateLimitLike('529 overloaded_error: Overloaded'), true);
  assert.equal(isRateLimitLike('rate limit exceeded for this model'), true);
  assert.equal(isRateLimitLike('quota exceeded, try again later'), true);
  assert.equal(isRateLimitLike('500 internal server error'), false);
  assert.equal(isRateLimitLike('request aborted by user'), false);
});

test('orderCandidates moves sticky route to the front without dropping others', () => {
  const ordered = orderCandidates(
    [
      { key: 'primary' },
      { key: 'openai' },
      { key: 'anthropic' },
    ],
    'anthropic',
  );

  assert.deepEqual(ordered.map((candidate) => candidate.key), ['anthropic', 'primary', 'openai']);
});

test('buildWrapperModel uses conservative capabilities across all backends', () => {
  const wrapper = buildWrapperModel(
    { id: 'copilot-coder', name: 'Copilot coder' },
    [
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 16000,
      },
      {
        id: 'gpt-5-codex',
        name: 'GPT-5 Codex',
        reasoning: false,
        input: ['text'],
        cost: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8000,
      },
    ],
  );

  assert.equal(wrapper.id, 'copilot-coder');
  assert.equal(wrapper.name, 'Copilot coder');
  assert.equal(wrapper.api, FAILOVER_API);
  assert.equal(wrapper.provider, FAILOVER_PROVIDER_NAME);
  assert.equal(wrapper.reasoning, false);
  assert.deepEqual(wrapper.input, ['text']);
  assert.equal(wrapper.contextWindow, 128000);
  assert.equal(wrapper.maxTokens, 8000);
  assert.deepEqual(wrapper.cost, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
});

test('pipeFailoverStream retries the next backend when the current one 429s before output', async () => {
  const forwarded = [];
  const notices = [];
  const calls = [];
  const candidates = [
    { key: 'copilot', provider: 'github-copilot', model: 'claude-sonnet-4' },
    { key: 'openai', provider: 'openai', model: 'gpt-5-codex' },
  ];

  const result = await pipeFailoverStream({
    candidates,
    invoke: async (candidate) => {
      calls.push(candidate.key);
      if (candidate.key === 'copilot') {
        return toAsyncStream([
          { type: 'start', partial: { provider: 'github-copilot', model: 'claude-sonnet-4' } },
          {
            type: 'error',
            reason: 'error',
            error: { errorMessage: '429 Too Many Requests' },
          },
        ]);
      }

      return toAsyncStream([
        { type: 'start', partial: { provider: 'openai', model: 'gpt-5-codex' } },
        { type: 'text_start', contentIndex: 0, partial: {} },
        { type: 'text_delta', contentIndex: 0, delta: 'fallback works', partial: {} },
        { type: 'text_end', contentIndex: 0, content: 'fallback works', partial: {} },
        { type: 'done', reason: 'stop', message: { provider: 'openai', model: 'gpt-5-codex' } },
      ]);
    },
    forward: async (event) => {
      forwarded.push(event);
    },
    onFallback: (notice) => {
      notices.push(notice);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.usedCandidate.key, 'openai');
  assert.deepEqual(calls, ['copilot', 'openai']);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].failedCandidate.key, 'copilot');
  assert.equal(forwarded[0].type, 'start');
  assert.equal(forwarded[0].partial.provider, 'openai');
  assert.equal(forwarded.some((event) => event.error?.errorMessage === '429 Too Many Requests'), false);
  assert.equal(forwarded.at(-1).type, 'done');
});

test('pipeFailoverStream does not switch providers after output has already started', async () => {
  const forwarded = [];
  const calls = [];

  const result = await pipeFailoverStream({
    candidates: [
      { key: 'copilot', provider: 'github-copilot', model: 'claude-sonnet-4' },
      { key: 'openai', provider: 'openai', model: 'gpt-5-codex' },
    ],
    invoke: async (candidate) => {
      calls.push(candidate.key);
      if (candidate.key !== 'copilot') {
        throw new Error('backup should not run once output started');
      }

      return toAsyncStream([
        { type: 'start', partial: { provider: 'github-copilot', model: 'claude-sonnet-4' } },
        { type: 'text_start', contentIndex: 0, partial: {} },
        { type: 'text_delta', contentIndex: 0, delta: 'partial', partial: {} },
        {
          type: 'error',
          reason: 'error',
          error: { errorMessage: '429 Too Many Requests' },
        },
      ]);
    },
    forward: async (event) => {
      forwarded.push(event);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.usedCandidate.key, 'copilot');
  assert.deepEqual(calls, ['copilot']);
  assert.equal(forwarded[0].type, 'start');
  assert.equal(forwarded[1].type, 'text_start');
  assert.equal(forwarded[2].type, 'text_delta');
  assert.equal(forwarded[3].type, 'error');
});
