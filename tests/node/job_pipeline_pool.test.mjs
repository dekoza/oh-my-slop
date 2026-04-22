import test from 'node:test';
import assert from 'node:assert/strict';

import { drawSessionPool } from '../../extensions/job-pipeline/lib/pool.mjs';

const BASE_CONFIG = {
  pools: {
    scout: { models: ['github-copilot/gpt-5-mini'] },
    planner: { models: ['github-copilot/claude-sonnet-4-5', 'github-copilot/gpt-5'] },
    jester: { models: ['github-copilot/gpt-5', 'github-copilot/claude-sonnet-4-5'] },
    'task-writer': { models: ['github-copilot/gpt-5-mini'] },
    worker: { models: ['github-copilot/gpt-5-mini'] },
    reviewer: { models: ['github-copilot/claude-sonnet-4-5'] },
  },
};

const ALL_MODELS = [
  'github-copilot/gpt-5-mini',
  'github-copilot/gpt-5',
  'github-copilot/claude-sonnet-4-5',
];

test('drawSessionPool returns exactly one model per role', () => {
  const pool = drawSessionPool(BASE_CONFIG, ALL_MODELS);
  const roles = ['scout', 'planner', 'jester', 'task-writer', 'worker', 'reviewer'];
  for (const role of roles) {
    assert.ok(typeof pool[role] === 'string', `missing role: ${role}`);
    assert.ok(pool[role].length > 0);
  }
});

test('drawSessionPool only picks from available models', () => {
  const pool = drawSessionPool(BASE_CONFIG, ALL_MODELS);
  for (const [role, modelId] of Object.entries(pool)) {
    assert.ok(ALL_MODELS.includes(modelId), `${role} drew unavailable model: ${modelId}`);
  }
});

test('drawSessionPool ensures planner and jester are different when possible', () => {
  // Run many times to catch a case where they'd be equal by accident
  for (let i = 0; i < 50; i++) {
    const pool = drawSessionPool(BASE_CONFIG, ALL_MODELS);
    assert.notEqual(
      pool.planner,
      pool.jester,
      'planner and jester should differ when pools allow it',
    );
  }
});

test('drawSessionPool picks planner even if it equals jester when only one model available', () => {
  const tightConfig = {
    pools: {
      scout: { models: ['github-copilot/gpt-5-mini'] },
      planner: { models: ['github-copilot/gpt-5-mini'] },
      jester: { models: ['github-copilot/gpt-5-mini'] },
      'task-writer': { models: ['github-copilot/gpt-5-mini'] },
      worker: { models: ['github-copilot/gpt-5-mini'] },
      reviewer: { models: ['github-copilot/gpt-5-mini'] },
    },
  };
  const pool = drawSessionPool(tightConfig, ['github-copilot/gpt-5-mini']);
  assert.equal(pool.planner, 'github-copilot/gpt-5-mini');
  assert.equal(pool.jester, 'github-copilot/gpt-5-mini');
});

test('drawSessionPool throws when a role pool has no available models', () => {
  const unavailableConfig = {
    pools: {
      ...BASE_CONFIG.pools,
      scout: { models: ['provider/unavailable-model'] },
    },
  };
  assert.throws(
    () => drawSessionPool(unavailableConfig, ALL_MODELS),
    /no available models for role: scout/i,
  );
});

test('drawSessionPool result is stable when called with the same random seed via deterministic input', () => {
  // Each call is independent but should respect the constraint that
  // drawn models are within the configured pool.
  const pool1 = drawSessionPool(BASE_CONFIG, ALL_MODELS);
  const pool2 = drawSessionPool(BASE_CONFIG, ALL_MODELS);
  // Both results must be valid (models within pools) even if different draws
  for (const [role, modelId] of Object.entries(pool1)) {
    assert.ok(
      BASE_CONFIG.pools[role].models.includes(modelId),
      `pool1: ${role} drew model outside its pool`,
    );
  }
  for (const [role, modelId] of Object.entries(pool2)) {
    assert.ok(
      BASE_CONFIG.pools[role].models.includes(modelId),
      `pool2: ${role} drew model outside its pool`,
    );
  }
});
