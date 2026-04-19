# Repository AGENTS.md

This file is the repo-specific guide for agents working in `oh-my-slop`.
It supplements the global `/home/minder/.pi/agent/AGENTS.md` rules.
If the two conflict, the global file wins.

## What this repository is

This repo packages:

- `skills/` — curated markdown skills for pi agents
- `extensions/` — TypeScript pi extensions
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

- Any change under `skills/` or to markdown references: `uv run pytest tests/test_validate_refs.py`
- Any change under `extensions/` or to package entrypoints: `node --test tests/node/*.mjs`
- Any change to `package.json`, `pyproject.toml`, or installable entrypoints: `uv run pytest tests/test_pi_package_installability.py`
- Any change to `scripts/validate_refs.py`: `uv run pytest tests/test_validate_refs.py`

If a change affects more than one surface, run every relevant command. Do not rely on a single happy-path smoke test.

## Repo-specific rules

### `skills/`

This directory is the core product.

- Keep markdown links and backtick references valid.
- Do not invent file paths, reference targets, or API details.
- If you add or rename a reference file, update the owning `SKILL.md` and any tests that assert its content.
- If a skill has `evals/`, keep the evals aligned with the docs. A skill doc change without matching eval updates is incomplete.
- Preserve the repo’s “one skill, one boundary” style. Do not blur unrelated frameworks or topics into the same skill.

### `extensions/`

These are installable pi extensions, so entrypoints matter.

- Keep each extension’s `index.ts` reachable from the declared `pi.extensions` entry.
- Keep nested `package.json` files in sync with the actual entrypoints.
- Do not break relative imports or rename files casually; the extension tests assume resolvable local module graphs.
- If you change extension behavior, update the Node tests in `tests/node/`.
- Do not add placeholder providers, fake registration logic, or speculative configuration knobs.

### `scripts/`

These scripts enforce repository invariants.

- Treat `scripts/validate_refs.py` as an authority for markdown reference integrity.
- If you change how references are parsed or resolved, add tests for the new behavior.
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

## Practical review checklist

Before finishing a task, verify:

- markdown references still resolve
- package manifests still match real entrypoints
- affected tests were run
- new files are intentional and documented
- no cache or generated files were touched by accident
