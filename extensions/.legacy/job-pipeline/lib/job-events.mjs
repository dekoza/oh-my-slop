import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { getJobDir } from './job-store.mjs';

export function getJobEventsDir(agentDir, jobId) {
  return join(getJobDir(agentDir, jobId), 'events');
}

export function appendJobEvent(agentDir, jobId, type, data = {}, options = {}) {
  validateJobId(jobId);
  validateEventType(type);

  const eventsDir = getJobEventsDir(agentDir, jobId);
  mkdirSync(eventsDir, { recursive: true });

  const seq = getNextSequence(agentDir, jobId);
  const recordedAt = Number(options.recordedAt ?? Date.now());
  const event = buildEvent({ seq, type, recordedAt, data });
  const filename = formatEventFilename(seq, type);
  const path = join(eventsDir, filename);

  writeJsonFileAtomic(path, event);

  return { seq, filename, path, event };
}

export function readJobEvents(agentDir, jobId) {
  const eventsDir = getJobEventsDir(agentDir, jobId);
  if (!existsSync(eventsDir)) {
    return [];
  }

  const events = [];
  for (const entry of readdirSync(eventsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const parsed = readJsonFile(join(eventsDir, entry.name));
    if (parsed && typeof parsed.seq === 'number') {
      events.push(parsed);
    }
  }

  return events.sort((left, right) => left.seq - right.seq);
}

export function readLastJobEvent(agentDir, jobId) {
  const events = readJobEvents(agentDir, jobId);
  return events.length > 0 ? events[events.length - 1] : null;
}

export function validateEventLog(agentDir, jobId) {
  const eventsDir = getJobEventsDir(agentDir, jobId);
  if (!existsSync(eventsDir)) {
    return { ok: true, issues: [] };
  }

  const issues = [];
  const events = [];

  for (const entry of readdirSync(eventsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const path = join(eventsDir, entry.name);
    const parsed = readJsonFile(path);
    if (!parsed) {
      issues.push({ type: 'malformed-event', path });
      continue;
    }

    events.push({ path, event: parsed });
  }

  events.sort((left, right) => left.event.seq - right.event.seq);

  let expectedSeq = 1;
  for (const { path, event } of events) {
    while (expectedSeq < event.seq) {
      issues.push({ type: 'missing-sequence', expectedSeq, path });
      expectedSeq += 1;
    }

    if (event.seq !== expectedSeq) {
      issues.push({ type: 'unexpected-sequence', expectedSeq, actualSeq: event.seq, path });
      expectedSeq = event.seq;
    }

    const actualChecksum = computeEventChecksum({
      seq: event.seq,
      type: event.type,
      recordedAt: event.recordedAt,
      data: event.data,
    });
    if (actualChecksum !== event.checksum) {
      issues.push({ type: 'checksum-mismatch', path, seq: event.seq });
    }

    expectedSeq = event.seq + 1;
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function buildEvent({ seq, type, recordedAt, data }) {
  const normalized = {
    seq,
    type,
    recordedAt,
    data: data ?? {},
  };
  return {
    ...normalized,
    checksum: computeEventChecksum(normalized),
  };
}

function getNextSequence(agentDir, jobId) {
  const lastEvent = readLastJobEvent(agentDir, jobId);
  return lastEvent ? lastEvent.seq + 1 : 1;
}

function formatEventFilename(seq, type) {
  return `${String(seq).padStart(6, '0')}-${slugifyEventType(type)}.json`;
}

function slugifyEventType(type) {
  return String(type)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateJobId(jobId) {
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new Error('jobId must be a non-empty string.');
  }
}

function validateEventType(type) {
  if (typeof type !== 'string' || type.trim().length === 0) {
    throw new Error('Event type must be a non-empty string.');
  }
}

function computeEventChecksum(event) {
  return createHash('sha256')
    .update(`${JSON.stringify(event, null, 2)}\n`)
    .digest('hex');
}

function readJsonFile(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
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
