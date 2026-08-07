---
name: git-discipline
description: >
  Use when running any git operation — committing, pushing, branching, merging, rebasing —
  or when a command could touch uncommitted or untracked work. Enforces conventional-commit
  messages, a commit per execution wave, and hard guards on destructive commands. Triggers
  on: git clean, git reset --hard, force push, rebasing a published branch, rm on user files,
  deleting untracked files.
license: MIT
---

# Git Discipline

Git is mostly reversible — except when it isn't. The guards against **irreversible loss of the user's work** come first; commit conventions follow.

## Protect Uncommitted and Untracked Work

**Untracked files are the user's property.** They may be hours of work with no other copy — a legitimate workflow, e.g. cleaning files before the first commit to keep secrets out of history. Treat them as sacred.

Before ANY operation that could affect them:
1. Run `git status` and understand what is untracked and why.
2. Never assume untracked files are garbage, generated artifacts, or safe to delete.

**These commands require the user to explicitly request them** — running any without that request is a catastrophic, possibly unrecoverable bug:

- `git clean` (any flags) — destroys untracked files irreversibly
- `git checkout -- .` or `git restore .` — discards all uncommitted changes
- `git reset --hard` — destroys uncommitted work
- `rm -rf` / `rm -r` on directories containing user files
- Any glob-pattern command (`rm *.md`, `git checkout -- *.py`) that could hit user files

**Never rewrite shared history** without explicit permission — no `--force` push, no rebasing published branches.

**Rogue files from a subagent:** list them to the user first, then delete them **individually by exact path** — never with a blanket command.

**Worktree location:** when the user requests a Git worktree, create it under the project's root-level, Git-ignored `.worktrees/` directory. Verify that `.worktrees/` is ignored first, then use a descriptive name such as `<task-id>-<short-handle>`.

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
