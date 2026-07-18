# Issues, Comments, Labels, Milestones, Times

Every command below needs `--repo owner/name` — see `references/repo-context.md` for why omitting it silently targets the wrong repo.

## Issues

```sh
tea issues list --repo minder/app --state all --limit 50
tea issues 24 --repo minder/app                 # detail view; --comments to include them
tea issues create --repo minder/app -t "Title" -d "Body"
tea issues edit --repo minder/app 24 --add-labels bug --milestone ""
tea issues close  --repo minder/app 24 25 26    # variadic
tea issues reopen --repo minder/app 24
```

`tea issues` with no subcommand lists; with an index it shows detail.

### `list` and `create` have disjoint flag sets

Filters exist only on `list`; they are silently unavailable on `create`.

- **`list` filters**: `--state` (`all|open|closed`, default `open`), `--kind` (`issues|pulls|all`), `--keyword/-k`, `--labels/-L`, `--milestones/-m`, `--author/-A`, `--assignee/-a`, `--mentions/-M`, `--owner/--org`, `--from/-F`, `--until/-u`.
- **`create` fields**: `--title/-t` (**required** — omitting it fails with `Error: title is required`, exit 1), `--description/-d`, `--labels/-L`, `--assignees/-a`, `--milestone/-m`, `--deadline/-D`, `--referenced-version/-v`.

`create` has **no `--output`**, so the new issue's index cannot be captured as JSON. Parse it from the printed URL, or create via `tea api` when you need the index programmatically.

### `edit` uses different flag names than `create`

`create` takes `--labels`; `edit` takes `--add-labels` / `--remove-labels` and `--add-assignees`. `--add-labels` takes precedence over `--remove-labels` when both name the same label. **Unset a property with an empty string**: `--milestone ""`.

`edit` is variadic — `tea issues edit --repo minder/app 24 25 --add-labels triage` edits both.

### Default `--state` is `open`

Every list command defaults to `open`. An issue that "disappeared" is usually closed, not missing; pass `--state all`.

## Comments

```sh
tea comments list --repo minder/app 24          # shows comment IDs
tea comments add  --repo minder/app 24 "body"
tea comments edit --repo minder/app <comment-id> "new body"
tea comments delete --repo minder/app <comment-id> [<id>...]
```

**`add` takes an issue index; `edit`/`delete` take a global comment ID.** Get IDs from `tea comments list`. `tea comment <idx> "<body>"` remains a shorthand for `add`.

`edit` accepts the body as an argument, on stdin, or (interactively only) via `$EDITOR`. Without a body in a non-TTY context: `Error: no comment content provided`, exit 1.

`tea comments` has no `--fields`.

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
