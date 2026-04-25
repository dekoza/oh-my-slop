import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPipeline } from '../../extensions/job-pipeline/lib/pipeline.mjs';
import { acquireJobLock, getJobLockPath, readJobLock } from '../../extensions/job-pipeline/lib/job-locks.mjs';

function createRepoRoot() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'job-pipeline-run-locking-'));
  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.name', 'Job Pipeline Test']);
  runGit(repoRoot, ['config', 'user.email', 'job-pipeline@example.com']);
  writeFileSync(join(repoRoot, 'README.md'), '# test\n', 'utf8');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'initial']);
  return repoRoot;
}

function buildConfig() {
  return {
    gates: {
      scoutQuestion: { mode: 'compulsory' },
      planApproval: { mode: 'compulsory' },
      proofReview: { mode: 'compulsory' },
      retroReview: { mode: 'compulsory' },
    },
  };
}

function buildUi() {
  return {
    confirm: async () => true,
    notify: () => {},
  };
}

test('runPipeline holds the job lock while waiting at the proof-review gate and releases it after approval', async () => {
  const repoRoot = createRepoRoot();
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-agent-'));
  const gate = createDeferred();
  const state = {
    id: 'job-2026-04-25-runlock0001',
    cwd: repoRoot,
    spec: { goal: 'Add OAuth login' },
    cycleIndex: 1,
    pool: {},
    scoutResult: { summary: 'done' },
    finalPlan: 'done',
    taskGraph: { tasks: [] },
    worktreePath: join(repoRoot, '.worktrees', 'job-2026-04-25-runlock0001'),
    workerResults: [],
    proofDeckPath: '/tmp/proof.html',
    reviewVerdict: 'approved',
    reviewNotes: 'looks good',
    humanApproved: false,
    merged: true,
    step: 'human-review',
  };

  const pipelinePromise = runPipeline({
    jobState: state,
    agentDir,
    config: buildConfig(),
    ui: buildUi(),
    proofReviewGate: async () => gate.promise,
    onProgress: () => {},
  });

  await Promise.resolve();

  assert.ok(readJobLock(agentDir, state.id));
  assert.equal(getJobLockPath(agentDir, state.id).endsWith('/lock.json'), true);

  gate.resolve(true);
  await pipelinePromise;

  assert.equal(readJobLock(agentDir, state.id), null);
});

test('runPipeline rejects when another live job lock already exists', async () => {
  const repoRoot = createRepoRoot();
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-agent-'));
  const state = {
    id: 'job-2026-04-25-runlock0002',
    cwd: repoRoot,
    spec: { goal: 'Add OAuth login' },
    cycleIndex: 1,
    pool: {},
    scoutResult: { summary: 'done' },
    finalPlan: 'done',
    taskGraph: { tasks: [] },
    worktreePath: join(repoRoot, '.worktrees', 'job-2026-04-25-runlock0002'),
    workerResults: [],
    proofDeckPath: '/tmp/proof.html',
    reviewVerdict: 'approved',
    reviewNotes: 'looks good',
    humanApproved: true,
    merged: true,
    step: 'retro',
  };

  acquireJobLock(agentDir, state.id, {
    pid: process.pid,
    owner: 'other-process',
    now: 100,
    processAlive: () => true,
  });

  await assert.rejects(
    () => runPipeline({
      jobState: state,
      agentDir,
      config: buildConfig(),
      ui: buildUi(),
      onProgress: () => {},
    }),
    /already locked by an active process/,
  );

  const lock = readJobLock(agentDir, state.id);
  assert.equal(lock.pid, process.pid);
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
