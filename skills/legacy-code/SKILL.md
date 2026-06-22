---
name: legacy-code
description: >
  Use when changing code that is expensive to change safely because behavior is unclear,
  tests are weak or missing, dependencies are hidden, or runtime/framework setup blocks
  local feedback. Based on Working Effectively with Legacy Code (Michael Feathers).
  Covers characterization tests, seams, dependency breaking, sprout/wrap techniques,
  and incremental risk reduction. Use when the user says "legacy code", "untested code",
  "change existing code safely", "refactor legacy", "add tests to legacy code",
  "break dependencies", or when touching code with no tests or unclear behavior.
---

# Working Effectively with Legacy Code

## When This Skill Loads

If you are reading this, the user is working with code that lacks trustworthy tests or has unclear behavior. **Stop and follow this workflow.** Do not start with a rewrite, a broad cleanup, or speculative refactoring.

## Core Principle

**Gain control before improving design.**

The legacy loop:
1. **Identify** the change point
2. **Characterize** current behavior (write tests that capture what it does today)
3. **Find or create** the smallest useful seam
4. **Break** the dependency that blocks testing
5. **Change** the requested behavior
6. **Refactor** locally — leave the area more testable

## Primary Directive

**If a part of the code lacks trustworthy tests, treat it as legacy code.**

Before editing, state:
- The **requested behavior change** (what should be different)
- The **current behavior that must remain** (what must not break)

If current behavior is uncertain, **characterize it** — write tests that capture what the code does today, even if the behavior is ugly. Do not silently "fix" behavior you don't understand.

## Decision Rules

### Characterization
- Write characterization tests when you don't know whether current behavior is intentional.
- Test externally visible behavior first — narrow tests around the slice you're modifying.
- If real consumers rely on ugly behavior, capture it. Mark it for clarification, don't silently fix it.
- Use sensing variables or temporary probes only to confirm a test reaches the intended path; remove them after use.

### Seams
A seam is a place where you can alter behavior without editing in that place. Use the **smallest seam** that unlocks the change:
- Constructor injection, parameter injection, extracted method, wrapper around static call, factory indirection
- Subclass seam only when language constraints leave no better option
- Link/preprocessing seams only when ordinary object seams are impractical
- Decide whether each seam is for **sensing** (observing behavior), **separation** (substituting a dependency), or both

### Dependency Breaking
When code is hard to test, look for these dependency types and break them:

| Dependency Type | Examples | Breaking Move |
|---|---|---|
| **Hidden inputs** | Time, randomness, env vars, thread-local state, globals, singletons | Inject clock, random generator, config |
| **Hard outputs** | File writes, network calls, DB writes, process exits, messages | Wrap behind an interface, inject the wrapper |
| **Construction problems** | Constructors doing real work, hidden `new`, buried factory calls | Split construction from use, parameterize constructor |
| **Static/global reach-through** | Direct static calls, global config access | Encapsulate behind a wrapper, inject the wrapper |

### Sprout and Wrap Techniques
When direct edits are too risky:

- **Sprout method:** Extract new behavior into a new method. Keep old code mostly untouched. Route to the new method from a small insertion point.
- **Sprout class:** Add a focused new collaborator. Delegate from the legacy class. Move behavior over incrementally.
- **Wrap method:** Add pre/post behavior around a risky method, or observe effects through a wrapper.
- **Wrap class:** Mediate through a new abstraction when the original class is too hard to test directly.

### Keep Changes Separate
- **Behavior changes** and **structural refactorings** go in separate commits.
- **Characterization tests** (capturing old behavior) and **new behavior tests** stay distinct.
- Exploratory restructuring for understanding: do not check it in.

## Trigger Rules

- **Uncertain behavior.** When behavior is unclear, consumers may rely on ugly behavior, or a branch is hard to prove — add characterization before changing semantics.
- **Expensive setup.** When tests require too much setup or a class can't be instantiated cheaply, break the first real barrier: constructor work, hidden allocation, factory call, global state, static construction.
- **Non-determinism.** When time, randomness, environment, thread-local state, files, network, or DB writes block repeatable tests — wrap or inject that boundary.
- **Large method/class.** When a method or class defeats local reasoning, sketch effects, find interception or pinch points, extract pure computation first.
- **Framework-bound code.** When changing database-heavy, UI, framework, or API-boundary code — separate policy from query/mapping/persistence/handlers.
- **Temporary seam.** When a seam is magical, public-for-test, subclass-only, or link/preprocessor-based — add a cleanup obligation. Remove it once safer structure exists.
- **Repeated edits.** When repeated edits cluster across several places, remove duplication incrementally under tests instead of launching a broad redesign.
- **Rewrite temptation.** When a rewrite feels tempting, choose the smallest sprout, wrap, seam, or characterization step that makes today's requested change safer.

## Forbidden Patterns

- **Rewrite as first move.** Do not replace a subsystem before understanding current behavior.
- **No-safety change.** Do not change legacy code with no tests or observation strategy.
- **Hidden dependency expansion.** Do not add more globals, statics, or ambient context to already hard-to-test code.
- **Cosmetic refactoring only.** Do not rename and format while leaving the real dependency knots intact.

## Final Checklist

Before finalizing any legacy change:
- [ ] Untested area treated as legacy risk?
- [ ] Behavior delta and behavior-to-preserve stated?
- [ ] Uncertain current behavior characterized?
- [ ] Tests close enough and fast enough to diagnose the change?
- [ ] Smallest useful seam chosen (sensing vs separation clear)?
- [ ] Blocking dependency reduced without expanding hidden dependencies?
- [ ] Behavior change, refactoring, and cleanup kept separate?
- [ ] Temporary seam has a cleanup path?
- [ ] Touched area is more understandable, testable, or changeable than before?

## Reference

| File | Use When |
|---|---|
| [Dependency Breaking](references/dependency-breaking.md) | Choosing which dependency-breaking technique applies to a specific barrier |
| [Seam Techniques](references/seam-techniques.md) | Deciding between sprout method, sprout class, wrap method, wrap class, extract-and-override |
| [Legacy Workflow](references/legacy-work.md) | Full step-by-step walkthrough of the legacy change loop |
