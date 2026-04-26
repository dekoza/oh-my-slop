import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendJobEvent } from '../../extensions/job-pipeline/lib/job-events.mjs';
import { startTrackedJob, captureInterviewSpec, recordPoolDraw } from '../../extensions/job-pipeline/lib/job-lifecycle.mjs';
import { acquireJobLock } from '../../extensions/job-pipeline/lib/job-locks.mjs';
import { writeJobSnapshot, writeStageArtifacts, writeTaskArtifacts } from '../../extensions/job-pipeline/lib/job-store.mjs';
import { writeProofDeck } from '../../extensions/job-pipeline/lib/state.mjs';
import { runDoctor, formatDoctorReport } from '../../extensions/job-pipeline/lib/doctor.mjs';

function createRepoRoot() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'job-pipeline-doctor-repo-'));
  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.name', 'Job Pipeline Doctor Test']);
  runGit(repoRoot, ['config', 'user.email', 'job-pipeline-doctor@example.com']);
  writeFileSync(join(repoRoot, 'README.md'), '# test\n', 'utf8');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'initial']);
  return repoRoot;
}

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-doctor-agent-'));
}

function buildPool() {
  return {
    scout: 'mock/scout',
    planner: 'mock/planner',
    jester: 'mock/jester',
    'task-writer': 'mock/task-writer',
    worker: 'mock/worker',
    reviewer: 'mock/reviewer',
  };
}

function buildHealthyJob(agentDir, repoRoot, jobId = 'job-2026-04-25-doctor0001') {
  const initialState = startTrackedJob(agentDir, {
    id: jobId,
    description: 'Harden OAuth callback validation',
    cwd: repoRoot,
    step: 'interview',
    createdAt: 100,
    updatedAt: 100,
    cycleIndex: 1,
    replanCount: 0,
  });
  const interviewState = captureInterviewSpec(agentDir, initialState, {
    goal: 'Harden OAuth callback validation',
    context: 'Preserve current auth behavior while tightening backend checks.',
    constraints: ['Keep current route structure'],
    outOfScope: ['UI redesign'],
    questionsToScout: ['Which auth files matter?'],
    evidenceHint: 'both',
  }, { now: 200 });
  const pooledState = recordPoolDraw(agentDir, interviewState, buildPool(), { now: 300 });

  appendJobEvent(agentDir, jobId, 'GATE_APPROVED', { gate: 'scout-question', step: 'scout' }, { recordedAt: 350 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'scout',
    step: 'planning',
    result: { scoutResult: { summary: 'Scout summary', answers: [], relevantFiles: ['README.md'] } },
  }, { recordedAt: 400 });
  appendJobEvent(agentDir, jobId, 'GATE_APPROVED', { gate: 'plan-approval', step: 'planning' }, { recordedAt: 450 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'planning',
    step: 'task-writing',
    result: { finalPlan: 'Plan text', planCritiques: ['Looks fine.'] },
  }, { recordedAt: 500 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'task-writing',
    step: 'worktree',
    result: { taskGraph: { tasks: [{ id: 'task-1', dependsOn: [] }] } },
  }, { recordedAt: 550 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'workers',
    step: 'proof',
    result: { workerResults: [{ taskId: 'task-1', success: true, summary: 'Done', artifactFiles: [] }] },
  }, { recordedAt: 600 });
  appendJobEvent(agentDir, jobId, 'TASK_QUEUED', { taskId: 'task-1', title: 'Implement callback' }, { recordedAt: 610 });
  appendJobEvent(agentDir, jobId, 'TASK_STARTED', { taskId: 'task-1', title: 'Implement callback' }, { recordedAt: 620 });
  appendJobEvent(agentDir, jobId, 'TASK_SUCCEEDED', {
    taskId: 'task-1',
    title: 'Implement callback',
    summary: 'Done',
    artifactFiles: [],
  }, { recordedAt: 630 });

  const proofDeckPath = writeProofDeck(agentDir, jobId, 1, '<html><body>proof</body></html>');
  appendJobEvent(agentDir, jobId, 'PROOF_WRITTEN', { proofDeckPath }, { recordedAt: 650 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'proof',
    step: 'review',
    result: { proofDeckPath },
  }, { recordedAt: 660 });
  appendJobEvent(agentDir, jobId, 'REVIEW_COMPLETED', {
    reviewVerdict: 'approved',
    reviewNotes: 'Review looks good.',
    reviewFindings: [],
    reviewMissingTests: [],
    reviewOpenQuestions: [],
    evidenceSummary: 'Inspected proof deck.',
  }, { recordedAt: 700 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'review',
    step: 'human-review',
    result: { reviewVerdict: 'approved', reviewNotes: 'Review looks good.' },
  }, { recordedAt: 710 });
  appendJobEvent(agentDir, jobId, 'GATE_APPROVED', { gate: 'proof-review', step: 'human-review' }, { recordedAt: 720 });
  appendJobEvent(agentDir, jobId, 'MERGE_COMPLETED', { step: 'retro' }, { recordedAt: 730 });
  appendJobEvent(agentDir, jobId, 'STAGE_COMPLETED', {
    stage: 'merge',
    step: 'retro',
    result: { merged: true },
  }, { recordedAt: 740 });

  writeStageArtifacts(agentDir, jobId, 1, 'scout', {
    responseText: JSON.stringify({ summary: 'Scout summary', answers: [], relevantFiles: ['README.md'] }),
    parsedJson: { summary: 'Scout summary', answers: [], relevantFiles: ['README.md'] },
  });
  writeStageArtifacts(agentDir, jobId, 1, 'planning', {
    responseText: 'Plan text',
    parsedJson: { finalPlan: 'Plan text', planCritiques: ['Looks fine.'] },
  });
  writeStageArtifacts(agentDir, jobId, 1, 'task-writing', {
    responseText: JSON.stringify({ tasks: [{ id: 'task-1', dependsOn: [] }] }),
    parsedJson: { tasks: [{ id: 'task-1', dependsOn: [] }] },
  });
  writeStageArtifacts(agentDir, jobId, 1, 'review', {
    responseText: JSON.stringify({ verdict: 'approved' }),
    parsedJson: { verdict: 'approved', findings: [] },
  });
  writeTaskArtifacts(agentDir, jobId, 1, 'task-1', {
    responseText: JSON.stringify({ status: 'success', summary: 'Done', artifactFiles: [] }),
    result: { taskId: 'task-1', success: true, summary: 'Done', artifactFiles: [] },
  });

  const finalSnapshot = {
    ...pooledState,
    scoutResult: { summary: 'Scout summary', answers: [], relevantFiles: ['README.md'] },
    finalPlan: 'Plan text',
    planCritiques: ['Looks fine.'],
    taskGraph: { tasks: [{ id: 'task-1', dependsOn: [] }] },
    workerResults: [{ taskId: 'task-1', success: true, summary: 'Done', artifactFiles: [] }],
    proofDeckPath,
    reviewVerdict: 'approved',
    reviewNotes: 'Review looks good.',
    reviewFindings: [],
    reviewMissingTests: [],
    reviewOpenQuestions: [],
    reviewEvidenceSummary: 'Inspected proof deck.',
    merged: true,
    step: 'retro',
    updatedAt: 740,
  };
  writeJobSnapshot(agentDir, jobId, finalSnapshot);

  return { jobId, proofDeckPath };
}

test('runDoctor reports HEALTHY for a consistent completed job', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const { jobId } = buildHealthyJob(agentDir, repoRoot);

  const report = runDoctor({
    agentDir,
    jobId,
    availableModels: Object.values(buildPool()),
    now: 1_000,
    processAlive: () => false,
  });

  assert.equal(report.overallStatus, 'HEALTHY');
  assert.equal(report.jobId, jobId);
  assert.equal(report.checks.find((check) => check.key === 'event-log')?.status, 'PASS');
  assert.equal(report.checks.find((check) => check.key === 'snapshot-consistency')?.status, 'PASS');
  assert.equal(report.checks.find((check) => check.key === 'proof-deck')?.status, 'PASS');
  assert.equal(report.checks.find((check) => check.key === 'model-availability')?.status, 'PASS');
  assert.match(formatDoctorReport(report), /OVERALL HEALTH: HEALTHY/);
});

test('runDoctor reports CRITICAL when the lock is stale', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const { jobId } = buildHealthyJob(agentDir, repoRoot, 'job-2026-04-25-doctor0002');

  acquireJobLock(agentDir, jobId, {
    pid: 99999,
    owner: 'stale-owner',
    now: 100,
    processAlive: () => true,
  });

  const report = runDoctor({
    agentDir,
    jobId,
    availableModels: Object.values(buildPool()),
    now: 500,
    processAlive: () => false,
  });

  assert.equal(report.overallStatus, 'CRITICAL');
  assert.equal(report.checks.find((check) => check.key === 'lock-status')?.status, 'FAIL');
});

test('runDoctor reports CRITICAL when snapshot and replayed events diverge', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const { jobId } = buildHealthyJob(agentDir, repoRoot, 'job-2026-04-25-doctor0003');
  const snapshot = loadSnapshotForMutation(agentDir, jobId);
  snapshot.finalPlan = 'Different plan text';
  writeJobSnapshot(agentDir, jobId, snapshot);

  const report = runDoctor({
    agentDir,
    jobId,
    availableModels: Object.values(buildPool()),
    now: 1_000,
    processAlive: () => false,
  });

  assert.equal(report.overallStatus, 'CRITICAL');
  assert.equal(report.checks.find((check) => check.key === 'snapshot-consistency')?.status, 'FAIL');
});

test('runDoctor reports CRITICAL when the proof deck referenced by the snapshot is missing', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const { jobId } = buildHealthyJob(agentDir, repoRoot, 'job-2026-04-25-doctor0004');
  const snapshot = loadSnapshotForMutation(agentDir, jobId);
  snapshot.proofDeckPath = join(agentDir, 'extensions', 'job-pipeline', 'jobs', jobId, 'proofs', 'missing.html');
  writeJobSnapshot(agentDir, jobId, snapshot);

  const report = runDoctor({
    agentDir,
    jobId,
    availableModels: Object.values(buildPool()),
    now: 1_000,
    processAlive: () => false,
  });

  assert.equal(report.checks.find((check) => check.key === 'proof-deck')?.status, 'FAIL');
});

test('runDoctor reports WARNING for an orphaned worktree path with a surviving branch', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const jobId = 'job-2026-04-25-doctor0005';
  const { jobId: resolvedJobId } = buildHealthyJob(agentDir, repoRoot, jobId);
  runGit(repoRoot, ['branch', `job/${jobId}`]);
  const snapshot = loadSnapshotForMutation(agentDir, jobId);
  snapshot.merged = false;
  snapshot.step = 'workers';
  snapshot.worktreePath = join(repoRoot, '.worktrees', jobId);
  writeJobSnapshot(agentDir, jobId, snapshot);

  const report = runDoctor({
    agentDir,
    jobId: resolvedJobId,
    availableModels: Object.values(buildPool()),
    now: 1_000,
    processAlive: () => false,
  });

  assert.equal(report.checks.find((check) => check.key === 'worktree-status')?.status, 'WARN');
});

test('runDoctor reports CRITICAL when configured models are unavailable or the task graph is invalid', () => {
  const agentDir = createAgentDir();
  const repoRoot = createRepoRoot();
  const jobId = 'job-2026-04-25-doctor0006';
  buildHealthyJob(agentDir, repoRoot, jobId);
  const snapshot = loadSnapshotForMutation(agentDir, jobId);
  snapshot.pool.worker = 'missing/worker';
  snapshot.taskGraph = { tasks: [{ id: 'task-1', dependsOn: ['task-missing'] }] };
  writeJobSnapshot(agentDir, jobId, snapshot);

  const report = runDoctor({
    agentDir,
    jobId,
    availableModels: Object.values(buildPool()),
    now: 1_000,
    processAlive: () => false,
  });

  assert.equal(report.checks.find((check) => check.key === 'model-availability')?.status, 'FAIL');
  assert.equal(report.checks.find((check) => check.key === 'task-graph')?.status, 'FAIL');
  assert.equal(report.overallStatus, 'CRITICAL');
});

function loadSnapshotForMutation(agentDir, jobId) {
  return JSON.parse(readFileSync(join(agentDir, 'extensions', 'job-pipeline', 'jobs', jobId, 'snapshot.json'), 'utf8'));
}

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
