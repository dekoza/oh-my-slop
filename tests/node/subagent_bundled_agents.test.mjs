import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getMirroredWorkspacePathSegments,
  resolveProjectAgentsDir,
  seedBundledAgents,
} from '../../extensions/subagent-bundled-agents/lib/project-agents.mjs';

test('project agents default to shared subagent storage under the pi agent dir', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'oh-my-slop-home-'));
  const cwd = join(homeDir, 'workspace', 'demo-repo');

  const resolved = resolveProjectAgentsDir(cwd, { env: {}, homeDir });
  const expected = join(
    homeDir,
    '.pi',
    'agent',
    'subagents',
    'project-agents',
    ...getMirroredWorkspacePathSegments(cwd),
    'agents',
  );

  assert.equal(resolved, expected);
});

test('project storage mode writes into repo-local .pi/agents', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'oh-my-slop-home-'));
  const cwd = join(homeDir, 'workspace', 'demo-repo');

  const resolved = resolveProjectAgentsDir(cwd, {
    env: { PI_SUBAGENT_PROJECT_AGENTS_MODE: 'project' },
    homeDir,
  });

  assert.equal(resolved, join(cwd, '.pi', 'agents'));
});

test('subagent config shared root overrides the default shared storage location', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'oh-my-slop-home-'));
  const cwd = join(homeDir, 'workspace', 'demo-repo');
  const configPath = join(homeDir, 'config', 'subagent.json');

  mkdirSync(join(homeDir, 'config'), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ projectAgentStorageMode: 'shared', projectAgentSharedRoot: '~/custom-subagents' }),
    'utf8',
  );

  const resolved = resolveProjectAgentsDir(cwd, { env: {}, homeDir, configPath });
  const expected = join(homeDir, 'custom-subagents', ...getMirroredWorkspacePathSegments(cwd), 'agents');

  assert.equal(resolved, expected);
});

test('seeding bundled agents copies only missing markdown agent files', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'oh-my-slop-home-'));
  const cwd = join(homeDir, 'workspace', 'demo-repo');
  const sourceDir = join(homeDir, 'bundled-agents');

  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'visual-designer.md'), 'visual agent', 'utf8');
  writeFileSync(join(sourceDir, 'code-reviewer.md'), 'review agent', 'utf8');
  writeFileSync(join(sourceDir, 'review.chain.md'), 'chain config', 'utf8');

  const targetDir = join(cwd, '.pi', 'agents');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'visual-designer.md'), 'user override', 'utf8');

  const result = seedBundledAgents({
    cwd,
    sourceDir,
    env: { PI_SUBAGENT_PROJECT_AGENTS_MODE: 'project' },
    homeDir,
  });

  assert.equal(result.targetDir, targetDir);
  assert.deepEqual(result.seeded, [join(targetDir, 'code-reviewer.md')]);
  assert.deepEqual(result.skipped, [join(targetDir, 'visual-designer.md')]);
  assert.equal(readFileSync(join(targetDir, 'visual-designer.md'), 'utf8'), 'user override');
  assert.equal(readFileSync(join(targetDir, 'code-reviewer.md'), 'utf8'), 'review agent');
});
