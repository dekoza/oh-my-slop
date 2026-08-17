# Proofs

Recorded results of the acceptance obligations that **cost model tokens** and therefore cannot
live in a suite. Each file states what was proven, against exactly which harness version, resolved
model id and package tree digest, and how to take the proof again.

A proof here is a statement about **one point** on its axes. Any axis moving — a new harness
version, a different model, a changed package revision — makes an existing document a statement
about a point nothing runs at any more, and the answer is a new document beside it rather than an
edit to the old one.

| Proof | Runner | Obligation |
|---|---|---|
| `skill-loading-claude-<version>-<digest>.md` | `node tests/live/prove-skill-loading.mjs` | [`docs/specs/software-factory.md`](../specs/software-factory.md) §6.7 / §15 — that Opus and Fable **load and follow** a skill body, not merely register its name |

**§6.7 is the authority on what the skill-loading matrix means and why its mechanism is the one it
is.** It is not restated here: a reader deciding whether a result is worth anything should be
reading the specification the result answers to, and a second description would be one more copy
to keep true. Each document states its own axes, its own verdicts, and the claims it leaves
unverified.

What each proof carries, and what it does not: the judgement, the claim assessment and the
rendering live in `factory/lib/proof/` and are held by `tests/node/factory_proof_*.test.mjs`. The
runner is wiring and spending, and is not itself covered by a test.
