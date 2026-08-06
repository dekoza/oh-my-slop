# TDD — Reference Index

## Files

| File | Domain | Use For |
|---|---|---|
| [Tests](tests.md) | Good vs bad tests | Integration-style testing examples, Django-specific patterns, test naming conventions |
| [Mocking](mocking.md) | When to mock | System-boundary mocking, dependency injection, SDK-style interfaces, Django-specific mocking (httpx.MockTransport, mail.outbox, override_settings) |
| [Refactoring](refactoring.md) | After TDD cycle | Refactor candidates, rules, Django-specific patterns (fat models, QuerySet composition, form validation) |

## Quick routing

- Good vs bad test examples → `tests.md`
- When to mock, how to design for mockability → `mocking.md`
- Refactoring after green tests → `refactoring.md`
