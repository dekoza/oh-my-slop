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

## Django-specific patterns

- **Models own invariants, services own workflows.** Move single-model validation and state transitions into model methods. Multi-model orchestration, external API calls, and side-effect coordination (email, webhooks) belong in service functions or classes — not on the model. A model with 800 lines and 15 methods touching 3 other models is a god model, not a "fat" one.
- **QuerySet composition** → Extract reusable QuerySet filters into model managers or custom managers.
- **Form validation** → Move shared validation into model `clean()` methods (inherited by ModelForm).
- **Template tags** → Extract repeated template logic into custom template tags or includes.
