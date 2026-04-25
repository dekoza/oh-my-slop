import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireJobLock,
  getJobLockPath,
  inspectJobLock,
  readJobLock,
  releaseJobLock,
} from '../../extensions/job-pipeline/lib/job-locks.mjs';

function createAgentDir() {
  return mkdtempSync(join(tmpdir(), 'job-pipeline-locks-'));
}

test('acquireJobLock creates a lock file with pid, owner, and acquiredAt', () => {
  const agentDir = createAgentDir();

  const result = acquireJobLock(agentDir, 'job-2026-04-25-lock0001', {
    pid: 4242,
    owner: 'test-owner',
    now: 1_761_000_000_000,
    processAlive: () => true,
  });

  assert.ok(existsSync(getJobLockPath(agentDir, 'job-2026-04-25-lock0001')));
  assert.equal(result.lock.pid, 4242);
  assert.equal(result.lock.owner, 'test-owner');
  assert.equal(result.lock.acquiredAt, 1_761_000_000_000);
});

test('acquireJobLock rejects when a live lock already exists', () => {
  const agentDir = createAgentDir();

  acquireJobLock(agentDir, 'job-2026-04-25-lock0002', {
    pid: 1111,
    owner: 'first-owner',
    now: 100,
    processAlive: () => true,
  });

  assert.throws(
    () => acquireJobLock(agentDir, 'job-2026-04-25-lock0002', {
      pid: 2222,
      owner: 'second-owner',
      now: 200,
      processAlive: () => true,
    }),
    /already locked by an active process/,
  );

  const lock = readJobLock(agentDir, 'job-2026-04-25-lock0002');
  assert.equal(lock.pid, 1111);
  assert.equal(lock.owner, 'first-owner');
});

test('releaseJobLock removes the lock file owned by the current process', () => {
  const agentDir = createAgentDir();

  acquireJobLock(agentDir, 'job-2026-04-25-lock0003', {
    pid: 3333,
    owner: 'lock-owner',
    now: 100,
    processAlive: () => true,
  });

  releaseJobLock(agentDir, 'job-2026-04-25-lock0003');

  assert.equal(existsSync(getJobLockPath(agentDir, 'job-2026-04-25-lock0003')), false);
});

test('inspectJobLock marks a dead pid as stale', () => {
  const agentDir = createAgentDir();

  acquireJobLock(agentDir, 'job-2026-04-25-lock0004', {
    pid: 4444,
    owner: 'lock-owner',
    now: 100,
    processAlive: () => true,
  });

  const inspection = inspectJobLock(agentDir, 'job-2026-04-25-lock0004', {
    now: 250,
    processAlive: () => false,
  });

  assert.equal(inspection.exists, true);
  assert.equal(inspection.stale, true);
  assert.equal(inspection.live, false);
  assert.equal(inspection.pid, 4444);
  assert.equal(inspection.ageMs, 150);
});

test('releaseJobLock is safe when no lock exists', () => {
  const agentDir = createAgentDir();

  releaseJobLock(agentDir, 'job-2026-04-25-lock0005');

  assert.equal(existsSync(getJobLockPath(agentDir, 'job-2026-04-25-lock0005')), false);
});
