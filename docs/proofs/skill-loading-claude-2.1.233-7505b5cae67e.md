# Skill-loading acceptance matrix — claude 2.1.233, `7505b5cae67e`

Taken 2026-08-17T23:16:31.265Z. This is §6.7's one-time deep proof for one point on its three axes:
**harness version × model × package revision**. It is not preflight — §6.2's probe proves registration and
invocation echo at zero model cost before every run, and this proves *following*, at the cost of real turns.

## What it was proven against

| | |
|---|---|
| harness | `claude`, version **2.1.233** |
| package revision | `sha256:7505b5cae67ef4caa92bbfb5310ec3325a8650b99d419eadf96f3229cc081ffc` (867 files) |
| checkout | commit `aef7a3cdf418662b78397b179248c8ea0ff1de66`, worktree **dirty** (metadata only, §11.7) |
| session surface | headless |
| plugin | `oh-my-slop`, built by the package's own generator from the revision above |
| contract | marker `SKILL-LOADING-PROOF`, token `ptarmigan-4417-lodestar`, rule `reverse-upper` |

The contract is read out of the shipped `skills/meta/skill-loading-proof/SKILL.md` — the same bytes the tree
digest above covers and the model was given. No prompt in this matrix carries the token, the rule, or the
answer; a receipt line is therefore a body that reached the model, and a correct one is a body it followed.

The digest is the working tree as it stood when the cells ran, which is **before this document existed**.
Committing the document moves the tree on by one file; that is the ordinary revision drift the three axes
describe, and not a mismatch.

## The matrix

| model | resolved id | case | verdict | tools in trace |
|---|---|---|---|---|
| `opus` | `claude-opus-5` | direct-invocation | **followed** | none |
| `opus` | `claude-opus-5` | model-invocation | **followed** | none |
| `opus` | `claude-opus-5` | trace-control | **read-not-loaded** | Read |
| `fable` | `claude-fable-5` | direct-invocation | **followed** | none |
| `fable` | `claude-fable-5` | model-invocation | **followed** | none |
| `fable` | `claude-fable-5` | trace-control | **read-not-loaded** | Read |

`followed` is the receipt, exact, with no filesystem tool in the trace. `read-not-loaded` is the same receipt
reached by reading the file — the outcome the `trace-control` cells are *supposed* to reach, and the reason the
other cells' empty trace column is evidence rather than an assumption.

## Survey claims discharged

- **Opus and Fable actually load and follow the named skills from the proposed plugin artifact.**
  - 2 `direct-invocation` cells, all `followed`.
- **Account entitlement and actual resolution of the `opus` and `fable` aliases; CLI help proves accepted syntax, not access.**
  - Every cell answered under a resolved id: opus → claude-opus-5, fable → claude-fable-5.
- **Whether traces expose enough evidence to distinguish native Skill loading from a model merely reading a path.**
  - 2 control cells show the read in the trace (Read), and all 4 invoked cells show none.

## Still unverified

- **Successful execution of the documented `/plugin-name:skill-name` command from a session-local plugin in interactive versus headless Claude workers.**
  - The claim is about headless and interactive workers, and every cell here ran headless: the cell binding is the worker binding **plus** the probe-only stream-json IO flags, which is a `--print` session. §6.4 runs every real worker attempt in an interactive pane, so interactive is the half this matrix cannot reach — and the load-bearing one.
  - *What this matrix did establish:* The headless half is proven: every `direct-invocation` cell executed the documented `<plugin>:<skill>` command from a session-local plugin and followed the body it loaded.
- **Skill-trigger consistency across Claude Code versions and between Opus and Fable.**
  - The claim is about consistency across harness versions, and one matrix records one: 2.1.233. It is discharged, if ever, by comparing this document with the next one — never from inside either.
  - *What this matrix did establish:* Between the models: every `model-invocation` cell triggered on the description alone, naming no skill.
- **The complete transitive skill set needed by each factory role under arbitrary consumer instructions.**
  - No cell in this matrix speaks to it.

## Re-running it

Any of the three axes moving — a new harness version, a different model, a changed package revision — makes
this document a statement about a point nothing runs at any more. Take it again:

```sh
node tests/live/prove-skill-loading.mjs --out docs/proofs/
```

The runner builds the §6.3 plugin from the working tree, resolves the tree digest, and runs every cell under
the **worker** binding — the argv a worker pane receives, plus the probe-only stream-json IO flags and nothing
else (§6.2's composed-binding rule, amendment row #160). It writes one document per (version × revision), so
an earlier matrix is never overwritten by a later one.

**It spends model tokens** — one short turn per cell — which is why it is a script run by hand and not a check
in any suite.
