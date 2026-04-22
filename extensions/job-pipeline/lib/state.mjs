import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Persistent job state, written to a JSON file under the pi agent directory
 * so it survives pi session restarts and can be resumed.
 *
 * @param {string} agentDir  From getAgentDir() in the TypeScript entry point.
 * @returns {string}
 */
export function getJobStatePath(agentDir) {
  return join(agentDir, 'extensions', 'job-pipeline', 'job-state.json');
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
 * @param {string} agentDir
 * @returns {object | null}
 */
export function readJobState(agentDir) {
  const path = getJobStatePath(agentDir);
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} agentDir
 * @param {object} state
 */
export function writeJobState(agentDir, state) {
  const path = getJobStatePath(agentDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  } catch {
    // Non-critical persistence; failure is logged by caller.
  }
}

/**
 * @param {string} agentDir
 */
export function clearJobState(agentDir) {
  const path = getJobStatePath(agentDir);
  try {
    if (existsSync(path)) writeFileSync(path, 'null\n', 'utf-8');
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
