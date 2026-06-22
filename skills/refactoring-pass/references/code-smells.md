# Code Smells

From Refactoring (Martin Fowler). Use to identify which structural problem you're dealing with and which refactoring move applies.

## Method-Level Smells

| Smell | Symptom | Move |
|---|---|---|
| **Long method** | Method does too much; needs comments to explain sections | Extract method |
| **Long parameter list** | More than 3-4 parameters; parameters travel together | Introduce parameter object, preserve whole object |
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

## Conditional and Control Flow Smells

| Smell | Symptom | Move |
|---|---|---|
| **Repeated conditionals** | Same switch/if-else chain in multiple places | Replace conditional with polymorphism, replace type code with state/strategy |
| **Complex conditional** | Hard-to-read conditional expression | Decompose conditional, extract method for condition |
| **Nested conditionals** | Deeply nested if/else | Replace nested conditional with guard clauses |
| **Switch statements** | Switch on type code that varies behavior | Replace type code with subclasses/state/strategy |

## Data and State Smells

| Smell | Symptom | Move |
|---|---|---|
| **Exposed mutable collection** | Callers manipulate internal collections directly | Encapsulate collection, return copy or read-only view |
| **Public fields** | Fields exposed directly, no encapsulation | Encapsulate field |
| **Duplicated state-transition logic** | Same state machine logic repeated | Consolidate in one place, replace with state pattern |
| **Boolean flags controlling behavior** | Boolean parameters that switch behavior | Replace parameter with explicit methods, extract method |

## Abstraction Smells

| Smell | Symptom | Move |
|---|---|---|
| **Speculative generality** | Abstraction with one caller, unused parameters | Collapse hierarchy, inline class, remove parameter |
| **Dead code** | Unused methods, classes, or parameters | Delete |
| **Pass-through layer** | Module that only delegates, adds no value | Inline, remove middle man |
| **Just-in-case interface** | Interface designed for hypothetical future needs | Remove, inline |

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
