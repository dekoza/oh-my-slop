import test from 'node:test';
import assert from 'node:assert/strict';

import { interviewSystemAddition } from '../../extensions/job-pipeline/lib/prompts.mjs';

test('interviewSystemAddition deprecates the legacy capture tool and requires returning the spec directly', () => {
  const prompt = interviewSystemAddition({ description: 'Add audit logging to checkout flows.' });

  assert.match(prompt, /Do not call `job_interview_complete`/i);
  assert.match(prompt, /return the final structured spec directly/i);
  assert.doesNotMatch(prompt, /When the user confirms they are ready, call the `job_interview_complete` tool/i);
  assert.match(prompt, /Add audit logging to checkout flows\./);
});
