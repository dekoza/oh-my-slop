# Spec Document Template

Copy this template when starting Phase 1. Replace all bracketed placeholders.

---

```markdown
# Specification: [Project Name]

> **Created**: [Date]
> **Spec Agent**: [Agent/session identifier]
> **Confidence key**: [VERIFIED] = observed | [INFERRED] = deduced | [UNKNOWN] = gap | [CRITICAL_UNKNOWN] = dangerous gap

## 1. Overview

**[VERIFIED]** [One paragraph: what is this system, what problem does it solve, who uses it.]

## 2. External Interfaces

### 2.1 [Interface Name — e.g., "HTTP API", "CLI", "File Watcher"]

**Endpoint/Command**: `[method/path/name]`

| Property | Value |
|----------|-------|
| Input | [type, constraints] |
| Output | [type, structure] |
| Errors | [error conditions and how they are signaled] |
| Dependencies | [external services, files, env vars] |

**[VERIFIED]** Brief description of this interface's purpose and behavior.

[Repeat for each endpoint/command]

### 2.2 [Next Interface]

## 3. Functional Behavior

### 3.1 [Feature Area]

**[VERIFIED]** [Description of what this feature does when triggered.]

**Input → Output mapping:**
- Given [specific input X], the system produces [specific output Y]
- Given [specific input A], the system produces [specific output B]

**[INFERRED]** [Description of behavior deduced from type signatures or documentation — not directly observed.]

**[UNKNOWN]** [Description of behavior that could not be determined. Why not? What was tried?]

[Repeat for each feature area]

## 4. Data Structures

### 4.1 [Type/Entity Name]

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string | non-empty, unique | Primary identifier |
| ... | ... | ... | ... |

**Relationships**: [How entities relate to each other — logical, not physical]

## 5. Business Rules

| Rule ID | Statement | Confidence |
|---------|-----------|------------|
| BR-1 | [Declarative constraint, e.g., "A user cannot approve their own request"] | [VERIFIED] |
| BR-2 | [Another rule] | [INFERRED] |

## 6. Edge Cases

| Scenario | Observed Behavior | Confidence |
|----------|-------------------|------------|
| Empty input | [What happens] | [VERIFIED] |
| Null/malformed input | [What happens] | [INFERRED] |
| Concurrent requests | [What happens] | [UNKNOWN] |
| Resource exhaustion | [What happens] | [VERIFIED] |

## 7. Non-Functional Requirements

| Property | Observed Value | Confidence |
|----------|---------------|------------|
| Response latency (p50) | [value] | [VERIFIED] |
| Max payload size | [value] | [INFERRED] |
| Retry behavior | [description] | [VERIFIED] |
| Auth model | [description] | [VERIFIED] |

## 8. Philosophy of Implementation

When the specification is silent on a decision, follow these principles in order:

1. **[Most important principle]** — [Why this matters most]
2. **[Second principle]** — [Why]
3. **[Third principle]** — [Why]
4. **[Additional as needed]**

## 9. Gap Inventory

| # | Unknown Item | Why Unknown | Impact | Suggested Resolution |
|---|-------------|-------------|--------|---------------------|
| 1 | [What we don't know] | [Why] | [How bad if wrong] | [How to find out] |

## 10. Evidence Index

For `[VERIFIED]` items, link to the specific characterization test cases in the `characterization/` directory:

| Spec Item | Test Case | Input | Expected Output |
|-----------|-----------|-------|-----------------|
| 3.1 Feature X | `tests/test_feature_x.py::test_basic` | `{...}` | `{...}` |
```
