---
name: skill-loading-proof
description: >
  Use only when asked for a skill-loading receipt for a named proof nonce — the software
  factory's acceptance matrix asking a model to prove it loaded this body rather than merely
  registering the skill. Triggers on: "skill-loading proof nonce", "emit the skill-loading
  receipt", "factory skill-loading proof". It answers with one receipt line and nothing else,
  and no other work uses it.
license: MIT
---

# Skill loading proof

This skill exists to be **followed**, and for nothing else. It ships in the package so that
`docs/specs/software-factory.md` §6.7's acceptance matrix can prove — per harness version, model,
and package revision — that a model loads a skill body and acts on it, rather than merely
registering the skill's name.

## The contract

```factory-proof-contract
marker  SKILL-LOADING-PROOF
token   ptarmigan-4417-lodestar
rule    reverse-upper
```

`reverse-upper` means: take the proof nonce's characters **in reverse order** and **upper-case**
them. Nothing else is done to it — no separators are added or removed, and no character is
translated.

## What to do

You were given a **proof nonce**: a short string of lowercase letters and digits.

Reply with **exactly one line**, and no other text before or after it:

```
SKILL-LOADING-PROOF ptarmigan-4417-lodestar <answer>
```

where `<answer>` is the nonce under `reverse-upper`. For the nonce `a1b2c3`, the line is:

```
SKILL-LOADING-PROOF ptarmigan-4417-lodestar 3C2B1A
```

**Use no tools.** Everything needed is on this page, so a file read, a search, or a shell command
is evidence that the body did not reach you natively — which is the one thing this proof is
measuring. Do not explain the answer, restate the rule, or offer to do anything further.

If no proof nonce was given, say so in one sentence and emit no receipt line. A receipt for a
nonce nobody asked about proves nothing.
