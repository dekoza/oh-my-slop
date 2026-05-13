# User-Facing Docs

User-facing documentation is not one blob. Use the Diátaxis split so each document serves one dominant need.

## The Four Types

| Type | User need | Best for | Wrong if |
|---|---|---|---|
| Tutorial | Learn by doing | First contact, guided onboarding, confidence-building | It turns into an exhaustive reference |
| How-to | Solve a specific task | Task completion for users who already know the basics | It starts teaching concepts from zero |
| Reference | Look up facts | Exact commands, options, parameters, limits, defaults, behaviors | It becomes a narrative walkthrough |
| Explanation | Build mental models | Why the system works this way, tradeoffs, concepts, architecture from the user’s perspective | It tries to be step-by-step instructions |

## Routing Rules

- If the user is new and needs a guided path -> write a **tutorial**.
- If the user already knows the product and needs to complete one task -> write a **how-to**.
- If the user needs exact facts -> write **reference**.
- If the user needs conceptual understanding or rationale -> write **explanation**.

Do not mix all four forms into one page unless the page is explicitly a portal with links out to the real canonical docs.

## Tutorial

Use tutorials to help a user succeed on their first run.

- choose one realistic outcome
- guide step by step
- explain only what is needed for that journey
- optimize for confidence, not coverage

## How-to

Use how-to guides for a concrete task such as “rotate an API token” or “export invoices”.

- assume baseline familiarity
- keep the path direct
- include prerequisites and success checks
- mention branching only when it materially changes the task

## Reference

Use user-facing reference for exact public facts.

- commands, options, defaults, limits, permissions, error meanings
- exact configuration keys
- compatibility or deprecation notes

## Explanation

Use explanation when the user needs the why.

- concepts and mental models
- tradeoffs that affect correct usage
- system behavior that surprises users unless explained

## Minimal Templates

### Tutorial

```markdown
# [Goal-oriented tutorial]

## What you will build or achieve
## Before you start
## Step 1
## Step 2
## Step 3
## What to try next
```

### How-to

```markdown
# How to [complete task]

## Prerequisites
## Steps
## Verify success
## Troubleshooting
```

### Reference

```markdown
# [Feature] reference

## Commands / fields / options
## Defaults and limits
## Permissions or prerequisites
## Error meanings
```

### Explanation

```markdown
# How [feature / concept] works

## Core model
## Tradeoffs
## Common misunderstandings
## Related tasks or references
```

## Anti-Patterns

- A tutorial that becomes a dump of every option.
- A how-to guide that starts teaching fundamentals from scratch.
- A reference page that hides exact facts inside prose.
- An explanation doc that is secretly a vague product pitch.
- Mixing tutorial, how-to, reference, and explanation in one canonical page and forcing the user to excavate the part they actually need.
