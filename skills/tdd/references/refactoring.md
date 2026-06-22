# Refactor Candidates

After the TDD cycle, look for:

- **Duplication** → Extract function/class.
- **Long methods** → Break into private helpers (keep tests on public interface).
- **Shallow modules** → Combine or deepen (see `codebase-design` skill).
- **Feature envy** → Move logic to where data lives.
- **Primitive obsession** → Introduce value objects.
- **Existing code** the new code reveals as problematic.

## Rules

- Refactor only after all tests pass.
- Keep tests on the public interface — don't move them into the module being refactored.
- Small, incremental steps. Commit after each refactor that passes the suite.
- If a refactor touches more than one module, break it into separate commits.

## Preparatory Refactoring (Before the Feature)

Fowler's key insight: refactor *before* the feature, not just after.

When a requested change is awkward to make:

1. Identify the structural friction that blocks the change.
2. Reshape that local structure first — just enough to make the feature simple.
3. Make the behavior change.
4. Clean up debt introduced by the change.

This is not "rewrite the module." It's the smallest refactor that makes the requested change safe and obvious.

## Behavior-Preserving Discipline

Refactoring means changing structure *without* changing observable behavior. Enforce this strictly:

- **Never mix** a behavior change with a structural change in the same commit.
- **Isolate** structural edits from behavior edits so each can be reviewed and reverted independently.
- **If tests are absent or weak**, make the smallest possible structural move and improve testability before broader cleanup.
- **If behavior is uncertain**, characterize it first (write a test that captures current behavior) before refactoring.

## Trigger Rules

Act on these signals during development:

- **Third repetition.** When the same edit appears for a third time, remove duplication through clearer ownership instead of copying again.
- **Mixed responsibilities.** When a function mixes setup, validation, computation, and side effects, split the phases before adding more logic.
- **Shotgun surgery.** When one change forces edits across many files, centralize the knowledge or introduce a clearer boundary.
- **Repeated conditionals.** When repeated conditionals or type codes grow, decompose intent first; introduce polymorphism, state, strategy, or a table only when the variation is real.
- **UI/domain mixing.** When UI and domain behavior mix, move rules toward domain objects and verify any required presentation synchronization.
- **Temptation to rewrite.** When a rewrite feels tempting, choose the next small behavior-preserving transformation that recovers control instead.

## Stop Conditions

Stop refactoring when:

- The requested change is easy to make.
- The blocking smell is gone.
- Readability and local changeability are clearly better.
- The next cleanup would be speculative (no concrete evidence it's needed).

**Do not** turn cleanup into a rewrite, a hidden feature change, or speculative architecture. If you've removed the friction that blocked the original task, stop.

## Django-specific patterns

- **Models own invariants, services own workflows.** Move single-model validation and state transitions into model methods. Multi-model orchestration, external API calls, and side-effect coordination (email, webhooks) belong in service functions or classes — not on the model. A model with 800 lines and 15 methods touching 3 other models is a god model, not a "fat" one.
- **QuerySet composition** → Extract reusable QuerySet filters into model managers or custom managers.
- **Form validation** → Move shared validation into model `clean()` methods (inherited by ModelForm).
- **Template tags** → Extract repeated template logic into custom template tags or includes.
