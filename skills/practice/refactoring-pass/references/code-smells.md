# Code Smells

From Refactoring (Martin Fowler) and the Refactoring.Guru catalog. Use to identify which structural problem you're dealing with and which refactoring move applies.

## Scan Order: The Six Smell Families

When you touch existing code, scan for smells in this order — coarse-to-fine, structural-cost-first. Each family names *why* its smells make change harder, which is what tells you whether the smell is worth treating.

1. **Bloaters** — code grew too large to understand or change as one unit (long method, large class, primitive obsession, long parameter list, data clumps).
2. **Object-Orientation Abusers** — inheritance, type codes, or conditionals misuse the object model (switch statements, temporary field, refused bequest, alternative classes with different interfaces).
3. **Change Preventers** — one change forces edits in many places, or one class changes for unrelated reasons (divergent change, shotgun surgery, parallel inheritance hierarchies).
4. **Dispensables** — code that exists without earning its maintenance cost (comments-as-deodorant, duplicate code, lazy class, data class, dead code, speculative generality).
5. **Couplers** — classes know too much about each other, or delegate so much that responsibility disappears (feature envy, inappropriate intimacy, message chains, middle man).
6. **Library Gaps** — an external class you can't change forces duplicated workarounds (incomplete library class).

For each smell: name the symptom, name the maintenance cost it creates, check whether it is local / repeated / architectural, and confirm it is a real problem and not a style preference. Then pick the smallest treatment from the [priority map](#smell--treatment-priority-map) — and check the [exceptions](#when-not-to-treat-a-smell) before you act.

## Method-Level Smells

| Smell | Symptom | Move |
|---|---|---|
| **Long method** | Method does too much; needs comments to explain sections | Extract method |
| **Long parameter list** | Parameter list grows beyond local reasoning (often around 3-4) — a signal, not a rule; parameters travel together | Introduce parameter object, preserve whole object |
| **Confusing argument order** | Callers must memorize positional argument order to call correctly | Introduce parameter object, replace parameter with explicit methods, keyword arguments |
| **Duplicated code** | Same code in two or more places | Extract method, pull up method, form template method |
| **Primitive obsession** | Primitives (string, int) where a value object would carry meaning | Replace data value with object, replace type code with class |
| **Temporary field** | Field only set in certain circumstances, leaving object incomplete | Extract class, move field |
| **Message chain** | `a.getB().getC().getD().doSomething()` | Hide delegate, extract method + move method |

## Class-Level Smells

| Smell | Symptom | Move |
|---|---|---|
| **Large class** | Class has too many responsibilities (god class) | Extract class, extract subclass, extract interface |
| **Divergent change** | One class changes for many different reasons | Extract class |
| **Shotgun surgery** | One change requires edits across many classes | Move method/field, inline class |
| **Feature envy** | Method uses another class's data more than its own | Move method |
| **Data clumps** | Same group of parameters passed everywhere | Extract class, introduce parameter object |
| **Refused bequest** | Subclass doesn't use most of what it inherits | Replace inheritance with delegation, extract superclass |
| **Middle man** | Class only delegates to another | Remove middle man, inline method |
| **Global data / hidden dependencies** | Reliance on globals, singletons, or ambient context; dependencies invisible in signatures | Make dependencies explicit — refactor toward injection, parameters, or clear ownership |
| **Alternative classes with different interfaces** | Two classes do the same job but expose different method names/signatures | Rename method, move method, extract superclass; delete one once redundant |
| **Parallel inheritance hierarchies** | Adding a subclass in one hierarchy forces a matching subclass in another | Move methods/fields so one hierarchy owns the variation; collapse the mirror |
| **Lazy class** | A class no longer does enough to justify its maintenance cost | Inline class, collapse hierarchy |
| **Data class** | Class only stores data with crude getters/setters while clients do the behavior | Encapsulate field/collection, move behavior onto the data, remove broad setters |
| **Inappropriate intimacy** | Classes rely on each other's internals or spend too much time together | Move method/field, hide delegate, replace inheritance with delegation |
| **Incomplete library class** | An external class you can't change lacks a method you need | Introduce foreign method (one or two ops); introduce local extension (substantial) |

## Conditional and Control Flow Smells

| Smell | Symptom | Move |
|---|---|---|
| **Repeated conditionals** | Same switch/if-else chain in multiple places | Replace conditional with polymorphism, replace type code with state/strategy |
| **Complex conditional** | Hard-to-read conditional expression | Decompose conditional, extract method for condition |
| **Nested conditionals** | Deeply nested if/else | Replace nested conditional with guard clauses |
| **Switch statements** | Switch on type code that varies behavior | Replace type code with subclasses/state/strategy |
| **Duplicate conditional fragments** | Identical code appears in all branches of a conditional | Consolidate duplicate conditional fragments — move the shared code out of the conditional |
| **Repeated null checks** | Same null/None check with the same fallback behavior everywhere | Introduce null object |
| **Mapping conditionals** | if/else or switch that only maps inputs to outputs | Replace with a lookup/decision table when the mapping logic is stable |

## Data and State Smells

| Smell | Symptom | Move |
|---|---|---|
| **Exposed mutable collection** | Callers manipulate internal collections directly | Encapsulate collection, return copy or read-only view |
| **Public fields** | Fields exposed directly, no encapsulation | Encapsulate field |
| **Duplicated state-transition logic** | Same state machine logic repeated | Consolidate in one place, replace with state pattern |
| **Boolean flags controlling behavior** | Boolean parameters that switch behavior | Replace parameter with explicit methods, extract method |
| **Parameter reassignment** | A parameter is reassigned inside the method, obscuring what the input was | Remove assignments to parameters — use a local variable |
| **Unnecessary setters** | Setter exists for a field that should not change after construction | Remove setting method |

## Abstraction Smells

| Smell | Symptom | Move |
|---|---|---|
| **Speculative generality** | Abstraction with one caller, unused parameters | Collapse hierarchy, inline class, remove parameter |
| **Dead code** | Unused methods, classes, or parameters | Delete |
| **Pass-through layer** | Module that only delegates, adds no value | Inline, remove middle man |
| **Just-in-case interface** | Interface designed for hypothetical future needs | Remove, inline |
| **Comments as deodorant** | Comments explain *what* unclear code does instead of *why* it exists | Extract variable/method, rename; keep comments only for rationale, constraints, and algorithms that resisted simpler structure |

## Smell → Move Quick Reference

| If you see... | Consider... |
|---|---|
| Same code twice | Extract method |
| Same code three times | Extract + parameterize |
| Method with sections | Extract each section |
| Class with two responsibilities | Extract class |
| Method that lives in the wrong class | Move method |
| Boolean flag switching behavior | Replace with explicit methods |
| Repeated switch on type | Polymorphism or strategy |
| Long parameter list | Parameter object |
| Class that only delegates | Remove middle man |
| Unused abstraction | Delete / inline |

## Smell → Treatment Priority Map

After diagnosing the smell, start with the **preferred** treatment. Move to the **fallback** only when the preferred one is blocked. Treat the **risky** option as needing stronger tests and explicit justification — it changes more than the smell requires.

| Smell | Prefer | Fallback (when preferred is blocked) | Risky (needs stronger justification) |
|---|---|---|---|
| **Long method** | Extract method | Replace temp with query, introduce parameter object, preserve whole object | Replace method with method object (new object, reshaped algorithm) |
| **Large class** | Extract class | Extract subclass (variant behavior), extract interface (client subset) | Broad hierarchy extraction before responsibilities are stable |
| **Primitive obsession** | Replace data value with object, replace magic number with constant, replace array with object | Type-code refactorings when behavior varies by code | Replace type code with subclasses / state-strategy before variation is stable |
| **Long parameter list** | Replace parameter with method call, preserve whole object | Introduce parameter object | Removing parameters by creating hidden object dependencies |
| **Data clumps** | Extract class, introduce parameter object | Preserve whole object | Passing a large owner object merely to shorten a signature |
| **Switch statements** | Extract method + move method to isolate the decision | Type-code replacement | Replace conditional with polymorphism when the conditional is simple or unstable |
| **Temporary field** | Extract class, replace method with method object | Introduce null object for absence checks | Spreading optional half-state through more conditionals |
| **Refused bequest** | Push down method / field | Replace inheritance with delegation | Preserving inheritance only to avoid changing callers |
| **Alternative classes w/ different interfaces** | Rename method + align signatures | Extract superclass | Merging classes across library or ownership boundaries |
| **Divergent change** | Extract class | Extract superclass / subclass for genuine shared behavior | Inheritance used to dodge a clear responsibility split |
| **Shotgun surgery** | Move method + move field to centralize ownership | Inline class or extract class | Adding forwarding layers without reducing edit sites |
| **Parallel inheritance hierarchies** | Move methods/fields to collapse mirrored variation | Collapse hierarchy | Adding the next paired subclass without redesigning ownership |
| **Comments** | Extract variable / method, rename | Introduce assertion for hidden state assumptions | Deleting comments before the code is self-explanatory |
| **Duplicate code** | Extract method | Pull up / extract superclass (siblings); extract class (separate concept) | Merging coincidental similarity likely to diverge |
| **Lazy class** | Inline class | Collapse hierarchy | Keeping a class only because future work *might* need it |
| **Data class** | Encapsulate field + encapsulate collection | Move method / extract method to bring behavior to the data | Stopping after trivial accessors |
| **Dead code** | Delete after usage checks | Inline class, collapse hierarchy, remove parameter | Deleting externally reachable API |
| **Speculative generality** | Inline method / class, remove parameter, delete field | Collapse hierarchy | Removing framework extension points without checking users |
| **Feature envy** | Move method | Extract the envying fragment before moving it | Moving behavior deliberately separated for interchangeable strategy use |
| **Inappropriate intimacy** | Move method + move field | Hide delegate, replace inheritance with delegation | Widening visibility to preserve the intimacy |
| **Message chains** | Hide delegate | Move method closer to the data | Adding a middle man that only forwards |
| **Middle man** | Remove middle man | Inline class | Removing a boundary that hides volatile structure or policy |
| **Incomplete library class** | Introduce foreign method (narrow gap) | Introduce local extension (repeated substantial gap) | Broadly wrapping or forking the library |

## When NOT to Treat a Smell

A smell is a prompt to *look*, not a mandate to *change*. Confirm the treatment actually improves clarity for **this** codebase before applying it. Legitimate reasons to leave a smell in place:

- **Simple conditional** — leave it alone when replacing it with polymorphism would obscure a direct, easy-to-read rule.
- **Duplicate fragments** — keep them separate when the shared abstraction would be less obvious than the duplication, or when the copies are only coincidentally similar and likely to diverge.
- **Comments** — keep those that explain *why*, capture external constraints, or document an algorithm that has already resisted simpler structure.
- **Small class** — keep it when it communicates a real extension point or boundary.
- **Behavior separated from data** — keep it when the design intentionally supports interchangeable (strategy-like) behavior.
- **Long parameter list** — tolerate it temporarily when removing parameters would create a stronger unwanted dependency.

Two standing rules around exceptions:

- **Report intentional non-treatment.** When you leave a visible smell in code you touched, say so and say why — don't leave it silent.
- **Don't chain into unrelated smells.** Stop when the diagnosed smell is fixed. Record any newly-spotted smell separately unless it blocks the current change; discovering a second smell is not a licence to keep going.
