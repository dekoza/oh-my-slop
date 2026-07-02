---
name: english-only
description: >
  Enforce English-only identifiers, comments, docstrings, and messages in all code.
  Triggers on: "English", "Polish", "language", "identifier", "naming", "comment language",
  "non-English code", "mixed language", "localize", "internationalize", "i18n", "l10n",
  or when the user writes in a non-English language and you're about to generate code.
  Use when: detecting non-English identifiers (e.g., nazwa_użytkownika, count_items),
  non-English comments, or when the user's message is in a non-English language.
  This rule has NO exceptions — code identifiers are ALWAYS English, regardless of user language.
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

## When to Load This Skill

Trigger on any of these signals:
1. User writes in a non-English language (Polish, German, etc.)
2. Code contains non-English identifiers or comments
3. User mentions "English", "Polish", "language", "naming", "identifier"
4. You're about to generate code and detect non-English context

## Enforcement

1. **Before writing any code**: Check if user message is in non-English language
2. **If non-English**: Load this skill, generate code in English only
3. **If you spot existing violations**: Report them, don't silently fix them (scope control)
4. **User-facing messages**: Ask user for preference (UI text, error messages shown to users)

## Exception: User-Facing Messages

For code that users see (UI text, error messages, CLI help):
- **Ask the user** whether to use English or their native language
- Once decided, apply consistently across the project
- Library/internal code: ALWAYS English, no exceptions

## Quick Reference

| Context | Language |
|---------|----------|
| Code identifiers (variables, functions, classes) | **English always** |
| Code comments and docstrings | **English always** |
| Library error messages | **English always** |
| UI text, user-facing errors | **Ask user** |
| Commit messages | **English recommended** |
