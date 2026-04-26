import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';

import { getActiveJobId, getJobDir, listJobs, loadJobSnapshot } from './job-store.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STEPS = new Set(['retro', 'done']);

export function planCleanup({ agentDir, now = Date.now(), keepDays = 7 } = {}) {
  const activeJobId = getActiveJobId(agentDir);
  const cutoff = Number(now) - (Number(keepDays) * DAY_MS);
  const candidates = [];
  const skipped = [];

  for (const job of listJobs(agentDir)) {
    const snapshot = loadJobSnapshot(agentDir, job.id);
    if (!snapshot) {
      skipped.push({ jobId: job.id, reason: 'missing-snapshot' });
      continue;
    }

    if (job.id === activeJobId) {
      skipped.push({ jobId: job.id, reason: 'active-job' });
      continue;
    }

    if (Number(snapshot.updatedAt ?? job.updatedAt ?? 0) >= cutoff) {
      skipped.push({ jobId: job.id, reason: 'recent-job' });
      continue;
    }

    if (!isTerminalJob(snapshot)) {
      skipped.push({ jobId: job.id, reason: 'non-terminal-job' });
      continue;
    }

    const jobDir = getJobDir(agentDir, job.id);
    if (existsSync(jobDir)) {
      candidates.push({
        kind: 'job-dir',
        jobId: job.id,
        path: jobDir,
        bytes: estimatePathBytes(jobDir),
      });
    }

    if (typeof snapshot.worktreePath === 'string' && snapshot.worktreePath.length > 0 && existsSync(snapshot.worktreePath)) {
      candidates.push({
        kind: 'worktree',
        jobId: job.id,
        path: snapshot.worktreePath,
        cwd: typeof snapshot.cwd === 'string' ? snapshot.cwd : undefined,
        bytes: estimatePathBytes(snapshot.worktreePath),
      });
    }
  }

  return {
    activeJobId,
    keepDays: Number(keepDays),
    cutoff,
    candidates,
    skipped,
    totalBytes: candidates.reduce((sum, candidate) => sum + candidate.bytes, 0),
  };
}

export function executeCleanup(plan) {
  const removed = [];
  let reclaimedBytes = 0;

  for (const candidate of plan?.candidates ?? []) {
    if (!existsSync(candidate.path)) {
      continue;
    }

    if (candidate.kind === 'worktree') {
      removeWorktree(candidate);
    } else {
      rmSync(candidate.path, { recursive: true, force: true });
    }

    reclaimedBytes += Number(candidate.bytes ?? 0);
    removed.push(candidate);
  }

  return {
    removed,
    removedCount: removed.length,
    reclaimedBytes,
  };
}

export function formatCleanupPlan(plan) {
  if (!plan || (plan.candidates?.length ?? 0) === 0) {
    return 'No cleanup candidates found.';
  }

  const lines = [
    `Cleanup candidates: ${plan.candidates.length}`,
    `Estimated reclaimed bytes: ${plan.totalBytes}`,
  ];

  for (const candidate of plan.candidates) {
    lines.push(`- [${candidate.kind}] ${candidate.jobId}: ${candidate.path}`);
  }

  return lines.join('\n');
}

function isTerminalJob(snapshot) {
  return snapshot.merged === true || TERMINAL_STEPS.has(snapshot.step);
}

function estimatePathBytes(path) {
  try {
    const stats = statSync(path);
    if (stats.isFile()) {
      return stats.size;
    }
    if (!stats.isDirectory()) {
      return 0;
    }

    return readdirSync(path).reduce((sum, entry) => sum + estimatePathBytes(`${path}/${entry}`), 0);
  } catch {
    return 0;
  }
}

function removeWorktree(candidate) {
  const repoRoot = resolveRepoRoot(candidate);
  if (repoRoot) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', candidate.path], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return;
    } catch {
      // Fall through to exact-path removal.
    }
  }

  rmSync(candidate.path, { recursive: true, force: true });
}

function resolveRepoRoot(candidate) {
  if (typeof candidate.cwd === 'string' && candidate.cwd.length > 0) {
    return candidate.cwd;
  }
  return null;
}
