import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendJobEvent,
  getJobEventsDir,
  readJobEvents,
  readLastJobEvent,
  validateEventLog,
} from '../../extensions/job-pipeline/lib/job-events.mjs';

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-events-'));
}

function buildStoredEvent({ seq, type, recordedAt, data }) {
  const payload = { seq, type, recordedAt, data };
  return {
    ...payload,
    checksum: createHash('sha256')
      .update(`${JSON.stringify(payload, null, 2)}\n`)
      .digest('hex'),
  };
}

test('appendJobEvent writes sequential event files starting at 000001', () => {
  const agentDir = createAgentDir();

  const first = appendJobEvent(agentDir, 'job-1', 'RUN_CREATED', { description: 'Add OAuth login' }, { recordedAt: 100 });
  const second = appendJobEvent(agentDir, 'job-1', 'INTERVIEW_CAPTURED', { goal: 'Ship OAuth login' }, { recordedAt: 200 });

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.match(first.path, /000001-run-created\.json$/);
  assert.match(second.path, /000002-interview-captured\.json$/);
  assert.ok(existsSync(first.path));
  assert.ok(existsSync(second.path));
});

test('readJobEvents returns events in sequence order even if filesystem order differs', () => {
  const agentDir = createAgentDir();
  const eventsDir = getJobEventsDir(agentDir, 'job-1');

  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(
    join(eventsDir, '000002-interview-captured.json'),
    `${JSON.stringify(buildStoredEvent({ seq: 2, type: 'INTERVIEW_CAPTURED', recordedAt: 200, data: {} }), null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(eventsDir, '000001-run-created.json'),
    `${JSON.stringify(buildStoredEvent({ seq: 1, type: 'RUN_CREATED', recordedAt: 100, data: {} }), null, 2)}\n`,
    'utf8',
  );

  const events = readJobEvents(agentDir, 'job-1');

  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
});

test('appendJobEvent persists event type, timestamp, payload, and checksum', () => {
  const agentDir = createAgentDir();

  const event = appendJobEvent(agentDir, 'job-1', 'RUN_CREATED', { description: 'Add OAuth login' }, { recordedAt: 100 });
  const parsed = JSON.parse(readFileSync(event.path, 'utf8'));

  assert.equal(parsed.seq, 1);
  assert.equal(parsed.type, 'RUN_CREATED');
  assert.equal(parsed.recordedAt, 100);
  assert.deepEqual(parsed.data, { description: 'Add OAuth login' });
  assert.equal(typeof parsed.checksum, 'string');
  assert.ok(parsed.checksum.length > 0);
});

test('validateEventLog reports checksum mismatch as a failure', () => {
  const agentDir = createAgentDir();

  const event = appendJobEvent(agentDir, 'job-1', 'RUN_CREATED', { description: 'Add OAuth login' }, { recordedAt: 100 });
  const parsed = JSON.parse(readFileSync(event.path, 'utf8'));
  parsed.data.description = 'tampered';
  writeFileSync(event.path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

  const report = validateEventLog(agentDir, 'job-1');

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.type === 'checksum-mismatch'));
});

test('validateEventLog reports missing sequence numbers', () => {
  const agentDir = createAgentDir();
  const eventsDir = getJobEventsDir(agentDir, 'job-1');

  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(
    join(eventsDir, '000001-run-created.json'),
    `${JSON.stringify(buildStoredEvent({ seq: 1, type: 'RUN_CREATED', recordedAt: 100, data: {} }), null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(eventsDir, '000003-stage-started.json'),
    `${JSON.stringify(buildStoredEvent({ seq: 3, type: 'STAGE_STARTED', recordedAt: 300, data: { stage: 'scout' } }), null, 2)}\n`,
    'utf8',
  );

  const report = validateEventLog(agentDir, 'job-1');

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.type === 'missing-sequence' && issue.expectedSeq === 2));
});

test('readLastJobEvent returns the latest event or null when none exist', () => {
  const agentDir = createAgentDir();

  assert.equal(readLastJobEvent(agentDir, 'job-1'), null);

  appendJobEvent(agentDir, 'job-1', 'RUN_CREATED', { description: 'Add OAuth login' }, { recordedAt: 100 });
  const latest = appendJobEvent(agentDir, 'job-1', 'INTERVIEW_CAPTURED', { goal: 'Ship OAuth login' }, { recordedAt: 200 });

  assert.deepEqual(readLastJobEvent(agentDir, 'job-1'), latest.event);
});
