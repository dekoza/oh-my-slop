---
id: n-25fc91fa
title: "Monitor UI hierarchy: tracker graph spine with vertical stage stacks (B)"
type: decision
authored_at: 2026-08-13T15:05:06.096417+02:00
status: active
summary: "#71 verdict: tracker DAG is the monitor's spine; runs are overlay selectors; runtime phases unfold per ticket as vertical clickable stage stacks opening a stage inspector; frozen styling for unresponsive runs; runtime never styled as tracker tickets."
tags: [software-factory, monitor, ui, wayfinder]
---

Wayfinder ticket #71 (map #67, Software Factory monitor) resolved by prototype: three variants judged (A run ledger, B tracker wall, C event river); **B won** after two correction rounds — vertical full-width stage stacks instead of horizontal chip chains, and frozen (amber ❄ dashed) styling for `running` phases inside unresponsive runs instead of the live pulse.

Locked for the spec (#74): tracker graph primary; run history a secondary overlay selector; timeline scoped per ticket/stage, full ticket timeline secondary; transcript excerpts on-demand with source provenance (pi jsonl vs Claude jsonl, never Herdr pane capture); runtime phases always visually distinct from tracker tickets. C's source facets + inline excerpts noted as steal-worthy if a river view returns as the history surface.

Confidence medium: synthetic data shaped by the #68 survey, one judge; hierarchy locked, concrete layered layout a starting point. Primary source: branch `prototype/monitor-ui-71` (prototype HTML + NOTES.md); main keeps only the decision.
