# Repo Context, Logins & Auth

## How `tea` decides what to talk to

Two independent resolutions happen on every command, and conflating them is the root of most `tea` bugs:

| Resolution | Answers | Controlled by |
|---|---|---|
| **Login** | Which Gitea instance + token | `--login`, `--remote`, or the default login |
| **Repo scope** | Which repository | `--repo owner/name` **only** |

`--remote` is a *login discovery* flag. Its help text ("Discover Gitea login from remote") describes exactly what it does and nothing more. It never scopes the repo.

### The silent fallback

When a command needs a repo and none resolves, `tea` does not error. It falls back to instance-wide endpoints:

```
GET /api/v1/repos/issues/search?...     ← unscoped: every repo you can see
GET /api/v1/repos/{owner}/{repo}/issues ← scoped: what you actually wanted
```

Verified with `--debug` in a repo where `origin` is GitHub:

```
DEBUG: Get remote configurations &{origin [git@github.com:dekoza/oh-my-slop.git]} of origin
DEBUG: Matching remote URL 'git@github.com:dekoza/oh-my-slop.git' against {Kuferek http://...} login
GET: http://192.168.129.37:30008/api/v1/repos/issues/search?...
```

`tea` reads `origin` first. The GitHub URL cannot match the Gitea login, so scoping is abandoned — silently, with exit `0`.

Passing `--remote gitea` makes the *URL match* succeed but changes nothing about scope:

```
DEBUG: Matching remote URL 'ssh://git@192.168.129.37:30009/minder/oh-my-slop.git' against {Kuferek ...} login
GET: http://192.168.129.37:30008/api/v1/repos/issues/search?...   ← still unscoped
```

Only `--repo minder/oh-my-slop` yields the scoped endpoint.

### Recognising the failure at a glance

Add `owner` and `repo` to `--fields` on any list command. If rows show repos you did not ask for, scoping failed:

```sh
tea issues list --repo minder/oh-my-slop -f index,title,owner,repo
```

## `--repo` accepted forms

- `owner/name` — the reliable form. Always prefer it.
- A local filesystem path — resolves via that repo's remotes, inheriting the same `origin`-first problem.
- `.` — does **not** force the current directory to scope correctly; it hit the unscoped endpoint in testing.
- **A URL is rejected.** `--repo http://host/minder/app` fails with `Error: user does not exist [uid: 0, name: http:]` — it parses the scheme as the owner.

`tea` also requires a git repository in `$PWD` even when `--repo` is explicit; outside one it fails at `git rev-parse --show-toplevel`. Run `tea` from inside any repo (or pass `--repo <local-path>`).

## Config file

Path: `$XDG_CONFIG_HOME/tea/config.yml` (i.e. `~/.config/tea/config.yml`).

```yaml
logins:
    - name: Kuferek
      url: http://192.168.129.37:30008
      default: true
      ssh_host: 192.168.129.37:30008
      ssh_key: ""
      insecure: true
      ssh_certificate_principal: ""
      ssh_agent: false
      ssh_key_agent_pub: ""
      version_check: true
      user: minder
      created: 1783552394
      auth_method: oauth
preferences:
    editor: false
    flag_defaults:
        remote: ""
```

Notes:

- The **token is not in `config.yml`** on this setup. Credentials live in `credentials.json.enc` alongside it (`auth_method: oauth`). Do not expect to read or hand-edit a token out of the YAML.
- `config.yml.lock` guards concurrent writes — a stale lock can block `tea login` operations.
- `default: true` marks the login used when `--login` is absent.
- `preferences.flag_defaults.remote` can pin a default `--remote`, which (again) affects login choice only.

## Login management

```sh
tea logins list                      # names, URLs, default marker
tea logins default                   # show current default
tea logins default <name>            # set default
tea logins add --name X --url URL --token TOK
tea logins delete <name>
tea whoami                           # confirm which user/instance you are acting as
```

`tea logins add` runs interactively when given no args. In non-TTY contexts pass flags, or read from the documented env vars: `GITEA_SERVER_URL`, `GITEA_SERVER_TOKEN`, `GITEA_SERVER_USER`, `GITEA_SERVER_PASSWORD`, `GITEA_SERVER_OTP`, `GITEA_SCOPES`.

Useful `add` flags: `--insecure` (skip TLS verification, needed for plain-HTTP instances), `--no-version-check`, `--scopes`, `--oauth` (interactive browser flow), `--ssh-agent-key` / `--ssh-agent-principal`.

## Git credential helper

`tea` can authenticate plain `git push`/`git clone` over HTTPS using its stored token:

```sh
tea logins add --git-credentials      # register while adding
tea logins helper setup               # register for existing logins
```

This writes `!tea login helper` into `~/.gitconfig`. `tea logins oauth-refresh [<login>]` manually refreshes an expired OAuth token, opening a browser if the refresh token has also expired.

Irrelevant when remotes are SSH (`ssh://git@host:30009/...`), which is the usual layout here — the helper only covers HTTPS.
