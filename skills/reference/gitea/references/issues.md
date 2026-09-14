# Issues, Comments, Labels, Milestones, Times

Bind `--repo owner/name` and the selected login from the project configuration;
examples are not defaults. See `repo-context.md` for inference and login selection.
Read `api-scripting.md` as well before file-backed writes or programmatic reads.
For PRs, ordinary discussion uses these issue-comment operations; inline review
threads and review decisions use `pulls.md`.

## Issues

```sh
tea issues list --repo minder/app --state all --limit 50
tea issues 24 --repo minder/app --comments      # detail view; without --comments you get the body ALONE
tea issues create --repo minder/app -t "Title" -d "Body"
tea issues edit --repo minder/app 24 --add-labels bug --milestone ""
tea issues close  --repo minder/app 24 25 26    # variadic
tea issues reopen --repo minder/app 24
```

`tea issues` with no subcommand lists; with an index it shows detail. A `view` or
`comment` word after `issues` is not the requested detail/comment operation and can
produce a listing instead. Confirm the returned issue index before treating output
as the ticket. Use `--description` for CLI create/edit text, not the `gh` flag
`--body`.

### A body-only read is not the ticket

The detail view prints the body and **omits every comment**, with no marker saying so and exit `0`. A partial read is therefore indistinguishable from a complete one:

```sh
tea issues 24 --repo minder/app              # body only — looks complete
tea issue  24 --repo minder/app              # singular alias, same omission
tea issues 24 --repo minder/app --comments   # body + comments
```

That matters because comments are where trackers put the things that **override the body**: a triage brief with its own acceptance criteria, a scope cut, a correction, a decision that makes the original description stale. The body is what someone reported; the comments are what the project concluded.

**Rule: pass `--comments` whenever you are reading a ticket to find out what to do.** Skip it only for lookups that cannot be changed by a comment — confirming a title, a state, a label. When in doubt, pass it; the cost is one flag, and the failure mode is building the wrong thing while believing you read the spec.

Comments are also available typed, when you need to filter or parse them rather than read them:

```sh
tea api "/repos/minder/app/issues/24/comments"
```

### `list` and `create` have disjoint flag sets

Check the exact subcommand's flags: list-only filters are not create fields.
Search with `--keyword`, not an inferred `--search` flag.

- **`list` filters**: `--state` (`all|open|closed`, default `open`), `--kind` (`issues|pulls|all`), `--keyword/-k`, `--labels/-L`, `--milestones/-m`, `--author/-A`, `--assignee/-a`, `--mentions/-M`, `--owner/--org`, `--from/-F`, `--until/-u`.
- **`create` fields**: `--title/-t` (**required** — omitting it fails with `Error: title is required`, exit 1), `--description/-d`, `--labels/-L`, `--assignees/-a`, `--milestone/-m`, `--deadline/-D`, `--referenced-version/-v`.

`create` has **no `--output`**, so the new issue's index cannot be captured as JSON. Parse it from the printed URL, or create via `tea api` when you need the index programmatically.

### `edit` uses different flag names than `create`

`create` takes `--labels`; `edit` takes `--add-labels` / `--remove-labels` and `--add-assignees`. `--add-labels` takes precedence over `--remove-labels` when both name the same label. **Unset a property with an empty string**: `--milestone ""`.

`edit` is variadic — `tea issues edit --repo minder/app 24 25 --add-labels triage` edits both.

### Default `--state` is `open`

Every list command defaults to `open`. An issue that "disappeared" is usually closed, not missing; pass `--state all`.

## Comments — select list, add or edit explicitly

```sh
tea comments list --repo OWNER/REPO --login LOGIN INDEX
tea comments add --repo OWNER/REPO --login LOGIN INDEX "short body"
tea comments edit --repo OWNER/REPO --login LOGIN COMMENT_ID "new body"
```

**Read with `list`.** `tea comments INDEX` and `tea comment INDEX` select **add**;
without a body they fail with `Error: no comment content provided`. Treat that as
wrong operation selection, not missing tracker discussion. Both issues and PRs use
this ordinary-comment interface. List supports `--page`/`--limit` (default30), so a
single list is not proof that a long discussion has been read completely.

**Add with an issue index; edit with a global comment ID** obtained from the list.
For a workflow marker comment, read the complete comments collection, find the
marker, and edit/reuse the existing comment or add one if absent. Read it back before
claiming success or closing the ticket.

**Preserve exact bodies with file input.** For Markdown files use the API reference's
`-F body=@file` or encoded JSON `-d @file` recipes; shell command substitution strips
trailing newlines. The same reference explains HTTP verification and pagination.
`edit` also accepts the body as an argument, via `--description`, on stdin, or
(interactively) via `$EDITOR`. `tea comments` has no `--fields`.

Deletion takes global IDs too: `tea comments delete --repo OWNER/REPO COMMENT_ID`.
Deleting a comment removes its text from the tracker; require explicit authorization
and a saved copy for reconstruction before doing so.

## Labels

```sh
tea labels list --repo minder/app
tea labels create --repo minder/app --name bug --color "#ee0701" --description "…"
tea labels update --repo minder/app --id 50 --name renamed
tea labels delete --repo minder/app --id 50
```

`update`/`delete` take `--id` (from `list`), not the label name. `--org` lists organisation-level labels; `--exclude-org` omits them. `create --file` bulk-loads a label file, and `list --save` writes one out.

## Milestones

```sh
tea milestones list --repo minder/app --state all
tea milestones create --repo minder/app -t "v1.0" -x 2026-12-31
tea milestones issues --repo minder/app "v1.0"        # list; `add`/`remove` subcommands
tea milestones close --repo minder/app "v1.0"
tea milestones delete --repo minder/app "v1.0"
```

Milestones are addressed **by title**, not ID — quote titles containing spaces. Deadline flag is `--deadline/--expires/-x`.

Beware `tea milestones close --force/-f`, whose help reads "delete milestone": it removes rather than closes.

## Tracked times

```sh
tea times list --repo minder/app --total
tea times list --repo minder/app "#24"      # times on one issue (note the # prefix)
tea times list --mine                       # across all repos
tea times add --repo minder/app 24 1h25m
tea times reset --repo minder/app 24
tea times delete --repo minder/app 24 <time-id>
```

A bare username argument filters by user; a `#`-prefixed argument selects an issue. `--mine` overrides positional arguments. Permissions may restrict you to your own times.
