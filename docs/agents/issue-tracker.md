# Issue tracker

This repo has **two** tracker surfaces, and conflating them is the failure this file
exists to prevent:

- **Agent work** — Gitea (`minder/oh-my-slop`). Everything the skills *create* lands
  here: specs, tickets, wayfinder maps.
- **Intake** — GitHub (`dekoza/oh-my-slop`, public). Where humans and community file
  issues. Read and triaged; **never** written to with new work tickets.

The standing rule: **agents never open work tickets on the intake tracker.**

---

# Agent work: Gitea

Issues, specs, and wayfinder maps for this repo live as Gitea issues. Use the `tea`
CLI for all operations.

## Conventions

`tea` infers the repo and login from the git remote when run inside a clone. This repo
has both a `gitea` and an `origin` (GitHub) remote, so pass `--remote gitea` or
`--repo minder/oh-my-slop` when inference picks the wrong one.

Run `tea` from inside the clone even when passing `--repo`: several subcommands
(`tea issues edit` among them) shell out to `git rev-parse --show-toplevel` first and
fail outright outside a work tree.

- **Create an issue**: `tea issues create --title "..." --description "..."`.
  Note it is `--description` / `-d`, **not** `--body` — the `gh` habit fails here.
- **Read an issue**: `tea issues <index> --comments`
- **List issues**: `tea issues list --state open --labels "..." --fields index,title,state,labels,assignees`
- **Comment**: `tea comments add <index> "..."` (the shorthand `tea comment <index> "..."` also works)
- **Apply / remove labels**: `tea issues edit <index> --add-labels "..."` / `--remove-labels "..."`
- **Assign**: `tea issues edit <index> --add-assignees <user>`
- **Close**: `tea issues close <index>`
- **Anything without a CLI verb**: `tea api` makes an authenticated request, e.g.
  `tea api /repos/minder/oh-my-slop/issues/<index>`

Labels must exist before they can be applied — `tea labels create --name "..." --color "..."`.
Manage them with `tea labels list`.

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

Create a Gitea issue with `tea issues create`.

## When a skill says "fetch the relevant ticket"

Run `tea issues <index> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue; **tickets** are issues linked to it.
Maps and tickets live on Gitea only — never on the intake tracker.

- **Map**: an issue labelled `wayfinder:map`, holding the Destination / Notes /
  Decisions-so-far / Fog body.
  `tea issues create --labels wayfinder:map --title "..." --description "..."`
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
  tea api --method POST /repos/minder/oh-my-slop/issues/<blocked>/dependencies \
    --data '{"index": <blocker>, "owner": "minder", "repo": "oh-my-slop"}'
  ```

  The body is an `IssueMeta`: `owner` and `repo` are **required**, even though the
  same repo is already in the URL. Omitting them returns
  `{"message":"repository does not exist [id: 0, uid: 0, owner_name: , name: ]"}`
  with **HTTP 200 and exit code 0**, so the edge silently never lands — always
  verify with a `GET` on the same path afterwards.

  The endpoint takes the plain issue **index** — no numeric database id, unlike
  GitHub. Semantics: the issue in the URL becomes blocked by the issue in the body.
  `GET` on the same path lists everything blocking an issue; `DELETE` removes an edge.
  A ticket is unblocked when every blocker is closed.
- **Terminal review ticket**: `to-tickets` ends every map's implementation run in one
  `ready-for-human` + `workflow:implement` ticket, `Review the delivered <map title>`,
  blocked by every other ticket of the run. It is the sink a factory run drains into —
  the one ticket left open when everything implementable is done — and the factory warns
  (`no-human-sink`) when a parent scope has none. The operator answers its three questions
  in a comment and closes it.
- **Frontier query**: list the map's open children, drop any that still have an open
  blocker (`GET .../dependencies`) or an assignee; first in map order wins.
- **Claim**: `tea issues edit <index> --add-assignees <me>` — the session's first write.
- **Resolve**: `tea comments add <index> "<answer>"`, then `tea issues close <index>`,
  then append a one-line gist plus link to the map's Decisions-so-far.

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

GitHub shares one number space across issues and PRs, so a bare `#42` may be either —
resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Publish to the **agent work tracker** (Gitea). This surface is intake-only.

## When a skill says "fetch the relevant ticket"

If the ticket is a human-filed intake issue, `gh issue view <number> --comments`.
Otherwise it lives on Gitea — see the agent work section above.

## Wayfinding operations

None. `/wayfinder` maps and tickets live on the Gitea agent work tracker only.
