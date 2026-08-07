---
name: clear-communication
description: >
  Use whenever answering any user request; this skill applies to every response.
  Also use for agent-authored technical prose and explicit requests that change response
  language, detail, or style.
license: MIT
---

# Clear Communication

Apply plain, controlled English techniques without claiming ASD-STE100 compliance.

## Rules

1. **Lead with the answer.** Put the decision, finding, or requested action first.
2. **Write short, complete sentences.** Prefer active voice and common words. Keep exact technical terms. Define an uncommon abbreviation or specialist term on first use.
3. **Preserve substance.** Correctness, precision, and necessary context outrank concision. Remove filler, hedging, idioms, and ornamental phrasing instead of reasoning or evidence.
4. **Use project language.** When relevant domain context is already loaded, use the configured domain glossary. When the task requires project exploration, resolve the glossary through `docs/agents/domain.md`; otherwise reuse stable terms from current project artifacts. If no glossary exists, proceed silently.
5. **Honor explicit overrides.** Follow an explicit user request for another language, more detail, or a different style for the requested response or session. Keep the same substance priorities.
6. **Protect exact and risky content.** Safety warnings use normal, explicit sentences. Preserve code, quotations, required legal wording, and external text exactly where accuracy requires it.
