# Architecture

The `job-pipeline` extension is a state machine that coordinates a swarm of
ephemeral sub-agent sessions. Each sub-agent is spawned via the pi SDK's
`createAgentSession`, runs to completion, and returns structured JSON. The
main pi session acts as the human-facing interface: it hosts the interview,
presents gates, and shows progress.

## Module map

```
index.ts                 Extension entry point
│  Registers commands, tools, and event hooks.
│  Closes over pi, agentDir, and runtime state.
│
├── lib/config.mjs       Config loading with partial-load tolerance
├── lib/pool.mjs         Session pool draw (planner ≠ jester constraint)
├── lib/state.mjs        Disk persistence: job state, autonomy state, proofs
├── lib/tasks.mjs        Task dependency graph → ordered execution batches
├── lib/autonomy.mjs     Clean-retro streak tracking
├── lib/proof.mjs        Self-contained HTML proof deck generator
│
├── lib/pipeline.mjs     Pipeline state machine (the core orchestrator)
│   └── calls agents.mjs, tasks.mjs, worktree.mjs, proof.mjs, state.mjs
│
├── lib/agents.mjs       Sub-agent spawning via SDK
├── lib/worktree.mjs     Git worktree create / merge / abandon
├── lib/prompts.mjs      System prompts for all roles
└── lib/swampcastle.mjs  SwampCastle message builders
```

## Execution flow

```
User: /job "goal"
       │
       ▼
index.ts: /job command handler
  ├─ Check for interrupted job → offer resume
  ├─ Write initial job state to disk
  ├─ Set runtime.mode = "interview"
  └─ pi.sendUserMessage("Let's plan this") → triggers agent turn

       │  (main session conversation)
       ▼
before_agent_start event handler
  └─ Injects interview system prompt from lib/prompts.mjs

       │  (planner model asks questions, user answers)
       ▼
job_interview_complete tool (called by model when ready)
  ├─ Captures structured spec
  ├─ Writes spec to job state on disk
  ├─ Sets runtime.mode = "pipeline-ready"
  └─ pi.sendUserMessage("call job_run_pipeline") → triggers next turn

       │
       ▼
before_agent_start event handler
  └─ Injects orchestrator context (tells model to call job_run_pipeline)

       │
       ▼
job_run_pipeline tool (long-running, called by model)
  ├─ Draws session pool from config + available models
  ├─ Calls lib/pipeline.mjs: runPipeline(...)
  └─ Returns result when pipeline completes or gate is denied
```

## Pipeline state machine

`runPipeline` in `lib/pipeline.mjs` is a single async function that walks
through pipeline steps. Job state is written to disk after each step so
the pipeline can be resumed after a crash or pi restart.

```
Step: scout
  └─ spawnAgent (scout model, read-only tools, scout system prompt)
  └─ gate: scoutQuestion

Step: planning
  └─ spawnAgent (planner) → initial plan
  └─ spawnAgent (jester) → critique round 1
  └─ spawnAgent (planner) → revised plan (if critique found issues)
  └─ spawnAgent (jester) → critique round 2
  └─ gate: planApproval

Step: task-writing
  └─ spawnAgent (task-writer) → task list with dependency graph

Step: worktree
  └─ git worktree add .worktrees/<job-id>

Step: workers
  └─ resolveExecutionBatches(tasks) → ordered batches
  └─ For each batch: Promise.all(tasks.map(spawnCodingAgent))
  └─ Failures → re-plan (resets to planning step, increments replanCount)

Step: proof
  └─ collectArtifacts from disk (logs, screenshots)
  └─ generateProofHtml → write to ~/.pi/agent/.../jobs/<id>/proofs/

Step: review
  └─ spawnAgent (reviewer) → review
  └─ spawnAgent (jester) → critique of review
  └─ spawnAgent (planner) → resolution
     ├─ "worker-fix" → new cycle (increments cycleIndex, resets workers/proof/review)
     └─ "process-update" → logged, continues

Step: human-review
  └─ gate: proofReview

Step: merge
  └─ git merge --no-ff + worktree remove

Step: retro (inside index.ts factory)
  └─ spawnAgent (planner model) → retro summary
  └─ gate: retroReview
  └─ Update autonomy streak
  └─ Write to SwampCastle (fire-and-forget via pi.sendUserMessage)
```

## Job state schema

Persisted at `~/.pi/agent/extensions/job-pipeline/job-state.json`.

```jsonc
{
  "id": "job-2026-04-22-a1b2c3d4",
  "description": "Add OAuth login",
  "cwd": "/path/to/project",    // Persisted job cwd, used on resume/sub-agents
  "step": "workers",            // Current pipeline step
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000,
  "cycleIndex": 1,              // Increments on each review→worker-fix cycle
  "replanCount": 0,             // Total worker-failure re-plans
  "spec": {                     // Captured from interview
    "goal": "...",
    "context": "...",
    "constraints": [],
    "outOfScope": [],
    "questionsToScout": [],
    "evidenceHint": "both"
  },
  "pool": {                     // Drawn once, stable for the job
    "scout": "github-copilot/gpt-5-mini",
    "planner": "github-copilot/claude-sonnet-4-5",
    "jester": "github-copilot/gpt-5",
    "task-writer": "github-copilot/gpt-5-mini",
    "worker": "github-copilot/gpt-5-mini",
    "reviewer": "github-copilot/claude-sonnet-4-5"
  },
  "scoutResult": { "summary": "...", "answers": [], "relevantFiles": [] },
  "finalPlan": "...",
  "planCritiques": ["...", "..."],
  "taskGraph": { "tasks": [] },
  "worktreePath": "/path/to/.worktrees/job-id",
  "workerResults": [],
  "proofDeckPath": "/path/to/proof-cycle-1.html",
  "previousProofDeckPath": null,
  "reviewVerdict": "approved",
  "reviewNotes": "...",
  "reviewJesterCritique": "...",
  "plannerResolution": "...",
  "humanApproved": true,
  "merged": false
}
```

## Sub-agent isolation

Each sub-agent is a separate `createAgentSession` call with:

- Its own in-memory session (`SessionManager.inMemory()`)
- Its own model (drawn from the role's pool)
- Fresh `AuthStorage` (reads the same `~/.pi/agent/auth.json`)
- Role-specific system context injected via `agentsFilesOverride` (virtual `ROLE.md`)
- Appropriate tool set (read-only for scout/planner/jester/reviewer; coding tools for workers)

Sub-agents communicate only through their return value: the final assistant
message, which must be a JSON block. If JSON extraction fails, the raw text
is used as a fallback.

## Concurrency

Workers within the same dependency batch run concurrently via `Promise.all`.
Workers in different batches run sequentially. Each worker is an independent
sub-agent session with no shared state other than the git worktree on disk.
