---
description: Compact the conversation into a handoff document
argument-hint: ""
---
Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the OS temp directory — not the current workspace.

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
2. **Redact sensitive information.** API keys, passwords, tokens, PII — none of it.
3. **Tailor to the next session.** If the user described what the next session will focus on, shape the handoff around that.
4. **Keep it under 500 words.** A handoff longer than a page is a document, not a handoff.
5. **Save to temp, not workspace.** Write to `$TMPDIR`, `/tmp`, or `%TEMP%` — never into the repo.
