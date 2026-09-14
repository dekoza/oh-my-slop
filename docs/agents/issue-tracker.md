# Issue tracker

This repo has **two** tracker surfaces, and conflating them is the failure this file
exists to prevent:

- **Agent work** — Gitea (`minder/oh-my-slop`). Everything the skills *create* lands
  here: specs, tickets, wayfinder maps.
- **Intake** — GitHub (`dekoza/oh-my-slop`, public). Where humans and community file
  issues. Read and triaged; **never** written to with new work tickets.

The standing rule: **agents never open work tickets on the intake tracker.**

## Reference routing

Route an explicitly named issue before querying either tracker:

- `#213` and `213` resolve to Gitea (`minder/oh-my-slop`).
- `gh:213` and `github:213` resolve to GitHub (`dekoza/oh-my-slop`); remove the
  qualifier before passing the number to `gh`.
- A full tracker URL resolves to the tracker named by that URL.

Do not probe one tracker and silently fall back to another. These forms route explicit
references only; triage discovery still queries the intake tracker.

---

# Agent work: Gitea

Issues, specs, and wayfinder maps for this repo live as Gitea issues. Use the `tea`
CLI for all operations.

## Conventions

Use the `gitea` skill for command grammar, reference routing and API verification.
Pass `--repo minder/oh-my-slop` on repository commands. This repo has both a
`gitea` and an `origin` (GitHub) remote; `--remote` selects a login source, not
repository scope. Use the configured login when selecting an instance explicitly.

Run `tea` from inside the clone even when passing `--repo`: several subcommands
(`tea issues edit` among them) shell out to `git rev-parse --show-toplevel` first and
fail outright outside a work tree.

- **Create an issue**: `tea issues create --repo minder/oh-my-slop --title "..." --description "..."`.
- **Read an issue**: `tea issues --repo minder/oh-my-slop --comments <index>`
- **List issues**: `tea issues list --repo minder/oh-my-slop --state open --labels "..." --fields index,title,state,labels,assignees`
- **Read comments**: `tea comments list --repo minder/oh-my-slop <index>`
- **Comment**: `tea comments add --repo minder/oh-my-slop <index> "..."`
- **Apply / remove labels**: `tea issues edit --repo minder/oh-my-slop <index> --add-labels "..."` / `--remove-labels "..."`
- **Assign**: `tea issues edit --repo minder/oh-my-slop <index> --add-assignees <user>`
- **Close**: `tea issues close --repo minder/oh-my-slop <index>`
- **Anything without a CLI verb**: `tea api` makes an authenticated request, e.g.
  `tea api --repo minder/oh-my-slop /repos/minder/oh-my-slop/issues/<index>`.
  Verify HTTP status and the intended result; process exit code alone is not success.

Labels must exist before they can be applied — `tea labels create --repo minder/oh-my-slop --name "..." --color "..."`.
Manage them with `tea labels list --repo minder/oh-my-slop`. Verify each write
before a dependent action; a posted comment and a closed issue are separate outcomes.

## Robot comments

A comment a skill posts on an issue or PR opens with a stable **marker** line:

> 🤖 `<skill-name>` — <purpose>

(skill name in backticks; one purpose per marker, e.g. ``🤖 `triage` — triage notes``).
Markers make re-runs idempotent: before posting, read the item's comments and look for
your marker — found, edit that comment in place; not found, post fresh. One live
marker comment per skill and purpose; anything parsing comments keys on the marker
text, never on the emoji alone.

- **Find yours**: `tea comments list --repo minder/oh-my-slop <index>` (shows comment IDs)
- **Edit in place**: `tea comments edit --repo minder/oh-my-slop <comment-id> "new body"` —
  note `edit` takes the **global comment ID** from the list, not the issue index

## PRs as a request surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats incoming PRs as
feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same roles and states as issues, via
`tea pulls`. Gitea shares one index space across issues and PRs, so a bare `#42` may
be either — resolve with `tea pulls <n>` and fall back to `tea issues <n>`.

## When a skill says "publish to the issue tracker"

Create a Gitea issue with `tea issues create --repo minder/oh-my-slop`.

## When a skill says "fetch the relevant ticket"

Run `tea issues --repo minder/oh-my-slop --comments <index>`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue; **tickets** are issues linked to it.
Maps and tickets live on Gitea only — never on the intake tracker.

- **Map**: an issue labelled `wayfinder:map`, holding the Destination / Notes /
  Decisions-so-far / Fog body.
  `tea issues create --repo minder/oh-my-slop --labels wayfinder:map --title "..." --description "..."`
- **Child ticket**: Gitea has **no sub-issue API**, so parentage is expressed in the
  body — the **literal first body line** `Part of #<map>` (nothing before it, nothing
  after the number), and keep a task list of children in the map body. Label each
  ticket `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`).
- **Membership is one anchored pattern on the first line, for every child of anything**
  — decision tickets under a map, implementation tickets `to-tickets` cuts from a map
  or a spec issue. It is the contract the software factory resolves a parent-scoped
  run through (`docs/specs/software-factory.md` §3.1; `factory/lib/tracker/membership.mjs`),
  so a `## Parent` heading or a mention in prose makes a ticket a member of nothing:
  `factory start --parent <N>` over such children refuses as `scope-empty`, and
  `factory doctor --parent <N>` raises the same alarm.
- **Blocking**: Gitea has **native issue dependencies**, which render the frontier in
  the web UI. Add an edge with:

  ```sh
  tea api --repo minder/oh-my-slop --include --method POST /repos/minder/oh-my-slop/issues/<blocked>/dependencies \
    --data '{"index": <blocker>, "owner": "minder", "repo": "oh-my-slop"}'
  ```

  The body is an `IssueMeta`: `index`, `owner` and `repo` are **required**, even
  though the same repo is already in the URL. Missing fields can produce a
  misleading repository-not-found error. Check HTTP success independently of the
  process exit code, then verify the edge with a `GET` on the same path.

  The endpoint takes the plain issue **index** — no numeric database id, unlike
  GitHub. Semantics: the issue in the URL becomes blocked by the issue in the body.
  `GET` on the same path lists everything blocking an issue; `DELETE` removes an edge.
  A ticket is unblocked when every blocker is closed.
- **Terminal review ticket**: `to-tickets` ends every map's implementation run in one
  `ready-for-human` + `workflow:implement` ticket, `Review the delivered <map title>`,
  blocked by every other ticket of the run. It is the sink a factory run drains into —
  the one ticket left open when everything implementable is done — and the factory warns
  (`no-human-sink`) when a parent scope has none. The operator answers its three questions
  in a comment and closes it. `/humanify <ticket>` assists with evidence and the human
  decision; it may record and close on explicit delegation unless the action is reserved
  to the human personally. Retain unfinished obligations and verify the final state.
  This does not change the ticket's labels or the factory's human-owned classification.
- **Frontier query**: list the map's open children, drop any that still have an open
  blocker (`GET .../dependencies`) or an assignee; first in map order wins.
- **Claim**: `tea issues edit --repo minder/oh-my-slop <index> --add-assignees <me>` — the session's first write.
- **Resolve**: `tea comments add --repo minder/oh-my-slop <index> "<answer>"`, verify
  the comment, then `tea issues close --repo minder/oh-my-slop <index>`, verify the
  state, then append a one-line gist plus link to the map's Decisions-so-far.

---

# Intake: GitHub

Human- and community-filed issues live as GitHub issues on `dekoza/oh-my-slop` (public).
Use the `gh` CLI. Pass `--repo dekoza/oh-my-slop` when remote inference is ambiguous.

> GitHub is the **intake** surface only: humans and community file here, and skills
> read and triage these issues but never open new work tickets on them. New specs,
> tickets, and maps go to the Gitea agent work tracker above.

## Conventions

- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
  with `--label` / `--state` filters as needed.
- **Comment**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **Create an issue**: `gh issue create` — **reserved for the user.** A skill that
  wants to record work creates it on Gitea instead.

## Robot comments

A comment a skill posts on an issue or PR opens with a stable **marker** line:

> 🤖 `<skill-name>` — <purpose>

(skill name in backticks; one purpose per marker, e.g. ``🤖 `triage` — triage notes``).
Markers make re-runs idempotent: before posting, read the item's comments and look for
your marker — found, edit that comment in place; not found, post fresh. One live
marker comment per skill and purpose; anything parsing comments keys on the marker
text, never on the emoji alone.

- **Find yours**: `gh issue view <number> --comments`; for comment IDs,
  `gh api repos/dekoza/oh-my-slop/issues/<number>/comments --jq '.[] | {id, body}'`
- **Edit in place**: `gh issue comment <number> --edit-last --body "..."` when the
  marker comment is your latest on the item; otherwise
  `gh api --method PATCH repos/dekoza/oh-my-slop/issues/comments/<comment-id> -f body='...'`

## PRs as a request surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as
feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the
`gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments`, plus `gh pr diff <number>`.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,
  then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or
  `NONE` (drop `OWNER` / `MEMBER` / `COLLABORATOR`). That filter is what "external"
  means for this repo.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label` / `--remove-label`, `gh pr close`.

After `gh:` / `github:` or a GitHub URL selects this surface, the number may name
an issue or PR because GitHub shares one number space across both. Resolve it with
`gh pr view <number>` and fall back to `gh issue view <number>`.

## When a skill says "publish to the issue tracker"

Publish to the **agent work tracker** (Gitea). This surface is intake-only.

## When a skill says "fetch the relevant ticket"

For a `gh:` / `github:` reference or GitHub URL, run
`gh issue view <number> --comments`. Unqualified references resolve to Gitea — see
the agent work section above.

## Wayfinding operations

None. `/wayfinder` maps and tickets live on the Gitea agent work tracker only.
