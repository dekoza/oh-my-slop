# dekoza-skills

After enough hours watching AI confidently produce wrong code, you stop hoping it'll get better and start building guardrails instead.

This is a collection of those guardrails — framework-specific skills that encode the knowledge AI models claim to have but demonstrably don't. Each skill is a curated reference designed for AI coding agents, distilled from real production mistakes and hard-won lessons.

## What's here

| Skill | What it covers |
|-------|---------------|
| **[Django](django/SKILL.md)** | Django 6.0 framework patterns — models, views, URLs, templates, forms, admin, auth, testing, architecture. The gotchas section alone justifies this skill's existence. |
| **[HTMX](htmx/SKILL.md)** | Attributes, requests, swapping strategies, events, extensions, and the patterns that make hypermedia-driven UIs actually work. |
| **[Tabler](tabler/SKILL.md)** | Tabler UI component reference — CSS classes, variants, layout patterns, modals, plugins. Everything an agent needs to stop guessing class names. |

## Why this exists

AI coding assistants hallucinate API parameters, ignore framework conventions, and produce code that looks plausible until you actually run it. The standard response is to paste documentation into prompts and hope for the best.

These skills are a more structured attempt at the same losing battle. They give AI agents:
- **Critical rules** they will otherwise violate on every other generation
- **Gotcha lists** compiled from actual bugs, not theoretical edge cases
- **Reference maps** so they look things up instead of inventing things

Does it work? Sometimes. Better than without? Measurably. A reason for optimism? No.

## How to use

These skills are built for [OpenCode](https://github.com/opencode-ai/opencode) agents. Drop the skill directories into your OpenCode skills path and reference them in your agent configuration.

Each skill follows the same structure:
```
skill-name/
├── SKILL.md              # Entry point — critical rules, quick start, reference map
└── references/
    ├── topic-a.md         # Detailed reference for a specific domain
    ├── topic-b.md
    └── ...
```

The agent reads `SKILL.md` first, then loads only the reference files relevant to the current task.

## The AGENTS.md and Anti-Sycophancy

The [AGENTS.md](AGENTS.md) file contains non-negotiable rules for any agent working in this context. It is not a suggestion. It is a technical constraint.

The most critical part is the **Hardline Review and Honesty Policy**. This clause is a countermeasure against the single most dangerous property of AI code assistants: the tendency to agree with the user even when the user is wrong. I have seen too much code fail because an AI was too "polite" to point out a flaw.

In this repo, disagreement is not a failure. Unearned agreement is.

## Contributing

If you have a framework skill worth sharing — one born from production pain, not tutorial optimism — contributions are welcome. The bar is: would this have prevented a real bug?

## License

[Unlicense](LICENSE) — public domain. Take what's useful. No attribution needed.
