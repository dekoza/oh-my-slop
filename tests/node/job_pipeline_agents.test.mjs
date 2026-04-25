import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_READ_ONLY_TOOL_NAMES,
  DEFAULT_CODING_TOOL_NAMES,
  resolveAgentToolNames,
  resolveNamedAgentDefinition,
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

test('resolveNamedAgentDefinition falls back to the bundled agent when no overrides exist', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'oh-my-slop-home-'));
  const cwd = join(homeDir, 'workspace', 'demo-repo');
  const bundledDir = join(homeDir, 'bundled-agents');

  mkdirSync(cwd, { recursive: true });
  mkdirSync(bundledDir, { recursive: true });
  writeFileSync(join(bundledDir, 'visual-designer.md'), `---\nname: visual-designer\ndescription: Bundled visual designer\nmodel: demo/bundled\ntools: read, bash\n---\nBundled prompt\n`, 'utf8');

  const result = resolveNamedAgentDefinition({
    name: 'visual-designer',
    cwd,
    env: { PI_SUBAGENT_PROJECT_AGENTS_MODE: 'project' },
    homeDir,
    bundledAgentDirs: [bundledDir],
  });

  assert.equal(result?.model, 'demo/bundled');
  assert.deepEqual(result?.tools, ['read', 'bash']);
  assert.match(result?.systemPrompt ?? '', /Bundled prompt/);
  assert.equal(result?.source, 'bundled');
});

test('resolveNamedAgentDefinition lets project agents override user and bundled definitions', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'oh-my-slop-home-'));
  const cwd = join(homeDir, 'workspace', 'demo-repo');
  const userDir = join(homeDir, '.pi', 'agent', 'agents');
  const projectDir = join(cwd, '.pi', 'agents');
  const bundledDir = join(homeDir, 'bundled-agents');

  mkdirSync(userDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(bundledDir, { recursive: true });

  writeFileSync(join(bundledDir, 'visual-designer.md'), `---\nname: visual-designer\ndescription: Bundled visual designer\nmodel: demo/bundled\n---\nBundled prompt\n`, 'utf8');
  writeFileSync(join(userDir, 'visual-designer.md'), `---\nname: visual-designer\ndescription: User visual designer\nmodel: demo/user\n---\nUser prompt\n`, 'utf8');
  writeFileSync(join(projectDir, 'visual-designer.md'), `---\nname: visual-designer\ndescription: Project visual designer\nmodel: demo/project\ntools: read, grep\n---\nProject prompt\n`, 'utf8');

  const result = resolveNamedAgentDefinition({
    name: 'visual-designer',
    cwd,
    env: { PI_SUBAGENT_PROJECT_AGENTS_MODE: 'project' },
    homeDir,
    bundledAgentDirs: [bundledDir],
  });

  assert.equal(result?.model, 'demo/project');
  assert.deepEqual(result?.tools, ['read', 'grep']);
  assert.match(result?.systemPrompt ?? '', /Project prompt/);
  assert.equal(result?.source, 'project');
});
