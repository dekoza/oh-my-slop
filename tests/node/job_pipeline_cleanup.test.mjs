import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planCleanup, executeCleanup } from '../../extensions/job-pipeline/lib/cleanup.mjs';
import { createJobRun, getActiveJobPath, getJobDir, setActiveJobId } from '../../extensions/job-pipeline/lib/job-store.mjs';

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-cleanup-agent-'));
}

function createRepoRoot() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'job-pipeline-cleanup-repo-'));
  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.name', 'Job Pipeline Cleanup Test']);
  runGit(repoRoot, ['config', 'user.email', 'job-pipeline-cleanup@example.com']);
  writeFileSync(join(repoRoot, 'README.md'), '# cleanup\n', 'utf8');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'initial']);
  return repoRoot;
}

function createJob(agentDir, { id, repoRoot, updatedAt, merged = true, step = 'retro', worktree = false }) {
  const state = {
    id,
    description: `Job ${id}`,
    cwd: repoRoot,
    step,
    createdAt: updatedAt - 100,
    updatedAt,
    cycleIndex: 1,
    replanCount: 0,
    merged,
  };
  createJobRun(agentDir, state);

  const proofsDir = join(getJobDir(agentDir, id), 'proofs');
  mkdirSync(proofsDir, { recursive: true });
  writeFileSync(join(proofsDir, 'proof-cycle-1.html'), '<html>proof</html>', 'utf8');

  if (worktree) {
    const worktreePath = join(repoRoot, '.worktrees', id);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, 'notes.txt'), 'worktree', 'utf8');
    const snapshotPath = join(getJobDir(agentDir, id), 'snapshot.json');
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    snapshot.worktreePath = worktreePath;
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  return state;
}

test('planCleanup lists old merged jobs as removable while preserving recent jobs', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const now = 20 * DAY_MS;

  createJob(agentDir, { id: 'job-old', repoRoot, updatedAt: 1 * DAY_MS, merged: true });
  createJob(agentDir, { id: 'job-recent', repoRoot, updatedAt: 19 * DAY_MS, merged: true });

  const plan = planCleanup({ agentDir, now, keepDays: 7 });

  assert.ok(plan.candidates.some((candidate) => candidate.jobId === 'job-old' && candidate.kind === 'job-dir'));
  assert.ok(!plan.candidates.some((candidate) => candidate.jobId === 'job-recent'));
});

test('planCleanup preserves the active job even when it is old enough to prune', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const now = 20 * DAY_MS;

  createJob(agentDir, { id: 'job-active', repoRoot, updatedAt: 1 * DAY_MS, merged: true });
  setActiveJobId(agentDir, 'job-active', now);

  const plan = planCleanup({ agentDir, now, keepDays: 7 });

  assert.ok(!plan.candidates.some((candidate) => candidate.jobId === 'job-active'));
  assert.ok(existsSync(getActiveJobPath(agentDir)));
});

test('planCleanup includes orphaned worktree paths for old terminal jobs', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const now = 20 * DAY_MS;

  createJob(agentDir, { id: 'job-worktree', repoRoot, updatedAt: 1 * DAY_MS, merged: true, worktree: true });

  const plan = planCleanup({ agentDir, now, keepDays: 7 });

  assert.ok(plan.candidates.some((candidate) => candidate.jobId === 'job-worktree' && candidate.kind === 'worktree'));
});

test('planCleanup does not schedule unrelated directories for deletion', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const now = 20 * DAY_MS;
  const unrelatedPath = join(repoRoot, 'manual-notes');
  mkdirSync(unrelatedPath, { recursive: true });
  writeFileSync(join(unrelatedPath, 'keep.txt'), 'keep', 'utf8');

  createJob(agentDir, { id: 'job-safe', repoRoot, updatedAt: 1 * DAY_MS, merged: true });

  const plan = planCleanup({ agentDir, now, keepDays: 7 });

  assert.ok(!plan.candidates.some((candidate) => candidate.path === unrelatedPath));
});

test('executeCleanup removes planned extension-owned artifacts and returns reclaimed bytes', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const now = 20 * DAY_MS;

  createJob(agentDir, { id: 'job-clean', repoRoot, updatedAt: 1 * DAY_MS, merged: true, worktree: true });
  const keepState = createJob(agentDir, { id: 'job-keep', repoRoot, updatedAt: 19 * DAY_MS, merged: true, worktree: true });

  const plan = planCleanup({ agentDir, now, keepDays: 7 });
  const result = executeCleanup(plan);

  assert.ok(result.removedCount >= 2);
  assert.ok(result.reclaimedBytes > 0);
  assert.equal(existsSync(getJobDir(agentDir, 'job-clean')), false);
  assert.equal(existsSync(join(repoRoot, '.worktrees', 'job-clean')), false);
  assert.equal(existsSync(getJobDir(agentDir, keepState.id)), true);
  assert.equal(existsSync(join(repoRoot, '.worktrees', keepState.id)), true);
});

const DAY_MS = 24 * 60 * 60 * 1000;

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
