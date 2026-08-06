---
name: english-only
description: >
  Use when about to write or review code whose identifiers, comments, or docstrings are in
  a non-English language, or when the user is writing to you in one. Keeps all code
  identifiers, comments, and docstrings English regardless of the user's language. Triggers
  on: non-English identifiers (nazwa_użytkownika, licznik), non-English comments, a user
  request written in another language, mixed-language code.
license: MIT
---

# English-Only Rule

## The Rule (No Exceptions)

**All code identifiers, comments, docstrings, and messages MUST be in English.**

This applies regardless of:
- The user's primary language (Polish, German, Japanese, etc.)
- The project's target audience
- Whether the user explicitly requests non-English code

**Violations:**
- `nazwa_użytkownika` instead of `user_name`
- `licznik` instead of `counter`
- `// Sprawdź czy użytkownik istnieje` instead of `// Check if user exists`
- `# Sprawdzenie poprawności` instead of `# Validation check`

## Enforcement

- **Write all new code in English** — identifiers, comments, docstrings, and log/exception messages — even when the user's request is in another language.
- **Report existing violations, don't silently fix them.** Flag the non-English identifiers or comments you encounter and let the user decide whether renaming is in scope.
- **For user-facing text** (UI strings, error messages shown to end users, CLI help), ask the user whether to use English or their native language, then apply that choice consistently across the project. Library and internal code stays English regardless.

## Quick Reference

| Context | Language |
|---------|----------|
| Code identifiers (variables, functions, classes) | **English always** |
| Code comments and docstrings | **English always** |
| Library error messages | **English always** |
| UI text, user-facing errors | **Ask user** |
| Commit messages | **English recommended** |
