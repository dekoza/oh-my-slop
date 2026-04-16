import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDefaultConfig,
  normalizeModelName,
} from '../../extensions/provider-failover/lib/default-config.mjs';

test('normalizeModelName strips provider noise and release suffixes', () => {
  assert.equal(normalizeModelName('Anthropic Claude Sonnet 4.5 (20250929)'), 'claude sonnet 4.5');
  assert.equal(normalizeModelName('OpenAI GPT-5 Codex 2025-11-13'), 'gpt 5 codex');
  assert.equal(normalizeModelName('Google Gemini 2.5 Pro Preview'), 'gemini 2.5 pro');
});

test('buildDefaultConfig maps github-copilot models to original providers by normalized name', () => {
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
  ]);

  assert.deepEqual(config, {
    models: [
      {
        id: 'copilot-claude',
        name: 'Claude Sonnet 4.5',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-claude' },
          { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
        ],
        sticky: true,
      },
      {
        id: 'copilot-gemini',
        name: 'Gemini 2.5 Pro',
        strategy: [
          { provider: 'github-copilot', model: 'copilot-gemini' },
          { provider: 'google', model: 'gemini-2.5-pro' },
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

test('buildDefaultConfig keeps only preferred original providers and skips unmatched copilot models', () => {
  const config = buildDefaultConfig([
    { provider: 'github-copilot', id: 'copilot-claude', name: 'Claude Sonnet 4.5' },
    { provider: 'github-copilot', id: 'copilot-unknown', name: 'Mystery Model 1' },
    { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { provider: 'openrouter', id: 'router-mystery', name: 'Mystery Model 1' },
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
