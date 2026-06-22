# Legacy Change Workflow

Complete step-by-step walkthrough for making safe changes to legacy code. Based on Working Effectively with Legacy Code (Michael Feathers).

## Phase 1: Identify

1. **State the requested change.** What behavior should be different after your work?
2. **Identify the change point.** Which files, classes, methods need to be touched?
3. **Assess existing protection.** Are there trustworthy tests around the change point?

If there are no trustworthy tests, the code is legacy code. Proceed to Phase 2.

## Phase 2: Characterize

Before changing anything, capture what the code does today:

1. **Write a characterization test** that exercises the current behavior through its public interface.
2. **Run it.** It should pass against the current code. If it fails, the test captured wrong behavior — fix the test, not the code.
3. **Mark suspicious behavior.** If the code does something ugly but consumers might rely on it, add a comment: `# CHARACTERIZATION: this behavior is suspicious — verify with team before changing`.
4. **Repeat** until you have enough tests to confidently detect regressions in the area you're changing.

Characterization tests are not permanent documentation. They're safety nets. Once the area has proper tests, characterization tests can be replaced.

## Phase 3: Find or Create a Seam

A seam is where you can alter behavior without editing in that place:

1. **Look for existing seams:** Constructor parameters, method parameters, overridable methods, factory methods.
2. **If no seam exists, create the smallest one:**
   - Extract a method and make it overridable
   - Introduce a parameter to the constructor or method
   - Wrap a static call behind an instance method
3. **Decide:** Is this seam for *sensing* (observing behavior), *separation* (substituting a dependency), or both?

## Phase 4: Break the Dependency

Identify the specific dependency that blocks testing:

| Barrier | Technique |
|---|---|
| Constructor does I/O | Move to factory, inject result |
| Hidden `new` of collaborator | Extract factory method, inject factory |
| Static/global access | Encapsulate behind wrapper, inject wrapper |
| Time/randomness | Inject clock/random generator |
| File/network/DB access | Inject filesystem/HTTP client/repository |
| Non-deterministic environment | Wrap environment access, inject |

Break **one** dependency at a time. Verify tests still pass after each break.

## Phase 5: Change Behavior

Now make the actual requested change:

1. Write a test for the **new** behavior. It should fail.
2. Implement the change. The test should pass.
3. Verify characterization tests still pass (old behavior is preserved where intended).
4. Commit the behavior change separately from structural changes.

## Phase 6: Refactor Locally

Once the behavior change is protected by tests:

1. Remove temporary seams that are no longer needed.
2. Clean up characterization tests — replace with proper tests if the area now has good coverage.
3. Improve naming, extract methods, simplify conditionals — but only within the touched area.
4. **Do not** expand the refactor beyond what the requested change justifies.

## Phase 7: Verify

Run the final checklist:

- [ ] Untested area treated as legacy risk?
- [ ] Behavior delta and behavior-to-preserve stated?
- [ ] Uncertain current behavior characterized?
- [ ] Tests close enough and fast enough to diagnose the change?
- [ ] Smallest useful seam chosen (sensing vs separation clear)?
- [ ] Blocking dependency reduced without expanding hidden dependencies?
- [ ] Behavior change, refactoring, and cleanup kept separate?
- [ ] Temporary seam has a cleanup path?
- [ ] Touched area is more understandable, testable, or changeable?

## Common Patterns

### Large Method
1. Sketch the method's effects (what it reads, what it writes, what it calls).
2. Extract pure computation first (no side effects, easiest to test).
3. Isolate side effects behind collaborators.
4. Add tests around extracted parts.
5. Avoid editing many branches at once.

### Database-Heavy Code
1. Separate query/mapping from business policy.
2. Test policy without a real database (inject a repository).
3. Keep integration tests for actual persistence behavior.

### UI / Framework-Bound Code
1. Move decision logic out of handlers and callbacks.
2. Test the moved logic independently.
3. Keep adapters thin — they translate, they don't decide.

### Constructor Doing Too Much
1. Stop doing I/O, network, or config lookup in constructors.
2. Move setup to factories, builders, or composition roots.
3. Keep constructed objects easy to instantiate under test.
