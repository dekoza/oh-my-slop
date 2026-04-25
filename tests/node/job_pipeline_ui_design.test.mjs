import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectUiRequirement,
  selectVisualDesignMode,
} from '../../extensions/job-pipeline/lib/ui-design.mjs';
import {
  plannerInitialPrompt,
  plannerRevisePrompt,
  taskWriterPrompt,
  visualDesignerPrompt,
  workerPrompt,
} from '../../extensions/job-pipeline/lib/prompts.mjs';

test('detectUiRequirement treats user-supplied proposedUiDesign as an explicit UI signal', () => {
  const result = detectUiRequirement({
    spec: {
      goal: 'Add a new payment summary section.',
      proposedUiDesign: 'Use a two-column billing page with a sticky order summary card.',
    },
    plannerUiAssessment: { touchesUi: false },
    scoutResult: { relevantFiles: [] },
  });

  assert.equal(result.required, true);
  assert.equal(result.hasExistingUiSurface, false);
  assert.match(result.reasons.join('\n'), /user supplied a proposed ui design/i);
});

test('selectVisualDesignMode prefers user proposals over planner proposals', () => {
  const result = selectVisualDesignMode({
    spec: {
      goal: 'Refresh the checkout flow.',
      proposedUiDesign: 'Keep the current shell but switch to a stepper with right-rail totals.',
    },
    plannerUiAssessment: {
      touchesUi: true,
      proposedDesign: 'Use a tabbed wizard with inline summaries.',
      targetSurface: 'checkout page',
    },
    scoutResult: { relevantFiles: ['templates/checkout.html'] },
  });

  assert.equal(result.mode, 'critique-proposal');
  assert.equal(result.proposalSource, 'user');
  assert.match(result.proposedDesign, /stepper with right-rail totals/i);
});

test('selectVisualDesignMode uses planner proposal when the user did not provide one', () => {
  const result = selectVisualDesignMode({
    spec: {
      goal: 'Improve account settings navigation.',
    },
    plannerUiAssessment: {
      touchesUi: true,
      proposedDesign: 'Turn the settings page into a left-nav two-pane layout.',
      targetSurface: 'settings page',
    },
    scoutResult: { relevantFiles: ['templates/settings/account.html'] },
  });

  assert.equal(result.mode, 'critique-proposal');
  assert.equal(result.proposalSource, 'planner');
  assert.match(result.proposedDesign, /left-nav two-pane layout/i);
});

test('selectVisualDesignMode chooses extend-existing-ui when a UI feature fits an existing surface without a proposal', () => {
  const result = selectVisualDesignMode({
    spec: {
      goal: 'Add bulk actions to the orders dashboard table.',
    },
    plannerUiAssessment: {
      touchesUi: true,
      targetSurface: 'orders dashboard table',
    },
    scoutResult: {
      relevantFiles: [
        'templates/orders/dashboard.html',
        'static/css/orders.css',
        'apps/orders/views.py',
      ],
    },
  });

  assert.equal(result.mode, 'extend-existing-ui');
  assert.equal(result.proposalSource, 'none');
  assert.deepEqual(result.coherenceFiles, [
    'templates/orders/dashboard.html',
    'static/css/orders.css',
  ]);
});

test('selectVisualDesignMode falls back to propose-new-ui when UI is required but no existing UI surface is evidenced', () => {
  const result = selectVisualDesignMode({
    spec: {
      goal: 'Design a new onboarding wizard for first-time users.',
    },
    plannerUiAssessment: {
      touchesUi: true,
      targetSurface: 'new onboarding wizard',
    },
    scoutResult: {
      relevantFiles: ['apps/onboarding/service.py'],
    },
  });

  assert.equal(result.mode, 'propose-new-ui');
  assert.equal(result.proposalSource, 'none');
  assert.deepEqual(result.coherenceFiles, []);
});

test('plannerInitialPrompt requires structured uiAssessment output', () => {
  const prompt = plannerInitialPrompt({
    goal: 'Add a billing dashboard card.',
    scoutSummary: 'The repo uses server-rendered templates.',
    interviewNotes: 'The new card appears on the account overview page.',
  });

  assert.match(prompt, /"uiAssessment"/);
  assert.match(prompt, /"touchesUi": true/);
  assert.match(prompt, /"proposedDesign": "optional UI concept/);
  assert.match(prompt, /"targetSurface": "settings page \/ dashboard \/ modal \/ detail view"/);
});

test('plannerRevisePrompt preserves structured uiAssessment output on revisions', () => {
  const prompt = plannerRevisePrompt({
    previousPlan: 'Plan text',
    jesterCritique: 'Critique text',
    round: 1,
  });

  assert.match(prompt, /"uiAssessment"/);
  assert.match(prompt, /Preserve or update the uiAssessment block/);
});

test('taskWriterPrompt carries designer output into ui task requirements', () => {
  const prompt = taskWriterPrompt({
    finalPlan: 'Implement the account summary page.',
    scoutSummary: 'Relevant file: templates/account/summary.html',
    evidenceHint: 'both',
    designBrief: {
      mode: 'extend-existing-ui',
      summary: 'Keep the current dense card layout and add an actions rail.',
      designOutput: 'Use the existing dashboard shell and spacing rhythm.',
      acceptanceCriteria: ['Reuse existing card radius and spacing tokens.'],
      openQuestions: ['Should the new actions rail collapse on tablet widths?'],
      coherenceBasis: ['templates/account/summary.html'],
    },
  });

  assert.match(prompt, /## UI design brief/);
  assert.match(prompt, /extend-existing-ui/);
  assert.match(prompt, /Reuse existing card radius and spacing tokens/);
  assert.match(prompt, /"uiRelated": true/);
  assert.match(prompt, /"uiAcceptanceCriteria": \[/);
});

test('workerPrompt includes explicit ui acceptance criteria when present', () => {
  const prompt = workerPrompt({
    task: {
      id: 'task-ui-1',
      title: 'Add billing summary card',
      description: 'Implement the billing summary card.',
      testRequirement: 'node --test tests/node/billing_card.test.mjs',
      evidenceType: 'both',
      uiAcceptanceCriteria: [
        'Use the existing card spacing tokens.',
        'Keep focus states visible on all interactive elements.',
      ],
    },
    scoutSummary: 'templates/account/dashboard.html is the current shell.',
    cycleIndex: 2,
  });

  assert.match(prompt, /## UI acceptance criteria/);
  assert.match(prompt, /existing card spacing tokens/);
  assert.match(prompt, /Keep focus states visible/);
});

test('visualDesignerPrompt encodes repo coherence first for extend-existing-ui mode', () => {
  const prompt = visualDesignerPrompt({
    mode: 'extend-existing-ui',
    goal: 'Add bulk actions to the orders dashboard table.',
    interviewNotes: 'Users need batch operations without disrupting the current dashboard.',
    scoutSummary: 'templates/orders/dashboard.html and static/css/orders.css drive the existing UI.',
    relevantUiFiles: ['templates/orders/dashboard.html', 'static/css/orders.css'],
    uiDesignProposal: '',
    targetSurface: 'orders dashboard table',
  });

  assert.match(prompt, /repo coherence first, skill guidance second/i);
  assert.match(prompt, /Do not use --persist/i);
  assert.match(prompt, /"coherenceBasis": \[/);
  assert.match(prompt, /Inspect the current repository UI before proposing changes/i);
});
