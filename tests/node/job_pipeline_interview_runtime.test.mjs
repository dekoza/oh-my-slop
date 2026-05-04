import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startTrackedJob } from '../../extensions/job-pipeline/lib/job-lifecycle.mjs';
import { getJobSnapshotPath } from '../../extensions/job-pipeline/lib/job-store.mjs';
import { buildInterviewMessageRenderModel } from '../../extensions/job-pipeline/lib/interview-render.mjs';
import { appendInterviewMessageAndPersist } from '../../extensions/job-pipeline/lib/interview-runtime.mjs';
import { readJobState } from '../../extensions/job-pipeline/lib/state.mjs';

function createInterviewJob(agentDir, jobId) {
  return startTrackedJob(agentDir, {
    id: jobId,
    description: 'demo',
    cwd: `/tmp/${jobId}`,
    step: 'interview',
    cycleIndex: 1,
    replanCount: 0,
    jesterFlags: [],
    tokenCosts: {},
  }, { now: 1 });
}

test('appendInterviewMessageAndPersist survives cold recovery and drives inline image rendering', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-interview-runtime-'));
  const jobState = createInterviewJob(agentDir, 'job-2026-05-04-runtime0001');

  const result = appendInterviewMessageAndPersist(agentDir, jobState, {
    role: 'user',
    content: 'See attached error state.',
    images: [
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } },
    ],
    now: 2,
  });

  unlinkSync(getJobSnapshotPath(agentDir, jobState.id));

  const recoveredState = readJobState(agentDir, { repoRoot: jobState.cwd });
  assert.equal(recoveredState.interviewTranscript.length, 1);
  assert.equal(recoveredState.interviewTranscript[0].images[0].source.data, 'abc');

  const renderModel = buildInterviewMessageRenderModel(agentDir, result.messagePayload);
  assert.equal(renderModel.body, 'See attached error state.');
  assert.equal(renderModel.attachmentLabel, '[1 image attached]');
  assert.deepEqual(renderModel.inlineImages, [
    { mediaType: 'image/png', data: 'abc' },
  ]);
  assert.equal(renderModel.remainingImageCount, 0);
});

test('appendInterviewMessageAndPersist keeps historical transcript references stable across later turns', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-interview-runtime-'));
  const jobState = createInterviewJob(agentDir, 'job-2026-05-04-runtime0002');

  const firstTurn = appendInterviewMessageAndPersist(agentDir, jobState, {
    role: 'user',
    content: 'Current layout is broken.',
    images: [
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'one' } },
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'two' } },
    ],
    now: 2,
  });

  const secondTurn = appendInterviewMessageAndPersist(agentDir, firstTurn.jobState, {
    role: 'assistant',
    content: 'Which screen should stay unchanged?',
    now: 3,
  });

  const recoveredState = readJobState(agentDir, { repoRoot: jobState.cwd });
  assert.equal(recoveredState.interviewTranscript.length, 2);
  assert.equal(recoveredState.interviewTranscript[0].images.length, 2);
  assert.equal(recoveredState.interviewTranscript[1].content, 'Which screen should stay unchanged?');

  const firstRenderModel = buildInterviewMessageRenderModel(agentDir, firstTurn.messagePayload);
  assert.equal(firstRenderModel.attachmentLabel, '[2 images attached]');
  assert.deepEqual(firstRenderModel.inlineImages, [
    { mediaType: 'image/png', data: 'one' },
    { mediaType: 'image/png', data: 'two' },
  ]);

  const secondRenderModel = buildInterviewMessageRenderModel(agentDir, secondTurn.messagePayload);
  assert.equal(secondRenderModel.body, 'Which screen should stay unchanged?');
  assert.equal(secondRenderModel.attachmentLabel, '');
  assert.deepEqual(secondRenderModel.inlineImages, []);
});
