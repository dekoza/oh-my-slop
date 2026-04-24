import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlanApprovalDialogSpec,
  buildProofReviewDialogSpec,
  buildRetroReviewDialogSpec,
  ScrollableApprovalDialogState,
  wrapPlainText,
} from '../../extensions/job-pipeline/lib/plan-approval-dialog.mjs';

test('buildPlanApprovalDialogSpec includes clear sections and approval question', () => {
  const spec = buildPlanApprovalDialogSpec({
    planText: '1. Audit the current gate UI.\n2. Add a scrollable dialog.',
    critiqueHighlights: 'Round 1: the approval step is ambiguous.',
  });

  assert.equal(spec.title, 'Plan Approval');
  assert.match(spec.body, /Final Plan/);
  assert.match(spec.body, /Jester Critique Highlights/);
  assert.match(spec.body, /Add a scrollable dialog/);
  assert.match(spec.body, /approval step is ambiguous/);
  assert.equal(spec.question, 'Approve this plan and continue to task writing?');
  assert.equal(spec.approveLabel, 'Continue');
  assert.equal(spec.denyLabel, 'Pause');
});

test('buildProofReviewDialogSpec includes merge decision context', () => {
  const spec = buildProofReviewDialogSpec({
    verdict: 'changes-required',
    notes: 'The reviewer wants stronger coverage around denied proof review paths.',
    proofDeckPath: '/tmp/job/proof-cycle-2.html',
  });

  assert.equal(spec.title, 'Proof Review');
  assert.match(spec.body, /Verdict/);
  assert.match(spec.body, /changes-required/);
  assert.match(spec.body, /Reviewer Notes/);
  assert.match(spec.body, /denied proof review paths/);
  assert.match(spec.body, /Proof Deck/);
  assert.match(spec.body, /proof-cycle-2\.html/);
  assert.equal(spec.question, 'Merge this reviewed worktree into the main branch?');
  assert.equal(spec.approveLabel, 'Merge');
  assert.equal(spec.denyLabel, 'Request changes');
});

test('buildRetroReviewDialogSpec includes explicit acknowledgement question and changes', () => {
  const spec = buildRetroReviewDialogSpec({
    summary: 'The retro found repeated ambiguity in review gates.',
    processChanges: [
      'Add pinned approval questions to gate dialogs.',
      'Preserve scroll state while reading long critiques.',
    ],
    cleanRetroStreak: 2,
    cleanRetrosRequired: 3,
  });

  assert.equal(spec.title, 'Retrospective');
  assert.match(spec.body, /Summary/);
  assert.match(spec.body, /review gates/);
  assert.match(spec.body, /Process Changes/);
  assert.match(spec.body, /Add pinned approval questions/);
  assert.match(spec.body, /Preserve scroll state/);
  assert.match(spec.body, /Streak/);
  assert.match(spec.body, /2 \/ 3 clean retros/);
  assert.equal(spec.question, 'Acknowledge this retrospective and finish the job?');
  assert.equal(spec.approveLabel, 'Acknowledge');
  assert.equal(spec.denyLabel, 'Pause');
});

test('ScrollableApprovalDialogState exposes overflow content through scrolling', () => {
  const bodyText = Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join('\n');
  const state = new ScrollableApprovalDialogState({
    bodyText,
    question: 'Approve?',
    minBodyLines: 4,
    maxBodyLines: 4,
  });

  assert.deepEqual(state.getVisibleBodyLines(40), ['Line 1', 'Line 2', 'Line 3', 'Line 4']);

  state.pageDown(40);
  assert.deepEqual(state.getVisibleBodyLines(40), ['Line 4', 'Line 5', 'Line 6', 'Line 7']);

  state.scrollDown(40, 5);
  assert.deepEqual(state.getVisibleBodyLines(40), ['Line 9', 'Line 10', 'Line 11', 'Line 12']);
});

test('ScrollableApprovalDialogState toggles between approve and deny', () => {
  const state = new ScrollableApprovalDialogState({
    bodyText: 'Short body',
    question: 'Approve?',
  });

  assert.equal(state.confirm(), true);
  state.toggleChoice();
  assert.equal(state.confirm(), false);
  state.toggleChoice();
  assert.equal(state.confirm(), true);
});

test('wrapPlainText hard-wraps long tokens without adding blank trailing lines', () => {
  assert.deepEqual(wrapPlainText('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
});
