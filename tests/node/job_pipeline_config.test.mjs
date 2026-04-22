import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeJobPipelineConfig, DEFAULT_JOB_PIPELINE_CONFIG } from '../../extensions/job-pipeline/lib/config.mjs';

const VALID_CONFIG = {
  pools: {
    scout: { models: ['github-copilot/gpt-5-mini'] },
    planner: { models: ['github-copilot/claude-sonnet-4-5', 'github-copilot/gpt-5'] },
    jester: { models: ['github-copilot/gpt-5', 'github-copilot/claude-sonnet-4-5'] },
    'task-writer': { models: ['github-copilot/gpt-5-mini'] },
    worker: { models: ['github-copilot/gpt-5-mini'] },
    reviewer: { models: ['github-copilot/claude-sonnet-4-5'] },
  },
  gates: {
    scoutQuestion: { mode: 'compulsory' },
    planApproval: { mode: 'auto-accept' },
    proofReview: { mode: 'compulsory' },
    retroReview: { mode: 'compulsory' },
  },
  autonomy: { cleanRetrosRequired: 5 },
  costs: { track: false },
};

test('normalizeJobPipelineConfig: valid config is returned unchanged', () => {
  const result = normalizeJobPipelineConfig(VALID_CONFIG);
  assert.equal(result.value.gates.planApproval.mode, 'auto-accept');
  assert.equal(result.value.autonomy.cleanRetrosRequired, 5);
  assert.equal(result.value.costs.track, false);
  assert.deepEqual(result.value.pools.planner.models, ['github-copilot/claude-sonnet-4-5', 'github-copilot/gpt-5']);
});

test('normalizeJobPipelineConfig: invalid gate mode falls back to compulsory', () => {
  const raw = {
    ...VALID_CONFIG,
    gates: { ...VALID_CONFIG.gates, planApproval: { mode: 'invalid-mode' } },
  };
  const result = normalizeJobPipelineConfig(raw);
  assert.equal(result.value.gates.planApproval.mode, 'compulsory');
  assert.ok(result.warnings?.some((w) => w.includes('planApproval')));
});

test('normalizeJobPipelineConfig: non-object input returns default', () => {
  const result = normalizeJobPipelineConfig(null);
  assert.deepEqual(result.value, DEFAULT_JOB_PIPELINE_CONFIG);
});

test('normalizeJobPipelineConfig: missing pools section uses defaults', () => {
  const { pools: _pools, ...withoutPools } = VALID_CONFIG;
  const result = normalizeJobPipelineConfig(withoutPools);
  assert.deepEqual(result.value.pools, DEFAULT_JOB_PIPELINE_CONFIG.pools);
});

test('normalizeJobPipelineConfig: pool with empty models array uses defaults for that role', () => {
  const raw = {
    ...VALID_CONFIG,
    pools: { ...VALID_CONFIG.pools, scout: { models: [] } },
  };
  const result = normalizeJobPipelineConfig(raw);
  assert.deepEqual(result.value.pools.scout.models, DEFAULT_JOB_PIPELINE_CONFIG.pools.scout.models);
  assert.ok(result.warnings?.some((w) => w.includes('scout')));
});

test('normalizeJobPipelineConfig: cleanRetrosRequired below 1 uses default', () => {
  const raw = { ...VALID_CONFIG, autonomy: { cleanRetrosRequired: 0 } };
  const result = normalizeJobPipelineConfig(raw);
  assert.equal(result.value.autonomy.cleanRetrosRequired, DEFAULT_JOB_PIPELINE_CONFIG.autonomy.cleanRetrosRequired);
});

test('normalizeJobPipelineConfig: extra unknown keys are silently ignored', () => {
  const raw = { ...VALID_CONFIG, unknownKey: 'ignored' };
  const result = normalizeJobPipelineConfig(raw);
  assert.equal(result.value.autonomy.cleanRetrosRequired, 5);
});
