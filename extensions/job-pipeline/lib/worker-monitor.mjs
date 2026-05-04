import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readJobEvents } from './job-events.mjs';
import { getJobStagesRoot, getJobTasksRoot } from './job-store.mjs';

const STAGE_ORDER = ['scout', 'planning', 'task-writing', 'worktree', 'workers', 'proof', 'review', 'merge'];
const STAGE_TITLES = {
  scout: 'Scout — reconnaissance',
  planning: 'Planner — final planning package',
  'task-writing': 'Task writer — execution graph',
  worktree: 'Worktree — setup',
  workers: 'Workers — execution summary',
  proof: 'Proof — compiled deck',
  review: 'Reviewer — implementation review',
  merge: 'Merge — final merge',
};

export function createWorkerMonitorState() {
  return {
    jobId: undefined,
    workers: [],
  };
}

export function resetWorkerMonitorState(state, jobId) {
  state.jobId = jobId;
  state.workers = [];
  return state;
}

export function applyWorkerMonitorEvent(state, event) {
  if (!state || !event || !event.jobId) {
    return state;
  }

  if (state.jobId && state.jobId !== event.jobId) {
    resetWorkerMonitorState(state, event.jobId);
  }

  if (!state.jobId) {
    state.jobId = event.jobId;
  }

  if (event.type === 'job-reset') {
    resetWorkerMonitorState(state, event.jobId);
    return state;
  }

  const worker = ensureWorker(state, event);

  if (event.type === 'worker-queued') {
    if (event.title) {
      worker.title = event.title;
    }
    if (worker.status === 'pending') {
      worker.status = 'queued';
    }
    return state;
  }

  if (event.type === 'worker-started') {
    if (event.title) {
      worker.title = event.title;
    }
    worker.status = 'running';
    return state;
  }

  if (event.type === 'worker-log') {
    appendLogText(worker, event.text ?? '');
    return state;
  }

  if (event.type === 'worker-finished') {
    flushPendingLog(worker);
    worker.status = event.status;
    return state;
  }

  return state;
}

export function getSelectedWorker(state) {
  return state.workers[0];
}

export function getWorkerLogLines(worker) {
  if (!worker) {
    return [];
  }
  return worker.pendingLogLine
    ? [...worker.logLines, worker.pendingLogLine]
    : [...worker.logLines];
}

export function wrapWorkerLogLines(lines, width) {
  const safeWidth = Math.max(1, Math.floor(width || 1) - 1);
  const wrappedLines = [];

  for (const line of lines.length > 0 ? lines : ['']) {
    const normalizedLine = normalizeViewerLine(line);
    if (normalizedLine.length === 0) {
      wrappedLines.push('');
      continue;
    }

    let cursor = normalizedLine;
    while (cursor.length > safeWidth) {
      wrappedLines.push(cursor.slice(0, safeWidth));
      cursor = cursor.slice(safeWidth);
    }
    wrappedLines.push(cursor);
  }

  return wrappedLines.length > 0 ? wrappedLines : [''];
}

export function buildPersistedWorkerMonitorState({ agentDir, jobState, cycleFilter = 'all' }) {
  if (!agentDir || !jobState?.id) {
    return createWorkerMonitorState();
  }

  const state = createWorkerMonitorState();
  state.jobId = jobState.id;

  const events = readJobEvents(agentDir, jobState.id);
  const taskMetadataByKey = buildTaskMetadataByKey(events, jobState);

  const stageEntries = loadPersistedStageEntries(agentDir, jobState.id);
  const taskEntries = loadPersistedTaskEntries(agentDir, jobState.id, taskMetadataByKey);
  const proofEntries = loadProofDeckEntries(jobState);
  const allWorkers = [...stageEntries, ...taskEntries, ...proofEntries].sort(comparePersistedEntries);
  const availableCycles = [...new Set(allWorkers.map((worker) => worker.cycleIndex))].sort((left, right) => left - right);
  const selectedCycle = normalizeSelectedCycle(cycleFilter, availableCycles);

  state.availableCycles = availableCycles;
  state.selectedCycle = selectedCycle;
  state.workers = selectedCycle === 'all'
    ? allWorkers
    : allWorkers.filter((worker) => worker.cycleIndex === selectedCycle);
  return state;
}

function ensureWorker(state, event) {
  const key = buildWorkerKey(event.cycleIndex, event.taskId);
  let worker = state.workers.find((candidate) => candidate.key === key);
  if (worker) {
    return worker;
  }

  worker = {
    key,
    cycleIndex: event.cycleIndex,
    taskId: event.taskId,
    title: event.title ?? event.taskId,
    status: event.type === 'worker-started' ? 'running' : 'pending',
    logLines: [],
    pendingLogLine: '',
  };
  state.workers.push(worker);
  return worker;
}

function buildWorkerKey(cycleIndex, taskId) {
  return `${cycleIndex}:${taskId}`;
}

function appendLogText(worker, text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  if (!normalized) {
    return;
  }

  const parts = normalized.split('\n');
  worker.pendingLogLine += parts.shift() ?? '';

  while (parts.length > 0) {
    worker.logLines.push(worker.pendingLogLine);
    worker.pendingLogLine = parts.shift() ?? '';
  }
}

function flushPendingLog(worker) {
  if (!worker.pendingLogLine) {
    return;
  }
  worker.logLines.push(worker.pendingLogLine);
  worker.pendingLogLine = '';
}

function normalizeViewerLine(line) {
  return String(line ?? '').replace(/\t/g, '    ');
}

function loadPersistedStageEntries(agentDir, jobId) {
  const stagesRoot = getJobStagesRoot(agentDir, jobId);
  if (!existsSync(stagesRoot)) {
    return [];
  }

  const entries = [];
  for (const cycleEntry of readdirSync(stagesRoot, { withFileTypes: true })) {
    if (!cycleEntry.isDirectory()) {
      continue;
    }

    const cycleIndex = parseCycleIndex(cycleEntry.name);
    if (!cycleIndex) {
      continue;
    }

    const cycleDir = join(stagesRoot, cycleEntry.name);
    for (const stageEntry of readdirSync(cycleDir, { withFileTypes: true })) {
      if (!stageEntry.isDirectory()) {
        continue;
      }

      const responseText = readOptionalText(join(cycleDir, stageEntry.name, 'response.txt'));
      if (!responseText) {
        continue;
      }

      entries.push({
        key: buildWorkerKey(cycleIndex, `${stageEntry.name}-cycle-${cycleIndex}`),
        cycleIndex,
        taskId: `${stageEntry.name}-cycle-${cycleIndex}`,
        title: STAGE_TITLES[stageEntry.name] ?? stageEntry.name,
        status: 'success',
        logLines: toLogLines(responseText),
        pendingLogLine: '',
        sourcePath: join(cycleDir, stageEntry.name, 'response.txt'),
        sourceType: 'text',
      });
    }
  }

  return entries;
}

function loadPersistedTaskEntries(agentDir, jobId, taskMetadataByKey) {
  const tasksRoot = getJobTasksRoot(agentDir, jobId);
  if (!existsSync(tasksRoot)) {
    return [];
  }

  const entries = [];
  for (const cycleEntry of readdirSync(tasksRoot, { withFileTypes: true })) {
    if (!cycleEntry.isDirectory()) {
      continue;
    }

    const cycleIndex = parseCycleIndex(cycleEntry.name);
    if (!cycleIndex) {
      continue;
    }

    const cycleDir = join(tasksRoot, cycleEntry.name);
    for (const taskEntry of readdirSync(cycleDir, { withFileTypes: true })) {
      if (!taskEntry.isDirectory()) {
        continue;
      }

      const taskId = taskEntry.name;
      const result = readOptionalJson(join(cycleDir, taskId, 'result.json'));
      const responseText = readOptionalText(join(cycleDir, taskId, 'response.txt'));
      const metadata = taskMetadataByKey.get(buildWorkerKey(cycleIndex, taskId)) ?? {};
      const logLines = [];

      if (typeof result?.summary === 'string' && result.summary.trim().length > 0) {
        logLines.push(`Summary: ${result.summary.trim()}`);
      }
      if (Array.isArray(result?.artifactFiles) && result.artifactFiles.length > 0) {
        logLines.push(`Artifacts: ${result.artifactFiles.join(', ')}`);
      }
      if (responseText) {
        if (logLines.length > 0) {
          logLines.push('');
        }
        logLines.push(...toLogLines(responseText));
      }

      entries.push({
        key: buildWorkerKey(cycleIndex, taskId),
        cycleIndex,
        taskId,
        title: metadata.title ?? taskId,
        status: derivePersistedTaskStatus(result, metadata.status),
        logLines,
        pendingLogLine: '',
        sourcePath: join(cycleDir, taskId, 'response.txt'),
        sourceType: 'text',
      });
    }
  }

  return entries;
}

function loadProofDeckEntries(jobState) {
  if (typeof jobState?.proofDeckPath !== 'string' || jobState.proofDeckPath.trim().length === 0) {
    return [];
  }

  const cycleIndex = Number(jobState?.cycleIndex ?? 1);
  return [{
    key: buildWorkerKey(cycleIndex, `proof-deck-cycle-${cycleIndex}`),
    cycleIndex,
    taskId: `proof-deck-cycle-${cycleIndex}`,
    title: `Proof deck — cycle ${cycleIndex}`,
    status: 'success',
    logLines: [jobState.proofDeckPath],
    pendingLogLine: '',
    sourcePath: jobState.proofDeckPath,
    sourceType: 'html',
    browserPath: jobState.proofDeckPath,
  }];
}

function buildTaskMetadataByKey(events, jobState) {
  const metadataByKey = new Map();
  const tasksById = new Map(
    Array.isArray(jobState?.taskGraph?.tasks)
      ? jobState.taskGraph.tasks.map((task) => [task.id, task])
      : [],
  );

  for (const [taskId, task] of tasksById.entries()) {
    metadataByKey.set(buildWorkerKey(Number(jobState?.cycleIndex ?? 1), taskId), {
      title: task.title,
      status: 'pending',
    });
  }

  for (const event of Array.isArray(events) ? events : []) {
    const taskId = event?.data?.taskId;
    if (typeof taskId !== 'string' || taskId.length === 0) {
      continue;
    }

    const cycleIndex = Number(event?.data?.cycleIndex ?? jobState?.cycleIndex ?? 1);
    const key = buildWorkerKey(cycleIndex, taskId);
    const existing = metadataByKey.get(key) ?? {};
    metadataByKey.set(key, {
      title: event?.data?.title ?? existing.title ?? tasksById.get(taskId)?.title,
      status: deriveTaskStatusFromEvent(event.type, existing.status),
    });
  }

  return metadataByKey;
}

function derivePersistedTaskStatus(result, fallbackStatus) {
  if (result?.success === true) {
    return 'success';
  }
  if (result?.success === false) {
    return 'failed';
  }
  if (fallbackStatus === 'success' || fallbackStatus === 'failed' || fallbackStatus === 'running' || fallbackStatus === 'queued') {
    return fallbackStatus;
  }
  return 'pending';
}

function deriveTaskStatusFromEvent(eventType, fallbackStatus) {
  switch (eventType) {
    case 'TASK_QUEUED':
      return 'queued';
    case 'TASK_STARTED':
      return 'running';
    case 'TASK_SUCCEEDED':
      return 'success';
    case 'TASK_FAILED':
      return 'failed';
    default:
      return fallbackStatus ?? 'pending';
  }
}

function comparePersistedEntries(left, right) {
  if (left.cycleIndex !== right.cycleIndex) {
    return left.cycleIndex - right.cycleIndex;
  }

  const leftStageRank = getStageRank(left.taskId);
  const rightStageRank = getStageRank(right.taskId);
  if (leftStageRank !== rightStageRank) {
    return leftStageRank - rightStageRank;
  }

  return left.title.localeCompare(right.title);
}

function getStageRank(taskId) {
  if (typeof taskId !== 'string') {
    return STAGE_ORDER.length + 1;
  }
  if (taskId.startsWith('proof-deck-cycle-')) {
    return STAGE_ORDER.length + 2;
  }
  if (taskId.startsWith('task-')) {
    return STAGE_ORDER.length + 1;
  }

  const stageName = taskId.replace(/-cycle-\d+$/, '');
  const index = STAGE_ORDER.indexOf(stageName);
  return index === -1 ? STAGE_ORDER.length + 1 : index;
}

function parseCycleIndex(dirName) {
  const match = String(dirName).match(/^cycle-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function readOptionalText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  } catch {
    return '';
  }
}

function readOptionalJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function toLogLines(text) {
  const normalized = String(text ?? '');
  return normalized.length > 0 ? normalized.split('\n') : [];
}

function normalizeSelectedCycle(cycleFilter, availableCycles) {
  if (cycleFilter === 'all' || availableCycles.length === 0) {
    return 'all';
  }

  const parsed = Number(cycleFilter);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return availableCycles.at(-1) ?? 'all';
  }
  return availableCycles.includes(parsed) ? parsed : (availableCycles.at(-1) ?? 'all');
}
