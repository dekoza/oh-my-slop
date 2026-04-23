# Pipeline Stages

Each stage is idempotent with respect to job state. If the pipeline is
interrupted and resumed, each stage checks whether its output already exists
in job state before running. Completed stages are skipped.

---

## Interview

**Trigger:** `/job [description]`
**Model:** planner (from pool, drawn at interview start)
**Gate:** none — controlled by the model's `job_interview_complete` tool call

The interview happens in the main pi session. The extension injects an
interview system prompt via `before_agent_start` that instructs the planner
to ask targeted questions and conclude with `job_interview_complete`.

The model drives the conversation adaptively. The extension listens for the
`job_interview_complete` tool call, captures the structured spec, and
transitions to the pipeline.

**Output written to job state:**
```jsonc
{
  "spec": {
    "goal": "Full goal description",
    "context": "Key context from the interview",
    "constraints": ["constraint 1"],
    "outOfScope": ["thing 1"],
    "questionsToScout": ["What auth pattern is used?"],
    "evidenceHint": "screenshots" | "logs" | "both"
  }
}
```

---

## Pool draw

**Trigger:** Automatic when `job_run_pipeline` is called
**Model:** none
**Gate:** none

Draws one model per role from each pool's eligible set (pool ∩ available).
The planner/jester constraint is applied. The draw is written to job state
and reused for the entire job including all re-plan and re-review cycles.

Fails loudly with a clear error message if any role has no eligible models.

---

## Scout

**Trigger:** Automatic
**Model:** scout (from pool)
**Thinking:** `low`
**Gate:** `scoutQuestion`

The scout receives read-only tools. The planner's question list (from spec)
drives the reconnaissance. The gate fires before the scout runs, showing
the first question and its rationale.

**Scout system prompt goals:**
- Summarise relevant files and patterns
- Build a dependency map
- Answer the planner's specific questions

**Output written to job state:**
```jsonc
{
  "scoutResult": {
    "summary": "narrative summary",
    "dependencyMap": "key dependencies relevant to goal",
    "answers": [{ "question": "...", "answer": "..." }],
    "relevantFiles": ["path/to/file.py"]
  }
}
```

If the scout output is not valid JSON, the raw text is stored as `summary`.

---

## Planning loop

**Trigger:** Automatic after scout gate passes
**Models:** planner (initial + revision), jester (critiques)
**Thinking:** planner = `high`, jester = `high`
**Gate:** `planApproval` (after final plan)

```
planner → initial plan
jester  → critique round 1
planner → revised plan (if critique found issues)
jester  → critique round 2
```

If the jester finds no issues in round 1 (`verdict: "acceptable"`), round 2
is skipped. The final plan is the planner's output after round 2 (or round 1
if round 2 was skipped).

The gate dialog shows the full plan text plus extracted jester highlights
(summary of both critique rounds).

**Output written to job state:**
```jsonc
{
  "finalPlan": "full plan text",
  "planCritiques": ["jester round 1 output", "jester round 2 output"]
}
```

---

## Task writing

**Trigger:** Automatic after plan gate passes
**Model:** task-writer (from pool — different from planner by design)
**Thinking:** `medium`
**Gate:** none

The task writer receives the final plan and scout summary. It produces a
task list with explicit dependency declarations.

**Task spec schema:**
```jsonc
{
  "id": "task-1",
  "title": "Short title",
  "description": "Full worker instructions",
  "dependsOn": [],             // IDs of tasks that must complete first
  "evidenceType": "both",      // screenshots | logs | both
  "testRequirement": "All auth tests pass"
}
```

Tasks with no declared dependencies run in parallel within a batch.
`lib/tasks.mjs: resolveExecutionBatches()` converts the flat task list into
ordered batches, detecting circular dependencies before workers start.

---

## Worktree setup

**Trigger:** Automatic
**Gate:** none

Creates a git worktree at `.worktrees/<job-id>/` on a new branch `job/<job-id>`.
Adds `.worktrees/` to `.gitignore` if not already present.

Workers operate **only** inside this worktree. The main working tree is not
touched until the merge step.

---

## Workers

**Trigger:** Automatic
**Model:** worker (from pool)
**Thinking:** `medium`
**Gate:** none — failures are re-planning triggers, not human gates

Workers execute in dependency order. Independent tasks run concurrently.

Each worker:
1. Receives full coding tools (read, bash, edit, write) scoped to the worktree
2. Must follow TDD: write tests first, watch them fail, implement until they pass
3. Saves evidence to `~/.pi/agent/.../jobs/<id>/artifacts/cycle-N/<task-id>/`
4. Returns a structured JSON result (success or failure report)

**Success result:**
```jsonc
{
  "status": "success",
  "taskId": "task-1",
  "summary": "Implemented OAuth login via django-allauth",
  "testsPassed": ["test_oauth_login", "test_token_refresh"],
  "artifactFiles": ["proof-task-1.log", "proof-task-1-screenshot.png"]
}
```

**Failure result (worker cannot proceed):**
```jsonc
{
  "status": "failed",
  "taskId": "task-1",
  "attempted": "Add SocialApp configuration",
  "found": "SOCIALACCOUNT_PROVIDERS not defined in settings",
  "reason": "Cannot proceed without settings context — task spec is incomplete"
}
```

Failures do NOT go to the human. They trigger a re-plan:
1. Failure details are appended to the spec context
2. `taskGraph` and `finalPlan` are cleared
3. Pipeline returns to the planning step
4. `replanCount` is incremented (visible in retro)

---

## Proof compilation

**Trigger:** Automatic after all workers complete
**Gate:** none (compiled deck path shown in the proof review gate)

Reads artifact files written by workers from disk. Screenshots are embedded
as base64 data URIs. Logs are embedded in `<pre>` blocks. Generates a
single self-contained HTML file.

If `previousDeckPath` is set (re-review cycle), a comparison link is
included at the top of the deck.

Deck written to:
`~/.pi/agent/extensions/job-pipeline/jobs/<job-id>/proofs/proof-cycle-N.html`

Proofs are never deleted. Each review cycle writes a new deck.

---

## Review loop

**Trigger:** Automatic after proof compilation
**Models:** reviewer, jester, planner
**Thinking:** reviewer = `high`, jester = `high`, planner = `high`
**Gate:** none — human gate comes after resolution

```
reviewer → inspects diff, changed files, and proof artifacts against the plan
           outputs verdict + structured findings + missing tests + open questions
jester   → critiques the review
planner  → resolves jester's critique
  ├─ "worker-fix"     → new cycle: workerResults/proof/review reset,
  │                     fix instructions added to spec context,
  │                     cycleIndex incremented
  └─ "process-update" → logged to job state, continues to proof gate
```

The proof deck is refreshed after review so it includes the reviewer findings,
missing tests, open questions, jester critique, and planner resolution in one
place.

---

## Human review gate

**Gate:** `proofReview`

Shows:
- Review verdict (`approved` / `changes-required`)
- Overall review notes
- Absolute path to the proof deck HTML file
- Structured reviewer findings already embedded in that proof deck

If you deny (request changes): `cycleIndex` increments, `workerResults`,
`proofDeckPath`, and review fields are cleared. Pipeline loops back to
workers with a fresh cycle.

If you approve: pipeline continues to merge.

---

## Merge

**Trigger:** Automatic after human approval
**Gate:** none (implicit human approval via proof review gate)

```bash
git merge --no-ff job/<job-id>  -m "feat: merge job <job-id>"
git worktree remove --force .worktrees/<job-id>
git branch -d job/<job-id>
```

Proof decks are already on disk (not in the worktree) and survive cleanup.

---

## Retrospective

**Trigger:** Automatic after merge
**Model:** planner (from pool)
**Thinking:** `high`
**Gate:** `retroReview`

A retro sub-agent receives a job summary (re-plan count, cycle count,
task count) and the raw job state. It produces a structured assessment:

```jsonc
{
  "verdict": "clean" | "changes-proposed",
  "replanCauses": ["scout missed X dependency"],
  "jesterPatterns": ["planner repeatedly underspecified auth flow"],
  "processChanges": [
    { "description": "Add auth context to scout questions", "rationale": "..." }
  ],
  "summary": "Overall assessment paragraph"
}
```

**After the gate:**
- `clean` → `cleanRetroStreak` increments
- `changes-proposed` → `cleanRetroStreak` resets to 0
- At threshold: extension suggests loosening a gate via `/job-autonomy`
- Results written to SwampCastle (fire-and-forget)
