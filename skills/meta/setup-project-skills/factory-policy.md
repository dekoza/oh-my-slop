# Software factory policy details

Read during Section D before drafting an accepted factory configuration. The example
JSON and the write/verification steps remain in `SKILL.md`.

**Write the current schema, `schemaVersion: 2`.** `factory migrate` is for configs written
before that schema existed and is never a step in a fresh setup — it deliberately leaves
`TODO` holes the loader hard-fails on (the checks, the concurrency sizes, the automation
budget) for a human to fill in by hand. A setup run has those answers in front of it, so it
asks for them and emits a file that loads on the first verb. A run that ends with the user
having to run `migrate` and hand-edit holes is this section failing.

The loader refuses every key it does not understand and defaults almost nothing, so these
blocks are **asked for or scaffolded, never emitted as holes**:

- **`checks`** — the mechanical commands the controller reruns itself. Each one declares all
  five required fields: `name` (lower-case identifier), `command`, `timeout` (whole seconds),
  `severity` (`required` or `advisory`), and `expectedFailureExitCodes`; an advisory check may
  also declare `feeds`. Nothing here is discovered or defaulted, `expectedFailureExitCodes`
  least of all: it is the only line between "the worker's code failed this check" and "this
  check is broken", and pytest, ruff, tsc and a shell script do not agree on it. Seed the list
  from the repo's `## Mandatory commands` section in `AGENTS.md` when it has one — that is the
  same section `factory migrate` reads — otherwise from its Justfile, Makefile, or CI workflow,
  and confirm every field with the user.
- **`concurrency`** — `maxTicketExecutions` (currently capped at 1; the loader refuses more)
  plus a `resources` map of resource class → slot count.
- **`budgets`** — `repair`, `freshRetry`, and `automation`, each 1 or 2, plus
  `circuitBreaker`. These do have upstream defaults, but write them out: the automation
  budget is the one number a migrated file cannot supply, and a config that states it is one
  fewer thing for the operator to discover from a refusal.
- **`routing`** — `roles` naming a profile for `implement`, `freshRetry`, and `review`
  (a **two-element pair**, one per review axis), plus `rules` written out even when empty.
  There is no `finalReview` role and no implicit fallback between roles.

`tracker.labels` is **not** written. The factory's label vocabulary is fixed constants in the
binary's own code — per-install names would make the tracker graph un-auditable across repos
— and a config carrying that key is refused by name. Section B's label answers still govern
the workflow skills; they just do not reach this file.

Three traps are worth spending a question on, because each one produces a file that looks
right and costs real time:

1. **Scaffold check commands in their runner-prefixed form.** A command naming a
   dev-dependency binary directly — `just test unit`, `pytest`, `ruff check` — exits 127
   when that binary is not on the controller's `PATH`, and the runner classifies 127 as
   `exec-not-found`: the check is unrunnable, which is not the same outcome as failing. In a
   uv project the form that always works is `uv run just test unit`. Read the runner off the
   project (`uv`, `poetry run`, `npm run`, `pnpm exec`) and write the command through it,
   even when it works in your own shell.
2. **Derive `concurrency.resources` from the profiles you just wrote, never from a menu.**
   A class is `claude-code` for every `kind: claude` profile, and the provider segment of
   the model selector for every `kind: pi` one — `local` for `local/qwen3`, `openrouter` for
   `openrouter/z-ai/glm-5.2`. (A profile binding an `endpoint` derives its class from that
   address instead; a setup run writes none.) Size exactly the classes the routing reaches:
   an unsized class the active routing reaches refuses the load, and so does a sized class
   no declared routing set reaches ("Dead config lies about what will run"). Writing a
   `local` resource beside a routing that only names Claude profiles produces a file that
   cannot load.
3. **`severity` says what a red result does; `feeds` says what it costs.** A required check
   runs on every verify — after every implement *and* after every repair — and is the set the
   pre-run baseline executes. An advisory check is paid for where its evidence is read, and
   the `feeds` list is what states that: one that feeds a later phase runs on every verify
   too, because its captured output reaches the next prompt; one that feeds nothing runs
   **once per published ticket**, at the publication boundary, where the attestation a human
   opens is its only reader. So a ten-minute browser tier declared advisory with no `feeds`
   costs ten minutes a ticket rather than thirty on a ticket that takes two repair rounds —
   and the tradeoff is that its result appears on the pull request rather than mid-attempt.
   Give a check `feeds` when a worker or a repair must actually see its output; leave it off
   when only the reader of the PR will. What the list still makes you decide first is whether
   the check belongs in `checks` at all: a long tier nobody reads belongs in CI outside the
   factory, and saying so is a better answer than any severity.
