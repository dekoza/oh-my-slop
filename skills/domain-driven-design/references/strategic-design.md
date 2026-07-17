# Strategic Design

From Domain-Driven Design (Evans), DDD Distilled (Vernon), and Implementing DDD (Vernon). Use when defining the large-scale structure of a system — contexts, boundaries, and relationships.

## Subdomain Classification

Every business capability belongs to exactly one subdomain type:

### Core Domain
- **What:** The competitive advantage. What makes this business different.
- **Modeling:** Highest investment. Rich domain model, best people, continuous iteration with domain experts.
- **Example:** Pricing engine for an e-commerce platform, matching algorithm for a dating app.

### Supporting Subdomain
- **What:** Needed for the business to function, but not a differentiator.
- **Modeling:** Model honestly, but don't over-invest. Use DDD patterns where they clarify, skip them where they don't.
- **Example:** Inventory management, order fulfillment workflow.

### Generic Subdomain
- **What:** Commodity capabilities that any business needs.
- **Modeling:** Lowest investment. Buy off-the-shelf, use simple CRUD, or build with minimal ceremony.
- **Example:** Authentication, email notifications, audit logging, user management.

**Rule:** Spend your best modeling effort on the Core Domain. Resist the urge to apply the same level of DDD ceremony everywhere.

## Bounded Context Definition

A Bounded Context is a **linguistic and conceptual boundary** within which a model is defined and applicable.

To define a Bounded Context:
1. **Name it** after the business capability it serves (not the technical subsystem).
2. **Define its Ubiquitous Language** — the terms and their meanings within this context.
3. **Identify its subdomains** — which parts are Core, Supporting, Generic.
4. **Define its boundaries** — what's inside, what's outside.
5. **Map its relationships** — how it integrates with other contexts.

**Critical rule:** The same word in different Bounded Contexts may mean different things. "Customer" in sales (lead, contact info) is not "Customer" in billing (account, payment history). Don't share domain classes across contexts.

## Context Mapping

Draw a context map showing all Bounded Contexts and their relationships. This is a strategic design artifact — keep it updated.

### Relationship Patterns

#### Partnership
Two teams coordinate closely. Models evolve together.
- **Governance:** Joint design sessions, shared understanding.
- **Risk:** Requires ongoing coordination. If teams diverge, integration breaks.

#### Shared Kernel
A small, stable part of the model is shared between two contexts.
- **Governance:** Joint ownership, shared tests, no changes without both teams agreeing.
- **Risk:** Shared Kernel must stay small and stable. If it grows, it becomes a coupling point.
- **When to use:** Only when the overlap is genuinely stable and both teams can govern it.

#### Customer / Supplier
Downstream context depends on upstream. Upstream prioritizes downstream's needs.
- **Governance:** Upstream team consults downstream before making breaking changes.
- **Risk:** Upstream may deprioritize downstream's needs under pressure.

#### Conformist
Downstream context has no leverage to influence upstream. It conforms to upstream's model exactly.
- **Governance:** None. Downstream adapts to whatever upstream provides.
- **Risk:** Downstream model is shaped by upstream's design decisions, which may not fit.

#### Anticorruption Layer (ACL)
Downstream context translates upstream's foreign model into its own language.
- **Governance:** Downstream owns the translation layer. Upstream model never leaks into downstream domain.
- **Risk:** Translation adds complexity. Keep the ACL focused on the boundary.
- **When to use:** Integrating with legacy systems, external APIs, or any context with a model that doesn't fit yours.

#### Open Host Service (OHS)
Upstream provides a well-defined protocol for multiple downstream consumers.
- **Governance:** Upstream maintains a published API contract. Version carefully.
- **Risk:** Supporting multiple consumers with different needs.

#### Published Language
A shared format (schema, API contract) used for integration between contexts.
- **Governance:** The language is versioned and documented. Changes are backward-compatible or versioned.
- **When to use:** Cross-organization integration, event schemas, API contracts.

#### Separate Ways
No integration. Contexts are independent.
- **Governance:** None needed.
- **When to use:** When there's genuinely no dependency. Don't force integration where none exists.

#### Big Ball of Mud (Containment)
A neighboring system has no coherent model — tangled, inconsistent, unbounded.
- **Governance:** Draw a boundary around it on the context map and translate at that boundary (typically via an Anticorruption Layer). Don't try to model inside it.
- **Rule:** Treat a Big Ball of Mud as a context to contain and translate around, not as a model to spread. Its language never leaks into your contexts.

#### Incremental Legacy Replacement
A legacy system is phased out by moving its responsibilities into the new model one at a time.
- **Governance:** Protect the new model behind translation layers; each migrated responsibility crosses the boundary through an explicit translation.
- **Risk:** The intermediate state (two systems running side by side) must be managed deliberately, or the migration stalls halfway.
- **When to use:** Replacing a legacy system where a big-bang rewrite is riskier than incremental migration.

## Choosing Context Boundaries

Ask these questions:
1. **Language boundary:** Where does the meaning of a term change?
2. **Team boundary:** Where does ownership change?
3. **Consistency boundary:** What must be transactionally consistent?
4. **Change frequency:** What changes together should be together?
5. **Volatility:** Isolate volatile parts from stable parts.

## Context Mapping Heuristic

Start with the business capabilities. Group them by:
- Shared language (same terms, same meanings)
- Shared team (same people own it)
- Shared consistency requirements (must be updated together)

Each group becomes a candidate Bounded Context. Validate by checking that terms have consistent meanings within each context.
