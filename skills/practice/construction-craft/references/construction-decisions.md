# Construction decision guide

Read the section matching the construction pressure in front of you. These rules adapt the
working-size `code-complete` source into decisions not already owned by this repository's TDD,
debugging, refactoring, or module-design skills.

## Pre-construction gate

Before substantial construction, make these explicit enough to avoid building against guesses:

- required behavior and acceptance evidence;
- architecture fit and major technical risks;
- repository conventions and language/runtime constraints;
- error policy and trust boundaries;
- data representation, units, ranges, precision, and ownership;
- existing components to reuse and integrations that must remain compatible;
- test strategy and the commands that prove the change.

Scale the gate to risk. A local rename does not need a design dossier. A change spanning data,
integration, and deployment boundaries needs written answers. When a prerequisite is unresolved, ask for the missing decision or name
the evidence needed; route code experiments through [`tdd`](../../tdd/SKILL.md).

## Intent-first complex routines

Draft precise pseudocode or intent steps before a routine whose control flow cannot be reviewed at
a glance. Keep every line at the same abstraction level and separate setup, validation,
computation, and side effects when they are distinct phases. Translate the draft into code.

Use the draft to expose missing names and interfaces. If a step cannot be stated without describing
multiple unrelated actions, the routine boundary is still wrong.

## Data and variable discipline

Make data carry its own meaning:

- choose purpose-revealing names and the smallest practical scope;
- initialize values deliberately and keep ownership visible;
- replace magic domain values with named constants;
- use booleans only for genuinely binary meanings;
- use enums or equivalent sum types for closed sets;
- keep visible units in types or names and normalize them at a boundary;
- choose types that make invalid states unrepresentable where the language permits it.

A bare numeric parameter remains ambiguous even when adjacent documentation says kilograms; use a
`Kilograms` type or an interface field named `weight_kg` so the boundary carries the unit.

## Table-driven logic

Consider table-driven logic when repeated branching maps stable categories, ranges, conversions,
validation rules, dispatch choices, or configuration-like facts. Choose a table only when it is
clearer than control flow and a reader can inspect the mapping directly.

For every chosen table:

1. Name the dimensions and value meaning.
2. Validate keys, ranges, defaults, and duplicate entries.
3. Keep the table synchronized with its authoritative rule source.
4. Test boundary and unknown cases.
5. Replace the table with explicit behavior if encoding hides interactions or side effects.

A table is a representation of rules, not a place to bury a miniature programming language.

## Assertions and validation

Separate programmer assumptions from expected failures by mechanism:

| Situation | Mechanism | Meaning |
|---|---|---|
| Programmer assumptions and internal invariants | Assertion, invariant check, or contract | A defect exists if this is false |
| Expected user, file, network, or external input failure | Validation with an actionable error | The system must reject or handle this case |
| Expected business failure | Validation or domain error | The caller must handle a legitimate failure |

Keep assertions free of required side effects because production settings may disable them. Keep
validation at trust boundaries, preserve diagnostic context, and return errors at the abstraction
whose caller can act on them.

## Measured performance tuning

Run performance work as a controlled experiment:

1. State the user-visible or system target and the representative workload.
2. Measure the baseline with a repeatable command or benchmark.
3. Identify the measured bottleneck rather than guessing from code shape.
4. Change one variable.
5. Remeasure under the same conditions.
6. Keep the change only when the improvement matters and justifies its clarity and maintenance cost.
7. Record the target, environment, before/after values, and tradeoff.

A faster microbenchmark is not evidence for a production improvement when it measures a different
workload or shifts cost outside the measured boundary.
