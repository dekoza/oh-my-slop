# enterprise-patterns trigger-eval — §4 case 3 (new model-invoked skill)

New skills enter the library with trigger-eval coverage from day one. This gates the
`enterprise-patterns` description against both under-triggering on its own ground and
over-triggering onto the sibling skills it defers to (domain-driven-design, data-intensive,
django, drf, production-readiness).

- Harness: `skill-creator/scripts/run_eval.py`, 3 runs/query.
- Model: `anthropic/claude-opus-4-8` (the session model — the harness reads all-zeros
  under the default opencode model).
- Eval set: `trigger-evals.json` — 10 infrastructure-decision positives, 9 near-miss
  negatives owned by sibling skills (DB isolation/write-skew → data-intensive, ORM N+1 →
  django, serializer shape → drf, aggregate/ubiquitous-language → domain-driven-design,
  retry/timeout → production-readiness) plus unrelated tasks.

| Description | Passed | Notable |
|---|---|---|
| **v1** (defers domain modeling to DDD only) | 18/19 | "database isolation level … write skew" over-triggered 2/3 — the data-intensive boundary blurred by the shared word "concurrency" |
| **v2** (also hands database isolation/transactions to data-intensive) | **19/19** | isolation/write-skew now 0/3; all 10 positives still 3/3, every other negative 0/3 |

The v2 fix adds one clause — "database isolation/transactions to data-intensive" — to the
deference sentence. It draws the line the body already draws in the concurrency-and-sessions
reference (offline, cross-request locking is this skill's ground; in-transaction isolation is
data-intensive's), so the description and the reference now agree. Positive triggering on the force-based business-logic choice, offline locks,
Unit of Work / Identity Map, session-state placement, Remote Facade, and the
generic-repository blocker is unaffected.
