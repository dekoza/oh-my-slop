import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordCleanRetro,
  recordRetroWithChanges,
  shouldSuggestAutonomy,
} from '../../extensions/job-pipeline/lib/autonomy.mjs';

const BASE_STATE = { cleanRetroStreak: 0 };

test('recordCleanRetro increments the streak by 1', () => {
  const next = recordCleanRetro(BASE_STATE);
  assert.equal(next.cleanRetroStreak, 1);
});

test('recordCleanRetro increments cumulatively', () => {
  let state = BASE_STATE;
  state = recordCleanRetro(state);
  state = recordCleanRetro(state);
  state = recordCleanRetro(state);
  assert.equal(state.cleanRetroStreak, 3);
});

test('recordRetroWithChanges resets the streak to 0', () => {
  const withStreak = { cleanRetroStreak: 5 };
  const next = recordRetroWithChanges(withStreak);
  assert.equal(next.cleanRetroStreak, 0);
});

test('recordRetroWithChanges sets lastRetroAt timestamp', () => {
  const before = Date.now();
  const next = recordRetroWithChanges(BASE_STATE);
  assert.ok(next.lastRetroAt >= before);
});

test('recordCleanRetro sets lastRetroAt timestamp', () => {
  const before = Date.now();
  const next = recordCleanRetro(BASE_STATE);
  assert.ok(next.lastRetroAt >= before);
});

test('shouldSuggestAutonomy returns false when streak is below required', () => {
  const state = { cleanRetroStreak: 2 };
  assert.equal(shouldSuggestAutonomy(state, { cleanRetrosRequired: 3 }), false);
});

test('shouldSuggestAutonomy returns true when streak meets required', () => {
  const state = { cleanRetroStreak: 3 };
  assert.equal(shouldSuggestAutonomy(state, { cleanRetrosRequired: 3 }), true);
});

test('shouldSuggestAutonomy returns true when streak exceeds required', () => {
  const state = { cleanRetroStreak: 7 };
  assert.equal(shouldSuggestAutonomy(state, { cleanRetrosRequired: 3 }), true);
});

test('streak survives a round trip through change then clean', () => {
  let state = { cleanRetroStreak: 3 };
  state = recordRetroWithChanges(state);  // reset to 0
  assert.equal(state.cleanRetroStreak, 0);
  state = recordCleanRetro(state);
  assert.equal(state.cleanRetroStreak, 1);
});
