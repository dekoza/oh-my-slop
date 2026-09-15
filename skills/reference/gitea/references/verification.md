# Verification scope

## Current observations — 2026-09-15

Runtime: tea **0.16.0** (installed binary; help tree byte-identical to the official
v0.16.0 linux-amd64 release build apart from the version stamp); the configured
server's read-only `/version` response reported Gitea **1.27.1**. Version boundaries
below were established by running the official v0.15.1 linux-amd64 binary (checksum
verified) against the same fixture, and by diffing the full recursive `--help` trees
of 0.15.1 and 0.16.0: the only surface changes were `--description-file` on
issues/pulls create+edit, `logins status`, and the release-note items that change
behavior without changing help (create honoring `--output json`, truthful merge
refusal messages).

| Evidence source | Observed behavior |
|---|---|
| 0.15.1-vs-0.16.0 help-tree diff (installed binary) | No new/removed commands besides `logins status`; no flag removed; `pulls reply` present on both (0.15.0+). |
| Real tea 0.16.0 against a loopback HTTP fixture with isolated config and dummy token | `issues/pulls create -o json` → compact typed object, numeric `index`; `-o yaml` falls through to markdown; piped stdin becomes the create body when no description flag is given (0.15.1: stdin ignored, `-o json` ignored, `--description-file` unknown flag); `--description-file` sends byte-exact bodies incl. trailing newline, wins over `-d`, `-` reads stdin; create with an open silent pipe hangs past timeout; `issues close -o json`/`issues edit -o json` parse, are ignored, exit 0 with markdown. |
| Same fixture, `tea api` | HTTP404 still exits 0; `-i` status line on stderr; `-o json` still writes a file literally named `json`. |
| Isolated fixture login + real instance (read-only) | `logins status` verifies stored OAuth token (user, method, expiry); `-o json` stringifies booleans (`"valid": "true"`). On 0.15.1 the invocation is parsed as a login name. |
| Real instance, this repo's GitHub-origin/Gitea-remote clone, read-only `--debug` listings | tea 0.16.0 reached the repo-scoped endpoint with bare, `--remote gitea` and explicit `--repo` forms, matching the 0.15.1 result. |
| Installed `tea pulls reply --help` + fixture POST | Body positional or piped stdin; empty stdin fails `no reply content provided` exit 1; hits `POST /pulls/{index}/comments/{id}/replies`. |
| Installed `tea whoami --help` | Still no `--login` option. Explicit-login identity lookup stays the authenticated `/user` API or `logins status`. |
| Release notes / merged PRs (not re-probed) | Merge refusal reasons (gitea/tea#1107), OAuth browser-opener and SSH-key-discovery fixes (#1093, #1100), HTTP transport timeouts (#1020, 0.15.0), keychain-before-config (#1044, 0.15.0). Labelled as upstream-claimed here. |

No real tracker mutation was used for these probes. Session evidence independently
shows the comment-add shorthand misused for reads, invented verbs returning
listings, file-body omissions and failures after reference loads/compaction.

## Prior observations — 2026-09-14

Runtime: tea **0.15.1**; read-only `/version` reported Gitea **1.27.1**.

| Evidence source | Observed behavior |
|---|---|
| Installed `tea issues --help` and `tea issues create --help` | Detail takes an index; `--comments` includes discussion; creation uses `--description`; `-o json` was accepted on create but not honored. |
| Installed `tea comments list/edit --help` | Explicit list takes an issue/PR index; edit takes a global comment ID; list supports page/limit. |
| Installed `tea api --help`, followed by real-binary loopback probes | Endpoint positional argument; `-d`/`-F` request input; status/headers on stderr; `-o` writes a file. Bare stdin POST has an empty body; `-d @-` sends it; `-F key=null` sends null while `-f key=null` sends a string; file output leaves stdout empty. The fixture establishes client behavior, not Gitea's choice of error codes. |
| Read-only issue listing in a clone with GitHub `origin` and a Gitea remote | Bare invocation, `--remote gitea` and explicit `--repo` all reached the correct scoped endpoint in this environment. Older inference failures are not universal current behavior. Explicit binding remains the reproducible convention. |
| Read-only comments requests, limit1/page1 and limit1/page2 | Both returned the same single comment and `X-Total-Count: 1`. Waiting for an empty extra page would not terminate correctly. This is not a claim about all endpoints or concurrent snapshots. |

## Historical observations — tea 0.14.2 / Gitea 1.27.0

The original July 2026 reference recorded silent instance-wide searches after repo
inference failed, dependency writes requiring a complete IssueMeta, duplicate-edge
HTTP500, dependency creation/removal HTTP201, and refusal to close issues with open
blockers. These remain useful diagnostic observations, not freshly verified status
contracts for 1.27.1. Check the applicable API contract and actual response; verify
the postcondition rather than asserting one historic success code.

Storage/auth layout and less common commands may differ across installations.
Consult the installed command's help and the project's binding. Do not inspect or
quote tokens merely to establish login selection. Config-path resolution follows
`$XDG_CONFIG_HOME`/`$HOME` of the invoking environment: when isolating probes, set
them in separate statements and verify the isolation before running any login-
mutating command — a single-line `export HOME=… XDG_CONFIG_HOME=$HOME/...` expands
`$HOME` first and silently writes to the real user config.

## Revalidation recipe

- Establish grammar with the installed binary's exact subcommand help.
- Establish instance/version and request scope with read-only calls, capturing status
  separately from the body.
- Exercise client transport/body/output behavior against an isolated loopback fixture
  with dummy credentials, never the user's real token.
- Exercise server mutations only in an explicitly authorized disposable test repo.
  Preserve outcomes and version metadata; a simulated response cannot prove a live
  server status code.
- Evaluate model behavior separately using the fixtures described in `../evals/README.md`.
  Registration, body loading, reference loading and correct execution are distinct
  observations. Static reference tests cannot substitute for the model comparison.
