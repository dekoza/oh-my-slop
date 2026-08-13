# Survey addendum: Claude Code mechanical skill-inventory surfaces (2026-08-13)

**Status:** Decision evidence for the Gitea ticket **“Define worker launch, skill invocation,
and typed completion”** in the Wayfinder map **“Specify a reliable Software Factory”**.
Verified live against Claude Code 2.1.229 with a throwaway one-skill plugin; no model
invocation was made (zero API cost). Complements
[`software-factory-foundations-2026-08-13.md`](software-factory-foundations-2026-08-13.md),
which had left the Claude post-launch inventory mechanism unverified.

## Question

Does Claude Code offer a mechanical, non-interactive way for an orchestrator to verify which
skills are registered in a session launched with `--plugin-dir <path>` — the analogue of pi's
RPC `skill:<name>` command records?

## Verdict

Yes — two verified surfaces, one static and one session-level. The previously hypothesized
“proxy chain” (validation + trace forensics) is unnecessary.

### Surface 1 — static component inventory (pre-session)

```sh
claude --plugin-dir <path> plugin details <plugin-name>
```

`--plugin-dir` is a **global** flag and must precede the subcommand
(`claude plugin details --plugin-dir …` fails with `unknown option`). Output is a component
inventory (Skills / Agents / Hooks / MCP servers / LSP servers) produced by the same loader a
session uses, with `Source: <name>@inline`. Exit 0 on success, 1 when the plugin cannot be
resolved. There is no `--json` flag on `details` (verified: `error: unknown option '--json'`);
the text must be parsed. This answers “would this plugin's skills register”, not “did this
session register them”.

### Surface 2 — in-session registry via `initialize` control request (authoritative)

```sh
printf '%s\n' '{"type":"control_request","request_id":"req-1","request":{"subtype":"initialize"}}' \
  | claude -p --verbose --input-format stream-json --output-format stream-json --plugin-dir <path>
```

`--verbose` is mandatory (`--print` + `stream-json` errors without it). The process answers
with a `control_response` (`response.subtype: "success"`) whose `response.response` includes a
structured `commands` array; a registered plugin skill appears as a record such as:

```json
{"name": "testplug:hello-probe", "description": "(testplug) A probe skill for inventory testing", "argumentHint": "", "aliases": ["hello-probe"]}
```

No user message is processed: the observed frames were hook events plus the control response
only — no assistant/result frames, hence no API cost. Corroborating static evidence from the
installed binary: the stream-json `init` frame is built with
`slash_commands: e.commands.filter(i=>i.userInvocable!==!1).map(i=>i.name)`, but that frame is
emitted only once a (paid) user turn is processed and is **not** emitted on closed stdin — the
`initialize` control request is the free path.

## Caveats

- The probe must use the **same flag set** as the production session: `--disable-slash-commands`
  (“Disable all skills”), `--safe-mode`, or bare-mode settings change the registry.
- `claude plugin list --json` covers installed plugins only; it does not see `--plugin-dir`
  session plugins.
- `claude plugin validate <path> --strict` (exit 1 on warnings) validates the manifest and
  structure, not registration; it remains the first gate, not the last.

## Recommended orchestrator recipe

1. `claude plugin validate --strict "$PLUGIN_ROOT"` — artifact gate.
2. `claude --plugin-dir "$PLUGIN_ROOT" plugin details <name>` — expected-vs-actual component diff.
3. `initialize` control-request probe with production flags — authoritative session-level gate,
   asserting every required `<plugin>:<skill>` command record before any ticket is claimed.
