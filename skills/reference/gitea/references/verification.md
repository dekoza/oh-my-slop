# Verification scope

## Closure and body-fidelity observations — 2026-10-26

Runtime for the client probe: installed tea **0.15.1**. The loopback server used
dummy credentials and isolated HOME/XDG config; it recorded outbound JSON, not
real Gitea persistence. No live mutation was used for the probe.

| Evidence source | Observed behavior |
|---|---|
| Read-only Indyq issue188 timeline and PR218/294/297 bodies | All three PRs have `pull_ref` / `ref_action: closes` entries; their merge times match subsequent issue `close` events. The prose used negated closing phrases. Reopening after each partial delivery repaired state but left the wording hazard. PR257 used a non-closing reference and is not among those closure events. This supports safe positive wording, not interpreting negation as a parser escape. |
| Authorized issue188 reopen/comment reconciliation in the same session | A tea `comments edit` positional body written through subprocess argv lost its one terminal LF; no shell substitution was involved. Exact content readback succeeded after identifying that sole difference. This was ordinary-prose tracker correction, not proof of byte-exact file transport. |
| Isolated loopback `comments add` and `comments edit`, positional body | Input `  Summary\n\n    code\n\n` became `Summary\n\n    code`: outer whitespace trimmed, interior indentation preserved in this sample. |
| Same fixture, API `-F body=@file` | Two terminal LF characters became one; a separate one-LF input lost that LF. Leading spaces and interior indentation survived. This path is not byte-exact. |
| Same fixture, API JSON `-d @payload.json` and literal `-f body=...` argv | Both preserved the complete tested body string. The JSON file path avoids argv/shell-substitution hazards and is the documented exact-file recipe. |

Recent Pi session evidence independently shows the recurring failure. These are
local JSONL session identifiers and UTC timestamps, not shipped artifacts; the
selected records did not reliably capture a tea version. They establish the
observed write/readback behavior, while the loopback probe above isolates the client.

| Session identifier / UTC window | Narrow evidence and recovery |
|---|---|
| Indyq, 2026-10-25 17:28:09–17:28:45, 01a17403-33cd-7335-983a-82c621d08bbf, lines 104–111 | `comments edit` via Python subprocess argv: 9,173 expected / 9,172 actual characters, final LF absent. Broad `rstrip()` equality was an initial diagnostic, not exact proof. The agent removed the LF from its local draft and rewrote the same comment; later equality proved the modified draft, not preservation of the original file. |
| Indyq, 2026-10-26 18:22:11–18:22:39, 01a1796f-24ad-7315-8f64-fac88a1c9eef, lines 42–49 | `comments add` via subprocess argv: 6,074 / 6,073; a full line-preserving diff isolated the final LF. The retained draft was adjusted and matched the existing comment without another write. Neither argv case involved shell substitution. |
| Nukem2, 2026-10-26 09:44:38–09:45:26, 01a17791-19f2-72e3-b331-71f89f261a66, lines 52–57 | Comment POST with `-F body=@file`: 7,213 / 7,212; an explicit whole-body comparison established exactly one missing terminal LF. JSON-encoded `-d @payload.json` PATCH of that same comment, HTTP200 and fresh GET then matched the original complete body, including LF. This contradicts blanket server-normalization explanations. |
| Nukem2, 2026-10-25 16:53:20–16:53:57, 01a173ce-68d0-702c-b596-f9432d3da0de, lines 95–104 | PR creation with `-F body=@file`: HTTP201 but 3,465 / 3,464 characters on readback. The draft was changed to remove its final LF before exact verification passed. File input alone did not preserve the original body. |

Keep original inputs and observed bodies separate during diagnosis. Adapting a draft
to a proven prose normalization is not evidence that the original exact file was
published; accepting broad whitespace equality can conceal a second mismatch.

The missing-repository probe attempt made no HTTP request; a subsequent attempt
hit an existing dummy-login name. Both were setup failures, not body-behavior
results. The successful probe used a fresh isolated config and temporary Git repo.
No 0.16.0 comment/field-file re-probe or fresh description-file probe was performed;
keep those version/operation boundaries separate from the September observations.

## Prior observations — 2026-09-15

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
