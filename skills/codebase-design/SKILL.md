---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
license: MIT (adapted from mattpocock/skills)
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. Use this language and these principles wherever code is being designed or restructured. The aim is leverage for callers, locality for maintainers, and testability for everyone.

## Before You Build — The Ladder

Before writing any code, climb this ladder. Stop at the first rung that holds:

1. **Does this need to exist?** If not, delete the requirement, not the code. YAGNI is not a suggestion — it's a discipline.
2. **Does stdlib or the platform already do this?** Use it. Don't wrap what's free. See [Platform Native](references/platform-native.md) for a checklist.
3. **Does an already-installed dependency do this?** Use it. No new `pip install` or `npm add` for what you already ship.
4. **Can it be one line?** One line. No abstraction, no helper, no utility module, no base class.
5. **Only then:** build the minimum that works. Smallest interface, deepest implementation.

**Safety floor — never simplify away:** trust-boundary validation, error handling, security, accessibility, data integrity. The ladder optimizes for less code, not less safety. If a rung would strip a safety guard, stop.

When a shortcut is deliberate, tag it so it's harvestable later:

```python
# SHORTCUT: <what's skipped>. Upgrade: <what to do when this matters>.
```

Use `grep -rnE '(#|//) ?SHORTCUT:' .` across the repo to find accumulated shortcuts before they compound. See [TDD](../tdd/SKILL.md) for the shortcut-lifecycle workflow.

**Ship and question:** build the minimal version, then challenge the requirement. Does the caller actually need this shape? Could the seam move? If the requirement survives scrutiny, the minimal version was the right call. If it doesn't, you saved yourself the over-build. For adversarial requirement review, pair with [Court Jester](../court-jester/SKILL.md).

## Glossary

Use these terms exactly — don't substitute "component," "service," "API," or "boundary." Consistent language is the whole point.

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package, or tier-spanning slice. _Avoid_: unit, component, service.

**Interface** — everything a caller must know to use the module correctly: the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics. _Avoid_: API, signature (too narrow — they refer only to the type-level surface).

**Implementation** — what's inside a module, its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Reach for "adapter" when the seam is the topic; "implementation" otherwise.

**Internal seam** — a seam private to a module's implementation, used by its own tests but never exposed through the external interface. A deep module can have internal seams (e.g., private helper classes, regional splits) without losing depth. Internal seams are invisible to callers; if they become visible, the module has lost its depth.

**Depth** — leverage at the interface: the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.

**Seam** _(Michael Feathers)_ — a place where you can alter behaviour without editing in that place; the *location* at which a module's interface lives. Where to put the seam is its own design decision, distinct from what goes behind it. _Avoid_: boundary (overloaded with DDD's bounded context).

**Adapter** — a concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).

**Leverage** — what callers get from depth: more capability per unit of interface they learn. One implementation pays back across N call sites and M tests.

**Locality** — what maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place rather than spreading across callers. Fix once, fixed everywhere.

## Deep vs shallow

**Deep module** = small interface + lots of implementation:

```
┌─────────────────────┐
│   Small Interface   │  ← Few methods, simple params
├─────────────────────┤
│                     │
│  Deep Implementation│  ← Complex logic hidden
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid):

```
┌─────────────────────────────────┐
│       Large Interface           │  ← Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  ← Just passes through
└─────────────────────────────────┘
```

When designing an interface, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable, swappable parts — they just aren't part of the interface. A module can have **internal seams** (private to its implementation, used by its own tests) as well as the **external seam** at its interface.
- **Deepening and internal splitting are orthogonal axes.** Deepening shrinks the external interface (fewer modules, fewer imports). Internal splitting organizes the implementation (regions, private helpers, labeled sections). They serve different beneficiaries: deepening is a gift to the caller; internal splitting is a gift to the maintainer. They coexist when the interface stays small and stable. They conflict when internal structure leaks into the public API.
- **The temporal sequence: gather first, then split.** Consolidate fragmented logic into one module before decomposing internally. Splitting across files without consolidation is fragmentation wearing a disguise. Splitting within a consolidated domain is genuine decomposition.
- **Internal splitting is legitimate when it serves human readability.** It becomes an escape hatch when it's a cover for indecision ("we'll split internally for testability" while the class grows to 800 lines with no test at the interface level). The burden of proof: tests must exercise the public interface, not private methods.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

## Designing for testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.**

   ```python
   # Testable
   def process_order(order, payment_gateway):
       ...

   # Hard to test
   def process_order(order):
       gateway = StripeGateway(api_key=os.environ["STRIPE_KEY"])
       ...
   ```

2. **Return results, don't produce side effects.**

   ```python
   # Testable
   def calculate_discount(cart) -> Discount:
       ...

   # Hard to test
   def apply_discount(cart: Cart) -> None:
       cart.total -= discount
   ```

3. **Small surface area.** Fewer methods = fewer tests needed. Fewer params = simpler test setup.

## Relationships

- A **Module** has exactly one **Interface** (the surface it presents to callers and tests).
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Rejected framings

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout): rewards padding the implementation. We use depth-as-leverage instead.
- **"Interface" as the Python type hint or a class's public methods**: too narrow — interface here includes every fact a caller must know.
- **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.

## Going deeper

- **Deepening a cluster given its dependencies** — see [Deepening](references/deepening.md): dependency categories, seam discipline, and replace-don't-layer testing.
- **Exploring alternative interfaces** — see [Design It Twice](references/design-it-twice.md): spin up parallel sub-agents to design the interface several radically different ways, then compare on depth, locality, and seam placement.
- **Platform-native reference** — see [Platform Native](references/platform-native.md): what stdlib, frameworks, and browsers provide before you reach for a dependency.

## Reference Index

See [references/REFERENCE.md](references/REFERENCE.md) for the full routing table.
