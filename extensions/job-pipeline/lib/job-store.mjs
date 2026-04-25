import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function getJobPipelineRoot(agentDir) {
  return join(agentDir, 'extensions', 'job-pipeline');
}

export function getLegacyJobStatePath(agentDir) {
  return join(getJobPipelineRoot(agentDir), 'job-state.json');
}

export function getActiveJobPath(agentDir) {
  return join(getJobPipelineRoot(agentDir), 'active-job.json');
}

export function getJobsRoot(agentDir) {
  return join(getJobPipelineRoot(agentDir), 'jobs');
}

export function getJobDir(agentDir, jobId) {
  return join(getJobsRoot(agentDir), jobId);
}

export function getJobRunPath(agentDir, jobId) {
  return join(getJobDir(agentDir, jobId), 'run.json');
}

export function getJobSnapshotPath(agentDir, jobId) {
  return join(getJobDir(agentDir, jobId), 'snapshot.json');
}

export function createJobRun(agentDir, state) {
  validateJobState(state);

  const runPath = getJobRunPath(agentDir, state.id);
  const snapshotPath = getJobSnapshotPath(agentDir, state.id);

  mkdirSync(dirname(runPath), { recursive: true });
  writeJsonFileAtomic(runPath, buildRunMetadata(state));
  writeJsonFileAtomic(snapshotPath, state);

  return {
    jobId: state.id,
    jobDir: getJobDir(agentDir, state.id),
    runPath,
    snapshotPath,
  };
}

export function loadJobRun(agentDir, jobId) {
  return readJsonObject(getJobRunPath(agentDir, jobId));
}

export function loadJobSnapshot(agentDir, jobId) {
  return readJsonObject(getJobSnapshotPath(agentDir, jobId));
}

export function writeJobSnapshot(agentDir, jobId, snapshot) {
  validateJobState({ ...snapshot, id: jobId });
  const snapshotPath = getJobSnapshotPath(agentDir, jobId);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeJsonFileAtomic(snapshotPath, snapshot);
  return snapshotPath;
}

export function setActiveJobId(agentDir, jobId, now = Date.now()) {
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new Error('Active job id must be a non-empty string.');
  }

  const path = getActiveJobPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFileAtomic(path, { jobId: jobId.trim(), updatedAt: now });
  return path;
}

export function getActiveJobId(agentDir) {
  const pointer = readJsonObject(getActiveJobPath(agentDir));
  if (!pointer || typeof pointer.jobId !== 'string' || pointer.jobId.trim().length === 0) {
    return null;
  }
  return pointer.jobId;
}

export function clearActiveJobId(agentDir) {
  const path = getActiveJobPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFileAtomic(path, null);
}

export function listJobs(agentDir) {
  const jobsRoot = getJobsRoot(agentDir);
  if (!existsSync(jobsRoot)) {
    return [];
  }

  const jobs = readdirSync(jobsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const snapshot = loadJobSnapshot(agentDir, entry.name);
      const run = loadJobRun(agentDir, entry.name);
      const createdAt = Number(snapshot?.createdAt ?? run?.createdAt ?? 0);
      const updatedAt = Number(snapshot?.updatedAt ?? createdAt);
      return {
        id: entry.name,
        description: snapshot?.description ?? run?.description ?? '',
        createdAt,
        updatedAt,
        step: snapshot?.step ?? null,
        jobDir: getJobDir(agentDir, entry.name),
      };
    });

  return jobs.sort((left, right) => right.createdAt - left.createdAt);
}

export function migrateLegacyStateIfPresent(agentDir) {
  const activeJobId = getActiveJobId(agentDir);
  if (activeJobId) {
    return { migrated: false, reason: 'active-job-present', jobId: activeJobId };
  }

  const legacyPath = getLegacyJobStatePath(agentDir);
  const legacyState = readJsonObject(legacyPath);
  if (!legacyState || typeof legacyState.id !== 'string' || legacyState.id.trim().length === 0) {
    return { migrated: false, reason: 'no-legacy-state' };
  }

  if (!loadJobRun(agentDir, legacyState.id) || !loadJobSnapshot(agentDir, legacyState.id)) {
    createJobRun(agentDir, legacyState);
  }

  setActiveJobId(agentDir, legacyState.id, Number(legacyState.updatedAt ?? Date.now()));
  writeJsonFileAtomic(legacyPath, null);

  return { migrated: true, jobId: legacyState.id };
}

function buildRunMetadata(state) {
  return {
    schemaVersion: 1,
    id: state.id,
    description: state.description ?? '',
    cwd: state.cwd ?? '',
    createdAt: state.createdAt ?? Date.now(),
  };
}

function validateJobState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Job state must be an object.');
  }

  if (typeof state.id !== 'string' || state.id.trim().length === 0) {
    throw new Error('Job state must include a non-empty string id.');
  }
}

function readJsonObject(path) {
  try {
    if (!existsSync(path)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null) {
      return null;
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(path, value) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}
