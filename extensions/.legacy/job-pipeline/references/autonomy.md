# Autonomy and Retrospectives

The retro and autonomy systems are designed to build a track record before
loosening human oversight. The core principle: trust is earned through
demonstrated consistency, and any regression resets the clock.

---

## Retrospective structure

A retro runs automatically at the end of every job, after the merge. It
uses the planner model to analyse the job execution and surface actionable
findings.

**Inputs to the retro agent:**
- Job summary (goal, cycle count, re-plan count, task count)
- Prior process changes (TODO: queried from SwampCastle in future version)

**Retro output schema:**
```jsonc
{
  "verdict": "clean" | "changes-proposed",
  "replanCauses": [
    "Scout missed the settings module — task spec assumed it existed"
  ],
  "jesterPatterns": [
    "Planner consistently underspecified auth token lifecycle"
  ],
  "processChanges": [
    {
      "description": "Add token lifecycle question to scout prompt",
      "rationale": "Recurred in 2 of last 3 jobs"
    }
  ],
  "summary": "Overall one-paragraph assessment"
}
```

**Verdict rules:**
- `clean`: no process changes proposed — `processChanges` is empty
- `changes-proposed`: at least one process change recommended

---

## Gate mode

| Gate mode | Behaviour |
|---|---|
| `compulsory` | Shows retro summary + proposed changes in a confirmation dialog. You must acknowledge before the job is marked complete. |
| `auto-accept` | Logs the retro summary via `ctx.ui.notify` and proceeds without blocking. |

Switch `retroReview` to `auto-accept` only after several consistently clean
retros. It is typically the first gate to loosen because retrospectives are
low-risk: they don't modify code or make process changes automatically.

---

## Clean-retro streak

The streak counts consecutive retros that ended with `verdict: "clean"`.

```
recordCleanRetro(state)    → streak += 1
recordRetroWithChanges(state) → streak = 0
```

The streak is persisted separately from job state at:
`~/.pi/agent/extensions/job-pipeline/autonomy-state.json`

```jsonc
{
  "cleanRetroStreak": 2,
  "lastRetroAt": 1234567890000
}
```

This file persists across jobs. A streak of 3 (default threshold) means
three consecutive jobs completed without the retro agent finding anything
worth changing in the process.

---

## Autonomy suggestions

When `cleanRetroStreak >= cleanRetrosRequired`, the extension:
1. Shows a notification after the retro gate: "Consider switching a gate to auto-accept."
2. `/job-autonomy` reports the threshold has been met.

The extension never automatically changes gate modes. You decide which gate
to loosen and edit the config manually.

**Suggested progression order:**

1. `retroReview` — lowest risk, retro is informational
2. `scoutQuestion` — the scout question is low-stakes; auto-accept logs it
3. `planApproval` — only loosen after consistent plan quality
4. `proofReview` — loosen last; this is the final quality gate before merge

---

## Regression

If a retro produces process changes after a gate has been loosened, the
autonomy system signals regression. The extension notifies you via
`/job-autonomy` that the streak has reset.

The config file is **not** automatically modified. You must manually
revert gate modes to `compulsory` if you decide regression is serious.

This is intentional: automatic config reversion would be surprising and
could create a feedback loop during experimental phases.

---

## SwampCastle writes

At the end of each retro, the extension queues two types of SwampCastle
writes as `nextTurn` user messages (fire-and-forget):

**Retro summary** (when process changes exist):
```
Wing: oh_my_slop
Room: general
Content: full retro text including process changes
```

**Jester flags** (when recurring critique patterns exist):
```
Wing: oh_my_slop
Room: general
Knowledge graph: (job-pipeline/<id>, jester_flag, "<severity>: <critique>")
```

These are designed to accumulate over time so future planning sessions
can query SwampCastle for recurring failure patterns:
```
What process changes have been applied to job-pipeline?
What jester flags recur most often?
```

---

## Interpreting retro signals

| Signal | What it means | Likely action |
|---|---|---|
| `replanCauses` populated | Worker tasks were underspecified | Improve scout questions or task-writer prompt |
| `jesterPatterns` populated | Planner has recurring blind spots | Add specific constraints to interview questions |
| `processChanges` proposed | Something systemic needs fixing | Edit prompts in `lib/prompts.mjs`, consider adding scout questions |
| Streak resets repeatedly | Process is not stable yet | Stay in fully supervised mode, diagnose root cause |
| 3 clean retros | Process is stable | Consider loosening `retroReview` gate |
