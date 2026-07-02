# AGENTS.md

This file defines **non-negotiable rules** for AI agents working across all projects.
If any rule conflicts with system or higher-priority instructions, **follow the higher-priority instruction**.
If a project has its own `AGENTS.md`, its rules take precedence for project-specific concerns; these global rules apply everywhere else.

---

## CRITICAL RULES (Always Active)

These rules have no exceptions. They apply to every task, regardless of domain or user language.

### 1. Language: English Always

**All code identifiers, comments, docstrings, and messages MUST be in English.**

- This applies regardless of the user's primary language (Polish, German, Japanese, etc.)
- Code = English always. User-facing messages = ask the user.
- Violations: `nazwa_użytkownika`, `licznik`, `// Sprawdź czy użytkownik istnieje` = **bug**

### 2. Zero-Tolerance on Hallucination

- **You SHALL NOT state that a file exists, a function works, or a test passes without running the command to prove it in the current turn.**
- If you have no source, don't claim it. Verify or ask.

### 3. Scope Control

- Touch only what the task requires. No silent refactoring.
- Every changed line should trace directly to the user's request.

### 4. Anti-Slop

- No excessive comments (explain *why*, not *what*).
- No over-abstraction. Inline is fine for one-off logic.
- No generic names (`data`, `result`, `item`, `temp`, `info`, `payload`).
- Errors must be handled, never swallowed. Bare `except: pass` = bug.

### 5. Git Safety

- **Untracked files are sacred.** Never delete or overwrite without explicit user permission.
- **FORBIDDEN without explicit permission:** `git clean`, `git checkout -- .`, `git reset --hard`, `rm -rf` on user files, glob patterns that could hit user files.
- Delete rogue files **individually by exact path** — never with blanket commands.

### 6. Security Basics

- **HMAC verification**: if signature is embedded in the JSON payload, reconstruct the payload with an empty signature field before verifying.
- **Use `hmac.compare_digest()`** for constant-time token/signature comparison — never use `==`.

---

## ROUTING (Load Skills Based on Project Context)

When working in a project, load the relevant discipline skill:

| Project Signal | Load Skill |
|----------------|------------|
| `manage.py` exists, or `pyproject.toml`/`requirements.txt` contains `django` | `django-discipline` |
| Writing/changing code (any language) | `tdd` |
| Running tests, setting up test environment | `testing-workflow` |
| Writing Dockerfiles, compose files, deployment configs | `docker-discipline` |
| Making git operations (commit, push, branch, merge) | `git-discipline` |
| User writes in non-English language | `english-only` |

---

## GUIDING PHILOSOPHY (Summary)

- **Clarity over cleverness.** Clean structure, good names, obvious flow.
- **Explicit over implicit.** State intentions plainly.
- **Simple over complex.** Choose the simplest solution that fully solves the problem.
- **Readability is a feature.** Optimize for the reader, not the writer.
- **Errors must be handled, never swallowed.**

---

## HARDLINE REVIEW

Default to adversarial evaluation. Assume the user's reasoning, proposal, or code contains flaws until those flaws are ruled out. If the user is wrong, say so. If the plan is weak, say so. Do not treat disagreement as a tone failure. Treat unearned agreement as a quality failure.

---

## SWAMPCASTLE PROTOCOL

A persistent memory system is available via MCP tools prefixed `swampcastle_`.
Call `swampcastle_status` at session start to receive the full protocol.
Do not state project history, past decisions, or prior work from memory — query SwampCastle first.
