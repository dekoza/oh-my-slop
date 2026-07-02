---
name: refactoring-pass
description: >
  Changing existing code structure without intending to change observable behavior. Based
  on Refactoring (Martin Fowler). Covers: behavior-preserving transformations, code smell
  detection, named refactoring moves (extract, inline, move, rename, decompose), preparatory
  and follow-up refactoring around feature work, and stop conditions. Triggers on: "refactor",
  "restructure", "clean up", "extract", "inline", "rename", "move code", "reduce duplication",
  "simplify", "code smell", "behavior-preserving", or when reviewing code for structural
  improvement without changing observable behavior.
---

# Refactoring Pass

## When This Skill Loads

If you are reading this, the user wants to improve code structure without changing what the code does. **Refactoring is behavior-preserving design work in small steps.** Do not turn cleanup into a rewrite, a hidden feature change, or speculative architecture.

## Core Principle

**Preserve observable behavior.** Every structural change must leave the code doing exactly what it did before — just better organized.

## The Refactoring Workflow

### 1. Identify the Friction
What makes the current code hard to change? Common smells:
- **Duplication** — same code in multiple places
- **Long functions** — too much in one method
- **Long parameter lists** — too many arguments
- **Divergent change** — one class changes for many reasons
- **Shotgun surgery** — one change requires edits across many files
- **Feature envy** — a method uses another class's data more than its own
- **Primitive obsession** — primitives where value objects would carry meaning
- **Repeated conditionals** — same switch/if-else chain in multiple places
- **Middle man** — a class that only delegates to another
- **Speculative generality** — abstractions with one caller

### 2. Establish a Safety Net
Before refactoring, make sure you can detect regressions:
- **Existing tests:** Run them. They must pass before you start.
- **No tests:** Write characterization tests around the area you're changing. Capture current behavior, even if it's ugly.
- **Unclear behavior:** Characterize first. Don't refactor code you don't understand.

### 3. Refactor in Small Steps
Each step should be:
- **Reversible** — you can undo it if something breaks
- **Buildable** — the code compiles/passes after each step
- **Testable** — you can run tests after each step
- **Reviewable** — the diff is small enough to reason about

**Commit after each step that passes tests.**

### 4. Preparatory Refactoring (Before a Feature)
When a requested feature is awkward to make:
1. Identify the structural friction that blocks the change.
2. Reshape that local structure first — just enough to make the feature simple.
3. Make the behavior change.
4. Clean up debt introduced by the change.

### 5. Follow-up Refactoring (After a Feature)
After making a behavior change:
1. Look for smells the change introduced or revealed.
2. Clean them up while the context is fresh.
3. Don't expand beyond what the feature touched.

## Named Moves

Prefer the simplest named move that helps:

| Move | When |
|---|---|
| **Rename** | Name is misleading, vague, or mechanism-focused. Rename before deeper work when bad names block understanding. |
| **Extract method** | A chunk of code has a distinct purpose. Extract it, name the purpose. |
| **Extract class** | A class has two independent responsibilities. Split them. |
| **Inline** | A method's body is as clear as its name. Inline it. |
| **Move method/field** | Behavior lives in the wrong class. Move it where the data is. |
| **Introduce parameter object** | A group of parameters always travels together. Bundle them. |
| **Encapsulate collection** | Callers manipulate a collection directly. Expose intent-revealing methods instead. |
| **Decompose conditional** | A complex conditional or switch. Extract predicates, use guard clauses, or replace with polymorphism. |
| **Replace conditional with polymorphism** | Repeated type codes or switch statements that vary behavior. |
| **Use guard clauses** | Nested conditionals with early exits. Flatten with guard clauses at the top. |

## Decision Rules

- **Separate behavior changes from structural changes.** Never mix a feature change with a refactoring in the same commit.
- **Refactor the blocking smell, not every smell in sight.** Focus on what makes the current task hard.
- **Use abstraction only when current evidence justifies it.** Remove pass-through layers, vague utilities, and just-in-case interfaces.
- **Preserve error semantics** unless intentionally changing behavior. Refactor error handling to reveal the main path.
- **Keep patches reviewable.** Group related refactorings. Avoid giant patches that rename, move, redesign, and change logic together.

## Trigger Rules

- **Adding behavior:** First ask what structural friction blocks the change. Refactor before the feature only when it makes the feature safer or simpler.
- **Fixing a bug in unclear code:** Characterize the current failure. Refactor only enough to make the fix visible before changing behavior.
- **Weak tests:** Make the smallest possible structural move. Improve testability before broader cleanup.
- **Third repetition:** When the same edit appears for a third time, remove duplication through clearer ownership instead of copying again.
- **Mixed responsibilities:** When a function mixes phases or hidden side effects, split them before adding more logic.
- **Shotgun surgery:** When one change forces edits across many files, centralize the knowledge or introduce a clearer boundary.
- **Repeated conditionals:** Decompose intent first. Introduce polymorphism or strategy only when the variation is real.
- **UI/domain mixing:** Move rules toward domain objects. Keep presentation in adapters.
- **Rewrite temptation:** Choose the next small behavior-preserving transformation that recovers control.

## Stop Conditions

Stop refactoring when:
- The requested change is easy to make.
- The blocking smell is gone.
- Readability and local changeability are clearly better.
- The next cleanup would be speculative.

**Do not** turn cleanup into a rewrite, a hidden feature change, or speculative architecture.

## Final Checklist

- [ ] Observable behavior preserved?
- [ ] Structural change, behavior change, and test updates separated?
- [ ] Safety net in place (tests pass before and after)?
- [ ] At least one real source of friction removed?
- [ ] Names, responsibilities, control flow, data ownership, interfaces clearer?
- [ ] Patch still reviewable and runnable?
- [ ] Cleanup stopped before speculative abstraction or rewrite pressure?

## Reference

| File | Use When |
|---|---|
| [Code Smells](references/code-smells.md) | Identifying which smell to refactor and which move to apply |
| [Refactoring Moves](references/refactoring-moves.md) | Step-by-step instructions for specific refactoring techniques |
| [Preparatory Refactoring](references/preparatory-refactoring.md) | Reshaping structure before adding a feature |
