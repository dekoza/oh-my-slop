# Pull Requests

`tea pulls` aliases: `tea pull`, `tea pr`. All commands need `--repo owner/name`.

## Lifecycle

```sh
tea pr list --repo minder/app --state all
tea pr 42 --repo minder/app                       # detail view
tea pr create --repo minder/app -t "Title" -d "Body" --base main
tea pr checkout --repo minder/app 42 -b
tea pr merge --repo minder/app 42 --style squash
tea pr close --repo minder/app 42
tea pr clean --repo minder/app 42
```

## `create`

`--head` defaults to the current branch, `--base` to the repo's default branch. For a cross-repo PR, `--head` takes `<user>:<branch>`.

`tea` assumes local state is already **pushed** — it opens a PR for a branch on the remote, it does not push for you. Push first.

Other flags mirror `tea issues create`: `--title/-t`, `--description/-d`, `--labels/-L`, `--assignees/-a`, `--milestone/-m`, `--deadline/-D`, plus `--allow-maintainer-edits/--edits`.

### `--draft` is a title convention, not a flag on the object

`--draft` **prepends `WIP: ` to the title**; Gitea treats WIP-prefixed PRs as drafts. Consequences:

- `tea pr edit --draft` / `--ready` add and strip that prefix (both idempotent).
- Anything parsing PR titles must tolerate the `WIP: ` prefix.
- Unlike `gh pr create --draft`, no separate draft state is set.

### agit flow

`--agit` (with optional `--topic`) creates an agit-flow PR. It requires a remote — omitting one fails with `remote is required for agit flow PR`.

## `checkout`

```sh
tea pr checkout --repo minder/app 42 -b
```

Without `-b/--branch`, checkout fails when the local branch does not exist yet. `-b` creates it.

## `merge`

`--style/-s` is one of `merge` (default), `rebase`, `squash`, `rebase-merge`. `--title/-t` and `--message/-m` set the merge commit. The instance's branch protection may forbid a given style.

## `clean`

Deletes local and remote feature branches for a **closed** PR. It matches by commit hash; `--ignore-sha` falls back to matching by branch name (less precise — it can delete a branch that merely shares the name).

## Review

```sh
tea pr review --repo minder/app 42                     # interactive
tea pr approve --repo minder/app 42 "looks good"
tea pr reject  --repo minder/app 42 "reason"           # reason is required
tea pr review-comments --repo minder/app 42
tea pr resolve   --repo minder/app <comment-id>
tea pr unresolve --repo minder/app <comment-id>
```

`review` is interactive and unsuitable for scripts — use `approve`/`reject` instead. `reject` requires a reason argument. `resolve`/`unresolve` take **review-comment IDs** from `tea pr review-comments`, not PR indices.

## `edit`, and the `-r` collision

```sh
tea pr edit --repo minder/app 42 --add-reviewers alice,bob
```

`tea pulls edit` declares `-r` for **both** `--repo` and `--add-reviewers`. `--repo` wins — verified: `-r minder/app` resolved the repo rather than requesting a review. **Always spell out `--add-reviewers` and `--remove-reviewers`.**

Other flags match `tea issues edit`: `--add-labels`, `--remove-labels`, `--add-assignees`, `--title`, `--description`, `--milestone`, `--deadline`. Unset with `""`.

## Fields

`tea pr list --fields` adds PR-specific columns to the issue set: `mergeable`, `base`, `base-commit`, `head`, `diff`, `patch`, `ci`.

```sh
tea pr list --repo minder/app -f index,title,state,mergeable,ci
```

`--kind pulls` on `tea issues list` applies the richer issue search filters (`--labels`, `--author`, `--keyword`) to PRs, which `tea pr list` lacks — `tea pr list` only offers `--state`.
