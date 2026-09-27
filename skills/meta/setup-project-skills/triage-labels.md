# Triage labels

The skills speak in terms of canonical triage roles. This file maps each role to the
actual label string used in this repo's tracker.

## State roles

| Canonical role | Label in our tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Missing information or unfinished construction refinement |
| `ready-for-agent` | `ready-for-agent` | Fully specified and authorized for agent work under project policy |
| `ready-for-human` | `ready-for-human` | Requires human action or judgement |
| `wontfix` | `wontfix` | Will not be actioned |

## Category roles

| Canonical role | Label in our tracker | Meaning                     |
| -------------- | -------------------- | --------------------------- |
| `bug`          | `bug`                | Something behaves wrongly   |
| `enhancement`  | `enhancement`        | New capability or improvement |

When a skill names a role — "apply the agent-ready triage label" — use the
corresponding string from the right-hand column. Edit that column to match whatever
vocabulary you actually use; leave it identical to the left to accept the defaults.

Labels must exist before they can be applied. On Gitea, create them with
`tea labels create --name "..." --color "..."`; on GitHub, `gh label create`.

## Workflow labels

`workflow:implement` records implementation routing, not readiness or authorization.
Workflow and state are separate: keep one state role alongside it.
`needs-info` + `workflow:implement` is a valid non-dispatchable implementation
proposal: record each missing input or refinement with its owner and next action. Agent-discoverable facts belong to the agent, not
an unnecessary question to the reporter. When only human judgement or authorization
remains, use `ready-for-human`; change state only under the project's authority rules.
Prerequisites, active claims and other execution gates remain independent of labels.

Use `/refine-ticket <ticket-number>` or `/humanify <ticket>` to finish preparation
and record explicit human-authorized agent readiness. Publication approval alone
is not readiness approval; `/implement` starts separately. Explicitly human-only
steps and terminal reviews keep their own outcomes, not an invented code handoff.
This adds no label vocabulary and changes no factory eligibility rule.

## Wayfinder labels

`/wayfinder` uses its own namespace, unaffected by the mapping above: `wayfinder:map`
for a map, and `wayfinder:<type>` on each decision ticket where type is `research`,
`prototype`, `grilling`, or `task`. These labels route decision work; they do not
mark implementation tickets.
