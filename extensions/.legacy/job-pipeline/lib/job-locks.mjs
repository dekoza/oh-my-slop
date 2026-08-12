import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { getJobDir } from './job-store.mjs';

export function getJobLockPath(agentDir, jobId) {
  return join(getJobDir(agentDir, jobId), 'lock.json');
}

export function readJobLock(agentDir, jobId) {
  const path = getJobLockPath(agentDir, jobId);
  try {
    if (!existsSync(path)) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function inspectJobLock(agentDir, jobId, options = {}) {
  const path = getJobLockPath(agentDir, jobId);
  const lock = readJobLock(agentDir, jobId);
  if (!lock) {
    return {
      exists: false,
      live: false,
      stale: false,
      lockPath: path,
    };
  }

  const processAlive = options.processAlive ?? defaultProcessAlive;
  const now = Number(options.now ?? Date.now());
  const pid = Number(lock.pid);
  const live = Number.isFinite(pid) ? processAlive(pid) : false;
  const acquiredAt = Number(lock.acquiredAt ?? 0);

  return {
    exists: true,
    live,
    stale: !live,
    pid,
    owner: lock.owner,
    acquiredAt,
    ageMs: now - acquiredAt,
    lockPath: path,
  };
}

export function acquireJobLock(agentDir, jobId, options = {}) {
  const inspection = inspectJobLock(agentDir, jobId, {
    processAlive: options.processAlive,
    now: options.now,
  });

  if (inspection.exists && inspection.live) {
    throw new Error(`Job ${jobId} is already locked by an active process (${inspection.pid}, ${inspection.owner ?? 'unknown owner'}).`);
  }

  const pid = Number(options.pid ?? process.pid);
  const now = Number(options.now ?? Date.now());
  const owner = typeof options.owner === 'string' && options.owner.trim().length > 0
    ? options.owner.trim()
    : `pid:${pid}`;

  const lock = { pid, owner, acquiredAt: now };
  const path = getJobLockPath(agentDir, jobId);
  writeJsonFileAtomic(path, lock);

  return { lock, path, replacedStaleLock: inspection.exists && inspection.stale };
}

export function releaseJobLock(agentDir, jobId) {
  const path = getJobLockPath(agentDir, jobId);
  try {
    rmSync(path, { force: true });
  } catch {
    // Best effort.
  }
}

function writeJsonFileAtomic(path, value) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
