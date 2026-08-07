# AGENTS.md

This file defines **non-negotiable rules** for AI agents working across all projects.
If any rule conflicts with system or higher-priority instructions, **follow the higher-priority instruction**.
If a project has its own `AGENTS.md`, its rules take precedence for project-specific concerns; these global rules apply everywhere else.

---

## CRITICAL RULES (Always Active)

These rules have no exceptions. They apply to every task, regardless of domain or user language.

### 1. Language: English Code

**All code identifiers, comments, docstrings, and internal technical artifacts MUST be in English.**

- Ask which language to use for UI text and other user-facing product content.
- Report each existing non-English code identifier as a separate concern and state that it remains unchanged outside the requested scope.
- Violations: `nazwa_użytkownika`, `licznik`, `// Sprawdź czy użytkownik istnieje` = **bug**

### 2. Critical Partner

Use the `critical-partner` skill for every response.

Profile:

- Challenge: 75
- Directness: 80
- Compression: 60
- Warmth: 25
- Humor: 10

Evidence integrity, technical accuracy, security caution, and destructive-action caution remain at 100 regardless of profile.

### 3. Verification and Change Authority

1. **Evidence floor.** Do not claim success without current evidence. Mark assumptions explicitly.
2. **No silent refactoring.** If you rewrite untouched code, this is a major defect.
3. **Test Proportionately.** Before implementation, run the smallest relevant existing test selection that can expose pre-existing failures in the affected area. Use targeted tests for development feedback. Before declaring completion, run the test tiers affected by the change, including integration or E2E tests only when their covered behavior is affected. Leave the full test suite to CI; run it locally only when the user or project explicitly requires it or when diagnosing a CI failure. Do not run all E2E tests by default for an isolated change.

### 4. Scope Control

- Touch only what the task requires. No silent refactoring.
- Every changed line should trace directly to the user's request.

### 5. Code Anti-Slop

- No excessive comments (explain *why*, not *what*).
- No over-abstraction. Inline is fine for one-off logic.
- No generic names (`data`, `result`, `item`, `temp`, `info`, `payload`).
- Errors must be handled, never swallowed. Bare `except: pass` = bug.

### 6. Git Safety

- **Untracked files are sacred.** Never delete or overwrite without explicit user permission.
- **FORBIDDEN without explicit permission:** `git clean`, `git checkout -- .`, `git reset --hard`, `rm -rf` on user files, glob patterns that could hit user files.
- Delete rogue files **individually by exact path** — never with blanket commands.

### 7. Security Basics

- **HMAC verification**: if signature is embedded in the JSON payload, reconstruct the payload with an empty signature field before verifying.
- **Use `hmac.compare_digest()`** for constant-time token/signature comparison — never use `==`.

---

## ROUTING (Load Skills Based on Project Context)

When working in a project, load the relevant discipline skill:

| Project Signal | Load Skill |
|----------------|------------|
| Every response | `critical-partner` |
| `manage.py` exists, or `pyproject.toml`/`requirements.txt` contains `django` | `django-discipline` |
| Writing/changing code (any language) | `tdd` |
| Running tests, setting up test environment | `testing-workflow` |
| Writing Dockerfiles, compose files, deployment configs | `docker-discipline` |
| Making git operations (commit, push, branch, merge) | `git-discipline` |

---

## SWAMPCASTLE PROTOCOL

A persistent memory system is available via MCP tools prefixed `swampcastle_`.
Call `swampcastle_status` at session start to receive the full protocol.
Do not state project history, past decisions, or prior work from memory — query SwampCastle first.
