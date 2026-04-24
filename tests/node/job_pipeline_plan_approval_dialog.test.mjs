import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlanApprovalDialogSpec,
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
  assert.equal(spec.approveLabel, 'Yes');
  assert.equal(spec.denyLabel, 'No');
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
