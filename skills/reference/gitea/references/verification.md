# Verification scope

## Current observations — 2026-09-14

Runtime: tea **0.15.1**; the configured server's read-only `/version` response
reported Gitea **1.27.1**. Updating the skill's target version does not mean every
historical server behavior was retested.

| Evidence source | Observed behavior |
|---|---|
| Installed `tea issues --help` and `tea issues create --help` | Detail takes an index; `--comments` includes discussion; creation uses `--description` and has no output-format flag. |
| Installed `tea comments list/edit --help` | Explicit list takes an issue/PR index; edit takes a global comment ID; list supports page/limit. |
| Installed `tea api --help`, followed by real-binary loopback probes | Endpoint positional argument; `-d`/`-F` request input; status/headers on stderr; `-o` writes a file. |
| Real tea against a loopback HTTP fixture with an isolated config and dummy token | HTTP404 exits0; status was `HTTP/1.0 404`; bare stdin POST has an empty body; `-d @-` sends it; `-F key=null` sends null while `-f key=null` sends a string; file output leaves stdout empty. The fixture establishes client behavior, not Gitea's choice of error codes. |
| Read-only issue listing in a clone with GitHub `origin` and a Gitea remote | Bare invocation, `--remote gitea` and explicit `--repo` all reached the correct scoped endpoint in this environment. Older inference failures are not universal current behavior. Explicit binding remains the reproducible convention. |
| Read-only comments requests, limit1/page1 and limit1/page2 | Both returned the same single comment and `X-Total-Count: 1`. Waiting for an empty extra page would not terminate correctly. This is not a claim about all endpoints or concurrent snapshots. |
| Installed `tea whoami --help` | No `--login` option. Explicit-login identity lookup uses the authenticated `/user` API instead. |

No real tracker mutation was used for these probes. Session evidence independently
shows the comment-add shorthand misused for reads, invented verbs returning
listings, file-body omissions and failures after reference loads/compaction.

## Historical observations — tea 0.14.2 / Gitea 1.27.0

The original July 2026 reference recorded silent instance-wide searches after repo
inference failed, dependency writes requiring a complete IssueMeta, duplicate-edge
HTTP500, dependency creation/removal HTTP201, and refusal to close issues with open
blockers. These remain useful diagnostic observations, not freshly verified status
contracts for 1.27.1. Check the applicable API contract and actual response; verify
the postcondition rather than asserting one historic success code.

Storage/auth layout and less common commands may differ across installations.
Consult the installed command's help and the project's binding. Do not inspect or
quote tokens merely to establish login selection.

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
