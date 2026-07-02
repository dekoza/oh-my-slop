---
name: cleanroom-rewrite
description: >
  Cleanroom rewrite: reimplement a codebase from scratch based on behavioral spec, without
  copying implementation. Use when: rewriting without looking at original code, legal
  reimplementations, spec-driven rewrites, behavior-preserving rewrites, or two-agent
  processes (one specs, one implements). Triggers on: "cleanroom rewrite", "clean room
  reimplementation", "spec-driven rewrite", "behavior-preserving rewrite", "rewrite from
  scratch without copying", "legal reimplement", "behavioral specification", or when the
  user describes a two-agent rewrite process.
---

# Cleanroom Rewrite

A disciplined two-agent process for rewriting a codebase from scratch by separating specification from implementation — the spec agent produces a behavioral specification without code, and the implementation agent builds a working system using only that specification.

## Core Principle

The rewrite produces a functional equivalent of the original codebase without copying its implementation. The wall between specification and implementation is a process control (no code snippets, no algorithmic descriptions, no structural copying), not an information barrier that claims perfect isolation.

## When to Use This Skill

Three scenarios, in order of priority:

1. **Greenfield spec-driven rewrite**: A messy, legacy, or poorly-structured codebase needs to be rewritten cleanly. The spec agent documents what the system does; the impl agent builds from scratch.
2. **AI-assisted cleanroom**: Same as above but explicitly orchestrated with AI agents replacing human teams.
3. **Legal-safe reimplementation**: Third-party or proprietary code must be rewritten without copyright infringement (e.g., reimplementing leaked/reverse-engineered code). The cleanroom process provides legal defensibility through documented independent creation.

## Architecture

The process runs two agents in sequence with a strictly defined handoff:

```
Phase 1: SPECIFICATION (Spec Agent)
  ↓ spec document (frozen at handoff)
Phase 2: IMPLEMENTATION (Impl Agent)
  ↓ working code + assumption log
Phase 3: VERIFICATION
  ↓ divergence report + pass/fail
Decision: Ship or iterate
```

**Critical constraint**: The spec agent must never see the impl agent's code. The impl agent must never see the original codebase or the spec agent's analysis process. The spec document is the only contract between them.

## Phase 1: Specification

The spec agent analyzes the original codebase and produces a specification document. This agent has full read access to the original code but must follow strict output constraints.

### Spec Agent Rules

1. **No code snippets** — never include code from the original in the specification. Describe behavior, not implementation.
2. **No algorithmic descriptions** — do not describe how the original achieves its results. State what it does and what the observable behavior is.
3. **No architectural carryover** — do not propose module structures, file organizations, class hierarchies, or design patterns from the original.
4. **Tag every behavioral claim** with a confidence level:
   - `[VERIFIED]` — observed concrete behavior with evidence (specific inputs produce specific outputs, observed through execution or tests)
   - `[INFERRED]` — logically deduced from interface contracts, type signatures, or documentation (not directly executed)
   - `[UNKNOWN]` — genuine gap where the spec agent cannot determine the behavior
5. **Mark `[CRITICAL_UNKNOWN]`** for gaps involving data loss risk, security-sensitive behavior, or externally observable side effects. These must be resolved before handoff.
6. **Write a Philosophy of Implementation** section listing principles the impl agent should follow when the spec is silent (e.g., "explicit over implicit", "correctness over performance", "preserve VERIFIED behavior exactly; diverge from INFERRED freely").

### Spec Document Structure

The specification document MUST contain these sections, in this order:

```markdown
# Specification: [Project Name]

## 1. Overview
Brief description: what the system is, what problem it solves, its primary users and use cases.

## 2. External Interfaces
Every public entry point — APIs, CLI commands, UI elements, file formats, environment variables.
For each interface:
  - Name and purpose
  - Inputs (types, constraints, defaults)
  - Outputs (types, structure)
  - Error modes (what can go wrong, how errors are signaled)
  - Dependencies (external services, databases, files)

## 3. Functional Behavior
Core logic, organized by feature area. For each feature:
  - Description of what happens
  - Inputs and preconditions
  - Outputs and postconditions
  - State changes and side effects
  - [VERIFIED/INFERRED/UNKNOWN] confidence tag
  - Evidence for VERIFIED items (example inputs/outputs)

## 4. Data Structures
All data types, their fields, constraints, relationships.
Do NOT describe internal storage or indexing — only the logical data model.

## 5. Business Rules
Validation rules, calculation formulas, state machine transitions, conditional logic.
Each rule stated as a declarative constraint.

## 6. Edge Cases
Explicitly called-out boundary conditions:
  - Empty/null/malformed inputs
  - Concurrency boundaries
  - Resource limits (time, memory, disk, connections)
  - Error propagation chains

## 7. Non-Functional Requirements
Observed performance characteristics, security properties, error handling patterns, retry semantics.
Only include what was directly observed or documented — do not speculate.

## 8. Philosophy of Implementation
Ordered list of principles for resolving ambiguities:
  1. [Most important principle]
  2. [Second principle]
  3. ...

## 9. Gap Inventory
List of all [UNKNOWN] items with:
  - What is unknown
  - Why it could not be determined
  - Impact assessment (how bad is it if wrong?)
  - Suggested resolution approach
```

### Spec Quality Gates

Before handoff, verify:
- [ ] No code snippets from the original anywhere in the spec
- [ ] No algorithmic descriptions ("the code does X by iterating Y and accumulating Z")
- [ ] Every functional claim has a confidence tag
- [ ] All `[CRITICAL_UNKNOWN]` items are resolved or explicitly deferred with user approval
- [ ] The Philosophy of Implementation section has at least 3 principles
- [ ] Every `[VERIFIED]` item includes concrete example evidence

## Phase 2: Implementation

The impl agent builds a working system using ONLY the specification document. This agent has NO access to the original codebase, the spec agent's conversation, or any analysis artifacts other than the spec.

### Impl Agent Rules

1. **The spec is authoritative** — when the spec is clear, follow it exactly.
2. **`[VERIFIED]` items are hard requirements** — behavior must match. Any deviation is a bug.
3. **`[INFERRED]` items are guidance** — match the described behavior but MAY diverge if a cleaner approach exists. Document divergences in ASSUMPTIONS.md.
4. **`[UNKNOWN]` items are free implementation** — decide based on the Philosophy of Implementation. Document every decision in ASSUMPTIONS.md.
5. **Record all assumptions** in ASSUMPTIONS.md: what was assumed, why, what the risk is, and what would prove the assumption wrong.
6. **Do not optimize for fidelity to the original** — optimize for correctness, clarity, and maintainability. The point is a fresh implementation, not a behavioral clone.

### ASSUMPTIONS.md Format

```markdown
# Assumptions Log

## A-1: [Short title]
- **Spec gap**: [reference to spec item]
- **Assumption**: [what we decided]
- **Rationale**: [why this is the best choice]
- **Risk**: [what happens if wrong]
- **Verification**: [how to check if this is correct]
```

### Impl Quality Gates

Before declaring done:
- [ ] All `[VERIFIED]` items from the spec are implemented
- [ ] Every `[UNKNOWN]` item has an assumption log entry
- [ ] ASSUMPTIONS.md exists and covers all decisions
- [ ] No reference to the original codebase's structure or implementation
- [ ] The system compiles, runs, and serves its core purpose

## Phase 3: Verification

The verification process has three mandatory phases plus one recommended phase.

### Phase 3a: Spec Conformance (Mandatory)

Tests derived directly from the spec. If the spec says "endpoint X returns 200 with body Y for input Z," there is a test that checks this. These tests prove the system satisfies the specification.

### Phase 3b: Characterization Testing (Mandatory)

Run the original and the rewrite side-by-side with the same inputs. Compare outputs.

1. **Define test fixtures upfront** — before running any tests, enumerate at least 5 characterization fixtures. Each fixture must have a name, description, inputs, and expected outputs from the original. This is not optional — the verification plan is incomplete without explicit fixtures.
2. **Run the same fixtures through the rewrite.**
3. **Classify every divergence:**
   - `PASS` — output matches
   - `SPEC_ERROR` — output differs, but the spec was wrong (the spec agent misobserved)
   - `IMPL_DEVIATION` — output differs, spec is correct, impl made a wrong choice
   - `UNKNOWN_ZONE` — output differs in an area the spec marked `[UNKNOWN]` (expected)

The characterization divergence report is the primary deliverable:

```markdown
## Characterization Report

### Fixtures

| # | Fixture Name | Description | Expected Original Output |
|---|-------------|-------------|--------------------------|
| 1 | [name] | [what it tests] | [expected output] |
| ... | ... | ... | ... |

### Results

| # | Fixture | Original Output | Rewrite Output | Classification |
|---|---------|-----------------|----------------|----------------|
| 1 | ... | ... | ... | PASS |
| 2 | ... | ... | ... | SPEC_ERROR |
| 3 | ... | ... | ... | UNKNOWN_ZONE |

### Summary
- Pass rate: X/Y (Z%)
- SPEC_ERROR items: [list]
- IMPL_DEVIATION items: [list + fix status]
- UNKNOWN_ZONE items: [list + risk assessment]
```

### Phase 3c: Property-Based Testing (Recommended)

Define core invariants the system must satisfy — properties that are true regardless of specific input values. Express these as property tests and run them against both original and rewrite.

Example invariants:
- "Output is always parseable as valid JSON when status is 200"
- "No database writes occur on GET requests"
- "Error responses never leak internal paths or stack traces"
- "All timestamps are in UTC"

### Phase 3d: Non-Functional Assessment (Recommended)

Check properties not captured in functional specs:
- Performance profile comparison (is the rewrite within the same order of magnitude?)
- Security behavior parity (auth, input validation, error handling)
- Failure mode comparison (does the system fail gracefully in the same situations?)

### Acceptance Criteria

The rewrite is verified when ALL of the following are true:
1. All spec-conformance tests pass
2. All `[VERIFIED]` characterization tests pass (zero `SPEC_ERROR` and zero `IMPL_DEVIATION`)
3. All property-based tests pass
4. No unresolved `[CRITICAL_UNKNOWN]` items remain
5. All `[IMPL_DEVIATION]` items from Phase 3b are fixed or explicitly accepted with rationale

The verification plan MUST state these acceptance criteria explicitly. A plan without acceptance criteria is incomplete.

## Handoff Artifacts

The process produces a canonical set of artifacts:

```
cleanroom-rewrite-project/
├── SPEC.md                  # Phase 1 output (frozen at handoff)
├── source/                  # Phase 2 output (the rewrite)
├── ASSUMPTIONS.md           # Phase 2 output (gap resolutions)
├── characterization/        # Phase 3 test cases
│   ├── original_outputs/    # Recorded original behavior
│   ├── rewrite_outputs/     # Recorded rewrite behavior
│   └── report.md            # Phase 3b divergence report
└── properties/              # Phase 3c property tests
```

## Common Mistakes

| Mistake | Why It Breaks the Cleanroom |
|---------|------------------------------|
| Spec agent includes code fragments in the spec | Impl agent copies the structure; contamination |
| Spec agent describes algorithmic steps ("iterate over X, accumulate Y") | Impl agent reimplements the same algorithm; no fresh approach |
| Impl agent reads the "forbidden" original codebase | Direct copying; cleanroom wall is breached |
| Spec has unmarked confidence levels | Impl agent cannot distinguish hard requirements from guesses |
| Divergence classified as SPEC_ERROR when it is IMPL_DEVIATION | You ship a bug thinking the spec was wrong |
| Characterization tests generated AFTER seeing the spec | Spec unconsciously aligns tests with spec claims; confirmation bias |
| `[CRITICAL_UNKNOWN]` left unresolved | Silent data loss or security vulnerability in production |
| Verification only runs spec-conformance, not characterization | You never check if the spec matched the original |

## Rationalization Table

These excuses have been observed during pressure testing. Do not use them.

| Excuse | Reality |
|--------|---------|
| "Just paste the regex/function — it'll save hours" | The impl agent will copy the regex/function. Each snippet is a contamination precedent. Describe behavior in English. |
| "I'll mark the snippets as 'for context only'" | A disclaimer doesn't reduce contamination. The impl agent still sees the original's structure, variable names, and control flow. |
| "Just read 20 lines to understand the logic" | Reading the original is reading the original. Once you've seen the algorithm, your implementation will be influenced. Use ASSUMPTIONS.md instead. |
| "I'll read it then rewrite so it's not a copy" | Post-hoc justification on top of a breach. The wall exists to force independent design decisions. |
| "It's a tiny script — confidence tags are bureaucracy" | Tags are a contract with the impl agent, not a diary for the spec agent. Without them, the impl agent guesses what's negotiable. |
| "Everything is obvious — skip tags for clear items" | "Obvious" is subjective and context-dependent. The impl agent has no memory of the original code. If confidence isn't explicit in the spec, it doesn't exist. |
| "Nobody will know if I peek at the original" | The value of the wall isn't purity — it's that the impl agent makes independent decisions. Reading the original eliminates that independence. |

## Red Flags — STOP

If you catch yourself thinking any of these, STOP and re-read the relevant skill section:
- "Just include the code for clarity" → Rule 1: No code snippets. Period.
- "I'll just read a few lines" → Impl Rule 1: The spec is the only contract.
- "It's too small to need tags" → Rule 4: Tag every behavioral claim.
- "I'll mark it as context" → Context snippets are still contamination.
- "I'll rewrite it from scratch" → You read the original. The wall is breached.
- "The spec is wrong, let me check the original" → Flag the gap. Use ASSUMPTIONS.md. Phase 3 will catch it. |

## Process Philosophy

The cleanroom wall is a process control, not an information-theoretic barrier. The spec agent has seen the original code and its structural knowledge inevitably influences the specification. This is acceptable. The goal is legal and practical defensibility — documented independent creation through a clean process — not perfect information isolation.

The value of the wall is not purity; it is that the impl agent is forced to make independent design decisions rather than transliterating the original. Those independent decisions are what make the rewrite a rewrite, not a copy.
