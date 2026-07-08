---
name: resolving-merge-conflicts
description: >
  Loop for resolving an in-progress git merge or rebase conflict: understand each
  side's intent from primary sources, preserve both where possible, verify with the
  project's checks, finish the merge. Triggers on: "merge conflict", "rebase conflict",
  "CONFLICT (content)", "fix these conflicts", "continue the rebase", or when a merge
  or rebase is stopped mid-way with conflicting files.
license: MIT (adapted from mattpocock/skills)
---

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets (GitHub via `gh`, Gitea via `tea`).

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.
