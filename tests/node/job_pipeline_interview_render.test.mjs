import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJobRun } from '../../extensions/job-pipeline/lib/job-store.mjs';
import {
  buildInterviewMessagePayload,
  buildInterviewMessageRenderModel,
} from '../../extensions/job-pipeline/lib/interview-render.mjs';

test('buildInterviewMessagePayload stores compact transcript references instead of raw image data', () => {
  const payload = buildInterviewMessagePayload({
    role: 'user',
    content: 'See attached.',
    imageCount: 2,
    jobId: 'job-123',
    transcriptIndex: 4,
  });

  assert.equal(payload.customType, 'job-pipeline-interview-user');
  assert.equal(payload.content, 'See attached.');
  assert.equal(payload.display, true);
  assert.deepEqual(payload.details, {
    role: 'user',
    imageCount: 2,
    jobId: 'job-123',
    transcriptIndex: 4,
  });
});

test('buildInterviewMessageRenderModel resolves inline thumbnails from the persisted interview transcript', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-interview-render-'));
  const state = {
    id: 'job-2026-05-04-render0001',
    description: 'demo',
    cwd: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    step: 'interview',
    cycleIndex: 1,
    replanCount: 0,
    jesterFlags: [],
    tokenCosts: {},
    interviewTranscript: [
      {
        role: 'user',
        content: 'Current screen looks wrong.',
        images: [
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'aaa' } },
          { type: 'image', source: { type: 'base64', mediaType: 'image/jpeg', data: 'bbb' } },
        ],
      },
    ],
  };
  createJobRun(agentDir, state);

  const model = buildInterviewMessageRenderModel(agentDir, {
    content: 'Current screen looks wrong.',
    details: {
      role: 'user',
      imageCount: 2,
      jobId: state.id,
      transcriptIndex: 0,
    },
  });

  assert.equal(model.body, 'Current screen looks wrong.');
  assert.equal(model.attachmentLabel, '[2 images attached]');
  assert.deepEqual(model.inlineImages, [
    { mediaType: 'image/png', data: 'aaa' },
    { mediaType: 'image/jpeg', data: 'bbb' },
  ]);
  assert.equal(model.remainingImageCount, 0);
});

test('buildInterviewMessageRenderModel caps inline thumbnails and falls back to the attachment label when the snapshot is missing', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'job-pipeline-interview-render-'));
  const state = {
    id: 'job-2026-05-04-render0002',
    description: 'demo',
    cwd: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    step: 'interview',
    cycleIndex: 1,
    replanCount: 0,
    jesterFlags: [],
    tokenCosts: {},
    interviewTranscript: [
      {
        role: 'user',
        content: '',
        images: [
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'one' } },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'two' } },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'three' } },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'four' } },
        ],
      },
    ],
  };
  createJobRun(agentDir, state);

  const model = buildInterviewMessageRenderModel(agentDir, {
    content: '',
    details: {
      role: 'user',
      imageCount: 4,
      jobId: state.id,
      transcriptIndex: 0,
    },
  });

  assert.equal(model.body, '[4 images attached]');
  assert.equal(model.attachmentLabel, '');
  assert.equal(model.inlineImages.length, 3);
  assert.equal(model.remainingImageCount, 1);

  const missingModel = buildInterviewMessageRenderModel(agentDir, {
    content: '',
    details: {
      role: 'user',
      imageCount: 2,
      jobId: 'job-missing',
      transcriptIndex: 0,
    },
  });

  assert.equal(missingModel.body, '[2 images attached]');
  assert.equal(missingModel.attachmentLabel, '');
  assert.deepEqual(missingModel.inlineImages, []);
  assert.equal(missingModel.remainingImageCount, 0);
});
