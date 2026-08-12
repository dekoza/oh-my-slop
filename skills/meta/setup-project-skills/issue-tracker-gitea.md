# Issue tracker: Gitea

Issues, specs, and wayfinder maps for this repo live as Gitea issues. Use the `tea`
CLI for all operations. This is the **agent work tracker** — everything the skills
create lands here.

## Conventions

`tea` infers the repo and login from the git remote when run inside a clone. Pass
`--repo <owner>/<name>` or `--remote gitea` when that inference is wrong.

- **Create an issue**: `tea issues create --title "..." --description "..."`.
  Note it is `--description` / `-d`, **not** `--body` — the `gh` habit fails here.
- **Read an issue**: `tea issues <index> --comments`
- **List issues**: `tea issues list --state open --labels "..." --fields index,title,state,labels,assignees`
- **Comment**: `tea comments add <index> "..."` (the shorthand `tea comment <index> "..."` also works)
- **Apply / remove labels**: `tea issues edit <index> --add-labels "..."` / `--remove-labels "..."`
- **Assign**: `tea issues edit <index> --add-assignees <user>`
- **Close**: `tea issues close <index>`
- **Anything without a CLI verb**: `tea api` makes an authenticated request, e.g.
  `tea api /repos/<owner>/<repo>/issues/<index>`

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

- **Find yours**: `tea comments list --repo <owner>/<repo> <index>` (shows comment IDs)
- **Edit in place**: `tea comments edit --repo <owner>/<repo> <comment-id> "new body"` —
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

- **Map**: an issue labelled `wayfinder:map`, holding the Destination / Notes /
  Decisions-so-far / Fog body.
  `tea issues create --labels wayfinder:map --title "..." --description "..."`
- **Child ticket**: Gitea has **no sub-issue API**, so parentage is expressed in the
  body — put `Part of #<map>` at the top of each ticket, and keep a task list of
  children in the map body. Label each ticket `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: Gitea has **native issue dependencies**, which render the frontier in
  the web UI. Add an edge with:

  ```sh
  tea api --method POST /repos/<owner>/<repo>/issues/<blocked>/dependencies \
    --data '{"index": <blocker>}'
  ```

  The endpoint takes the plain issue **index** — no numeric database id, unlike
  GitHub. Semantics: the issue in the URL becomes blocked by the issue in the body.
  `GET` on the same path lists everything blocking an issue; `DELETE` removes an edge.
  A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children, drop any that still have an open
  blocker (`GET .../dependencies`) or an assignee; first in map order wins.
- **Claim**: `tea issues edit <index> --add-assignees <me>` — the session's first write.
- **Resolve**: `tea comments add <index> "<answer>"`, then `tea issues close <index>`,
  then append a one-line gist plus link to the map's Decisions-so-far.
