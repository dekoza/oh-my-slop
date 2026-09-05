# Two issue trackers, split by who writes to them

Agent work — specs, tickets, `wayfinder` maps — lives on Gitea
(`minder/oh-my-slop`, via `tea`). Human- and community-filed issues live on GitHub
(`dekoza/oh-my-slop`, public) and are read and triaged but **never** written to with
new work tickets. The binding and the CLI conventions are in
[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md).

## Why not one tracker

Upstream `mattpocock/skills` assumes a single GitHub tracker, and every workflow skill
would be simpler for it. Two things force the split.

**Signal.** This repo is public and its issue list is a product surface. An agent that
files its own planning artifacts there — a wayfinder map with fifteen child tickets,
a `to-tickets` batch — buries the handful of real reports from real users under work
only the agent will ever read. The two populations want opposite defaults: intake
should be small and human-legible, agent work should be free to be verbose.

**Capability.** Gitea has native issue dependencies, which is what makes a wayfinder
frontier render *visually* in the tracker's own UI. GitHub's equivalent is weaker and
its sub-issue API is not available here at all. The map is only useful to a human
who can see what is takeable without opening it.

## Consequences

- Every skill that touches a tracker reads `docs/agents/issue-tracker.md` first
  rather than assuming a forge. That doc is the only place the two roles are bound to
  real repos, and `/setup-project-skills` writes it per project.
- Both remotes exist in every clone (`gitea` and `origin`), so `tea` and `gh` both
  mis-infer. Passing `--repo` explicitly is not defensive noise; it is required.
- `triage` discovery reads from intake. Explicit references route by syntax:
  unqualified `#<number>` / `<number>` selects Gitea, while `gh:<number>` /
  `github:<number>` selects GitHub. A missing reference fails on the selected tracker
  rather than probing the other one. Triage can move an intake request across the
  boundary by filing resulting work on Gitea; nothing moves the other way.
- Our tracker vocabulary is a **superset** of upstream's, not a divergence from it.
  Upstream's GitHub-only assumptions are the degenerate case where both roles land on
  one tracker — which is exactly what `/setup-project-skills` emits for a repo with
  one remote.
