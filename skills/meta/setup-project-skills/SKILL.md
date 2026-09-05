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
- **Software factory policy** — optional machine-readable Gitea, Git, worker-profile,
  routing, check, concurrency, and budget settings for the `factory` binary

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

## Reference routing

When both trackers are configured, write a `## Reference routing` section into the
tracker doc. Route unqualified issue numbers (`#<number>` and `<number>`) to the agent
work tracker and require an explicit forge qualifier for intake references. For a GitHub intake tracker, accept
`gh:<number>` and `github:<number>`. Full tracker URLs select their own tracker. Make
routing deterministic: a missing number on the selected tracker is an error, not a
reason to probe the other tracker.

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

> Configure the opt-in software factory? (recommended: **yes** when `factory` is on `PATH`)

A yes writes `.pi/factory.json` — the single policy file the `factory` binary reads, at the
repository root — with the resolved repository, remote, explicit `tea` login name,
authenticated assignee, default branch, worker profiles, routing, mechanical checks,
concurrency sizes, and retry budgets. It also ensures `.worktrees/` is ignored. The file
contains executable automation policy and model selectors, never endpoints or credentials.
For another tracker, state that the first factory release supports Gitea only and skip the
file.

**Write the current schema, `schemaVersion: 2`.** `factory migrate` is for configs written
before that schema existed and is never a step in a fresh setup — it deliberately leaves
`TODO` holes the loader hard-fails on (the checks, the concurrency sizes, the automation
budget) for a human to fill in by hand. A setup run has those answers in front of it, so it
asks for them and emits a file that loads on the first verb. A run that ends with the user
having to run `migrate` and hand-edit holes is this section failing.

The loader refuses every key it does not understand and defaults almost nothing, so these
blocks are **asked for or scaffolded, never emitted as holes**:

- **`checks`** — the mechanical commands the controller reruns itself. Each one declares all
  five required fields: `name` (lower-case identifier), `command`, `timeout` (whole seconds),
  `severity` (`required` or `advisory`), and `expectedFailureExitCodes`; an advisory check may
  also declare `feeds`. Nothing here is discovered or defaulted, `expectedFailureExitCodes`
  least of all: it is the only line between "the worker's code failed this check" and "this
  check is broken", and pytest, ruff, tsc and a shell script do not agree on it. Seed the list
  from the repo's `## Mandatory commands` section in `AGENTS.md` when it has one — that is the
  same section `factory migrate` reads — otherwise from its Justfile, Makefile, or CI workflow,
  and confirm every field with the user.
- **`concurrency`** — `maxTicketExecutions` (currently capped at 1; the loader refuses more)
  plus a `resources` map of resource class → slot count.
- **`budgets`** — `repair`, `freshRetry`, and `automation`, each 1 or 2, plus
  `circuitBreaker`. These do have upstream defaults, but write them out: the automation
  budget is the one number a migrated file cannot supply, and a config that states it is one
  fewer thing for the operator to discover from a refusal.
- **`routing`** — `roles` naming a profile for `implement`, `freshRetry`, and `review`
  (a **two-element pair**, one per review axis), plus `rules` written out even when empty.
  There is no `finalReview` role and no implicit fallback between roles.

`tracker.labels` is **not** written. The factory's label vocabulary is fixed constants in the
binary's own code — per-install names would make the tracker graph un-auditable across repos
— and a config carrying that key is refused by name. Section B's label answers still govern
the workflow skills; they just do not reach this file.

Three traps are worth spending a question on, because each one produces a file that looks
right and costs real time:

1. **Scaffold check commands in their runner-prefixed form.** A command naming a
   dev-dependency binary directly — `just test unit`, `pytest`, `ruff check` — exits 127
   when that binary is not on the controller's `PATH`, and the runner classifies 127 as
   `exec-not-found`: the check is unrunnable, which is not the same outcome as failing. In a
   uv project the form that always works is `uv run just test unit`. Read the runner off the
   project (`uv`, `poetry run`, `npm run`, `pnpm exec`) and write the command through it,
   even when it works in your own shell.
2. **Derive `concurrency.resources` from the profiles you just wrote, never from a menu.**
   A class is `claude-code` for every `kind: claude` profile, and the provider segment of
   the model selector for every `kind: pi` one — `local` for `local/qwen3`, `openrouter` for
   `openrouter/z-ai/glm-5.2`. Size exactly the classes the routing reaches: an unsized class
   the active routing reaches refuses the load, and so does a sized class no declared
   routing set reaches ("Dead config lies about what will run"). Writing a `local` resource
   beside a routing that only names Claude profiles produces a file that cannot load.
3. **`severity` says what a red result does; `feeds` says what it costs.** A required check
   runs on every verify — after every implement *and* after every repair — and is the set the
   pre-run baseline executes. An advisory check is paid for where its evidence is read, and
   the `feeds` list is what states that: one that feeds a later phase runs on every verify
   too, because its captured output reaches the next prompt; one that feeds nothing runs
   **once per published ticket**, at the publication boundary, where the attestation a human
   opens is its only reader. So a ten-minute browser tier declared advisory with no `feeds`
   costs ten minutes a ticket rather than thirty on a ticket that takes two repair rounds —
   and the tradeoff is that its result appears on the pull request rather than mid-attempt.
   Give a check `feeds` when a worker or a repair must actually see its output; leave it off
   when only the reader of the PR will. What the list still makes you decide first is whether
   the check belongs in `checks` at all: a long tier nobody reads belongs in CI outside the
   factory, and saying so is a better answer than any severity.

After acceptance, inventory only the runtimes the user permits. `claude --version` verifies
Claude Code without spending a model turn. Ask before contacting a self-hosted model
endpoint; after permission, `pi --list-models <pattern>` verifies each proposed pi selector
without running an implementation prompt. Present named profiles and deterministic
`labelsAny × role → profile` rules in the JSON draft. Default to one implementation profile,
a fresh-retry profile on a different model, and two independent review profiles — model
diversity across the two axes is the point of the pair. Repair is not routable: it is pinned
to the originating attempt's profile. A fully local policy maps every role to one local pi
profile and sizes that one class; the scheduler itself stays deterministic and model-free.

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

When Section D was accepted, write this shape using the answers already resolved above. The
angle-bracketed values are the per-repo answers; every other value is a real default you may
change, and none of it may be left as a placeholder — the loader refuses a file that still
carries a `TODO` anywhere in it.

```json
{
  "schemaVersion": 2,
  "tracker": {
    "kind": "gitea",
    "repo": "<owner/repository>",
    "remote": "<gitea-remote>",
    "login": "<tea-login-name>",
    "assignee": "<authenticated-gitea-user>"
  },
  "git": {
    "baseBranch": "<default-branch>",
    "remote": "<gitea-remote>"
  },
  "profiles": {
    "builder": {
      "kind": "claude",
      "model": "opus",
      "effort": "high"
    },
    "fresh-retry": {
      "kind": "pi",
      "model": "openai-codex/gpt-5.6-sol",
      "thinking": "high"
    },
    "reviewer": {
      "kind": "claude",
      "model": "fable",
      "effort": "high"
    }
  },
  "routing": {
    "roles": {
      "implement": "builder",
      "freshRetry": "fresh-retry",
      "review": ["reviewer", "reviewer"]
    },
    "rules": []
  },
  "checks": [
    {
      "name": "python-test-suite",
      "command": "uv run pytest",
      "timeout": 900,
      "severity": "required",
      "expectedFailureExitCodes": [1]
    }
  ],
  "budgets": {
    "repair": 1,
    "freshRetry": 1,
    "automation": 1,
    "circuitBreaker": 2
  },
  "concurrency": {
    "maxTicketExecutions": 1,
    "resources": {
      "claude-code": 2,
      "openai-codex": 1
    }
  }
}
```

Read the example's `concurrency.resources` against its `profiles`: `builder` and `reviewer`
are `kind: claude`, so both draw on the one `claude-code` class; `fresh-retry` names
`openai-codex/gpt-5.6-sol`, whose provider segment is the class `openai-codex`. Change a
profile and that map changes with it — those two entries are not a default to copy.

Before showing the draft, load it: `factory doctor` in the target repository reads the file
and reports what it refuses. A draft that does not load is not ready to show.

Preserve an existing `.pi/factory.json` as a user answer during re-sync. Validate it
against this shape and ask before changing policy values. Never replace explicit profile
models or routing rules merely because another model is currently available. An existing
file declaring `version: 1` is the one case that is **not** rewritten from this template:
tell the user to run `factory migrate`, which preserves their file as `factory.v1.json` and
prints every key it maps, drops, or leaves as a hole — then help them fill the holes it
names. Rewriting a v1 file from here would silently discard routing rules a machine cannot
re-author. Add `.worktrees/` to an
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
`docs/agents/issue-tracker.md` containing the shared `## Reference routing` section,
an **Agent work** section seeded from that forge's template, and an **Intake** section
seeded from the other's, each keeping its own conventions. For an "other" tracker
(Jira, Linear, …), write the file from scratch from the user's description, keeping
the same section headings — those headings are what consumer skills dereference.

### 5. Done

Tell the user setup is complete and which skills now read from these files. When the
factory was configured, name `.pi/factory.json`, say that `factory doctor` verifies it
without running anything and that `factory start <ticket-or-parent>` detaches into a Herdr
pane by default (`--foreground` runs the controller in the invoking terminal instead), and
state that final merge remains manual. Mention they can edit
`docs/agents/*.md` and `.pi/factory.json` directly later; re-running this skill is only
needed to switch trackers, to re-sync after a skills update (below), or to start over.

## Re-syncing after an update

When exploration finds `docs/agents/` already populated and the user isn't switching
trackers, the run is a **re-sync**: the templates may have gained sections or changed
mechanics since these files were written, and the installed files catch up without
losing what the user answered or edited.

One split governs every file: **answers are the user's, scaffolding is the
skill's.** Answers — the tracker bindings, label overrides, flags like "PRs as a
request surface", and any local edits — are preserved verbatim. Scaffolding — the
shared sections declared above, the template headings, and their command mechanics —
is brought up to the current skill (e.g. `## Reference routing` and
`## Robot comments`).

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

> The issue tracker should have been provided to you — tell the user to run `/setup-project-skills` if not.

and, where the skill needs tracker-specific mechanics, name the section it needs:

> Consult the tracker doc's "Wayfinding operations" section for how _this_ repo expresses them.

Every tracker template provides the same load-bearing headings, and a two-tracker doc
adds the shared routing heading, so a consumer can dereference them without knowing
which forge is in play:

`## Reference routing` (two-tracker docs) · `## Conventions` · `## Robot comments` ·
`## When a skill says "publish to the issue tracker"` ·
`## When a skill says "fetch the relevant ticket"` · `## Wayfinding operations`
