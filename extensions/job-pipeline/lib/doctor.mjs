import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readJobEvents, validateEventLog } from './job-events.mjs';
import { getActiveJobId, getJobStageDir, getJobTaskDir, loadJobRun, loadJobSnapshot } from './job-store.mjs';
import { inspectJobLock } from './job-locks.mjs';
import { rebuildSnapshotFromEvents } from './job-snapshot.mjs';
import { validateTaskGraph } from './tasks.mjs';

const STATUS_ORDER = {
  PASS: 0,
  WARN: 1,
  FAIL: 2,
};

export function runDoctor({
  agentDir,
  jobId,
  availableModels = [],
  now = Date.now(),
  processAlive,
} = {}) {
  const checks = [];
  const resolvedJobId = typeof jobId === 'string' && jobId.trim().length > 0
    ? jobId.trim()
    : getActiveJobId(agentDir);

  if (!resolvedJobId) {
    checks.push(createCheck('job-resolution', 'Job Resolution', 'FAIL', 'No active job could be resolved.'));
    return buildReport({ jobId: null, checks });
  }

  const snapshot = loadJobSnapshot(agentDir, resolvedJobId);
  const run = loadJobRun(agentDir, resolvedJobId);
  if (!snapshot && !run) {
    checks.push(createCheck('job-resolution', 'Job Resolution', 'FAIL', `Job ${resolvedJobId} does not exist.`));
    return buildReport({ jobId: resolvedJobId, checks });
  }

  checks.push(createCheck('job-resolution', 'Job Resolution', 'PASS', `Resolved job ${resolvedJobId}.`));

  if (!snapshot) {
    checks.push(createCheck('snapshot', 'Snapshot', 'FAIL', 'Job snapshot is missing.'));
    return buildReport({ jobId: resolvedJobId, checks });
  }

  checks.push(createCheck('snapshot', 'Snapshot', 'PASS', `Snapshot found at step ${snapshot.step ?? 'unknown'}.`));

  const events = readJobEvents(agentDir, resolvedJobId);
  const eventValidation = validateEventLog(agentDir, resolvedJobId);
  if (events.length === 0) {
    checks.push(createCheck('event-log', 'Event Log', 'WARN', 'No event files were recorded for this job.'));
  } else if (!eventValidation.ok) {
    checks.push(createCheck(
      'event-log',
      'Event Log',
      'FAIL',
      `Event log integrity failures: ${eventValidation.issues.map(formatEventIssue).join('; ')}`,
    ));
  } else {
    checks.push(createCheck('event-log', 'Event Log', 'PASS', `${events.length} event(s) recorded.`));
  }

  if (events.length > 0) {
    const replayed = rebuildSnapshotFromEvents(events);
    const expected = buildComparableSnapshot(replayed);
    const actual = buildComparableSnapshot(snapshot);
    if (stableJson(expected) === stableJson(actual)) {
      checks.push(createCheck('snapshot-consistency', 'Snapshot Consistency', 'PASS', 'Snapshot matches replayed events.'));
    } else {
      checks.push(createCheck(
        'snapshot-consistency',
        'Snapshot Consistency',
        'FAIL',
        `Snapshot diverges from replayed events. Expected ${stableJson(expected)} but found ${stableJson(actual)}.`,
      ));
    }
  } else {
    checks.push(createCheck('snapshot-consistency', 'Snapshot Consistency', 'WARN', 'Snapshot replay skipped because no events were recorded.'));
  }

  const lockInspection = inspectJobLock(agentDir, resolvedJobId, { now, processAlive });
  if (!lockInspection.exists) {
    checks.push(createCheck('lock-status', 'Lock Status', 'PASS', 'No active job lock is present.'));
  } else if (lockInspection.stale) {
    checks.push(createCheck(
      'lock-status',
      'Lock Status',
      'FAIL',
      `Stale lock detected at ${lockInspection.lockPath} (pid ${lockInspection.pid}, owner ${lockInspection.owner ?? 'unknown'}).`,
    ));
  } else {
    checks.push(createCheck('lock-status', 'Lock Status', 'PASS', `Live lock held by pid ${lockInspection.pid}.`));
  }

  checks.push(checkPersistedStageArtifacts(agentDir, resolvedJobId, events));
  checks.push(checkPersistedTaskResults(agentDir, resolvedJobId, events));
  checks.push(checkProofDeck(snapshot));
  checks.push(checkTaskGraph(snapshot));
  checks.push(checkModelAvailability(snapshot, availableModels));
  checks.push(checkWorktreeStatus(snapshot, resolvedJobId));

  return buildReport({ jobId: resolvedJobId, checks });
}

export function formatDoctorReport(report) {
  const lines = [
    '============================================',
    `  JOB PIPELINE DOCTOR REPORT`,
    `  Run: ${report.jobId ?? '(none)'}`,
    '============================================',
    '',
    `OVERALL HEALTH: ${report.overallStatus}`,
    '',
    '--------------------------------------------',
    '  CHECK RESULTS',
    '--------------------------------------------',
    '',
  ];

  for (const check of report.checks) {
    lines.push(`- [${check.status}] ${check.label}: ${check.summary}`);
  }

  return lines.join('\n');
}

function checkPersistedStageArtifacts(agentDir, jobId, events) {
  const requiredStages = new Set(['scout', 'planning', 'task-writing', 'review']);
  const missingFiles = [];

  for (const event of events) {
    if (event.type !== 'STAGE_COMPLETED' || !requiredStages.has(event.data?.stage)) {
      continue;
    }

    const cycleIndex = Number(event.data?.cycleIndex ?? 1);
    const stageDir = getJobStageDir(agentDir, jobId, cycleIndex, event.data.stage);
    const responsePath = join(stageDir, 'response.txt');
    const parsedPath = join(stageDir, 'parsed.json');
    if (!existsSync(responsePath)) {
      missingFiles.push(responsePath);
    }
    if (!existsSync(parsedPath)) {
      missingFiles.push(parsedPath);
    }
  }

  if (missingFiles.length > 0) {
    return createCheck('stage-artifacts', 'Stage Artifacts', 'FAIL', `Missing stage artifacts: ${missingFiles.join(', ')}`);
  }

  return createCheck('stage-artifacts', 'Stage Artifacts', 'PASS', 'Recorded stage outputs are present.');
}

function checkPersistedTaskResults(agentDir, jobId, events) {
  const relevantEvents = events.filter((event) => event.type === 'TASK_SUCCEEDED' || event.type === 'TASK_FAILED');
  const missingFiles = [];

  for (const event of relevantEvents) {
    const cycleIndex = Number(event.data?.cycleIndex ?? 1);
    const taskDir = getJobTaskDir(agentDir, jobId, cycleIndex, event.data.taskId);
    const resultPath = join(taskDir, 'result.json');
    if (!existsSync(resultPath)) {
      missingFiles.push(resultPath);
    }
  }

  if (missingFiles.length > 0) {
    return createCheck('task-results', 'Task Results', 'FAIL', `Missing task result files: ${missingFiles.join(', ')}`);
  }

  return createCheck('task-results', 'Task Results', 'PASS', 'Recorded task result files are present.');
}

function checkProofDeck(snapshot) {
  if (!snapshot.proofDeckPath) {
    return createCheck('proof-deck', 'Proof Deck', 'PASS', 'No proof deck is recorded for this snapshot.');
  }

  if (!existsSync(snapshot.proofDeckPath)) {
    return createCheck('proof-deck', 'Proof Deck', 'FAIL', `Proof deck is missing at ${snapshot.proofDeckPath}.`);
  }

  return createCheck('proof-deck', 'Proof Deck', 'PASS', `Proof deck exists at ${snapshot.proofDeckPath}.`);
}

function checkTaskGraph(snapshot) {
  if (!snapshot.taskGraph) {
    return createCheck('task-graph', 'Task Graph', 'PASS', 'No task graph is recorded for this snapshot.');
  }

  const errors = validateTaskGraph(snapshot.taskGraph);
  if (errors.length > 0) {
    return createCheck('task-graph', 'Task Graph', 'FAIL', errors.join(' '));
  }

  return createCheck('task-graph', 'Task Graph', 'PASS', 'Task graph is structurally valid.');
}

function checkModelAvailability(snapshot, availableModels) {
  if (!snapshot.pool) {
    return createCheck('model-availability', 'Model Availability', 'PASS', 'No model pool is recorded for this snapshot.');
  }

  const available = new Set(availableModels);
  const missing = Object.entries(snapshot.pool)
    .filter(([, modelId]) => typeof modelId === 'string' && !available.has(modelId))
    .map(([role, modelId]) => `${role}: ${modelId}`);

  if (missing.length > 0) {
    return createCheck('model-availability', 'Model Availability', 'FAIL', `Unavailable models: ${missing.join(', ')}`);
  }

  return createCheck('model-availability', 'Model Availability', 'PASS', 'All configured models are available.');
}

function checkWorktreeStatus(snapshot, jobId) {
  if (!snapshot.worktreePath) {
    return createCheck('worktree-status', 'Worktree Status', 'PASS', 'No worktree path is recorded in the snapshot.');
  }

  if (existsSync(snapshot.worktreePath)) {
    return createCheck('worktree-status', 'Worktree Status', 'PASS', `Worktree exists at ${snapshot.worktreePath}.`);
  }

  if (snapshot.merged) {
    return createCheck('worktree-status', 'Worktree Status', 'PASS', 'Merged job no longer needs a worktree checkout.');
  }

  const repoRoot = tryFindRepoRoot(snapshot.cwd);
  const branchName = `job/${jobId}`;
  const branchExists = repoRoot ? gitBranchExists(repoRoot, branchName) : false;

  if (branchExists) {
    return createCheck('worktree-status', 'Worktree Status', 'WARN', `Worktree path is missing but branch ${branchName} still exists.`);
  }

  return createCheck('worktree-status', 'Worktree Status', 'WARN', `Worktree path is missing at ${snapshot.worktreePath}.`);
}

function buildComparableSnapshot(snapshot) {
  return {
    id: snapshot.id,
    description: snapshot.description,
    cwd: snapshot.cwd,
    step: snapshot.step,
    createdAt: snapshot.createdAt,
    cycleIndex: snapshot.cycleIndex,
    replanCount: snapshot.replanCount,
    pool: snapshot.pool,
    scoutResult: snapshot.scoutResult,
    finalPlan: snapshot.finalPlan,
    planCritiques: snapshot.planCritiques,
    taskGraph: snapshot.taskGraph,
    worktreePath: snapshot.worktreePath,
    workerResults: snapshot.workerResults,
    proofDeckPath: snapshot.proofDeckPath,
    previousProofDeckPath: snapshot.previousProofDeckPath,
    reviewVerdict: snapshot.reviewVerdict,
    reviewNotes: snapshot.reviewNotes,
    reviewFindings: snapshot.reviewFindings,
    reviewMissingTests: snapshot.reviewMissingTests,
    reviewOpenQuestions: snapshot.reviewOpenQuestions,
    reviewEvidenceSummary: snapshot.reviewEvidenceSummary,
    merged: snapshot.merged,
    pausedGate: snapshot.pausedGate,
    lastError: snapshot.lastError,
  };
}

function buildReport({ jobId, checks }) {
  const worst = checks.reduce((current, check) => Math.max(current, STATUS_ORDER[check.status] ?? 0), 0);
  return {
    jobId,
    checks,
    overallStatus: worst >= STATUS_ORDER.FAIL ? 'CRITICAL' : worst >= STATUS_ORDER.WARN ? 'WARNING' : 'HEALTHY',
  };
}

function createCheck(key, label, status, summary) {
  return { key, label, status, summary };
}

function formatEventIssue(issue) {
  switch (issue.type) {
    case 'checksum-mismatch':
      return `checksum mismatch at ${issue.path}`;
    case 'missing-sequence':
      return `missing sequence ${issue.expectedSeq}`;
    case 'malformed-event':
      return `malformed event ${issue.path}`;
    default:
      return issue.type;
  }
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortValue(entryValue)]),
  );
}

function tryFindRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitBranchExists(repoRoot, branchName) {
  try {
    execFileSync('git', ['show-ref', '--verify', `refs/heads/${branchName}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}
