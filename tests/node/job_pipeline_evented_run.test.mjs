import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readJobEvents } from '../../extensions/job-pipeline/lib/job-events.mjs';
import { runPipeline } from '../../extensions/job-pipeline/lib/pipeline.mjs';

function createRepoRoot() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'job-pipeline-evented-run-'));
  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.name', 'Job Pipeline Event Test']);
  runGit(repoRoot, ['config', 'user.email', 'job-pipeline-events@example.com']);
  writeFileSync(join(repoRoot, 'README.md'), '# test\n', 'utf8');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'initial']);
  return repoRoot;
}

function buildConfig() {
  return {
    gates: {
      scoutQuestion: { mode: 'auto-accept' },
      planApproval: { mode: 'auto-accept' },
      proofReview: { mode: 'auto-accept' },
      retroReview: { mode: 'auto-accept' },
    },
  };
}

function buildUi() {
  return {
    confirm: async () => true,
    notify: () => {},
  };
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

test('runPipeline records stage events and persists stage outputs for a minimal successful run', async () => {
  const repoRoot = createRepoRoot();
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-agent-'));
  const state = {
    id: 'job-2026-04-25-events0001',
    description: 'Harden OAuth callback validation',
    cwd: repoRoot,
    spec: {
      goal: 'Harden OAuth callback validation',
      context: 'Preserve the current auth behavior while tightening backend checks.',
      questionsToScout: ['Which files are relevant?'],
      evidenceHint: 'both',
    },
    pool: buildPool(),
    cycleIndex: 1,
    replanCount: 0,
    step: 'planning',
  };

  const finalState = await runPipeline({
    jobState: state,
    agentDir,
    config: buildConfig(),
    ui: buildUi(),
    onProgress: () => {},
    runtime: {
      readonlyAgentSpawn: async ({ taskId }) => {
        switch (taskId) {
          case 'scout-cycle-1':
            return JSON.stringify({ summary: 'Scout summary', answers: [], relevantFiles: ['README.md'] });
          case 'planner-initial-attempt-1':
            return JSON.stringify({ plan: 'Plan text', uiAssessment: { touchesUi: false } });
          case 'jester-planning-round-1-attempt-1':
            return JSON.stringify({ verdict: 'acceptable', issues: [], summary: 'Looks fine.' });
          case 'task-writer-cycle-1':
            return JSON.stringify({ tasks: [] });
          case 'reviewer-cycle-1':
            return JSON.stringify({
              verdict: 'approved',
              findings: [],
              missingTests: [],
              openQuestions: [],
              evidenceSummary: 'Inspected proof deck.',
              overallNotes: 'Review looks good.',
            });
          case 'jester-review-cycle-1':
            return JSON.stringify({ verdict: 'acceptable', issues: [], summary: 'Review is fine.' });
          default:
            throw new Error(`Unexpected readonly agent task: ${taskId}`);
        }
      },
    },
  });

  const events = readJobEvents(agentDir, state.id);
  const eventTypes = events.map((event) => event.type);

  assert.ok(eventTypes.includes('STAGE_STARTED'));
  assert.ok(eventTypes.includes('STAGE_COMPLETED'));
  assert.ok(eventTypes.includes('PROOF_WRITTEN'));
  assert.ok(eventTypes.includes('REVIEW_COMPLETED'));
  assert.ok(eventTypes.includes('MERGE_COMPLETED'));
  assert.ok(eventTypes.includes('GATE_APPROVED'));
  assert.equal(finalState.merged, true);

  const scoutResponsePath = join(agentDir, 'extensions', 'job-pipeline', 'jobs', state.id, 'stages', 'cycle-1', 'scout', 'response.txt');
  const scoutParsedPath = join(agentDir, 'extensions', 'job-pipeline', 'jobs', state.id, 'stages', 'cycle-1', 'scout', 'parsed.json');
  const taskWriterResponsePath = join(agentDir, 'extensions', 'job-pipeline', 'jobs', state.id, 'stages', 'cycle-1', 'task-writing', 'response.txt');

  assert.equal(existsSync(scoutResponsePath), true);
  assert.equal(existsSync(scoutParsedPath), true);
  assert.equal(existsSync(taskWriterResponsePath), true);
  assert.match(readFileSync(scoutResponsePath, 'utf8'), /Scout summary/);
  assert.match(readFileSync(taskWriterResponsePath, 'utf8'), /"tasks":\[\]/);
});

test('runPipeline records worker task lifecycle events and persists task results', async () => {
  const repoRoot = createRepoRoot();
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-agent-'));
  const state = {
    id: 'job-2026-04-25-events0002',
    description: 'Add OAuth login',
    cwd: repoRoot,
    spec: {
      goal: 'Add OAuth login',
      context: 'Keep the existing auth page structure.',
      evidenceHint: 'both',
    },
    pool: buildPool(),
    cycleIndex: 1,
    replanCount: 0,
    scoutResult: { summary: 'Scout summary', answers: [], relevantFiles: ['README.md'] },
    finalPlan: 'Plan text',
    taskGraph: {
      tasks: [
        {
          id: 'task-1',
          title: 'Implement OAuth callback',
          dependsOn: [],
        },
      ],
    },
    step: 'workers',
  };

  const finalState = await runPipeline({
    jobState: state,
    agentDir,
    config: buildConfig(),
    ui: buildUi(),
    onProgress: () => {},
    runtime: {
      readonlyAgentSpawn: async ({ taskId }) => {
        switch (taskId) {
          case 'reviewer-cycle-1':
            return JSON.stringify({
              verdict: 'approved',
              findings: [],
              missingTests: [],
              openQuestions: [],
              evidenceSummary: 'Inspected proof deck.',
              overallNotes: 'Review looks good.',
            });
          case 'jester-review-cycle-1':
            return JSON.stringify({ verdict: 'acceptable', issues: [], summary: 'Review is fine.' });
          default:
            throw new Error(`Unexpected readonly agent task: ${taskId}`);
        }
      },
      codingAgentSpawn: async () => JSON.stringify({
        status: 'success',
        summary: 'Implemented OAuth callback.',
        artifactFiles: [],
      }),
    },
  });

  const events = readJobEvents(agentDir, state.id);
  const eventTypes = events.map((event) => event.type);

  assert.ok(eventTypes.includes('TASK_QUEUED'));
  assert.ok(eventTypes.includes('TASK_STARTED'));
  assert.ok(eventTypes.includes('TASK_SUCCEEDED'));
  assert.equal(finalState.workerResults?.length, 1);

  const taskResultPath = join(agentDir, 'extensions', 'job-pipeline', 'jobs', state.id, 'tasks', 'cycle-1', 'task-1', 'result.json');

  assert.equal(existsSync(taskResultPath), true);
  assert.match(readFileSync(taskResultPath, 'utf8'), /Implemented OAuth callback/);
});

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
