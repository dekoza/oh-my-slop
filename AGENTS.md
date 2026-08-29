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

`tests/live/` is deliberately outside that glob: those scripts probe a running Herdr server and
one of them starts a paid model session. Run them by hand, never from a suite — see
`tests/live/README.md`.

`tests/live/prove-skill-loading.mjs` is one of them: it spends one short model turn per cell to
take §6.7's skill-loading acceptance matrix, and records the result under `docs/proofs/`. What the
matrix *concludes* — the contract, the judgement, the claim assessment, the document — is
`factory/lib/proof/`, held by `tests/node/factory_proof_*.test.mjs`; the runner itself is wiring
and spending, and is not covered by a test.

Targeted minimums:

- Any change under `skills/` or to markdown references: `uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py`
- Any change under `prompts/`: `uv run pytest tests/test_prompt_templates.py tests/test_readme.py`
- Any change under `extensions/` or to package entrypoints: `node --test tests/node/*.mjs`
- Any change under `factory/`: `node --test tests/node/factory_*.test.mjs`
- Any change to `factory/AGENTS.md`: `uv run pytest tests/test_factory_agents_index.py`
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

The Software Factory's operator binary — and the one surface whose rules do not live in this
file. [`factory/AGENTS.md`](factory/AGENTS.md) holds them, beside the code they bind; read it
before changing anything under `factory/`, and read it as a reviewer too, since findings about
factory code cite it. [`docs/specs/software-factory.md`](docs/specs/software-factory.md) is the
authority above both; cite the section a change answers to.

That file is an **index**, not a narrative: one row per invariant, naming the module that owns it
and the spec section it answers to, with the reasoning left in the spec and in the module's own
comments. A new invariant is a new row. `tests/test_factory_agents_index.py` holds that shape and
a line ceiling, so the section cannot go back to growing a paragraph per ticket.

The mandatory commands above stay here: `factory/lib/migrate/matrix.mjs` reads this file's
`## Mandatory commands` section at the repository root, once, at migration (§11.6).

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
