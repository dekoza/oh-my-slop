# job-pipeline

A pi extension that runs a full software development pipeline driven by
a swarm of specialised sub-agents. Each role draws from a user-configured
model pool, so cheap models handle high-volume work and expensive models
handle planning and review.

## Pipeline overview

```
/job "description"
   │
   ▼
INTERVIEW      Model-driven brain-dump. Planner asks targeted questions.
   │           Ends with "Shall I start?" → you confirm → spec captured.
   ▼
POOL DRAW      Random draw from configured pools. Stable for the whole job.
   │           Ensures planner ≠ jester.
   ▼
SCOUT          Cheap model reads the codebase, answers planner's questions.
   │           Gate: you approve the question before scout runs.
   ▼
PLANNING LOOP  Planner writes initial plan.
   │           Jester critiques (round 1). Planner revises.
   │           Jester critiques (round 2). Final plan produced.
   ▼
UI DESIGN      If the plan touches UI, the visual-designer subagent runs.
   │           Modes: critique proposal, extend existing UI, or propose new UI.
   │           Uses repo coherence first when extending existing surfaces.
   │           Gate: you review the plan + disagreement highlights + UI design brief.
   ▼
TASK WRITER    Different model from planner writes concrete worker tasks
   │           with explicit dependency graph.
   ▼
WORKTREE       Git worktree created at .worktrees/<job-id>/.
   │           Workers operate ONLY inside this worktree.
   ▼
WORKERS        Tasks executed in dependency order (parallel if no deps).
   │           TDD mandatory. Evidence saved per task.
   │           Failed tasks → planner re-plans (counted in retro).
   ▼
PROOF DECK     Single HTML file with embedded logs and screenshots.
   │           Previous deck linked for comparison on re-runs.
   ▼
REVIEW LOOP    Reviewer inspects the diff, changed files, and proof artifacts.
   │           Reviewer emits structured findings, missing tests, and open questions.
   │           Jester critiques the review.
   │           Planner resolves: worker fixes OR process update.
   ▼
HUMAN REVIEW   Gate: you see the proof deck path plus refreshed review findings and approve merge.
   ▼
MERGE          Worktree merged into main branch. Proofs preserved.
   ▼
RETRO          Structured summary auto-generated. Issues surface guided
               conversation. Results written to SwampCastle.
               3 consecutive clean retros → suggest more autonomy.
```

## Commands

| Command | Description |
|---|---|
| `/job [description]` | Start a new job or resume interrupted one |
| `/job-pool [role]` | Configure model pools interactively |
| `/job-status` | Show current job state |
| `/job-abandon` | Abandon the current job |
| `/job-autonomy` | Show clean-retro streak and autonomy suggestion |

## Human gates

Four gates control where you must approve before the pipeline continues.
Each gate can be `compulsory` (blocks for your input) or `auto-accept`
(proceeds automatically, always logged).

| Gate | Default | Trigger |
|---|---|---|
| `scoutQuestion` | compulsory | Planner's question to scout |
| `planApproval` | compulsory | Final plan + jester highlights + UI design brief when applicable |
| `proofReview` | compulsory | Proof deck before merge |
| `retroReview` | compulsory | Retro summary |

Switch gates to `auto-accept` via the config file after earning trust through
clean retros.

## Earned autonomy

The extension tracks consecutive retrospectives that produce no process
changes. When the streak reaches `cleanRetrosRequired` (default: 3), the
extension suggests loosening a gate. Any retro that proposes changes resets
the streak to zero.

Check your streak: `/job-autonomy`

## Model pools

Configure pools per role via `/job-pool`. Each role draws one model randomly
at job start. The draw is stable for the whole job. The jester always draws
a different model from the planner when the pool has more than one option.

### Default thinking levels by role

These are hard-coded defaults used when spawning sub-agents:

| Role | Thinking |
|---|---|
| scout | `low` |
| worker | `medium` |
| task-writer | `medium` |
| planner | `high` |
| jester | `high` |
| reviewer | `high` |

Recommended pool structure for a Copilot subscription:

| Role | Suggested tier |
|---|---|
| scout | Free (gpt-5-mini) |
| worker | Free (gpt-5-mini) |
| task-writer | Mid (sonnet-class) |
| planner | Mid/premium |
| reviewer | Mid/premium |
| jester | Mid (different from planner) |

## Config file

Stored at `~/.pi/agent/extensions/job-pipeline/config.json`.

```json
{
  "pools": {
    "scout": { "models": ["github-copilot/gpt-5-mini"] },
    "planner": { "models": ["github-copilot/claude-sonnet-4-5"] },
    "jester": { "models": ["github-copilot/gpt-5"] },
    "task-writer": { "models": ["github-copilot/gpt-5-mini"] },
    "worker": { "models": ["github-copilot/gpt-5-mini"] },
    "reviewer": { "models": ["github-copilot/claude-sonnet-4-5"] }
  },
  "gates": {
    "scoutQuestion": { "mode": "compulsory" },
    "planApproval": { "mode": "compulsory" },
    "proofReview": { "mode": "compulsory" },
    "retroReview": { "mode": "compulsory" }
  },
  "autonomy": { "cleanRetrosRequired": 3 },
  "costs": { "track": true }
}
```

## Job state

The active job pointer is persisted to
`~/.pi/agent/extensions/job-pipeline/active-job.json`.
Each job stores its current snapshot at
`~/.pi/agent/extensions/job-pipeline/jobs/<job-id>/snapshot.json`.
While a pipeline run is active, the extension also holds a transient lock at
`~/.pi/agent/extensions/job-pipeline/jobs/<job-id>/lock.json`.
Legacy `job-state.json` is read once for migration and then cleared.
If pi exits mid-pipeline, `/job` detects the interrupted snapshot and offers
to resume from the last completed step.

## Proof decks

HTML proof decks are written to:
`~/.pi/agent/extensions/job-pipeline/jobs/<job-id>/proofs/proof-cycle-N.html`

They are self-contained HTML files with embedded base64 screenshots and
inline log content. Each deck links to the previous cycle's deck for
section-by-section comparison.

## SwampCastle integration

At the end of each job, the extension writes:
- Retro summary (process changes proposed)
- Jester flags (recurring critique patterns)
- Process change records

These accumulate across jobs and are queryable for future planning sessions.

## Worktrees

The extension uses `git worktree` to isolate worker changes.
`.worktrees/` is automatically added to `.gitignore`.

Workers operate exclusively within the worktree. On human approval the
worktree is merged with `--no-ff` and cleaned up. On abandonment the
worktree is removed without merging.

## Reference docs

| Document | Contents |
|---|---|
| [Architecture](references/architecture.md) | Module map, execution flow, state machine, sub-agent isolation |
| [Pipeline Stages](references/pipeline-stages.md) | Every stage in detail: inputs, outputs, prompts, failure modes |
| [Configuration](references/configuration.md) | Full config schema, pool rules, gate progression path |
| [Commands and Tools](references/commands-and-tools.md) | All slash commands, LLM tools, and status bar states |
| [Autonomy and Retros](references/autonomy.md) | Retro structure, streak tracking, SwampCastle integration |

## Install

Add to your pi `settings.json`:

```json
{
  "extensions": ["path/to/oh-my-slop/extensions/job-pipeline/index.ts"]
}
```

Or install the `oh-my-slop` package which includes it automatically.
