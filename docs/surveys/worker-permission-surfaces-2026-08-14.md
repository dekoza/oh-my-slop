# Worker permission surfaces — facts for ticket #83 (2026-08-14)

Facts gathered while resolving "Define worker trust, permissions, and skill-conflict policy"
(#83) on the "Specify a reliable Software Factory" map (#75). Two probes: a repo/host survey
(read-only; no secret values read or printed) and a Claude Code documentation review.

## Gitea access

- The instance (`http://192.168.129.37:30008`) rejects **all** unauthenticated API calls
  (`REQUIRE_SIGNIN_VIEW`-style): `GET /api/v1/repos/minder/oh-my-slop/issues/83` without auth
  → 403; repo metadata endpoint answers "Only signed in user is allowed to call APIs."
- Consequence: there is no zero-credential path for a worker to read tracker content. Either
  the controller snapshots ticket content into the attempt context, or a dedicated read-only
  token must be minted. Repo publicness could not be determined anonymously.

## pi harness

- **No permission system exists.** `pi --help` and the installed
  `@earendil-works/pi-coding-agent` public API surface expose no permission modes, no
  allow/deny rules, no approval hooks. Grep of the dist for `permission|approv` matches
  nothing in the public API.
- Gating surface is tool selection only: `--tools`/`--exclude-tools` (plus
  `--no-tools`/`--no-builtin-tools`) and the resource kill switches
  (`--no-extensions --no-skills --no-prompt-templates --no-context-files`).
  A worker holding the `bash` tool defeats any edit/write exclusion.
- Trust: `~/.pi/agent/trust.json` is a flat `{path: boolean}` map; settings key
  `defaultProjectTrust: "ask" | "always" | "never"`. Trust gates project-local **resource
  loading** (`.pi` entries, skills), not tool calls. Extension API exposes only
  `ctx.isProjectTrusted()`.
- `pi auth print-api-key` / `print-bearer-token` prints provider credentials to any process
  running as the user.

## Claude Code

(From current docs: permission-modes, permissions, hooks, headless, env-vars pages.)

- **Trust dialog** fires in interactive sessions only; not inherited from parent directories.
  Pre-trust is mechanical: write `projects.<path>.hasTrustDialogAccepted: true` into the
  config state file (`~/.claude.json`, or its equivalent under `CLAUDE_CONFIG_DIR`).
- **Permission modes**: `acceptEdits` still prompts for Bash commands outside a fixed
  filesystem set (confirmed root cause of legacy factory failure #64). `dontAsk` auto-denies
  anything not matched by allow rules — no prompt paths, so no interactive-pane hangs.
  `bypassPermissions` approves everything except deny/ask rules and the `rm -rf` circuit
  breaker. In `-p`/stream-json sessions, would-be prompts deny instead of hanging.
- **Rules**: `permissions.{deny,ask,allow}` with deny > ask > allow, absolute — a deny cannot
  be carved out by a narrower allow. Bash prefix matching (`Bash(git push*)`) works.
  Per-session injection via `--settings <file-or-json>`.
- **Isolation**: `CLAUDE_CONFIG_DIR` replaces `~/.claude` entirely (settings, skills, hooks,
  global CLAUDE.md — and on Linux, credentials, so an isolated config dir needs its own auth).
  `--plugin-dir` still works under isolation. `--bare` skips project auto-discovery.
- **Hooks**: an orchestrator-injected PreToolUse hook can deny mechanically
  (exit 2 / `permissionDecision: deny`); hook allows cannot override settings denies.
- **Read-only recipes**: plan mode (read-only shell set available, edits blocked) or
  deny rules on Edit/Write/NotebookEdit + Bash mutations.

## Ambient credentials on this host

Any process running as this user — hence any worker with a bash tool, under any permission
mode short of a real sandbox — can read:

- `~/.config/tea/` (config.yml + credentials.json.enc; tea decrypts for any invocation
  by this user) — a full-mutation Gitea login.
- `~/.pi/agent/auth.json` and the `pi auth print-*` commands — provider credentials.
- `~/.ssh/` private keys; the `gitea` remote is SSH, so **push authority is ambient**.
- No `~/.git-credentials`, no credential helper configured for this repo.

File modes (0700/0600) protect against other users, not against same-user agents.
**Load-bearing conclusion: on this host, worker permission configuration constrains
_behavior_, never _capability_.** The guarantee that nothing unverified is published is the
controller's integration gate (#80), not worker-side permissions.

## Legacy precedent (independently justified keepers)

- software-factory validated permission modes against an allowlist that **rejects
  `bypassPermissions`** (`lib/config.mjs`; negative test in
  `tests/node/software_factory_config.test.mjs`).
- Reviewer read-only: Claude `--permission-mode plan` + `--disallowedTools
  Edit,Write,NotebookEdit`; pi `--exclude-tools edit,write` (bash retained).
- Git-state guard around review: capture clean-worktree + HEAD before, re-verify after,
  typed `FactoryReviewMutationError` (`lib/git.mjs:79-96`) — mechanical mutation detection.
- No token passing to workers; Gitea via `tea --login`, git push via ambient SSH.
- job-pipeline gated nothing beyond pi tool lists; reviewer read-only was prompting only —
  listed in the foundations survey as anti-inheritance.
