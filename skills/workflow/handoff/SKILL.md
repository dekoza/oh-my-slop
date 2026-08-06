---
name: handoff
description: Compact the current conversation into a handoff document — goal, progress, decisions, state, and next steps — saved to a temp file so a fresh agent can pick the work up.
argument-hint: "What will the next session be used for?"
#disable-model-invocation: true
license: MIT (adapted from mattpocock/skills)
---

# Handoff

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS — not the current workspace.

## Structure

```markdown
# Handoff — <date>

## Goal

What we're trying to accomplish. One paragraph.

## What's done

- Completed work, with links to commits, issues, or files.
- Do NOT duplicate content already captured in artifacts. Reference by path or URL.

## What's next

- The next concrete steps, in order.
- Any blockers or open questions.

## Decisions

- Key choices already made and the reasoning behind them — so the next agent doesn't reopen settled questions or unknowingly contradict them.

## Current state

- Git branch and HEAD commit.
- Uncommitted changes (if any).
- Running services or processes (if any).

## Suggested skills

Skills the next agent should load:

- <skill-name> — <reason>
```

## Rules

1. **Reference, don't duplicate.** If a PRD, ADR, plan, issue, or commit already captures the detail, link to it. The handoff is a map, not a territory.
2. **Redact sensitive information.** API keys, passwords, tokens, personally identifiable information — none of it.
3. **Tailor to the next session.** If the user described what the next session will focus on, shape the handoff around that. Don't dump everything equally.
4. **Keep it under 500 words.** A handoff that's longer than a page is a document, not a handoff.
5. **Save to temp, not workspace.** The handoff is a session artifact, not a project artifact. Write it to `$TMPDIR`, `/tmp`, or `%TEMP%` — never into the repo.
6. **Record decisions, not just state.** Capture the choices made and why, so the next agent doesn't reopen settled questions or silently contradict them.

## When to use

- You're about to end a session and the user wants to resume later.
- The user explicitly asks for a handoff or summary.
- The conversation has accumulated enough context that a fresh agent would need orientation.
