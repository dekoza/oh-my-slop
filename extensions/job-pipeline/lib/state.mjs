import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  clearActiveJobId,
  createJobRun,
  getActiveJobId,
  getLegacyJobStatePath,
  loadJobRun,
  loadJobSnapshot,
  migrateLegacyStateIfPresent,
  setActiveJobId,
  writeJobSnapshot,
} from './job-store.mjs';

/**
 * Legacy compatibility path for the pre-migration single-file job state.
 * New code should prefer the per-job store in job-store.mjs.
 *
 * @param {string} agentDir  From getAgentDir() in the TypeScript entry point.
 * @returns {string}
 */
export function getJobStatePath(agentDir) {
  return getLegacyJobStatePath(agentDir);
}

/**
 * @param {string} agentDir
 * @returns {string}
 */
export function getAutonomyStatePath(agentDir) {
  return join(agentDir, 'extensions', 'job-pipeline', 'autonomy-state.json');
}

/**
 * @param {string} agentDir
 * @returns {string}
 */
export function getConfigPath(agentDir) {
  return join(agentDir, 'extensions', 'job-pipeline', 'config.json');
}

/**
 * Read the currently active job snapshot.
 *
 * @param {string} agentDir
 * @returns {object | null}
 */
export function readJobState(agentDir) {
  migrateLegacyStateIfPresent(agentDir);

  const activeJobId = getActiveJobId(agentDir);
  if (!activeJobId) {
    return null;
  }

  return loadJobSnapshot(agentDir, activeJobId);
}

/**
 * Persist a job snapshot and mark it as the active job.
 *
 * @param {string} agentDir
 * @param {object} state
 */
export function writeJobState(agentDir, state) {
  try {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return;
    }

    if (typeof state.id !== 'string' || state.id.trim().length === 0) {
      return;
    }

    const jobId = state.id;
    if (!loadJobRun(agentDir, jobId)) {
      createJobRun(agentDir, state);
    } else {
      writeJobSnapshot(agentDir, jobId, state);
    }

    setActiveJobId(agentDir, jobId, Number(state.updatedAt ?? Date.now()));
  } catch {
    // Non-critical persistence; failure is logged by caller.
  }
}

/**
 * Clear the active job pointer. Historical job snapshots are preserved.
 *
 * @param {string} agentDir
 */
export function clearJobState(agentDir) {
  const legacyPath = getLegacyJobStatePath(agentDir);

  try {
    clearActiveJobId(agentDir);
  } catch {
    // Best effort.
  }

  try {
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, 'null\n', 'utf-8');
  } catch {
    // Best effort.
  }
}

/**
 * @param {string} agentDir
 * @returns {{ cleanRetroStreak: number, lastRetroAt?: number }}
 */
export function readAutonomyState(agentDir) {
  const path = getAutonomyStatePath(agentDir);
  try {
    if (!existsSync(path)) return { cleanRetroStreak: 0 };
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return { cleanRetroStreak: 0 };
    return {
      cleanRetroStreak:
        typeof parsed.cleanRetroStreak === 'number' ? parsed.cleanRetroStreak : 0,
      lastRetroAt:
        typeof parsed.lastRetroAt === 'number' ? parsed.lastRetroAt : undefined,
    };
  } catch {
    return { cleanRetroStreak: 0 };
  }
}

/**
 * @param {string} agentDir
 * @param {{ cleanRetroStreak: number, lastRetroAt?: number }} state
 */
export function writeAutonomyState(agentDir, state) {
  const path = getAutonomyStatePath(agentDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  } catch {
    // Non-critical persistence.
  }
}

/**
 * Write a proof deck HTML file to the jobs proofs directory.
 * Returns the absolute path of the written file.
 *
 * @param {string} agentDir
 * @param {string} jobId
 * @param {number} cycleIndex
 * @param {string} html
 * @returns {string}
 */
export function writeProofDeck(agentDir, jobId, cycleIndex, html) {
  const dir = join(agentDir, 'extensions', 'job-pipeline', 'jobs', jobId, 'proofs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `proof-cycle-${cycleIndex}.html`);
  writeFileSync(path, html, 'utf-8');
  return path;
}

/**
 * Return the directory used to stage proof artifacts for a specific task
 * within a job cycle.
 *
 * @param {string} agentDir
 * @param {string} jobId
 * @param {number} cycleIndex
 * @param {string} taskId
 * @returns {string}
 */
export function getArtifactDir(agentDir, jobId, cycleIndex, taskId) {
  return join(
    agentDir,
    'extensions',
    'job-pipeline',
    'jobs',
    jobId,
    'artifacts',
    `cycle-${cycleIndex}`,
    taskId,
  );
}
