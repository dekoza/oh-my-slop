# Triage labels

The skills speak in terms of canonical triage roles. This file maps each role to the
actual label string used in this repo's tracker.

## State roles

| Canonical role    | Label in our tracker | Meaning                                  |
| ----------------- | -------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`    | Requires human implementation            |
| `wontfix`         | `wontfix`            | Will not be actioned                     |

## Category roles

| Canonical role | Label in our tracker | Meaning                       |
| -------------- | -------------------- | ----------------------------- |
| `bug`          | `bug`                | Something behaves wrongly     |
| `enhancement`  | `enhancement`        | New capability or improvement |

When a skill names a role — "apply the agent-ready triage label" — use the
corresponding string from the right-hand column. Edit that column to match whatever
vocabulary you actually use; leave it identical to the left to accept the defaults.

Labels must exist before they can be applied. On Gitea, create them with
`tea labels create --name "..." --color "..."`; on GitHub, `gh label create`.

## Workflow labels

`workflow:implement` marks build-ready work that should run through `/implement`.
Workflow and state are separate: apply `ready-for-agent` or `ready-for-human` as
well to record who can execute the ticket.

## Wayfinder labels

`/wayfinder` uses its own namespace, unaffected by the mapping above: `wayfinder:map`
for a map, and `wayfinder:<type>` on each decision ticket where type is `research`,
`prototype`, `grilling`, or `task`. These labels route decision work; they do not
mark implementation tickets.
