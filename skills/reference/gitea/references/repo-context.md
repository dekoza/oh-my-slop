# Repository context, logins and auth

## Resolve identity explicitly

Two choices must agree with the project's tracker binding:

| Choice | Meaning | Explicit selection |
|---|---|---|
| Login | Gitea instance and authenticated user | `--login LOGIN` where supported |
| Repository | Owner/name within that instance | `--repo OWNER/REPO` on repository operations |

Read the binding before a call. A GitHub `origin`, a Gitea remote and a default tea
login may all refer to different destinations. `--remote` participates in discovery;
it is not an explicit owner/repo selection. Inference may work, but an explicit
binding makes the intended target inspectable and stable across worktrees/logins.

```sh
tea logins list
tea api --login LOGIN -i /user
tea issues list --login LOGIN --repo OWNER/REPO --fields index,title,owner,repo --limit 1
```

Substitute actual values; these names are placeholders. `tea whoami` shows the
current login, but **has no `--login` flag** (0.15.1 and still 0.16.0). Use the
`/user` read above when verifying a particular login, or `tea logins status` below
for a per-login validity check. Avoid dumping config or tokens to diagnose a
selection problem.

Run from the assigned clone/worktree. Some entity commands shell out to Git even
with explicit repo scope; leaving the worktree can also violate a session's guards.
Account-wide commands such as `tea repos list/create` do not accept `--repo`; inspect
their help and use their documented owner/name fields instead.

## Diagnose the actual request, not a theory about remotes

Add `--debug` to a **read** and inspect the requested URL and selected login. Keep
diagnostics separate from JSON stdout. For an issue list:

- `/api/v1/repos/OWNER/REPO/issues` is scoped to that repository.
- `/api/v1/repos/issues/search` is an instance-level search; verify that this is
  really what the task requested before using it as a repository's backlog.

The July 2026 tea 0.14.2 probes observed silent instance-wide fallback after remote
matching failed, including with `--remote gitea` and `--repo .`. Those observations
motivated explicit scope; they are not an assertion that inference always fails.
September 2026 tea 0.15.1 read-only checks, repeated on tea 0.16.0 (2026-09-15), in
the same GitHub-origin/Gitea-remote clone resolved the correct repository with all
three forms: bare list, `--remote gitea`, and explicit `--repo`. Inference working
here is not a guarantee elsewhere: remote-to-login matching still depends on every
remote URL hitting a configured login's host/port fields. See `verification.md` for
the evidence boundary.

`--repo owner/name` is the portable preferred form. Local paths and `.` use local
repository discovery instead of explicitly naming the target. The original probes
rejected an HTTP URL as a repo slug; use a slug, not a URL, for this flag. Never
repeat a mutation just to see its debug URL.

## Configuration and credentials

Tea normally keeps configuration under `$XDG_CONFIG_HOME/tea/`, commonly
`~/.config/tea/`. The default login and remote preferences affect implicit selection.
In the observed OAuth installation, credentials were encrypted alongside
`config.yml`, not stored as a plaintext token in its login entry. Storage depends
on version/auth method; do not infer that a token is missing or expose credentials
by printing the whole directory's contents.

Use supported login commands for changes and preserve other logins/preferences.
A stale `config.yml.lock` can obstruct writes; verify ownership/process state before
considering recovery rather than deleting a lock blindly.

```sh
tea logins list
tea logins default
tea logins default LOGIN
tea logins add --name LOGIN --url URL --token TOKEN
tea logins status [LOGIN]
```

`tea logins status` (tea 0.16.0+) verifies each stored credential against its
instance and reports user, auth method, token validity and expiry; `--output json`
emits the same, with stringified booleans (`"valid": "true"`). On ≤0.15.x `status`
is parsed as a *login-name* argument, not a verb. It authenticates by stored login,
so it is the per-login identity check that `tea whoami --login` is not.

Adding/changing a login modifies authentication configuration and requires that
intent. Supply credentials through an approved secure input path; never put a real
token into a report or shared example. `logins add` without flags is interactive.
Consult its installed help for OAuth and environment inputs (`GITEA_SERVER_URL`,
`GITEA_SERVER_TOKEN`, `GITEA_SERVER_USER`, etc.) — those variables feed the `add`
flags; a nameless invocation still does not replace an explicit `--login` on
operations. `--insecure` disables TLS certificate
verification; it is not a generic remedy for HTTP/auth failures.

## Git credential helper

```sh
tea logins helper setup
tea logins oauth-refresh LOGIN
```

Helper setup changes Git credential configuration so HTTPS Git operations can use
tea's credentials; authorize that configuration change first. `tea logins add
--git-credentials` registers the helper for the new login in one step (equivalent
to running `helper setup` afterwards). OAuth refresh may
require a browser when refresh credentials expire. Neither mechanism authenticates
SSH remotes: SSH keys/agent configuration are a separate boundary.
