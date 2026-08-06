# Specification Interview

Use this guide when a request is too vague to turn directly into a trustworthy feature spec. The goal is not to ask every possible question. The goal is to ask the smallest set of questions that turns ambiguity into a stable contract.

This workflow deliberately borrows two ideas from court-jester:

- **Socratic questioning** to expose assumptions without pretending to know the answer already
- **Dialectic synthesis** to resolve genuine tension when the user wants two things that do not comfortably fit together

## When to Interview

Run the interview when one or more of these are true:

- the request changes behavior but lacks acceptance criteria
- the user uses vague words such as “simple”, “flexible”, “robust”, “fast”, or “intuitive”
- the task impacts multiple actors with different incentives
- the team is under time pressure and wants to skip specification
- there is clear tension between scope, speed, safety, compatibility, or operability

Do **not** run a giant interview for trivial changes with obvious scope.

## Default Interview Sequence

1. **Steelman the request** in 1-2 sentences.
2. Ask **3-5 high-leverage questions** from the Socratic categories below.
3. If the answers expose a real conflict, frame it as **thesis vs antithesis** and synthesize a workable path.
4. Summarize the results into spec-ready notes.
5. Confirm only the unresolved or high-risk points with the user.

## Socratic Question Categories

### 1. Definitional Questions

Use these when the language is vague.

- When you say X, what specifically do you mean here?
- How would you explain X to a new teammate or operator?
- Which cases are in scope for X, and which are not?

### 2. Evidential Questions

Use these when claims are asserted but not grounded.

- What evidence supports this need?
- Is this based on production incidents, user research, operator pain, or intuition?
- What result would prove this feature or document was a mistake?

### 3. Logical Questions

Use these when the reasoning chain feels hand-wavy.

- What has to be true for this approach to solve the problem?
- Does the proposed mechanism necessarily produce the outcome the user wants?
- Could a simpler alternative satisfy the same need?

### 4. Perspective Questions

Use these when the task affects more than one audience.

- How would a first-time user see this?
- How would an on-call engineer or maintainer experience this?
- Which stakeholder loses if we optimize for the requested path?

### 5. Consequential Questions

Use these when failure is costly.

- What breaks if this assumption is wrong?
- What becomes harder later if we choose this path now?
- What recovery or rollback path exists if we regret the decision?

## Dialectic Synthesis When Tension Is Real

Sometimes the interview exposes a real clash:

- **thesis**: the user wants speed, flexibility, or minimal process
- **antithesis**: the system needs safety, specificity, backward compatibility, or operational clarity

Do not fake compromise. Name the conflict directly.

### Common Tensions

| Thesis | Antithesis | Typical synthesis |
|---|---|---|
| Ship now with minimal ceremony | Freeze a clear contract before implementation | Write a short but authoritative feature spec with only high-risk acceptance criteria |
| Keep docs lightweight | Prevent stale ambiguity | Update the existing canonical doc instead of creating new prose |
| Preserve flexibility | Give tests and operators something precise | Make the spec specific on current behavior and explicit about non-goals |
| Internal simplicity | Public clarity | Keep internal ADR/rationale separate from user-facing docs |

### Synthesis Patterns

- **Conditional** — X is acceptable when condition A holds; otherwise choose Y.
- **Scope split** — Apply one rule to engineering documentation and another to user-facing documentation.
- **Temporal** — Start with a short active spec now, expand only if a trigger is hit.
- **Risk mitigation** — Proceed quickly, but require specific safeguards such as rollback notes or compatibility warnings.

## Stop Condition

The interview is done when you can write:

- a clear problem statement
- goals and non-goals
- constraints and actors
- main behavior and edge cases
- testable acceptance criteria
- operational impact if relevant

If you cannot write those without guessing, the interview is not done.

## Output Template

```markdown
## Steelmanned problem
[Strongest fair restatement of the user’s request]

## Known requirements
- ...

## Non-goals
- ...

## Constraints
- ...

## Actors and stakeholders
- ...

## Main flows
- ...

## Edge cases
- ...

## Acceptance criteria draft
- ...

## Operational impact
- deploy / migrate / rollback / alerts / none

## Open questions
- ...
```

## Anti-Patterns

- Asking twenty questions when three would freeze the contract.
- Turning uncertainty into a spec without admitting what is unknown.
- Treating README prose as the canonical answer to feature behavior.
- Mistaking a polite paraphrase for a steelmanned problem statement.
- Forcing synthesis when the right answer is simply “the user needs to choose a priority.”
