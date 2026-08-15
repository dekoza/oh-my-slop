# Repository AGENTS.md

This file is the repo-specific guide for agents working in `oh-my-slop`.
It supplements the global `~/.pi/agent/AGENTS.md` rules.
If the two conflict, the global file wins.

## What this repository is

This repo packages:

- `skills/` — curated markdown skills for pi agents
- `prompts/` — slash-command entry points that hand off to those skills
- `extensions/` — TypeScript pi extensions
- `factory/` — the `factory` binary and its plain-ESM libraries, shipped from the root package's `bin`
- `scripts/` — repository maintenance scripts
- `tests/` — Python and Node regression tests for repo invariants
- `README.md`, `package.json`, `pyproject.toml`, `uv.lock` — package metadata and install surfaces

The repo is installed through `pi`, so broken paths, invalid references, or stale manifests are release-blocking defects, not minor cleanup items.

## Mandatory commands

Run these commands when you touch the related areas. Do not skip them.

- Full Python test suite: `uv run pytest`
- Markdown reference validator: `uv run python scripts/validate_refs.py`
- Node extension tests: `node --test tests/node/*.mjs`

Targeted minimums:

- Any change under `skills/` or to markdown references: `uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py`
- Any change under `prompts/`: `uv run pytest tests/test_prompt_templates.py tests/test_readme.py`
- Any change under `extensions/` or to package entrypoints: `node --test tests/node/*.mjs`
- Any change under `factory/`: `node --test tests/node/factory_*.test.mjs`
- Any change to `package.json`, `pyproject.toml`, or installable entrypoints: `uv run pytest tests/test_pi_package_installability.py`
- Any change to `scripts/validate_refs.py`: `uv run pytest tests/test_validate_refs.py`

If a change affects more than one surface, run every relevant command. Do not rely on a single happy-path smoke test.

## Repo-specific rules

### `skills/`

This directory is the core product.

- Skills live in exactly one of four buckets — `skills/reference/`, `skills/practice/`, `skills/workflow/`, `skills/meta/` — and the directory is the authority on which. File by what the reader came looking for: an API surface (reference), a way of working (practice), a job to run (workflow), or the agent's own toolkit (meta). The buckets are a taxonomy, not a promotion tier: everything under `skills/` ships, because pi recurses until it finds a `SKILL.md`.
- Retiring a skill means **deleting** it, in a commit whose message names its replacement — or states plainly that it has none. There is no `deprecated/` bucket; an empty directory kept as a gesture is a lie about the tree.
- Reach for a skill by name, not by path: `find_skill_dir()` in `scripts/validate_refs.py` resolves a name to whichever bucket currently holds it, so re-filing stays a pure move.
- Keep markdown links and backtick references valid.
- Do not invent file paths, reference targets, or API details.
- If you add or rename a reference file, update the owning `SKILL.md` and any tests that assert its content.
- If a skill has `evals/`, keep the evals aligned with the docs. A skill doc change without matching eval updates is incomplete.
- Preserve the repo’s “one skill, one boundary” style. Do not blur unrelated frameworks or topics into the same skill.

### `prompts/`

These are slash-command entry points, not a lighter alternative product.

- A template names the skill it fronts and does nothing else: one handoff sentence of the shape *"Use the `<skill-name>` skill to …"*, plus the argument substitution its frontmatter advertises.
- The skill is the single source of truth. Templates carry **no process text** — no headings, no phases, no vocabulary lists, no output formats, no stopping criteria. Eight templates once sat unmaintained while the skills beneath them were rewritten; `prompts/arch.md` described a flow its skill had not had for three releases.
- Name the skill, never a path. Install roots vary, so an absolute path rots silently while a name can be checked.
- A template whose skill sets `disable-model-invocation: true` adds the fallback clause telling the agent to find that skill's `SKILL.md` in the installed package — the flag strips it from the model's `<available_skills>` listing.
- The reason this surface exists is argument passthrough (`${1:-.}`, `$@`, `$2`), which `/skill:<name>` cannot do. Keep it; it is the whole justification for the file.
- `tests/test_prompt_templates.py` enforces the above. `scripts/validate_refs.py` is deliberately not widened to `prompts/`; under the naming rule there are no paths there to resolve.

### `extensions/`

These are installable pi extensions, so entrypoints matter.

- Keep each extension’s `index.ts` reachable from the declared `pi.extensions` entry.
- Keep nested `package.json` files in sync with the actual entrypoints.
- Do not break relative imports or rename files casually; the extension tests assume resolvable local module graphs.
- If you change extension behavior, update the Node tests in `tests/node/`.
- Do not add placeholder providers, fake registration logic, or speculative configuration knobs.

### `factory/`

The Software Factory's operator binary. [`docs/specs/software-factory.md`](docs/specs/software-factory.md)
is the authority; cite the section a change answers to.

- Plain ESM under Node (`.mjs`), no build step. TypeScript is reserved for the pi
  extension entries under `extensions/`.
- The binary ships from the **root** `package.json`'s `bin` — one package, one version.
  It is never separately installable and never grows its own `package.json`.
- Config is fail-closed and repo-bound: one file at `<repo root>/.pi/factory.json`, no
  `--config`, no env overrides, no merge layering, and no warn-and-continue path.
  `extensions/config-loader.ts`'s fallback-on-parse-error is the failure mode this
  code exists to end — do not reach for it here.
- Exit code `1` means usage or config-load failure and nothing else; `0` and `2`–`6`
  belong to the run end-reason table.
- Defaults exist only in `factory/lib/config/defaults.mjs` (`budgets`, `retention`),
  where an upstream decision already fixed the value. Everywhere else absence refuses —
  a policy the loader fills in is a policy nobody can read on disk.
- Policy that is not configuration lives in code, and each piece is read from exactly
  one place: the label vocabulary in `factory/lib/tracker/labels.mjs`;
  `MAX_SUPPORTED_TICKET_CONCURRENCY` in `factory/lib/config/concurrency.mjs`; the
  closed domain enums — phases, run lifecycles, end reasons, dispositions, attempt
  outcomes — in `factory/lib/domain/vocabulary.mjs`; and the event-kind enumeration in
  `factory/lib/state/events.mjs`. A vocabulary that grows a second home has already
  started to drift. The scheduler stays capacity-parametric and never reads the
  ceiling — that is what makes raising it a one-line change, and
  `tests/node/factory_config_semantics.test.mjs` guards it.
- Every command answers from one structured value, rendered human by default and
  `--json` on request. A verb that cannot do its job says what is missing; it never
  goes quiet and never half-runs.
- Durable state is one SQLite store per repository under the pi SDK's `getAgentDir()`.
  `node:sqlite` is imported by exactly one module — `factory/lib/state/sqlite.mjs` —
  and `PI_AGENT_DIR` is never read; it is not a pi variable, and the day someone sets
  `PI_CODING_AGENT_DIR` the old spelling splits pi and the factory into two brains.
  `tests/node/factory_state_*.test.mjs` guards both.
- An event and every projection it changes commit in **one** transaction, written from
  one place: `appendEvent` in `factory/lib/state/store.mjs`. That deletes the
  stale-projection failure class rather than detecting it, so no precedence rule
  between journal and projection exists to get wrong. `effect` and `lease` rows are
  canonical rather than projections — they ride the same transaction and are never
  rebuilt from the journal.
- The projection tables are the monitor's versioned read contract. A projector whose
  output changes bumps its `version` in `factory/lib/state/projections.mjs`; the head
  compare at open is fail-closed, and a missing head is a mismatch, never a skipped
  check. A mismatched **reader** refuses that projection alone — `projection-unreadable`
  — and still answers from the rest, because blanking a whole screen over one stale head
  sends the operator back to `sqlite3`.
- Every lock is one row and one compare-and-swap, from `factory/lib/state/leases.mjs`
  and nowhere else. **The holder token is the only ownership proof**: the identity blob
  is advisory, nothing tests a pid, and no path removes a row without comparing the
  token — those two are exactly how the legacy systems failed. Fencing generations come
  from the one DB-wide counter, so they order every lease against every other. **The
  `controller` lease is the only one a clock may free**, and the TTL belongs to the
  lease object rather than to its caller; every other row is settled by its superseded
  generation and a probe, never by elapsed time. A lost controller lease is terminal
  (`factory/lib/controller/lease-guard.mjs`): stop issuing effects, emit, exit non-zero,
  never reacquire.
- **Integrity failure is never repaired.** A damaged database is renamed into
  `quarantine/<stamp>/` byte-for-byte and replaced by a minimal fresh store carrying a
  typed `journal.integrity-failed` fact, so `status` and `doctor` still have somewhere to
  answer from; a hash-chain break scopes to its own stream and costs that run's tier-1
  detail alone. Only projections are rebuildable, only under one of
  `REBUILD_REASONS`, and every rebuild emits its reason, projector versions, and
  resulting head. The store whose compare failed is reachable **only** through
  `openStoreForRebuild`, which carries no `append` and no `transaction` — an
  ordinary append moves every projection head to the event it wrote, so a write
  path there would repair a mismatch without recording anything.
- **`factory/lib/state/truncation.mjs` holds the only two ways a record leaves the
  journal** — whole-stream deletion for a run stream, front-truncation for
  `controller.heartbeat`, recording `stream.truncated {stream, up_to_seq, up_to_hash}` on
  the indefinite `controller` stream. A `DELETE FROM event` anywhere else, or any
  renumbering or rewriting, is §14.7 broken; `tests/node/factory_state_integrity.test.mjs`
  greps the tree for it. A global sequence hole is the expected residue and is never read
  as tampering — only per-stream contiguity is verified.
- Every mutation outside the database is an effect: a requested/resolved pair keyed by
  §4.5's grammar, built in one place (`factory/lib/effects/keys.mjs`) and written in
  one place (`records.mjs`). A new effect kind is a row in `effects/catalogue.mjs` and
  nothing else — **an effect kind with no probe cannot be registered**, refused at
  construction, which is what keeps §5.3's reconciliation invariant structural rather
  than a review convention. **Reads are not effects**: they appear in the catalogue
  only as a probe's `call`, and get durable observation cursors instead.
- The payload digest sits **beside** the effect key, never in it. Re-issuing a key with
  an identical payload returns the committed result; a different payload is a typed
  conflict. Keying by the digest would turn that conflict into a different key and two
  mutations nobody compared.
- **An artifact is never referenced by path** — only by digest, through §12.1's ledger.
  Everything in `factory/lib/artifacts/` takes content or an address (an algorithm from a
  closed set plus a fixed-shape digest) and never a location, so the audited `../` escape is
  not a thing the API can *express* rather than a thing it checks for. The ledger row is
  canonical like `effect` and `lease`, keyed by the content: two productions of identical
  bytes are one blob and one row, stamped with the later producer so expiry reclaims it
  exactly once and no reference counting exists. The retention class is **derived** from the
  producer rather than passed, and byte accounting per class is a `GROUP BY` over the ledger
  — never a second tally to keep in step. Large output goes in as bytes and comes back as
  §6.6's reference (digest, media type, byte count, producer, class); the bytes themselves
  never enter an outbox or an event payload.
- The package handshake (`factory/lib/package/`) resolves §11.7's four participating
  artifacts — the binary, the factory extension, the monitor extension when present, and
  the skills root — from the **one manifest that declares them**, and proves they are one
  package. The **running executable is the anchor**: a configured package root would be one
  more thing that can disagree with what is executing. The deterministic tree digest is
  authoritative uniformly for every install shape, with the git commit and a dirty flag
  recorded beside it as **metadata only** — checkouts are never special-cased, because that
  would make dev runs incomparable to installed runs. Findings are **data rather than
  exceptions**, since `doctor` runs the same handshake in report mode (§10.5);
  `assertPackageIntact` is the one place they become the automation failure before first
  claim, and §14.35's split across roots has no severity ladder and no compatibility pass.
  `package.expect` declares a name and a version — exact or a range from npm's common
  subset — and nothing else: a hand-declared digest is refused at load, because the digest
  is observed and would be unmaintainable in development.

### `scripts/`

These scripts enforce repository invariants.

- Treat `scripts/validate_refs.py` as an authority for markdown reference integrity.
- If you change how references are parsed or resolved, add tests for the new behavior.
- `scripts/link-skills.sh` exists because skill discovery is not portable. pi recurses until it finds a `SKILL.md`, so the buckets cost it nothing; Claude Code scans exactly one level of `~/.claude/skills`, so a bucket symlinked in whole resolves fine and silently hides every skill inside it. Do not assume a change to the `skills/` layout is invisible to consumers — it is invisible to pi, and load-bearing for anything that scans one level.
- Keep script output explicit and machine-readable where possible; the tests depend on predictable failures.

### `tests/`

Tests are part of the contract, not decoration.

- Prefer real filesystem fixtures and subprocess-backed checks over heavy mocking.
- Add regression tests when you fix a bug. If the bug was caused by a bad assumption, encode that assumption in a test.
- Keep Python tests runnable with `uv run pytest`.
- Keep Node extension tests runnable with plain `node --test`.
- Do not write tests that only restate implementation details; test the repository behavior that users rely on.

### Package metadata

These files are install surfaces, not arbitrary config.

- `package.json` must keep the `pi.extensions` list accurate.
- `pyproject.toml` and `uv.lock` must stay consistent.
- Avoid editing manifests without checking the tests that validate installability and entrypoint exposure.

## File hygiene

- Do not edit generated caches such as `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, or other build artifacts.
- Do not delete or overwrite untracked files unless the user explicitly asks.
- Before removing anything, inspect `git status` and confirm the path is safe.
- Do not use blanket cleanup commands that can destroy user work.

## Change discipline

- Keep changes small and coherent.
- Do not mix unrelated fixes into one edit.
- If you notice a real problem outside the requested scope, report it instead of bundling it silently.
- Commit in logical units. This repo is actively used; half-finished work should not linger uncommitted.

## Protected surfaces

These are contracts with the outside — consumer repos, muscle memory, installed
packages. Changing one requires a stated migration path (a commit message naming the
replacement, a survey note, or a README callout) — never a silent rename:

- **Skill names** — consumer repos reference them from `CLAUDE.md`/`AGENTS.md` after
  `/setup-project-skills`, and everything here resolves skills by name
  (`find_skill_dir()`). Bucket moves are free; renames are breaking.
- **Prompt-template names** — the `/command` surface: muscle memory plus README rows.
- **The `docs/agents/` contract** — the file names, the `## Agent skills` pointer
  block, and the tracker templates' load-bearing headings (`## Conventions` ·
  `## Robot comments` · the two "when a skill says…" headings · `## Wayfinding
  operations`) that consumer skills dereference in installed repos.
- **Install surfaces** — `package.json`'s `pi` block and each extension's declared
  entrypoint.

## Practical review checklist

Before finishing a task, verify:

- markdown references still resolve
- package manifests still match real entrypoints
- affected tests were run
- new files are intentional and documented
- no cache or generated files were touched by accident

## Agent skills

### Issue tracker

Agent work lives on Gitea (`minder/oh-my-slop`, via `tea`); GitHub (`dekoza/oh-my-slop`)
is intake-only for human-filed issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical default vocabulary — each label string equals its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. `CONTEXT.md` holds the
workflow vocabulary; the skill-authoring vocabulary lives in
`skills/meta/writing-great-skills/GLOSSARY.md`. See `docs/agents/domain.md`.
