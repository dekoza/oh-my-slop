# Preparatory Refactoring

From Refactoring (Martin Fowler). Use when a requested feature is awkward to make because of structural friction.

## Core Insight

**Refactor before the feature, not just after.**

When adding a new feature is hard because the code is poorly structured, reshape the structure first. The refactor makes the feature simple. Then add the feature. Then clean up.

## The Pattern

```
1. IDENTIFY: What structural friction blocks the requested change?
2. REFACTOR: Reshape that local structure — just enough to make the feature simple.
3. IMPLEMENT: Add the feature behavior.
4. CLEAN UP: Remove debt introduced by the feature change.
```

## When to Refactor Before

- The change point is buried in a long method that mixes multiple concerns.
- The knowledge the feature needs is scattered across multiple files.
- The class you need to change has multiple reasons to change (divergent change).
- You'd need to duplicate code because there's no clean place to put the new behavior.
- The interface you need to extend is cluttered with unrelated parameters.

## When NOT to Refactor Before

- The feature is simple to add as-is. Don't add refactoring work that isn't needed.
- The refactor would be larger than the feature itself. Consider adding the feature first, then refactoring.
- You don't understand the code well enough. Characterize first (write tests), then refactor.

## How Much to Refactor

**Only refactor what the feature touches.** Don't clean up the whole module. Don't fix every smell in sight. Ask: "What is the minimum structural change that makes this feature easy to add?"

## Example

```python
# Before: process_order mixes validation, calculation, and persistence
def process_order(self, order):
    # 80 lines of mixed concerns
    # Need to add fraud check here, but where?

# Preparatory refactor: extract phases
def process_order(self, order):
    self._validate(order)
    self._check_fraud(order)        # new feature fits cleanly here
    amount = self._calculate(order)
    self._persist(order, amount)

# Now the fraud check has a clear home, and each phase is independently testable.
```

## Separating Structure from Behavior

Always keep structural changes and behavior changes in separate commits:

```
Commit 1: "Refactor: extract validation from process_order" (no behavior change)
Commit 2: "Feature: add fraud check to process_order" (behavior change)
```

This makes each commit reviewable and independently revertible.
