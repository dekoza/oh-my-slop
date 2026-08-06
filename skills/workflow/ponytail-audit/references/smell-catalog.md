# Code Smell Catalog

Expanded detection guide for the ponytail audit. Based on Refactoring.Guru's smell catalog. Use alongside the existing bloat/over-engineering checks in [SKILL.md](../SKILL.md).

The existing SKILL.md tags (`delete`, `stdlib`, `native`, `yagni`, `shrink`) still apply. This catalog adds *what to look for* before you tag.

## Bloat (already in SKILL.md)

- **Dead code** — functions, classes, imports, or modules nothing references
- **Reinvented stdlib** — hand-rolled versions of standard library functions
- **Speculative abstraction** — interface/protocol/base class with one implementation
- **Pass-through wrapper** — module that only delegates to another
- **Dead flags** — config options, feature toggles, or conditionals that are always true/false

## Method-Level Smells

- **Long method** — a method/function that does too much. Extract helper methods. If you need a comment to explain a section, that section wants to be a method.
- **Long parameter list** — more than 3-4 parameters. Introduce a parameter object or value object.
- **Duplicated code** — the same code in two or more places. Extract a shared function. Third repetition is the trigger: don't copy again.
- **Primitive obsession** — using primitives (strings, ints, numbers) where a value object would carry meaning. `money: float` → `Money` with currency and amount.
- **Repeated conditionals** — the same switch/if-else chain in multiple places. Consider polymorphism, strategy, or a lookup table.
- **Temporary field** — a field that's only set in certain circumstances, leaving the object in an incomplete state. Move it to a parameter or a separate object.

## Class-Level Smells

- **Large class** — a class with too many responsibilities (god class). Split by responsibility, not by size.
- **Divergent change** — one class changes for many different reasons. Each reason to change should be a separate class.
- **Shotgun surgery** — one change requires edits across many classes. The knowledge belongs in one place.
- **Feature envy** — a method that uses another class's data more than its own. Move the method to where the data lives.
- **Data clumps** — the same group of parameters passed together everywhere. Extract a value object.
- **Refused bequest** — a subclass that doesn't use most of what it inherits. The hierarchy is wrong; flatten or restructure.
- **Middle man** — a class that only delegates to another. Remove the middle man.

## Architecture Smells

- **Message chain** — `a.getB().getC().getD().doSomething()`. The caller knows too much about the intermediate structure. Hide the chain behind a method.
- **Inappropriate intimacy** — two classes that know too much about each other's internals. Reduce coupling; expose only what's needed.
- **Speculative generality** — "we might need this someday." If there's only one use case, build for that case. YAGNI.
- **Lazy class** — a class that does almost nothing. Inline it into its caller.
- **Dead library** — a dependency that nothing actually imports. Remove it.

## Detection Heuristics

When scanning, ask:

1. **Can I explain what this does in one sentence?** If not, it's doing too much.
2. **How many reasons does this have to change?** More than one → split it.
3. **If I delete this, how many places break?** Zero → dead code. One → maybe YAGNI. Many → earning its keep.
4. **Is this the simplest thing that works?** If a simpler version would work, flag the complex one.
5. **Would I write this again today?** If not, it's a candidate for replacement, not preservation.

## What This Catalog Does NOT Cover

- **Correctness bugs** — out of scope for ponytail-audit
- **Security issues** — out of scope
- **Performance problems** — out of scope
- **Test quality** — out of scope (that's TDD's job)

This catalog expands *detection*. The existing SKILL.md rules for *tagging and output format* still apply. Use this to find more smells; use the SKILL.md tags to report them consistently.
