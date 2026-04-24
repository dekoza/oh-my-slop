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
