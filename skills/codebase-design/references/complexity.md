# Complexity

Cognitive load as the primary design metric. Based on A Philosophy of Software Design (John Ousterhout). Assumes the vocabulary in [SKILL.md](../SKILL.md) — **module**, **interface**, **depth**, **seam**.

## Primary Metric

Use **reduced complexity** as the primary success metric. Prefer the design that lowers:

- **Cognitive load** — the number of facts a reader must hold at once
- **Change amplification** — how many places must change for one logical modification
- **Hidden dependencies** — relationships callers must know but can't see from the interface
- **Temporal coupling** — ordering constraints that aren't inherent in the problem
- **Unknown unknowns** — the most dangerous symptom: it isn't obvious which code must change or which facts matter, so the reader can't even tell what they don't know

When two designs are functionally equivalent, choose the one that reduces these five quantities.

## Pull Complexity Downward

When a detail is volatile or messy, hide it inside the module that owns the knowledge:

- Volatile decisions, internal representations, storage shape, protocols, file formats, performance hacks, bookkeeping, normalization, and messy edge handling belong *inside* the module.
- Prefer a slightly more complex implementation if it gives callers a simpler public contract and removes repeated reasoning from call sites.
- The goal: callers should never need to know *how* the module does what it does, only *what* it does.

## Design Is Continuous

A first working patch is not done if it worsens future changeability. For non-trivial interface, decomposition, or abstraction choices:

1. Compare at least two plausible alternatives.
2. Evaluate each on cognitive load, change amplification, and hidden dependencies.
3. Choose the one that makes the *next* change easiest, not just the current one.

### Strategic vs Tactical Programming

**Tactical programming** optimizes for the current change landing fast: patch where the symptom is, accept whatever complexity that adds. Each patch is locally reasonable; globally, complexity compounds until every change is expensive. **Strategic programming** treats good design as the deliverable and working code as the byproduct: spend a little extra now on the interface or seam that makes future changes cheap. When you catch yourself patching around a structure instead of fixing it, name it — that's tactical debt, and it should be a conscious loan, not a habit.

## Information Hiding

Design interfaces around what callers need to know, not how the implementation works:

- **Hide:** internal representations, storage details, transport protocols, caching strategies, file formats, internal workflow steps.
- **Expose:** only the minimal contract required for correct use.
- **Reject:** fragile staging, setup sequences, mode flags, configuration knobs, and arguments that expose internal choices.

## Define Away Invalid States

Reduce exception surface by changing interfaces or invariants where possible:

- Encode constraints in types or data structures so invalid states are unrepresentable.
- When every caller repeats defensive ceremony, move the check into the module that owns the invariant.
- Special-general decomposition: isolate unusual behavior behind a stronger operation rather than adding flags and conditionals to the common path.

## Names as Design Information

Names reveal abstractions rather than mechanisms:

- A name should tell you *what* concept it represents, not *how* it's implemented.
- Related operations should share conventions (e.g., `resolve_`, `build_`, `compute_` prefixes for distinct operation families).
- Surprising code is complexity even when short. If you have to pause to understand a name, the abstraction boundary is wrong.

## Generality at the Right Level

- **Avoid one-caller overfitting:** don't add abstraction for a single use case.
- **Avoid speculative generality:** don't add extension points "in case we need them later."
- **Isolate rare behavior:** keep common paths clean; push edge cases behind special-case handlers.
- Add generality only when current evidence (two or more real callers) justifies it.

## Clean Code Rules

From Robert C. Martin's *Clean Code*. These apply whenever writing or reviewing implementation code.

### Naming

- Use precise names. One term per concept. Don't use `data`, `result`, `item`, `info`, `payload` when a specific name is available.
- Name the abstraction, not the mechanism. `resolve_discount` not `calculate_from_db`.
- Rename when vocabulary hides intent, overloads meaning, or forces comments to compensate.

### Functions

- Keep functions small, focused, and at one level of abstraction.
- Tell the story top-down: intent appears before detail.
- Keep parameters few and meaningful. Avoid boolean flags, output parameters, and grab-bag argument lists.
- Model the concept instead: if you need a boolean flag, the function is doing two things.

### Command-Query Separation

- A function that answers should not also mutate. Separate commands (change state) from queries (return information).
- Eliminate hidden side effects. If a getter modifies internal state, the caller can't reason about it locally.
- Make mutation explicit: the function name and signature should signal that state changes.

### Error Handling

- Keep the happy path readable. Isolate error handling, invalid-state handling, and cleanup.
- Prefer explicit optionality or typed results over null-like sentinel flow when the language supports it.
- Do not use exceptions for normal control flow.

### Boundaries

- Keep construction, framework, persistence, transaction, security, and vendor details outside business behavior.
- Expose behavior rather than raw representation. Avoid train-wreck access and utility dumping grounds.
- Make public APIs small, explicit, and hard to misuse.
