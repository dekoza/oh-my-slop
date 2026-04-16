import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ORIGINAL_PROVIDERS,
  ROUTING_PROVIDERS,
  buildDefaultConfig,
  formatGenerationPlan,
  inspectGenerationPlan,
  normalizeModelName,
  resolvePreferredProviders,
} from '../../extensions/provider-failover/lib/default-config.mjs';

test('normalizeModelName strips provider noise and release suffixes', () => {
  assert.equal(normalizeModelName('Anthropic Claude Sonnet 4.5 (20250929)'), 'claude sonnet 4.5');
  assert.equal(normalizeModelName('OpenAI GPT-5 Codex 2025-11-13'), 'gpt 5 codex');
  assert.equal(normalizeModelName('Google Gemini 2.5 Pro Preview'), 'gemini 2.5 pro');
});

test('resolvePreferredProviders prefers active routing providers ahead of originals', () => {
  const providers = resolvePreferredProviders([
    { provider: 'github-copilot', id: 'copilot-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'openrouter', id: 'router-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'zai', id: 'z-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { provider: 'openai', id: 'gpt-5-codex', name: 'GPT-5 Codex' },
  ]);

  assert.deepEqual(providers, ['openrouter', 'zai', ...DEFAULT_ORIGINAL_PROVIDERS]);
  assert.deepEqual(ROUTING_PROVIDERS, ['openrouter', 'zai']);
});

test('buildDefaultConfig prefers routing providers when they are active', () => {
  const config = buildDefaultConfig([
    { provider: 'github-copilot', id: 'copilot-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'github-copilot', id: 'copilot-gpt', name: 'GPT-5 Codex' },
    { provider: 'github-copilot', id: 'copilot-gemini', name: 'Gemini 2.5 Pro' },
    { provider: 'github-copilot', id: 'copilot-grok', name: 'Grok 4' },
    { provider: 'anthropic', id: 'claude-sonnet-4-5-20250929', name: 'Anthropic Claude Sonnet 4.5 (20250929)' },
    { provider: 'openai', id: 'gpt-5-codex', name: 'OpenAI GPT-5 Codex 2025-11-13' },
    { provider: 'google', id: 'gemini-2.5-pro', name: 'Google Gemini 2.5 Pro Preview' },
    { provider: 'xai', id: 'grok-4', name: 'xAI Grok 4' },
    { provider: 'openrouter', id: 'router-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'openrouter', id: 'router-gpt', name: 'GPT-5 Codex' },
    { provider: 'zai', id: 'z-gemini', name: 'Gemini 2.5 Pro' },
  ]);

  assert.deepEqual(config, {
    models: [
      {
        id: 'copilot-claude',
        name: 'Claude Sonnet 4.5',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-claude' },
          { provider: 'openrouter', model: 'router-claude' },
          { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
        ],
        sticky: true,
      },
      {
        id: 'copilot-gemini',
        name: 'Gemini 2.5 Pro',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-gemini' },
          { provider: 'zai', model: 'z-gemini' },
          { provider: 'google', model: 'gemini-2.5-pro' },
        ],
        sticky: true,
      },
      {
        id: 'copilot-gpt',
        name: 'GPT-5 Codex',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-gpt' },
          { provider: 'openrouter', model: 'router-gpt' },
          { provider: 'openai', model: 'gpt-5-codex' },
        ],
        sticky: true,
      },
      {
        id: 'copilot-grok',
        name: 'Grok 4',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-grok' },
          { provider: 'xai', model: 'grok-4' },
        ],
        sticky: true,
      },
    ],
  });
});

test('buildDefaultConfig keeps only routing and original providers and skips unmatched copilot models', () => {
  const config = buildDefaultConfig([
    { provider: 'github-copilot', id: 'copilot-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'github-copilot', id: 'copilot-unknown', name: 'Mystery Model 1' },
    { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { provider: 'groq', id: 'groq-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'groq', id: 'groq-mystery', name: 'Mystery Model 1' },
  ]);

  assert.deepEqual(config, {
    models: [
      {
        id: 'copilot-claude',
        name: 'Claude Sonnet 4.5',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-claude' },
          { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        ],
        sticky: true,
      },
    ],
  });
});

test('inspectGenerationPlan reports matched and unmatched copilot models', () => {
  const plan = inspectGenerationPlan([
    { provider: 'github-copilot', id: 'copilot-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'github-copilot', id: 'copilot-gpt', name: 'GPT-5 Codex' },
    { provider: 'github-copilot', id: 'copilot-unknown', name: 'Mystery Model 1' },
    { provider: 'openrouter', id: 'router-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'openai', id: 'gpt-5-codex', name: 'GPT-5 Codex' },
  ]);

  assert.deepEqual(plan.preferredProviders, ['openrouter', ...DEFAULT_ORIGINAL_PROVIDERS]);
  assert.deepEqual(plan.matchedModels, [
    {
      id: 'copilot-claude',
      name: 'Claude Sonnet 4.5',
      strategy: [
        { provider: 'github-copilot', model: 'copilot-claude' },
        { provider: 'openrouter', model: 'router-claude' },
      ],
      sticky: true,
    },
    {
      id: 'copilot-gpt',
      name: 'GPT-5 Codex',
      strategy: [
        { provider: 'github-copilot', model: 'copilot-gpt' },
        { provider: 'openai', model: 'gpt-5-codex' },
      ],
      sticky: true,
    },
  ]);
  assert.deepEqual(plan.unmatchedCopilotModels, [
    { id: 'copilot-unknown', name: 'Mystery Model 1' },
  ]);
});

test('formatGenerationPlan prints provider order, matches, and unmatched copilot models', () => {
  const output = formatGenerationPlan({
    preferredProviders: ['openrouter', 'zai', 'openai', 'anthropic'],
    matchedModels: [
      {
        id: 'copilot-claude',
        name: 'Claude Sonnet 4.5',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-claude' },
          { provider: 'openrouter', model: 'router-claude' },
          { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        ],
        sticky: true,
      },
    ],
    unmatchedCopilotModels: [
      { id: 'copilot-unknown', name: 'Mystery Model 1' },
    ],
  });

  assert.match(output, /Preferred provider order: openrouter -> zai -> openai -> anthropic/);
  assert.match(output, /Claude Sonnet 4\.5 \(copilot-claude\)/);
  assert.match(output, /github-copilot\/copilot-claude/);
  assert.match(output, /openrouter\/router-claude/);
  assert.match(output, /anthropic\/claude-sonnet-4-5/);
  assert.match(output, /Unmatched GitHub Copilot models:/);
  assert.match(output, /Mystery Model 1 \(copilot-unknown\)/);
});
