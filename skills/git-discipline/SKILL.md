---
name: git-discipline
description: >
  Git workflow, commit conventions, and repository safety rules. Triggers on: "git", "commit",
  "push", "branch", "merge", "rebase", "force push", "git history", "untracked files",
  "destructive git", "conventional commits", "git log", "git blame", or when making any git operation.
  Use when: committing, pushing, branching, merging, rebasing, or managing git history.
license: MIT
---

# Git Discipline

## Commit Behavior

### Commit After Every Execution Wave

When executing a plan with parallel waves, **commit all results after each wave completes** — before starting the next wave.

- Each wave commit captures a coherent, working state of the codebase
- Do not accumulate changes across multiple waves into a single commit
- Starting a new wave without committing the previous wave's results = **bug**

### Conventional Commits

Use conventional format: `type(scope): description`

```bash
feat(auth): add JWT refresh token rotation
fix(cart): prevent negative quantities in checkout
docs(api): update OpenAPI spec for /users endpoint
```

The description should explain **what changed**, not **what you did**:
- ✅ "add JWT refresh token rotation"
- ❌ "I added JWT refresh token rotation"

## Git History as Context Source

Before making changes to unfamiliar code, check `git log` and `git blame` to understand how it evolved. Previous commit messages explain past decisions — use them before asking the user to re-explain.

## Untracked Files Are Sacred

The user may be working with files that haven't been committed yet. This is a legitimate workflow — for example, cleaning files before first commit to avoid leaking sensitive data in git history.

**Untracked files are the user's property.** They may represent hours of work with no other copy.

### Before Any Destructive Operation

Before ANY operation that could affect untracked files:
1. Run `git status` and understand what is untracked and why
2. Never assume untracked files are garbage, generated artifacts, or safe to delete

### Rogue Files from Subagents

If a subagent created rogue files that need removal:
- Delete them **individually by exact path** — never with blanket commands
- List them to the user first, then delete one by one

## FORBIDDEN Commands (Require Explicit User Permission)

The following commands are **FORBIDDEN** without the user explicitly requesting them:

- `git clean` (any flags) — destroys untracked files irreversibly
- `git checkout -- .` or `git restore .` — discards all uncommitted changes
- `git reset --hard` — destroys uncommitted work
- `rm -rf` / `rm -r` on directories containing user files
- Any command with glob patterns (`rm *.md`, `git checkout -- *.py`) that could hit user files

**Running any of the above without explicit user request = bug** (catastrophic, possibly unrecoverable).

## Never Rewrite Shared History

Never rewrite shared history without explicit user permission:
- No `--force` push
- No rebasing published branches
