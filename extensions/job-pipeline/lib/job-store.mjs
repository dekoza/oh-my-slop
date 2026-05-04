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

export function getActiveJobsPath(agentDir) {
  return join(getJobPipelineRoot(agentDir), 'active-jobs.json');
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

export function getJobStagesRoot(agentDir, jobId) {
  return join(getJobDir(agentDir, jobId), 'stages');
}

export function getJobStageDir(agentDir, jobId, cycleIndex, stageName) {
  return join(getJobStagesRoot(agentDir, jobId), `cycle-${cycleIndex}`, stageName);
}

export function getJobTasksRoot(agentDir, jobId) {
  return join(getJobDir(agentDir, jobId), 'tasks');
}

export function getJobTaskDir(agentDir, jobId, cycleIndex, taskId) {
  return join(getJobTasksRoot(agentDir, jobId), `cycle-${cycleIndex}`, taskId);
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

export function setActiveJobId(agentDir, jobId, now = Date.now(), { repoRoot } = {}) {
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new Error('Active job id must be a non-empty string.');
  }

  const normalizedJobId = jobId.trim();
  const normalizedRepoRoot = normalizeRepoRoot(repoRoot);

  if (normalizedRepoRoot) {
    const pointers = readActiveJobPointers(agentDir);
    pointers[normalizedRepoRoot] = { jobId: normalizedJobId, updatedAt: now };
    writeJsonFileAtomic(getActiveJobsPath(agentDir), pointers);
  }

  const path = getActiveJobPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFileAtomic(path, {
    jobId: normalizedJobId,
    repoRoot: normalizedRepoRoot,
    updatedAt: now,
  });
  return path;
}

export function getActiveJobId(agentDir, { repoRoot } = {}) {
  const normalizedRepoRoot = normalizeRepoRoot(repoRoot);
  if (normalizedRepoRoot) {
    const pointers = readActiveJobPointers(agentDir);
    const scopedPointer = pointers[normalizedRepoRoot];
    if (scopedPointer && typeof scopedPointer.jobId === 'string' && scopedPointer.jobId.trim().length > 0) {
      return scopedPointer.jobId;
    }

    const legacyPointer = readJsonObject(getActiveJobPath(agentDir));
    if (legacyPointer?.repoRoot === normalizedRepoRoot && typeof legacyPointer.jobId === 'string' && legacyPointer.jobId.trim().length > 0) {
      return legacyPointer.jobId;
    }

    return null;
  }

  const legacyPointer = readJsonObject(getActiveJobPath(agentDir));
  if (legacyPointer && typeof legacyPointer.jobId === 'string' && legacyPointer.jobId.trim().length > 0) {
    return legacyPointer.jobId;
  }

  const pointers = Object.values(readActiveJobPointers(agentDir))
    .filter((pointer) => pointer && typeof pointer.jobId === 'string' && pointer.jobId.trim().length > 0)
    .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));

  return pointers[0]?.jobId ?? null;
}

export function clearActiveJobId(agentDir, { repoRoot } = {}) {
  const normalizedRepoRoot = normalizeRepoRoot(repoRoot);
  if (normalizedRepoRoot) {
    const pointers = readActiveJobPointers(agentDir);
    if (pointers[normalizedRepoRoot]) {
      delete pointers[normalizedRepoRoot];
      writeJsonFileAtomic(getActiveJobsPath(agentDir), pointers);
    }

    const legacyPointer = readJsonObject(getActiveJobPath(agentDir));
    if (legacyPointer?.repoRoot === normalizedRepoRoot) {
      writeJsonFileAtomic(getActiveJobPath(agentDir), null);
    }
    return;
  }

  const path = getActiveJobPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFileAtomic(path, null);
  writeJsonFileAtomic(getActiveJobsPath(agentDir), {});
}

export function listJobs(agentDir, { repoRoot } = {}) {
  const jobsRoot = getJobsRoot(agentDir);
  if (!existsSync(jobsRoot)) {
    return [];
  }

  const normalizedRepoRoot = normalizeRepoRoot(repoRoot);
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
        repoRoot: snapshot?.repoRoot ?? run?.repoRoot ?? snapshot?.cwd ?? run?.cwd ?? '',
        jobDir: getJobDir(agentDir, entry.name),
      };
    })
    .filter((job) => !normalizedRepoRoot || job.repoRoot === normalizedRepoRoot);

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

  setActiveJobId(agentDir, legacyState.id, Number(legacyState.updatedAt ?? Date.now()), {
    repoRoot: legacyState.repoRoot ?? legacyState.cwd,
  });
  writeJsonFileAtomic(legacyPath, null);

  return { migrated: true, jobId: legacyState.id };
}

export function writeStageArtifacts(agentDir, jobId, cycleIndex, stageName, { responseText, parsedJson, metadata } = {}) {
  const stageDir = getJobStageDir(agentDir, jobId, cycleIndex, stageName);
  mkdirSync(stageDir, { recursive: true });

  if (typeof responseText === 'string') {
    writeTextFileAtomic(join(stageDir, 'response.txt'), responseText);
  }
  if (parsedJson !== undefined) {
    writeJsonFileAtomic(join(stageDir, 'parsed.json'), parsedJson);
  }
  if (metadata !== undefined) {
    writeJsonFileAtomic(join(stageDir, 'metadata.json'), metadata);
  }

  return stageDir;
}

export function writeTaskArtifacts(agentDir, jobId, cycleIndex, taskId, { responseText, result } = {}) {
  const taskDir = getJobTaskDir(agentDir, jobId, cycleIndex, taskId);
  mkdirSync(taskDir, { recursive: true });

  if (typeof responseText === 'string') {
    writeTextFileAtomic(join(taskDir, 'response.txt'), responseText);
  }
  if (result !== undefined) {
    writeJsonFileAtomic(join(taskDir, 'result.json'), result);
  }

  return taskDir;
}

function buildRunMetadata(state) {
  return {
    schemaVersion: 1,
    id: state.id,
    description: state.description ?? '',
    cwd: state.cwd ?? '',
    repoRoot: state.repoRoot ?? state.cwd ?? '',
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

function readActiveJobPointers(agentDir) {
  const pointers = readJsonObject(getActiveJobsPath(agentDir));
  if (!pointers) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(pointers)
      .filter(([repoRoot, pointer]) => normalizeRepoRoot(repoRoot) && pointer && typeof pointer === 'object')
      .map(([repoRoot, pointer]) => [normalizeRepoRoot(repoRoot), pointer]),
  );
}

function normalizeRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string') {
    return null;
  }

  const normalized = repoRoot.trim();
  return normalized.length > 0 ? normalized : null;
}

function writeJsonFileAtomic(path, value) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}

function writeTextFileAtomic(path, value) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
  renameSync(tempPath, path);
}
