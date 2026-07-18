---
name: gitea
description: >
  Use when interacting with a Gitea instance or its `tea` CLI — listing or filing
  issues, managing pull requests, labels, milestones, releases, repos, or calling
  the Gitea REST API. Triggers on: "tea" CLI commands, "Gitea", "tea issues",
  "tea pr", "tea api", blocked-by/issue dependencies, "file this on the tracker",
  or a repo whose remote points at a Gitea host. Excludes GitHub's `gh` CLI.
scope: gitea
target_versions: "tea 0.14.2, Gitea 1.27.0"
last_verified: 2026-07-19
source_basis: verified empirically against a live Gitea 1.27.0 instance
---

# Gitea & the `tea` CLI Reference

`tea` looks like `gh`, and that resemblance is the trap: the flags read the same but the **repo context resolution is completely different**. Most `tea` mistakes are not wrong flags — they are commands that succeed, exit `0`, and quietly operate on the wrong repository.

Read the routing table below and open only what the task needs.

## The one rule that prevents most failures

**Always pass `--repo <owner>/<name>` explicitly.** Never rely on `tea` inferring the repo from `$PWD`.

`tea` resolves context from the `origin` remote. When `origin` points at GitHub and Gitea lives on a different remote — the standard layout in this user's projects — `tea` fails to match the login, then **silently falls back to an instance-wide issue search** instead of erroring:

```console
$ cd ~/projekty/oh-my-slop        # origin=GitHub, gitea=Kuferek
$ tea issues list --limit 3
│ 193 │ Decide: VariantCodeAdmin permits ... │ minder │ nukem2_again │   ← WRONG REPO
```

It hit `/api/v1/repos/issues/search` (every repo on the instance), not this repo's issues, and exited `0`.

**`--remote` does not fix this.** It only points `tea` at a different remote to match against a login — matching still failed here, because the `gitea` remote's SSH port (`30009`) does not match the login's `ssh_host` port (`30008`). `--repo .` does not scope either. Only `--repo owner/name` produces `/api/v1/repos/{owner}/{repo}/issues`.

`tea` inspects exactly **one** remote — never all of them — so a correct Gitea remote sitting beside a GitHub `origin` is simply not consulted.

## Critical Gotchas

1. **`tea api` exits `0` on HTTP 404/500.** Unlike every other `tea` command (which exits `1`), `tea api` reports transport success, not HTTP success. Never gate a script on `$?` alone — pass `-i` and inspect the status line, or parse the body for `"message"`.
2. **`-o json` is flattened table data, not API objects.** It emits only the `--fields` columns, and every value is a **string** — `"index": "193"`, not `193`. Arithmetic and `jq` numeric comparisons break silently. For real typed objects, use `tea api`.
3. **Issue dependencies have no `tea` command.** Blocked-by relationships are API-only — see `references/dependencies.md`. `owner` and `repo` are required in the request body even for same-repo dependencies; omitting them returns a misleading `404 repository does not exist`.
4. **Blocked issues cannot be closed.** Gitea rejects the close with `cannot close this issue or pull request because it still has open dependencies`, and no `tea` list output reveals blocked-ness — the field does not exist. Query dependencies before assuming an issue is closeable.
5. **`-r` never means `--add-reviewers`.** On `tea pulls edit`, `-r` is declared for both `--repo` and `--add-reviewers`; `--repo` wins. Spell out `--add-reviewers` in full.
6. **Index, not ID.** Issue and PR commands take the per-repo **index** (`#24`), while `tea comments edit/delete`, `tea labels`, `tea webhooks`, and `tea ssh-keys` take global numeric **IDs**. They are not interchangeable.
7. **`-o` means two different things.** On every command except one it selects a format (`json`, `yaml`, …). On **`tea api` it names an output *file*** — `tea api -o json <endpoint>` writes the response to a file literally called `json`.
8. **Most `tea` documentation online is stale.** Nearly all of it describes 0.9.2 (2023); 0.14.2 (2026-06-26) added `comments edit/delete`, `pulls resolve/unresolve`, `wiki`, `webhooks`, `actions`, `ssh-keys`, and `--draft/--ready`. The installed binary's `--help` is the only authority — `tea api` is undocumented even in the official README.
9. **Interactivity is not TTY-based.** `tea` prompts whenever a command is given **zero flags** (`NumFlags() == 0`), regardless of whether stdin is a terminal. In scripts, always pass at least one flag.

## Routing

| File | Use for |
|------|---------|
| `references/repo-context.md` | Repo/login resolution, `config.yml`, auth, credential helper, adding logins |
| `references/issues.md` | Issues, comments, labels, milestones, tracked times |
| `references/dependencies.md` | Blocked-by / blocks relationships via the API |
| `references/pulls.md` | PR lifecycle, review, approve/reject, drafts, merging, checkout |
| `references/api-scripting.md` | `tea api`, output formats, exit codes, scripting patterns |
| `references/repos-releases.md` | Repos, releases, branches, wiki, webhooks, actions |

## Tracker split

Per the user's global rules: **Gitea is for agent/LLM work tracking** (wayfinder maps, tickets, planning). **GitHub issues are reserved for human-filed issues** — never create work tickets there with `gh`. A repo typically has `origin` → GitHub and `gitea` → Kuferek, which is precisely why the `--repo` rule above matters.

## Verifying a claim about `tea`

The installed binary is the source of truth, not upstream docs and not memory:

```sh
tea <command> --help 2>&1 | sed -r 's/\x1B\[[0-9;]*[mK]//g'
tea <command> --debug          # prints resolved login, matched remote, and the exact URL hit
```

`--debug` is the fastest way to confirm which repo a command actually targeted.
