# Technique Execution Safety

Paraphrased from Refactoring.Guru's technique catalog. Each named move is behavior-preserving *only if* its preconditions hold. Run the relevant checklist **before** applying a move from [Refactoring Moves](refactoring-moves.md), and re-run the relevant test or check after each risky step.

## The Public-Compatibility Rule

**Preserve public compatibility, or provide a transition path, whenever a refactoring changes a public interface** — a signature, a class hierarchy, a serialized shape, or anything callers outside your control depend on.

- When callers are numerous or external, add the **new** method/signature first, migrate callers, and remove the old one only once nothing uses it — never delete-then-scramble.
- Before deleting anything "unused", check for **generated, reflected, serialized, plugin-facing, and public** usages. Compiler/IDE "no references" is not proof for these.
- A rename, a moved field, or a collapsed hierarchy that crosses a published boundary needs the same staged transition — atomic rename works only when every caller is in the diff.

This rule outranks the tidiness of the end state. A cleaner internal shape that breaks a public contract is a behavior change, not a refactoring.

## Extraction Safety

- Before **Extract Method**, identify every variable the fragment reads, writes, or returns.
- Leave variables local to the new method when they are declared and used only inside the fragment; pass prior values as parameters only when the fragment genuinely needs them.
- Double-check any variable *modified* inside the fragment: if later code needs the changed value, return it explicitly — or pick a safer move.
- Run **Replace Temp with Query** before extraction when temporaries block a clean method boundary.
- Name the extracted method after its **purpose**, not the mechanical steps. Never hide an important side effect behind a harmless-sounding name.

## Inlining Safety

- Before **Inline Method**, confirm the method adds no useful name, abstraction, override point, or public contract.
- Check all callers first — especially where dynamic dispatch, inheritance, or interface calls are involved. Do not inline a method callers depend on as a public or test-facing API.
- Before **Inline Class**, move all useful behavior and data to the target and update every reference; delete the emptied class only after references, construction sites, tests, and docs no longer need it.

## Moving Safety

- Before **Move Method**, inspect which class owns most of the data the method uses. Extract the moving fragment first when only part of a method belongs elsewhere.
- Update all callers and set visibility intentionally — do not widen access just to make the move compile.
- Before **Move Field**, migrate reads and writes through accessors or direct replacements in a small sequence; preserve initialization, serialization, and persistence behavior.
- Do not move behavior away from its data if the separation was deliberate and supports interchangeable behavior.

## Encapsulation Safety

- Before **Encapsulate Field**, add access methods, migrate all direct readers and writers, *then* make the field private. Review the accessor callers afterward — the behavior may belong inside the owning class.
- Before **Encapsulate Collection**, prevent callers from mutating the internal collection: return a read-only view or copy, and expose add/remove operations that preserve invariants.
- Do not stop at trivial getters/setters if the real smell is behavior living outside the data.

## Conditional Safety

- Before **Consolidate Conditional Expression**, verify the conditions are side-effect free; extract the combined condition into a named query when it is complex.
- Before **Consolidate Duplicate Conditional Fragments**, move shared code out of the branches only when doing so preserves execution order.
- Before **Replace Nested Conditional with Guard Clauses**, identify the normal path and preserve each special case's behavior.
- Before **Replace Conditional with Polymorphism**, confirm the conditional varies by a **stable** type, state, or strategy. For a simple or one-off conditional, prefer explicit methods or leave it in place — polymorphism there obscures a direct rule.

## Method-Call Safety

- Before **Add Parameter**, check whether the method should instead own the data as a field or obtain it through an existing collaborator.
- Before **Remove Parameter**, confirm it is unused or no longer changes behavior — and that it is not part of a public contract.
- Before **Separate Query from Modifier**, split state mutation from returned information and route callers to the right method for each intent.
- Before **Replace Parameter with Explicit Methods**, confirm the parameter selects distinct *behavior*, not ordinary data.
- Before **Introduce Parameter Object**, confirm the grouped parameters represent one concept, not an arbitrary bag.
- Do not simplify a call if the simplification creates hidden dependencies between classes.

## Data-Reorganization Safety

- Before **Replace Data Value with Object**, define the object's meaning, equality, validation, and allowed behavior.
- Before changing value/reference semantics, decide whether identity, mutability, sharing, and lifecycle management are actually required. Make value objects immutable before replacing references with values; use factory creation when replacing values with references so callers receive the canonical object.
- Before changing association direction, identify which side owns updates and how consistency is maintained. Remove a bidirectional association when one side does not navigate; never add one unless both sides genuinely need it and the consistency logic is explicit.

## Generalization Safety

- Before pulling members **up**, confirm sibling duplication is real and the superclass can honestly own the member.
- Before pushing members **down**, confirm the superclass no longer promises or needs the member.
- Before extracting a superclass or interface, identify real shared behavior or a real client-facing subset — not coincidental method names.
- Before collapsing a hierarchy, check remaining subclasses for substitutability and public type expectations.
- Before **Replace Inheritance with Delegation**, preserve the delegated behavior and update construction and forwarding paths deliberately. Only replace delegation *with* inheritance when the delegating class truly is a subtype and inheritance will not create refused bequest.
