# Survey: six unported agent-rules-books directories vs oh-my-slop (2026-07-17)

Asset of wayfinder ticket [Group and name the six unported agent-rules-books directories as new skills](http://192.168.129.37:30008/minder/oh-my-slop/issues/7). Produced by a survey sub-agent from a fresh clone of [dekoza/agent-rules-books](https://github.com/dekoza/agent-rules-books); grounding for tickets #18–#21.

Every book directory ships three tiers: `<name>.md` (full, canonical), `<name>.mini.md` (recommended working size), `<name>.nano.md` (~2.2–2.8 KB fallback). All minis share one template: When to use / Primary bias / Decision rules / Trigger rules / Final checklist.

## 1. The six unported directories

### clean-architecture (mini: 758 words; full 17.8 KB, nano 2.3 KB)

- Dependency rule: source dependencies point inward; domain/use cases must not import frameworks, DBs, web handlers, queues, UI types.
- Entities hold enterprise rules; focused use cases hold application orchestration; plain request/response models cross use-case boundaries (no ORM rows, framework contexts).
- Inner layers own the interfaces (ports); outer layers implement them; wiring lives in a composition root.
- Humble adapters: controllers/presenters/gateways translate, never decide business rules.
- Package structure by use case/business capability, not technical buckets; no `common`/`core` escape hatches.
- Boundary selection by volatility/cost, including deliberately partial boundaries; don't merge use cases when sharing couples actors or change reasons.
- Enforce boundaries with package/build/visibility rules and tests; test entities/use cases without real infrastructure.
- Incremental boundary extraction over rewrites; document unavoidable compromises at the outermost layer.

### clean-code (mini: 582 words — the smallest of the six; full 13.9 KB)

- Cleanliness as part of delivery; leave touched code cleaner within scope (boy-scout rule).
- Precise naming, one term per concept; small functions at one abstraction level, told top-down.
- Few parameters; no boolean flags, output params, grab-bag arg lists.
- Command-query separation; no hidden side effects; isolate error handling from the happy path; typed results over null sentinels.
- Expose behavior not representation (no train wrecks, utility dumping grounds, mixed-responsibility classes).
- Keep construction/framework/persistence/vendor details out of business behavior; small hard-to-misuse public APIs.
- Comments only for rationale/constraints/contracts; tests as production code; emergent design, no needless abstraction.
- Smallest-cleanup scope control; concurrency isolation trigger.

### code-complete (mini: 938 words; full 12.4 KB)

- Pre-construction prerequisites checklist (requirements, architecture, conventions, error policy, data representation clear enough before large work).
- Pseudocode/intent-comment-first for complex routines.
- Variable/data discipline: purpose-revealing names, small scope, named constants, types that make invalid values unrepresentable, booleans only for true binaries, enums for closed sets, visible units.
- Control-flow simplicity: shallow nesting, named predicates, clear loop structure, no side-effect-dependent expressions.
- Table-driven/data-driven logic rules (only when clearer and validated).
- Defensive programming: assertions for programmer assumptions vs validation/domain errors for expected external failures; validate at trust boundaries; never continue from corrupted state.
- Incremental construction/integration; reviews/inspections matched to defect risk; debugging by reproduce→isolate→explain→fix→verify.
- Evidence-based performance tuning (target, measure, one change, remeasure); layout/coding-standard conformance; tooling as leverage.

### the-pragmatic-programmer (mini: 1010 words; full 13.4 KB)

- Ownership/accountability: surface tradeoffs instead of blaming tools/schedule; broken-windows rule.
- DRY at the knowledge level: one authoritative owner per system fact (rules, schemas, mappings, config meaning, manual process steps), rest derived/traced.
- Orthogonality: independent components, narrow interfaces, separated policy/mechanism/data/presentation.
- Reversibility: don't hard-code volatile vendor/platform/policy decisions before evidence.
- Tracer bullets (thin end-to-end slices) vs prototypes (learn, then discard); dig for real requirements behind proposed solutions.
- Automate repetitive/ritual work (builds, tests, setup, release), versioned and reproducible.
- Contracts/assertions; error taxonomy (programmer error vs contract violation vs expected/retryable/permanent failure); resource ownership and cleanup on all paths.
- Plain text/inspectable formats and versioned config; shared mutable state and temporal coupling treated as costs.
- Debug from reproduced facts; small increments with honest estimates; add a regression test whenever a human finds a bug.

### patterns-of-enterprise-application-architecture (mini: 1114 words — largest mini; full 15.5 KB)

- Responsibility layering: presentation, workflow, domain logic, data source, transactions, concurrency, integration must not collapse into one class; no pass-through "layering theater".
- Business-logic pattern chosen by force: Transaction Script vs Table Module vs Domain Model, with explicit escalation criteria.
- Service Layer for application operations and transaction ownership; Remote Facade + DTOs at remote boundaries (DTOs are transport, not domain).
- Persistence patterns: Repository, Data Mapper, Gateway; Active Record only for simple domains that accept persistence coupling.
- Identity Map, Unit of Work, Lazy Load (with N+1/serializer-surprise cautions); explicit O-R mapping decisions (inheritance mapping, query objects, metadata mapping).
- Concurrency: optimistic vs pessimistic vs coarse-grained/implicit offline locks; short transactions; remote calls outside transactions.
- Session state placement (client/server/database) with scaling/cleanup/security forces.
- Base-pattern catalog on concrete pressure only: Gateway, Mapper, Layer Supertype, Separated Interface, Registry, Value Object/Money, Special Case, Plugin, Service Stub, Record Set.
- Don't distribute by default; per-responsibility testing; forbidden-pattern review blockers (generic CRUD repository, ORM model doubling as aggregate/DTO, controller owning workflow).

### refactoring-guru (mini: 899 words; full 62.6 KB / 765 lines — ~3.5× the other fulls)

- **No design-patterns catalog.** The full file's headings cover only the refactoring.guru *refactoring* section: process, smells, techniques.
- Process: separate refactoring from feature/bugfix; diagnose smell → smallest treatment → verify → stop; Rule of Three; technical debt as compounding cost.
- Smell taxonomy: 22 named smells in six categories (Bloaters, OO Abusers, Change Preventers, Dispensables, Couplers, Incomplete Library Class).
- Technique groups: composing methods, moving features, organizing data, simplifying conditionals, simplifying method calls, generalization — each with a playbook.
- A smell-to-treatment priority map and "decision anti-patterns" section.
- Per-technique execution-safety checklists (extraction, inlining, moving, encapsulation, conditional, data reorganization, generalization) — pre-flight checks on inputs/outputs/mutations/callers/visibility/invariants.
- Public-compatibility/transition-path rule for signature/hierarchy changes; smell exception rules (when *not* to treat).
- An explicit "Refactoring Workflow for Agents" plus review checklist.

## 2. Overlap analysis vs existing oh-my-slop skills

- **clean-architecture**: largely pre-covered. `skills/codebase-design/references/clean-architecture.md` is an explicit Clean Architecture reference (dependency rule diagram, layer table, DI at seams, boundary testing, violation recognition, incremental extraction, "lightest enforceable boundary"). `domain-driven-design` covers application services, package structure, keeping infrastructure out of the domain; `refactoring-pass` has "separate business policy from delivery mechanics"; `legacy-code` covers incremental extraction under tests. **Uncovered**: component-level rules (acyclic components, stability-directed dependencies), boundary-cost calculus/partial boundaries, the actor/change-reason rule against merging use cases, embedded/hardware framing.
- **clean-code**: the most redundant of the six. Naming/small functions/smell-scoped cleanup → `refactoring-pass`; comment discipline and small hard-to-misuse interfaces → `codebase-design` (near-identical policies); tests-as-production-code → `tdd`/`testing-workflow`; boundary adapters → `codebase-design`/`domain-driven-design`. **Uncovered residue**: explicit command-query separation, null-sentinel/typed-result rule, the concurrency-isolation trigger — thin.
- **code-complete**: debugging loop → `diagnosing-bugs` (same reproduce→isolate→explain loop, far more operationalized); incremental verified construction → `tdd`; refactor-separate-from-behavior → `refactoring-pass`; trust-boundary validation partially → `production-readiness`. **Uncovered**: pre-construction prerequisites checklist, pseudocode-first process, variable/data-type discipline (enums, units, named constants, invalid-state-unrepresentable types), table-driven logic rules, assertions-vs-validation distinction, measured performance-tuning protocol, coding-standard/layout conformance.
- **the-pragmatic-programmer**: `tdd` already contains a named "Tracer Bullet" workflow step; debugging-from-facts → `diagnosing-bugs`; regression-test-on-human-found-bug → `tdd`/`testing-workflow`; YAGNI/orthogonality/leverage → `codebase-design` ladder; failure taxonomy and resource cleanup partially → `production-readiness`; commit communication → `git-discipline`; requirements digging partially → `documentation-lifecycle` (spec interview) and `grilling`. **Uncovered**: DRY-at-knowledge-level (one owner per fact), reversibility of volatile decisions, automation-of-manual-rituals mandate, plain-text/versioned-config preference, broken-windows norm, estimate/uncertainty communication.
- **patterns-of-enterprise-application-architecture**: see §4.
- **refactoring-guru**: see §3.

## 3. Special case: refactoring-guru vs refactoring-pass

Upstream itself marks Refactoring↔Refactoring.Guru as 🔁 with **90% overlap / 8% conflict** (`docs/compatibility/refactoring/refactoring-guru.md`): "Choose one… Loading both mostly repeats behavior preservation, smell diagnosis, smallest treatment, verification, and stop-condition guidance." `refactoring-pass` already has: behavior preservation, feature/structure separation, ~10 smells, ~10 named moves, safety net/characterization, third-repetition rule (= Rule of Three), stop conditions, anti-speculative-generality. **Distinct in refactoring-guru**: the fuller 22-smell taxonomy with category names (adds Temporary Field, Refused Bequest, Alternative Classes with Different Interfaces, Parallel Inheritance Hierarchies, Lazy Class, Data Class, Inappropriate Intimacy, Incomplete Library Class/Foreign Method/Local Extension), the smell→treatment priority map, per-technique execution-safety checklists, the public-compatibility/transition-path rule, and explicit smell-exception rules. Not distinct: design patterns — the file contains none, despite the site's fame for them.

## 4. Special case: PoEAA vs django/drf/data-intensive/DDD

- **Already embodied/covered**: Active Record is the Django ORM itself; `django` covers its sharpest Lazy Load consequences (N+1 via `select_related`/`prefetch_related` as "Critical Rule #2"). DTO-at-boundary is embodied by DRF serializers (`drf` Critical Rules). Repository, Domain Model, Service Layer≈Application Services, keep-rules-out-of-controllers → `domain-driven-design`. Transactions/isolation anomalies (lost update, write skew) and derived-data concerns → `data-intensive`. Coarse-grained remote interactions and failure-aware contracts → `production-readiness`.
- **Not covered anywhere**: the *force-based choice* among Transaction Script/Table Module/Domain Model (existing skills only offer the DDD "when overkill" escape); Identity Map and Unit of Work as named concepts; optimistic/pessimistic/coarse-grained/implicit **offline** locks (application-level concurrency, distinct from DB isolation in `data-intensive`); session-state placement; Remote Facade; the base-pattern catalog (Registry, Separated Interface, Special Case, Plugin, Service Stub, Layer Supertype); "layering theater" and forbidden-pattern review blockers.
- Upstream flags **DDD↔PoEAA and IDDD↔PoEAA as its only two ❌ conflicts** (62% conflict): DDD pushes rich domain modeling while PoEAA explicitly permits Transaction Script/Table Module/Active Record; equal loading "can make the agent oscillate." Their guidance: DDD primary, PoEAA constrained to specific infrastructure decisions.

## 5. Repo grouping and merging precedent

- `README.md`: 14 rule sets × three tiers; mini recommended; points to `docs/USAGE.md` (delivery: always-on vs skills, per-editor setup) and `docs/COMPATIBILITY.md` for combining.
- `docs/COMPATIBILITY.md`: full pairwise matrix with per-pair evidence files (`docs/compatibility/<a>/<b>.md`, each with conflict/overlap/complementarity percentages and "Use Together When"/"Prefer One When"). Verdicts: 78 ✅ complementary, 2 ❌ (both PoEAA-vs-DDD-family), 11 🔁 (notably Clean Code vs APoSD/Code Complete/PragProg; Code Complete vs PragProg; Clean Architecture vs IDDD and vs PoEAA; the DDD trio pairwise; DDD-Distilled vs PoEAA; Refactoring vs Refactoring.Guru).
- **No multi-source merged rule set exists upstream**: the three DDD books remain separate directories, marked pairwise 🔁 ("choose one"). The DDD-trio merge is an oh-my-slop-side precedent (`skills/domain-driven-design/SKILL.md`: "Synthesized from" Evans + both Vernons) — upstream's matrix supports that merge only implicitly, by classifying the trio as overlapping substitutes rather than complements.
- README also documents a validation experiment (mini rules vs book-name-only prompt, ~74 vs ~46 as rated by ChatGPT) and states the rule sets intentionally avoid reproducing book text.
