# Issue tracker: Gitea

Issues, specs, and wayfinder maps for this repo live as Gitea issues. Use the `tea`
CLI for all operations. This is the **agent work tracker** — everything the skills
create lands here.

## Conventions

Use the `gitea` skill for command grammar, reference routing and API verification.
Resolve the owner/repo and login from this project's binding before calling `tea`.
Pass `--repo <owner>/<repo>` on repository commands and `--login <login>` when the
binding selects a login. `--remote` participates in discovery; it does not replace
an explicit owner/repo binding.
Run from the assigned clone or worktree; some commands require Git context even
with an explicit repo.

- **Create an issue**: `tea issues create --repo <owner>/<repo> --title "..." --description "..."`.
- **Read an issue**: `tea issues --repo <owner>/<repo> --comments <index>`
- **List issues**: `tea issues list --repo <owner>/<repo> --state open --labels "..." --fields index,title,state,labels,assignees`
- **Read comments**: `tea comments list --repo <owner>/<repo> <index>`
- **Comment**: `tea comments add --repo <owner>/<repo> <index> "..."`
- **Apply / remove labels**: `tea issues edit --repo <owner>/<repo> <index> --add-labels "..."` / `--remove-labels "..."`
- **Assign**: `tea issues edit --repo <owner>/<repo> <index> --add-assignees <user>`
- **Close**: `tea issues close --repo <owner>/<repo> <index>`
- **Anything without a CLI verb**: `tea api` makes an authenticated request, e.g.
  `tea api --repo <owner>/<repo> /repos/<owner>/<repo>/issues/<index>`.
  Verify HTTP status and the intended result; process exit code alone is not success.

Labels must exist before they can be applied — `tea labels create --repo <owner>/<repo> --name "..." --color "..."`.
Manage them with `tea labels list --repo <owner>/<repo>`. Verify each write before
a dependent action; posting a comment and closing an issue are separate outcomes.

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

Create a Gitea issue with `tea issues create --repo <owner>/<repo>`.

## When a skill says "open a pull request"

```sh
git push -u <gitea-remote> <branch>
tea pr create --repo <owner>/<repo> --title "..." --description "..." --base <base-branch> --head <branch>
```

Resolve `<gitea-remote>` from the project's Gitea binding rather than assuming
`origin` hosts agent work. Put `Closes #<index>` in the description so the merge
closes the ticket. Do not merge — `tea pr merge` is the maintainer's call.

## When a skill says "fetch the relevant ticket"

Run `tea issues --repo <owner>/<repo> --comments <index>`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue; **tickets** are issues linked to it.

- **Map**: an issue labelled `wayfinder:map`, holding the Destination / Notes /
  Decisions-so-far / Fog body.
  `tea issues create --repo <owner>/<repo> --labels wayfinder:map --title "..." --description "..."`
- **Child ticket**: Gitea has **no sub-issue API**, so parentage is expressed in the
  body — put `Part of #<map>` at the top of each ticket, and keep a task list of
  children in the map body. Label each ticket `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: Gitea has **native issue dependencies**, which render the frontier in
  the web UI. Add an edge with:

  ```sh
  tea api --repo <owner>/<repo> --include --method POST /repos/<owner>/<repo>/issues/<blocked>/dependencies \
    --data '{"index": <blocker>, "owner": "<owner>", "repo": "<repo>"}'
  ```

  The endpoint takes the plain issue **index** — no numeric database id, unlike
  GitHub. Semantics: the issue in the URL becomes blocked by the issue in the body.
  `owner`, `repo` and `index` are all required, even for a same-repo edge.
  Check HTTP success, then verify the edge with `GET` on the same path before
  claiming it exists. A process exit code of 0 does not prove HTTP success.
  `GET` lists everything blocking an issue; `DELETE` removes an edge.
  A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children, drop any that still have an open
  blocker (`GET .../dependencies`) or an assignee; first in map order wins.
- **Claim**: `tea issues edit --repo <owner>/<repo> <index> --add-assignees <me>` — the session's first write.
- **Resolve**: `tea comments add --repo <owner>/<repo> <index> "<answer>"`, verify the
  comment, then `tea issues close --repo <owner>/<repo> <index>`, verify the state,
  then append a one-line gist plus link to the map's Decisions-so-far.
