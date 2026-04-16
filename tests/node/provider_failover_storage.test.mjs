import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getFailoverConfigPath,
  getFailoverStatePath,
  migrateLegacyFile,
} from '../../extensions/provider-failover/lib/storage.mjs';

test('failover persistence paths live under the agent extensions directory', () => {
  const agentDir = join(tmpdir(), 'pi-agent-home');

  assert.equal(
    getFailoverConfigPath(agentDir),
    join(agentDir, 'extensions', 'provider-failover', 'config.json'),
  );
  assert.equal(
    getFailoverStatePath(agentDir),
    join(agentDir, 'extensions', 'provider-failover', 'state.json'),
  );
});

test('migrateLegacyFile copies the legacy file into persistent storage when needed', () => {
  const baseDir = join(tmpdir(), `provider-failover-migrate-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const legacyPath = join(baseDir, 'legacy', 'config.json');
  const persistentPath = join(baseDir, 'agent', 'extensions', 'provider-failover', 'config.json');
  const legacyContent = '{"models":[{"id":"copilot-gpt"}]}\n';

  mkdirSync(join(baseDir, 'legacy'), { recursive: true });
  writeFileSync(legacyPath, legacyContent, 'utf8');

  assert.equal(migrateLegacyFile(legacyPath, persistentPath), true);
  assert.equal(existsSync(persistentPath), true);
  assert.equal(readFileSync(persistentPath, 'utf8'), legacyContent);
});

test('migrateLegacyFile does not overwrite an existing persistent file', () => {
  const baseDir = join(tmpdir(), `provider-failover-migrate-existing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const legacyPath = join(baseDir, 'legacy', 'state.json');
  const persistentPath = join(baseDir, 'agent', 'extensions', 'provider-failover', 'state.json');

  mkdirSync(join(baseDir, 'legacy'), { recursive: true });
  mkdirSync(join(baseDir, 'agent', 'extensions', 'provider-failover'), { recursive: true });
  writeFileSync(legacyPath, '{"stickyRoutes":{"a":"b"}}\n', 'utf8');
  writeFileSync(persistentPath, '{"stickyRoutes":{"saved":"route"}}\n', 'utf8');

  assert.equal(migrateLegacyFile(legacyPath, persistentPath), false);
  assert.equal(readFileSync(persistentPath, 'utf8'), '{"stickyRoutes":{"saved":"route"}}\n');
});
