# Commands and Tools

## Slash commands

### `/job [description]`

Start a new job or resume an interrupted one.

**With no description:**
The model is asked "What's on your mind?" and the interview starts from there.

**With description:**
The description is stored as the job's initial goal. The interview starts
with that context already present in the planner's system prompt.

**With an interrupted job on disk:**
A resume dialog is shown. Accepting resumes from the last completed pipeline
step. Denying clears the interrupted job and starts fresh.

---

### `/job-pool [role]`

Configure model pools interactively.

**With no argument:** Walks through all six roles in order.
**With a role name** (`scout`, `planner`, `jester`, `task-writer`, `worker`,
`reviewer`): Configures only that role.

Shows the current pool for each role before prompting. Presents all models
currently available in pi (authenticated providers only) as a selection list.

**Limitation:** `ctx.ui.select` returns one value at a time. To assign
multiple models to a pool, edit `config.json` directly after setting the
first model via the command.

```json
"planner": {
  "models": [
    "github-copilot/claude-sonnet-4-5",
    "github-copilot/gpt-5"
  ]
}
```

---

### `/job-status`

Show the current job's state: ID, description, step, cycle index, re-plan
count, pool assignments, and proof deck path (if any).

---

### `/job-abandon`

Abandon the current job. Confirms before clearing job state. Does **not**
remove the git worktree — this is intentional to avoid destroying work
that might be recoverable. Remove it manually if needed:

```bash
git worktree remove --force .worktrees/<job-id>
git branch -D job/<job-id>
```

---

### `/job-autonomy`

Show the current clean-retro streak and how far it is from the configured
threshold. If the threshold has been reached, the command says so and
suggests which gate to loosen.

Example output:
```
Clean retro streak: 2 / 3 required
1 more clean retro(s) before autonomy can be suggested.
```

---

## LLM tools

These tools are called by the model during the job flow. They are not
intended to be called manually, but understanding their contracts helps
when debugging stuck pipelines.

### `job_interview_complete`

Called by the planner at the end of the interview to capture the structured
job specification.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `goal` | string | Full, specific goal description |
| `context` | string | Key context gathered during interview |
| `constraints` | string[] | Known constraints and requirements |
| `outOfScope` | string[] | What is explicitly excluded |
| `questionsToScout` | string[] | Specific questions for the scout |
| `evidenceHint` | `"screenshots"` \| `"logs"` \| `"both"` | Evidence type workers should produce |

**Effect:** Writes spec to job state, transitions to `pipeline-ready`,
injects a follow-up message asking the model to call `job_run_pipeline`.

**Returns:** Confirmation text.

---

### `job_run_pipeline`

Long-running tool that executes the full pipeline. Called by the model
immediately after `job_interview_complete`.

**Parameters:** None. Reads all necessary state from disk.

**Effect:**
1. Draws session pool if not already drawn
2. Calls `lib/pipeline.mjs: runPipeline()`
3. Runs retro after pipeline completes
4. Returns a summary with the proof deck path and step log

**Abort:** Responds to the pi `signal` (Esc key). On abort, job state is
preserved on disk — the pipeline can be resumed with `/job`.

**On gate denied:** Returns a message indicating which gate was denied.
The job state is preserved. Use `/job` to resume from the gate.

**Returns:** Completion summary or error description.

---

## Keyboard shortcuts

None registered. All interaction is via slash commands and dialog prompts
during pipeline execution.

---

## Status bar

The extension sets a footer status via `ctx.ui.setStatus("job-pipeline", ...)`:

| Status | Meaning |
|---|---|
| `interview` | Interview in progress |
| `pipeline ready` | Interview complete, waiting for `job_run_pipeline` |
| `resuming` | Resuming from interrupted state |
| `running` | Pipeline executing (shows current step name) |
| `paused at <gate>` | Gate was denied, pipeline paused |
| `done` | Pipeline complete |
| `error` | Pipeline failed with an unhandled error |
| *(blank)* | No active job |
