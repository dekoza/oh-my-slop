import test from 'node:test';
import assert from 'node:assert/strict';

import { reviewerPrompt } from '../../extensions/job-pipeline/lib/prompts.mjs';
import { buildReviewTaskContext } from '../../extensions/job-pipeline/lib/review.mjs';

test('buildReviewTaskContext combines task requirements, worker results, and artifact hints', () => {
  const context = buildReviewTaskContext({
    tasks: [
      {
        id: 'task-1',
        title: 'Add OAuth login',
        description: 'Implement the OAuth callback flow and persist linked identities.',
        testRequirement: 'uv run pytest tests/auth/test_oauth.py -x',
      },
      {
        id: 'task-2',
        title: 'Harden token validation',
        description: 'Reject expired and malformed state tokens.',
        testRequirement: 'uv run pytest tests/auth/test_state_tokens.py -x',
      },
    ],
  }, [
    {
      taskId: 'task-1',
      success: true,
      summary: 'Implemented callback handling and linked-account persistence.',
      artifactFiles: ['proof-task-1.log', 'proof-task-1-1.png'],
    },
    {
      taskId: 'task-2',
      success: false,
      summary: 'Token validation still fails for malformed payloads.',
      artifactFiles: ['proof-task-2.log'],
      failureReport: {
        attempted: 'Added invalid-token test coverage',
        found: 'State token parser accepts malformed payloads',
        reason: 'Malformed tokens still deserialize as valid state',
      },
    },
  ]);

  assert.match(context, /Task task-1 — Add OAuth login/);
  assert.match(context, /Implement the OAuth callback flow/);
  assert.match(context, /uv run pytest tests\/auth\/test_oauth.py -x/);
  assert.match(context, /Reported artifacts: proof-task-1.log, proof-task-1-1.png/);
  assert.match(context, /Task task-2 — Harden token validation/);
  assert.match(context, /Worker status: failed/);
  assert.match(context, /Failure reason: Malformed tokens still deserialize as valid state/);
});

test('reviewerPrompt requires evidence-driven review output with structured findings', () => {
  const prompt = reviewerPrompt({
    plan: 'Implement OAuth login safely.',
    cycleIndex: 2,
    taskContext: 'Task task-1 — Add OAuth login',
    proofDeckPath: '/tmp/proof-cycle-2.html',
  });

  assert.match(prompt, /Establish scope first/);
  assert.match(prompt, /git diff --name-only/);
  assert.match(prompt, /Inspect the actual changed files, not just summaries/);
  assert.match(prompt, /If evidence is insufficient, say so explicitly/);
  assert.match(prompt, /"findings": \[/);
  assert.match(prompt, /"missingTests": \[/);
  assert.match(prompt, /"openQuestions": \[/);
  assert.match(prompt, /\/tmp\/proof-cycle-2.html/);
});
