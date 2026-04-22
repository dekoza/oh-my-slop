import test from 'node:test';
import assert from 'node:assert/strict';

import { generateProofHtml } from '../../extensions/job-pipeline/lib/proof.mjs';

const BASE_DECK = {
  jobId: 'job-test-001',
  goal: 'Add OAuth login',
  timestamp: 1_000_000_000_000,
  workerResults: [],
  reviewNotes: undefined,
  jesterCritique: undefined,
  plannerResolution: undefined,
  previousDeckPath: undefined,
  cycleIndex: 1,
};

test('generateProofHtml returns a string containing valid HTML skeleton', () => {
  const html = generateProofHtml(BASE_DECK);
  assert.ok(typeof html === 'string');
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('<html'));
  assert.ok(html.includes('</html>'));
});

test('generateProofHtml embeds job ID in output', () => {
  const html = generateProofHtml(BASE_DECK);
  assert.ok(html.includes('job-test-001'));
});

test('generateProofHtml embeds goal in output', () => {
  const html = generateProofHtml(BASE_DECK);
  assert.ok(html.includes('Add OAuth login'));
});

test('generateProofHtml escapes HTML special chars in goal', () => {
  const html = generateProofHtml({ ...BASE_DECK, goal: '<script>alert("xss")</script>' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('generateProofHtml includes log artifact content in preformatted block', () => {
  const deck = {
    ...BASE_DECK,
    workerResults: [
      {
        taskId: 'task-1',
        success: true,
        proofArtifacts: [{ type: 'log', content: 'test output: 5 passed', description: 'Test run' }],
      },
    ],
  };
  const html = generateProofHtml(deck);
  assert.ok(html.includes('test output: 5 passed'));
  assert.ok(html.includes('<pre'));
});

test('generateProofHtml includes screenshot as base64 img tag', () => {
  const deck = {
    ...BASE_DECK,
    workerResults: [
      {
        taskId: 'task-1',
        success: true,
        proofArtifacts: [
          { type: 'screenshot', content: 'aGVsbG8=', mimeType: 'image/png', description: 'Login page' },
        ],
      },
    ],
  };
  const html = generateProofHtml(deck);
  assert.ok(html.includes('data:image/png;base64,aGVsbG8='));
  assert.ok(html.includes('<img'));
});

test('generateProofHtml includes review notes section when present', () => {
  const deck = { ...BASE_DECK, reviewNotes: 'Looks good overall.' };
  const html = generateProofHtml(deck);
  assert.ok(html.includes('Looks good overall.'));
});

test('generateProofHtml includes previous deck link when previousDeckPath is set', () => {
  const deck = { ...BASE_DECK, previousDeckPath: '/some/path/proof-cycle-1.html' };
  const html = generateProofHtml(deck);
  assert.ok(html.includes('proof-cycle-1.html'));
});

test('generateProofHtml marks failed tasks clearly', () => {
  const deck = {
    ...BASE_DECK,
    workerResults: [
      {
        taskId: 'task-fail',
        success: false,
        failureReport: { attempted: 'write tests', found: 'missing dep', reason: 'import error' },
        proofArtifacts: [],
      },
    ],
  };
  const html = generateProofHtml(deck);
  assert.ok(html.includes('task-fail'));
  assert.ok(html.includes('import error'));
});
