Findings written to `/home/minder/projekty/oh-my-slop/context.md`. Here's the summary:

## ponytail-audit

- **Type**: Slash command (`/ponytail-audit`) → skill, one-shot report
- **Input**: Entire repo tree (all source files)
- **Scans for**: Over-engineering — dead code, reinvented stdlib, unneeded deps, speculative abstractions, single-implementation interfaces, wrappers that only delegate, dead flags/config
- **Markers**: None — reads all source files, no special comments needed
- **Output**: One line per finding, ranked biggest-cut-first: `<tag> <what to cut>. <replacement>. [path]` with tags `delete`, `stdlib`, `native`, `yagni`, `shrink`. Ends with `net: -<N> lines, -<M> deps possible.`
- **Side effects**: None — read-only

## ponytail-debt

- **Type**: Slash command (`/ponytail-debt`) → skill, one-shot report
- **Input**: Grep for `ponytail:` comment markers across the repo (`grep -rnE '(#|//) ?ponytail:' .`)
- **Scans for**: Deliberate shortcuts left by ponytail, tracked via `ponytail: <ceiling>, <upgrade path>` comments
- **Output**: One row per marker grouped by file: `<file>:<line>, <what was simplified>. ceiling: <limit>. upgrade: <trigger>.` Flags `no-trigger` on comments missing an upgrade path. Ends with `<N> markers, <M> with no trigger.`
- **Side effects**: None — read-only (optionally writes `PONYTAIL-DEBT.md` if asked)

**Key relationship**: `ponytail-audit` is proactive (find bloat anywhere), `ponytail-debt` is retrospective (track shortcuts ponytail already left behind). Both are slash commands wired through the skill system, not standalone CLI tools.