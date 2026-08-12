---
name: setup-project-skills
description: Configure the current project for the workflow skills — issue tracker bindings, triage label vocabulary, and domain doc layout. Run once per repo before first use of wayfinder, to-tickets, to-spec, triage, qa, or two-axis-review.
license: MIT (adapted from mattpocock/skills)
disable-model-invocation: true
---

# Set up project skills

Scaffold the per-repo configuration that the workflow skills assume, so they stop
guessing at it:

- **Issue tracker** — which forge holds agent work, and which (if any) holds
  human-reported intake
- **Triage labels** — the strings behind the canonical triage roles
- **Domain docs** — where the glossary and ADRs live
- **Software factory policy** — optional machine-readable Gitea, Git, Herdr, worker-profile,
  routing, retry, and completion settings for the `software-factory` extension

This writes into the **project you are working in**, not into the skills repo.
It is prompt-driven, not a script: explore, present what you found, confirm, then write.

## The two-tracker split

Most repos here have **two** surfaces, and conflating them is the failure this config exists to prevent:

- **Agent work tracker** — specs, tickets, wayfinder maps. Everything a skill
  *creates*. Defaults to Gitea.
- **Intake tracker** — where humans and community file issues. Read and triaged,
  never written to by a skill creating new work. Usually GitHub on a public repo.

The standing rule: **agents never open work tickets on the intake tracker.** A repo
may have only an agent work tracker; the intake binding is optional.

## Process

### 1. Explore

Read the repo's actual state. Don't assume:

- `git remote -v` — which forges are reachable? A `gitea` remote alongside an
  `origin` pointing at GitHub is the common shape here, and it settles Section A
  almost by itself.
- `AGENTS.md` and `CLAUDE.md` at the repo root — does either exist? Does either
  already carry an `## Agent skills` section?
- `docs/agents/` — has this skill run before?
- `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`
- Which of the consumer skills are installed — `triage` decides whether Section B
  runs at all.
- Monorepo signals (`pnpm-workspace.yaml`, a `workspaces` field, a populated
  `packages/*`). Absent these, the repo is single-context, which is almost every repo.
- The default Git branch and remote names, whether `.worktrees/` is ignored, and whether
  `herdr` is installed. For a proposed Gitea factory, resolve the authenticated Gitea
  username rather than guessing the ticket assignee.

Verify CLI availability for whatever you're about to propose (`tea`, `gh`, `glab`).
Recording a tracker whose CLI isn't installed produces a config that fails on first use.

### 2. Present findings and ask

Summarise what's present and what's missing, then take the sections in order — one
section, one answer, then the next. Lead each with the recommended answer so the user
can accept it in a word. Skip a section outright when exploration already settled it.

**Section A — Issue tracker.**

> Explainer: this is where issues live for this repo. `to-tickets`, `to-spec`,
> `triage`, `qa`, `wayfinder`, and `two-axis-review` need to know whether to reach
> for `tea`, `gh`, `glab`, or plain markdown files.

Default posture, in order:

- A `gitea` remote exists → propose **Gitea** as the agent work tracker.
- Only a GitHub remote exists → still propose **Gitea** for agent work if a `tea`
  login is configured, and note that GitHub Issues stays as intake. If no Gitea is
  reachable, propose GitHub for both and say so plainly.
- A GitLab remote → propose **GitLab**.
- No remote, or the user prefers files → propose **local markdown**.

Then ask whether the repo also has an **intake** tracker — a public GitHub repo
where users file issues. Default **yes** when an `origin` points at a public GitHub
repo, **no** otherwise.

Record both bindings in `docs/agents/issue-tracker.md`. The GitHub and GitLab
templates carry a "PRs as a request surface" flag, defaulted **off** — leave it off
and don't raise it; a user who wants external PRs in the triage queue flips it later.

**Section B — Ticket label vocabulary.** Ask exactly one question:

> Keep the default triage labels? (recommended: **yes**)

Defaults are the canonical roles, each label string equal to its name: `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, plus the categories
`bug` and `enhancement`. The fixed `workflow:implement` label routes build-ready
work to `/implement`; it is independent of the state-role mapping. Only if the user
says no — usually because their tracker already uses other state or category names —
collect those overrides, so the workflow skills apply existing labels instead of
creating duplicates.

**Section C — Domain docs.** Default to **single-context**: one `CONTEXT.md` plus
`docs/adr/` at the repo root. Write it without asking.

Offer **multi-context** — a root `CONTEXT-MAP.md` pointing at per-context
`CONTEXT.md` files — only when exploration found monorepo signals.

**Section D — Software factory.** Offer this only when the agent work tracker is Gitea.
Ask one question:

> Configure the opt-in Herdr software factory? (recommended: **yes** when `herdr` is installed)

A yes writes `.pi/factory.json` with the resolved repository, remote, explicit `tea`
login name, authenticated assignee, default branch, label mappings, and worker routing. It
also ensures `.worktrees/` is ignored. The file contains executable automation policy and
model selectors, never endpoints or credentials. For another tracker, state that the first
factory release supports Gitea only and skip the file.

After acceptance, inventory only the runtimes the user permits. `claude --version` verifies
Claude Code without spending a model turn. Ask before contacting a self-hosted model endpoint;
after permission, `pi --list-models <pattern>` verifies each proposed pi selector without
running an implementation prompt. Present named profiles and deterministic label/phase rules
in the JSON draft. Default to one explicit implementation profile, a fresh-retry profile, an
independent ticket-review profile, and a final integration-review profile. Keep same-worker
repair on the implementation profile. A fully local policy maps every default phase to one
local pi profile; the scheduler itself remains deterministic and model-free.

### 3. Confirm and edit

Show a draft of the `## Agent skills` block, each `docs/agents/*.md` file, and the
factory JSON when selected before writing. Show the `.gitignore` addition separately.
Let the user edit first.

### 4. Write

**Pick the file to edit:**

- If `CLAUDE.md` exists, edit it.
- Else if `AGENTS.md` exists, edit it.
- If neither exists, ask which to create — don't pick for them.

Never create `AGENTS.md` when `CLAUDE.md` already exists, or vice versa. If an
`## Agent skills` block is already there, update it in place rather than appending a
duplicate, and don't disturb the surrounding sections.

The block — this is the **pointer** consumer skills resolve through, so the paths
live here and nowhere else:

```markdown
## Agent skills

### Issue tracker

[one-line summary: which forge holds agent work, which holds intake]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

Include the `### Triage labels` sub-block and write `docs/agents/triage-labels.md`.
The workflow skills need the state mapping and `workflow:implement` routing label
even when the standalone `triage` skill is not installed.

When Section D was accepted, write this shape using the answers already resolved above:

```json
{
  "version": 1,
  "tracker": {
    "kind": "gitea",
    "repo": "<owner/repository>",
    "remote": "<gitea-remote>",
    "login": "<tea-login-name>",
    "assignee": "<authenticated-gitea-user>",
    "labels": {
      "implementation": "workflow:implement",
      "readyForAgent": "<configured ready-for-agent label>",
      "readyForHuman": "<configured ready-for-human label>"
    }
  },
  "git": {
    "baseBranch": "<default-branch>",
    "remote": "<gitea-remote>"
  },
  "herdr": {
    "maxWorkers": 1
  },
  "workers": {
    "profiles": {
      "implement": {
        "kind": "pi",
        "model": "<provider/model>",
        "thinking": "high"
      },
      "fresh-retry": {
        "kind": "pi",
        "model": "<provider/model>",
        "thinking": "high"
      },
      "review": {
        "kind": "pi",
        "model": "<provider/model>",
        "thinking": "high"
      },
      "final-review": {
        "kind": "claude",
        "model": "fable",
        "effort": "high",
        "permissionMode": "dontAsk"
      }
    },
    "routing": {
      "defaults": {
        "implement": "implement",
        "freshRetry": "fresh-retry",
        "review": "review",
        "finalReview": "final-review"
      },
      "rules": []
    }
  },
  "retry": {
    "repairAttempts": 1,
    "freshAgentRetries": 1
  },
  "completion": {
    "closeAfterIntegration": true,
    "finalMerge": "manual",
    "createPullRequest": true,
    "deploy": false
  }
}
```

Preserve an existing `.pi/factory.json` as a user answer during re-sync. Validate it
against this shape and ask before changing policy values. Never replace explicit profile
models or routing rules merely because another model is currently available. Add `.worktrees/` to an
existing ignore file without disturbing its other lines; if no ignore file exists,
show the proposed new file during confirmation.

Then write the docs files, seeding from the templates in this skill folder:

- [issue-tracker-gitea.md](./issue-tracker-gitea.md) — Gitea via `tea`
- [issue-tracker-github.md](./issue-tracker-github.md) — GitHub via `gh`
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md) — GitLab via `glab`
- [issue-tracker-local.md](./issue-tracker-local.md) — local markdown files
- [triage-labels.md](./triage-labels.md) — role → label mapping
- [domain.md](./domain.md) — domain doc layout and consumer rules

When both an agent work tracker and an intake tracker are configured, write one
`docs/agents/issue-tracker.md` containing an **Agent work** section seeded from that
forge's template and an **Intake** section seeded from the other's, each keeping its
own conventions. For an "other" tracker (Jira, Linear, …), write the file from scratch
from the user's description, keeping the same section headings — those headings are
what consumer skills dereference.

### 5. Done

Tell the user setup is complete and which skills now read from these files. When the
factory was configured, name `.pi/factory.json`, say that `/factory start <parent-ticket>`
must run inside Herdr, and state that final merge remains manual. Mention they can edit
`docs/agents/*.md` and `.pi/factory.json` directly later; re-running this skill is only
needed to switch trackers, to re-sync after a skills update (below), or to start over.

## Re-syncing after an update

When exploration finds `docs/agents/` already populated and the user isn't switching
trackers, the run is a **re-sync**: the templates may have gained sections or changed
mechanics since these files were written, and the installed files catch up without
losing what the user answered or edited.

One split governs every file: **answers are the user's, scaffolding is the
template's.** Answers — the tracker bindings, label overrides, flags like "PRs as a
request surface", and any local edits — are preserved verbatim. Scaffolding — the
load-bearing headings, the command mechanics under them, sections the template has
gained (e.g. `## Robot comments`) — is brought up to the current template.

Per file: diff the installed doc against its template, apply the scaffolding changes,
carry the answers over, and show the result before writing. Where a local edit and a
template change touch the same lines, ask — never silently discard either side. A
section the template dropped is removed only after saying so. Files already current
are reported as such, and nothing is re-interviewed unless a template change
invalidated a recorded answer (a renamed flag, a removed option).

## The consumer contract

Skills resolve this config **through the `## Agent skills` pointer**, never by
hardcoding `docs/agents/issue-tracker.md`. A repo that keeps its agent docs elsewhere
must still work. When adding a consumer skill, use this wording:

> The issue tracker should have been provided to you — run `/setup-project-skills` if not.

and, where the skill needs tracker-specific mechanics, name the section it needs:

> Consult the tracker doc's "Wayfinding operations" section for how _this_ repo expresses them.

Every tracker template provides the same load-bearing headings, so a consumer can
dereference them without knowing which forge is in play:

`## Conventions` · `## Robot comments` · `## When a skill says "publish to the issue tracker"` ·
`## When a skill says "fetch the relevant ticket"` · `## Wayfinding operations`
