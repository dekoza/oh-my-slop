import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFailoverProviderConfig, FAILOVER_DUMMY_API_KEY, FAILOVER_DUMMY_BASE_URL } from '../../extensions/provider-failover/lib/provider-registration.mjs';

const models = [
  {
    id: 'copilot-claude',
    name: 'Claude Sonnet 4.5',
    api: 'failover-router',
    provider: 'failover',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 500,
  },
];

test('buildFailoverProviderConfig includes dummy baseUrl and apiKey required by pi provider validation', () => {
  const streamSimple = () => ({ async *[Symbol.asyncIterator]() {} });
  const config = buildFailoverProviderConfig(models, streamSimple);

  assert.equal(config.baseUrl, FAILOVER_DUMMY_BASE_URL);
  assert.equal(config.apiKey, FAILOVER_DUMMY_API_KEY);
  assert.equal(config.api, 'failover-router');
  assert.equal(config.models, models);
  assert.equal(config.streamSimple, streamSimple);
});
