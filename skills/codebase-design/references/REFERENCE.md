# Codebase Design — Reference Index

## Files

| File | Domain | Use For |
|---|---|---|
| [Deepening](deepening.md) | Dependency categories | Classifying dependencies before deepening a module cluster; seam discipline; replace-don't-layer testing |
| [Design It Twice](design-it-twice.md) | Interface exploration | Spinning parallel sub-agents to design radically different interfaces, then comparing on depth, locality, and seam placement |
| [Platform Native](platform-native.md) | Stdlib / platform checklist | What's already available before adding a dependency — Python, Django, Browser, Node, PostgreSQL |
| [Complexity](complexity.md) | Cognitive load + clean code rules | Pull complexity downward, information hiding, naming discipline, command-query separation, function design, error handling, boundary isolation |
| [Clean Architecture](clean-architecture.md) | Dependency direction + boundary testing | Dependency rule, what goes where, dependency inversion at seams, boundary testing, recognizing violations, incremental extraction |

## Quick routing

- Classifying dependencies before a refactor → `deepening.md`
- Exploring alternative interfaces → `design-it-twice.md`
- Checking if stdlib/platform already provides something → `platform-native.md`
- Reducing cognitive load, hiding complexity, comment discipline → `complexity.md`
