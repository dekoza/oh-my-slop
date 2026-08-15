#!/usr/bin/env node
import { renderHuman, renderJson, runCli } from "../lib/cli/main.mjs";

// Running this binary inside a repo is itself the trust act (§10.2): there is no
// replacement for pi's project-trust gate, because the operator's own shell is
// the gate.
const { exitCode, value, json } = await runCli(process.argv.slice(2), { cwd: process.cwd() });

const rendered = json ? `${renderJson(value)}\n` : renderHuman(value);
// JSON always goes to stdout so `factory <verb> --json > out.json` captures the
// contract whatever the exit code; human refusals go where humans read errors.
if (json || value.ok) process.stdout.write(rendered);
else process.stderr.write(rendered);

process.exit(exitCode);
