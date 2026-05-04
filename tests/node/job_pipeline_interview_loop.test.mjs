import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendInterviewTranscriptEntry,
  buildInterviewTranscriptText,
  collectInterviewTranscriptImages,
  parseInterviewPlannerResponse,
} from '../../extensions/job-pipeline/lib/interview-loop.mjs';

test('appendInterviewTranscriptEntry appends normalized entries without mutating the input transcript', () => {
  const original = [{ role: 'assistant', content: 'What are we building?' }];

  const next = appendInterviewTranscriptEntry(original, 'user', 'A safer OAuth callback flow');

  assert.deepEqual(original, [{ role: 'assistant', content: 'What are we building?' }]);
  assert.deepEqual(next, [
    { role: 'assistant', content: 'What are we building?' },
    { role: 'user', content: 'A safer OAuth callback flow' },
  ]);
});

test('buildInterviewTranscriptText formats transcript entries for the planner interview prompt', () => {
  const transcript = [
    { role: 'assistant', content: 'What part of auth do you want to change?' },
    { role: 'user', content: 'Only the backend callback validation.' },
  ];

  assert.equal(
    buildInterviewTranscriptText(transcript),
    [
      'Planner: What part of auth do you want to change?',
      'User: Only the backend callback validation.',
    ].join('\n\n'),
  );
});

test('buildInterviewTranscriptText marks image attachments and supports image-only replies', () => {
  const transcript = [
    {
      role: 'user',
      content: '',
      images: [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } },
      ],
    },
  ];

  assert.equal(
    buildInterviewTranscriptText(transcript),
    'User: [1 image attached]',
  );
});


test('collectInterviewTranscriptImages flattens images across transcript turns', () => {
  const transcript = [
    {
      role: 'user',
      content: 'Here is the first screenshot.',
      images: [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'one' } },
      ],
    },
    {
      role: 'assistant',
      content: 'What about the error page?',
    },
    {
      role: 'user',
      content: 'And here is the second screenshot.',
      images: [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'two' } },
      ],
    },
  ];

  assert.deepEqual(
    collectInterviewTranscriptImages(transcript),
    [
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'one' } },
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'two' } },
    ],
  );
});

test('parseInterviewPlannerResponse accepts ask responses with a user-facing message', () => {
  const parsed = parseInterviewPlannerResponse([
    '```json',
    '{"status":"ask","message":"What edge cases should the callback reject?"}',
    '```',
  ].join('\n'));

  assert.deepEqual(parsed, {
    status: 'ask',
    message: 'What edge cases should the callback reject?',
  });
});

test('parseInterviewPlannerResponse accepts complete responses with a structured spec', () => {
  const parsed = parseInterviewPlannerResponse(JSON.stringify({
    status: 'complete',
    message: 'I have enough to draft the job specification.',
    spec: {
      goal: 'Harden OAuth callback validation.',
      context: 'Keep the frontend flow unchanged.',
      constraints: ['Preserve current routes'],
      outOfScope: ['UI redesign'],
      questionsToScout: ['Which files implement the callback?'],
      evidenceHint: 'logs',
      proposedUiDesign: 'No UI changes.',
    },
  }));

  assert.equal(parsed.status, 'complete');
  assert.equal(parsed.message, 'I have enough to draft the job specification.');
  assert.equal(parsed.spec.goal, 'Harden OAuth callback validation.');
  assert.equal(parsed.spec.evidenceHint, 'logs');
});

test('parseInterviewPlannerResponse rejects invalid statuses and malformed specs', () => {
  assert.throws(
    () => parseInterviewPlannerResponse('{"status":"unknown","message":"hi"}'),
    /status/i,
  );
  assert.throws(
    () => parseInterviewPlannerResponse('{"status":"complete","message":"done","spec":{"goal":"x"}}'),
    /constraints/i,
  );
});
