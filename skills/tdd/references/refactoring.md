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

- **Fat models, thin views** → Move business logic from views into model methods or services.
- **QuerySet composition** → Extract reusable QuerySet filters into model managers or custom managers.
- **Form validation** → Move shared validation into model `clean()` methods (inherited by ModelForm).
- **Template tags** → Extract repeated template logic into custom template tags or includes.
