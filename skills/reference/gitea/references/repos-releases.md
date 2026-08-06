# Repos, Releases, Branches, Wiki, Webhooks, Actions

## Repos

```sh
tea repos list --limit 50
tea repos list --owner minder
tea repos search "term" --owner minder --private true
tea repos create --name app --private --init --license MIT
tea repos create-from-template -t owner/tmpl -n newrepo --content --labels
tea repos fork --repo upstream/app --owner minder
tea repos edit --repo minder/app --default-branch main
tea repos delete --name app --owner minder --force
```

`tea repos list`/`create`/`search` take `--owner/-O` and have **no `--repo`/`--remote`** — they are not repo-scoped commands. `create` and `delete` identify the repo with `--name` + `--owner`, whereas `edit` uses `--repo owner/name`.

`--gitignores`, `--license`, `--readme`, and `--branch` on `create` all require `--init`. `delete --force/-f` skips the confirmation prompt; without it the command prompts.

`tea repos migrate` imports from `git`, `gitea`, `gitlab`, or `gogs`, with `--mirror`, `--mirror-interval`, and per-entity copy flags (`--issues`, `--labels`, `--releases`, `--milestones`, `--pull-requests`, `--wiki`, `--lfs`).

Boolean-ish flags on `edit` (`--private`, `--template`, `--archived`) are **strings** taking `true`/`false`, and each defaults to `true` if passed bare — write `--private false` explicitly.

## Releases

```sh
tea releases list --repo minder/app
tea releases create --repo minder/app --tag v1.0.0 -t "v1.0.0" -n "notes"
tea releases create --repo minder/app --tag v1.0.0 --note-file CHANGELOG.md -a dist/app.tar.gz
tea releases edit --repo minder/app v1.0.0 --title "…"
tea releases delete --repo minder/app v1.0.0 --confirm --delete-tag
```

Releases are addressed **by tag**. Gitea creates the tag if it does not exist (`--target` picks the branch or commit). `--note-file/-f` overrides `--note/-n`. `--asset/-a` is repeatable.

`delete` **requires `--confirm/-y`**, and only removes the git tag when `--delete-tag` is also given. As with `repos edit`, `--draft`/`--prerelease` on `releases edit` are strings defaulting to `true`.

Assets are managed separately: `tea releases assets list|create|delete`.

## Branches

```sh
tea branches list --repo minder/app
tea branches protect   --repo minder/app main
tea branches unprotect --repo minder/app main
tea branches rename --repo minder/app old new
```

Fields: `name`, `protected`, `user-can-merge`, `user-can-push`, `protection`. `tea branches` only consults and protects — it does not create or delete branches; use `git` for that.

## Wiki

```sh
tea wiki list --repo minder/app
tea wiki view --repo minder/app "Page Title"
tea wiki create --repo minder/app -t "Title" -c "content" -m "commit msg"
tea wiki edit   --repo minder/app "Page" -c "new content"
tea wiki delete --repo minder/app "Page" --confirm
```

Pages are addressed by title. Content comes from `--content/-c` — there is no `--content-file`, so pipe or use `tea api` for large pages. `delete` needs `--confirm/-y` in non-interactive use.

## Webhooks

```sh
tea webhooks list --repo minder/app
tea webhooks create --repo minder/app https://example.com/hook \
  --type gitea --events push,issues --active --secret s3cret
tea webhooks update --repo minder/app <id> --events push --inactive
tea webhooks delete --repo minder/app <id> --confirm
```

Addressed by numeric **ID** from `list`. `--type` accepts `gitea` (default), `gogs`, `slack`, `discord`, `dingtalk`, `telegram`, `msteams`, `feishu`, `wechatwork`, `packagist`. `--events` is comma-separated (default `push`). `update` has both `--active` and `--inactive` — pass exactly one.

## Actions

```sh
tea actions runs list --repo minder/app
tea actions runs view|logs --repo minder/app <run-id>
tea actions runs delete --repo minder/app <run-id>        # also cancels
tea actions workflows list|view|enable|disable --repo minder/app
tea actions workflows dispatch --repo minder/app <workflow>
tea actions secrets   list|create|delete --repo minder/app
tea actions variables list|set|delete --repo minder/app
```

`runs delete` doubles as cancel (aliases `remove`, `rm`, `cancel`). There is no `gh run watch` equivalent — poll `runs list` if you need to wait.

## Other helpers

```sh
tea notifications ls --mine --states unread
tea notifications read all
tea open --repo minder/app          # open in browser
tea clone minder/app
tea ssh-keys list|add|delete
tea admin users list                # requires admin
```

`tea ssh-keys delete <id>` requires `--confirm/-y`. Notification states are `pinned`, `unread`, `read` (default filter `unread,pinned`); types are `issue`, `pull`, `repository`, `commit`.
