#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { renderHuman, renderJson, runCli } from "../lib/cli/main.mjs";

// Running this binary inside a repo is itself the trust act (§10.2): there is no
// replacement for pi's project-trust gate, because the operator's own shell is
// the gate.
// `env` is the operator's environment as this shell carries it: the detached
// launch spawns Herdr commands into it (so the socket path, the pane's
// HERDR_* injections, and everything else the operator's own `herdr` uses
// resolve identically), and the foreground controller reads HERDR_PANE_ID
// from it to record the pane it runs in.
// §11.7's anchor: the running executable is the package the handshake digests
// and the command a detached launch names in its pane — the operator's
// invocation may be a relative path or a PATH lookup, so the record carries
// the resolved one.
const executable = realpathSync(process.argv[1]);
const { exitCode, value, json } = await runCli(process.argv.slice(2), { cwd: process.cwd(), env: process.env, executable });

const rendered = json ? `${renderJson(value)}\n` : renderHuman(value);
// JSON always goes to stdout so `factory <verb> --json > out.json` captures the
// contract whatever the exit code; human refusals go where humans read errors.
if (json || value.ok) process.stdout.write(rendered);
else process.stderr.write(rendered);

process.exit(exitCode);
