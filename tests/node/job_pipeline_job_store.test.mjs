import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearActiveJobId,
  createJobRun,
  getActiveJobId,
  getActiveJobPath,
  getJobDir,
  getJobsRoot,
  getJobRunPath,
  getJobSnapshotPath,
  getLegacyJobStatePath,
  listJobs,
  loadJobRun,
  loadJobSnapshot,
  migrateLegacyStateIfPresent,
  setActiveJobId,
  writeJobSnapshot,
} from '../../extensions/job-pipeline/lib/job-store.mjs';

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-store-'));
}

function buildJobState(overrides = {}) {
  const state = {
    id: 'job-2026-04-25-abcd1234',
    description: 'Add OAuth login',
    cwd: '/tmp/project',
    repoRoot: '/tmp/project',
    step: 'interview',
    createdAt: 1_761_000_000_000,
    updatedAt: 1_761_000_000_000,
    cycleIndex: 1,
    replanCount: 0,
    ...overrides,
  };
  return {
    ...state,
    repoRoot: state.repoRoot ?? state.cwd,
  };
}

test('createJobRun creates a job directory, run metadata, and snapshot file', () => {
  const agentDir = createAgentDir();
  const state = buildJobState();

  createJobRun(agentDir, state);

  assert.ok(existsSync(getJobsRoot(agentDir)));
  assert.ok(existsSync(getJobDir(agentDir, state.id)));
  assert.ok(existsSync(getJobRunPath(agentDir, state.id)));
  assert.ok(existsSync(getJobSnapshotPath(agentDir, state.id)));

  const run = loadJobRun(agentDir, state.id);
  const snapshot = loadJobSnapshot(agentDir, state.id);

  assert.equal(run.id, state.id);
  assert.equal(run.description, state.description);
  assert.equal(run.createdAt, state.createdAt);
  assert.equal(snapshot.id, state.id);
  assert.equal(snapshot.step, 'interview');
  assert.equal(snapshot.createdAt, state.createdAt);
  assert.equal(snapshot.updatedAt, state.updatedAt);
});

test('setActiveJobId writes an active job pointer and getActiveJobId reads it back', () => {
  const agentDir = createAgentDir();

  setActiveJobId(agentDir, 'job-2026-04-25-aaaa1111');

  assert.ok(existsSync(getActiveJobPath(agentDir)));
  assert.equal(getActiveJobId(agentDir), 'job-2026-04-25-aaaa1111');
});

test('setActiveJobId stores repo-scoped active pointers independently', () => {
  const agentDir = createAgentDir();

  setActiveJobId(agentDir, 'job-repo-a', 100, { repoRoot: '/repo/a' });
  setActiveJobId(agentDir, 'job-repo-b', 200, { repoRoot: '/repo/b' });

  assert.equal(getActiveJobId(agentDir, { repoRoot: '/repo/a' }), 'job-repo-a');
  assert.equal(getActiveJobId(agentDir, { repoRoot: '/repo/b' }), 'job-repo-b');
  assert.equal(getActiveJobId(agentDir), 'job-repo-b');
});

test('clearActiveJobId removes only the requested repo-scoped pointer', () => {
  const agentDir = createAgentDir();

  setActiveJobId(agentDir, 'job-repo-a', 100, { repoRoot: '/repo/a' });
  setActiveJobId(agentDir, 'job-repo-b', 200, { repoRoot: '/repo/b' });
  clearActiveJobId(agentDir, { repoRoot: '/repo/a' });

  assert.equal(getActiveJobId(agentDir, { repoRoot: '/repo/a' }), null);
  assert.equal(getActiveJobId(agentDir, { repoRoot: '/repo/b' }), 'job-repo-b');
});

test('loadJobSnapshot returns null when the snapshot file is missing', () => {
  const agentDir = createAgentDir();

  assert.equal(loadJobSnapshot(agentDir, 'job-missing'), null);
});

test('writeJobSnapshot overwrites the previous snapshot atomically', () => {
  const agentDir = createAgentDir();
  const state = buildJobState();

  createJobRun(agentDir, state);
  writeJobSnapshot(agentDir, state.id, { ...state, step: 'planning', updatedAt: state.updatedAt + 1 });
  writeJobSnapshot(agentDir, state.id, { ...state, step: 'workers', updatedAt: state.updatedAt + 2 });

  const snapshot = loadJobSnapshot(agentDir, state.id);
  assert.equal(snapshot.step, 'workers');
  assert.equal(snapshot.updatedAt, state.updatedAt + 2);
});

test('migrateLegacyStateIfPresent creates a job directory from legacy job-state.json', () => {
  const agentDir = createAgentDir();
  const legacyState = buildJobState({
    id: 'job-2026-04-25-legacy0001',
    step: 'planning',
    spec: { goal: 'Ship OAuth login' },
    pool: { planner: 'github-copilot/gpt-5' },
  });
  const legacyPath = getLegacyJobStatePath(agentDir);

  mkdirSync(join(agentDir, 'extensions', 'job-pipeline'), { recursive: true });
  writeFileSync(legacyPath, `${JSON.stringify(legacyState, null, 2)}\n`, 'utf8');

  const migration = migrateLegacyStateIfPresent(agentDir);

  assert.equal(migration.migrated, true);
  assert.equal(getActiveJobId(agentDir), legacyState.id);
  assert.ok(existsSync(getJobDir(agentDir, legacyState.id)));
  assert.deepEqual(loadJobSnapshot(agentDir, legacyState.id), legacyState);
  assert.equal(JSON.parse(readFileSync(legacyPath, 'utf8')), null);
});

test('migrateLegacyStateIfPresent is a no-op when no legacy state exists', () => {
  const agentDir = createAgentDir();

  const migration = migrateLegacyStateIfPresent(agentDir);

  assert.equal(migration.migrated, false);
  assert.equal(getActiveJobId(agentDir), null);
  assert.equal(existsSync(getJobsRoot(agentDir)), false);
});

test('listJobs returns known jobs sorted by createdAt descending', () => {
  const agentDir = createAgentDir();

  createJobRun(agentDir, buildJobState({ id: 'job-1', createdAt: 100, updatedAt: 100 }));
  createJobRun(agentDir, buildJobState({ id: 'job-2', createdAt: 300, updatedAt: 300 }));
  createJobRun(agentDir, buildJobState({ id: 'job-3', createdAt: 200, updatedAt: 200 }));

  const jobs = listJobs(agentDir);

  assert.deepEqual(jobs.map((job) => job.id), ['job-2', 'job-3', 'job-1']);
});
