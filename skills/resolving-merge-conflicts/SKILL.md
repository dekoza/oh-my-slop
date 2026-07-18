---
name: resolving-merge-conflicts
description: >
  Use when a git merge or rebase is stopped mid-way with conflicting files. Triggers
  on: "merge conflict", "rebase conflict", "CONFLICT (content)", "fix these conflicts",
  "continue the rebase".
license: MIT (adapted from mattpocock/skills)
---

Always resolve; never `--abort`. Preserve the intent of both sides — do **not** invent new behaviour.

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets via the tracker doc's "fetch the relevant ticket" convention.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.
