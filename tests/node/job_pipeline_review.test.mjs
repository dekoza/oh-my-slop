import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reviewerPrompt } from '../../extensions/job-pipeline/lib/prompts.mjs';
import {
  buildReviewRepoContext,
  buildReviewTaskContext,
  resolveReviewCwd,
} from '../../extensions/job-pipeline/lib/review.mjs';

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

test('resolveReviewCwd prefers the worker worktree when it exists', () => {
  assert.equal(resolveReviewCwd('/tmp/worktree', '/tmp/repo'), '/tmp/worktree');
  assert.equal(resolveReviewCwd(undefined, '/tmp/repo'), '/tmp/repo');
});

test('buildReviewRepoContext captures committed and working tree changes from the job worktree', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'job-pipeline-review-'));
  const worktreePath = join(repoRoot, '.worktrees', 'job-test');

  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.name', 'Pi Reviewer Test']);
  runGit(repoRoot, ['config', 'user.email', 'reviewer@example.com']);

  writeFileSync(join(repoRoot, 'alpha.txt'), 'base\n', 'utf8');
  writeFileSync(join(repoRoot, 'beta.txt'), 'base\n', 'utf8');
  runGit(repoRoot, ['add', 'alpha.txt', 'beta.txt']);
  runGit(repoRoot, ['commit', '-m', 'base']);

  runGit(repoRoot, ['worktree', 'add', '-b', 'job/test', worktreePath]);

  writeFileSync(join(worktreePath, 'alpha.txt'), 'base\ncommitted\n', 'utf8');
  runGit(worktreePath, ['add', 'alpha.txt']);
  runGit(worktreePath, ['commit', '-m', 'change alpha']);

  writeFileSync(join(worktreePath, 'beta.txt'), 'base\nworking\n', 'utf8');
  writeFileSync(join(worktreePath, 'gamma.txt'), 'new file\n', 'utf8');

  const context = buildReviewRepoContext({ repoRoot, worktreePath });

  assert.match(context, /Changed files in committed branch history:\nalpha\.txt/);
  assert.match(context, /Working tree status:\nM beta\.txt\n\?\? gamma\.txt/);
  assert.match(context, /Uncommitted tracked-file diff stat:/);
  assert.match(context, /beta\.txt/);
});

test('reviewerPrompt requires evidence-driven review output with structured findings', () => {
  const prompt = reviewerPrompt({
    plan: 'Implement OAuth login safely.',
    cycleIndex: 2,
    repoContext: 'Changed files in committed branch history:\naccounts/views.py',
    taskContext: 'Task task-1 — Add OAuth login',
    proofDeckPath: '/tmp/proof-cycle-2.html',
  });

  assert.match(prompt, /Repository scope snapshot/);
  assert.match(prompt, /Changed files in committed branch history/);
  assert.match(prompt, /Use the repository snapshot as your starting point/);
  assert.match(prompt, /Use read-only tools to inspect the listed changed files directly/);
  assert.doesNotMatch(prompt, /git diff --name-only/);
  assert.match(prompt, /Inspect the actual changed files, not just summaries/);
  assert.match(prompt, /If evidence is insufficient, say so explicitly/);
  assert.match(prompt, /"findings": \[/);
  assert.match(prompt, /"missingTests": \[/);
  assert.match(prompt, /"openQuestions": \[/);
  assert.match(prompt, /\/tmp\/proof-cycle-2.html/);
});

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
