# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in [SKILL.md](../SKILL.md) — **module**, **interface**, **seam**, **adapter**.

## Dependency categories

When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is tested across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — merge the modules and test through the new interface directly. No adapter needed.

### 2. Local-substitutable

Dependencies that have local test stand-ins (SQLite for Postgres, in-memory filesystem, `httpx.MockTransport` for HTTP clients). Deepenable if the stand-in exists. The deepened module is tested with the stand-in running in the test suite. The seam is internal; no port at the module's external interface.

### 3. Remote but owned (Ports & Adapters)

Your own services across a network boundary (microservices, internal APIs). Define a **port** (interface) at the seam. The deep module owns the logic; the transport is injected as an **adapter**. Tests use an in-memory adapter. Production uses an HTTP/gRPC/queue adapter.

Recommendation shape: *"Define a port at the seam, implement an HTTP adapter for production and an in-memory adapter for testing, so the logic sits in one deep module even though it's deployed across a network."*

### 4. True external (Mock)

Third-party services (Stripe, Twilio, etc.) you don't control. The deepened module takes the external dependency as an injected port; tests provide a mock adapter.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified (typically production + test). A single-adapter seam is just indirection.
- **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams through the interface just because tests use them.

## Testing strategy: replace, don't layer

- Old unit tests on shallow modules become waste once tests at the deepened module's interface exist — delete them.
- Write new tests at the deepened module's interface. The **interface is the test surface**.
- Tests assert on observable outcomes through the interface, not internal state.
- Tests should survive internal refactors — they describe behaviour, not implementation. If a test has to change when the implementation changes, it's testing past the interface.

## Internal structure of deep modules

A deep module can be internally organized without losing depth. The external interface stays small; the implementation can have structure.

### Regional splitting

Label sections within the class/file:

```python
class OrderDomain:
    # -- Resolution --
    def resolve_for_checkout(self, ...): ...
    def resolve_for_display(self, ...): ...

    # -- CRUD --
    def create_order(self, ...): ...
    def update_status(self, ...): ...
```

Regions are for human navigation, not architectural boundaries. They don't create new seams.

### Private helper classes

When a region exceeds ~120 lines, extract a private class **inside the same file**:

```python
class _LineItemManager:
    """Internal: manages line item CRUD and default promotions."""
    def __init__(self, domain: OrderDomain): ...
    def create(self, ...): ...
    def delete(self, ...): ...

class OrderDomain:
    def __init__(self):
        self._line_items = _LineItemManager(self)
```

The external boundary stays one import. Internal structure is invisible to callers.

### Stopping criteria

- **Public methods ≤ 8.** If the module exposes more, extract a sub-service with its own interface.
- **Internal regions ≤ 4.** CRUD, Dashboard, Receiver, Misc. If a region exceeds ~120 lines, extract a private class.
- **Total file ~600 lines.** Beyond that, even well-organized regions become hard to scan. Extract to a sibling file in the same package, but keep the external interface in the original module.

### When to stop deepening

Stop consolidating when adding a new responsibility would increase the public interface beyond what one caller can learn in one sitting. If the module's purpose can't be explained in one sentence, it's doing too much.

### The gather-then-split methodology

1. **Gather:** consolidate fragmented logic into one module. This establishes the boundary.
2. **Verify:** count public methods. If ≤ 8, the module is deep. If > 8, extract sub-services.
3. **Split internally:** organize the implementation into regions or private classes. This serves human readability.
4. **Stabilize:** internal structure should settle within 1–2 iterations. If it doesn't, the interface is wrong.

If "internal splitting" becomes permanent flux — regions that keep growing, methods constantly extracted and re-extracted — the module has no shape. Internal structure must stabilize. If it doesn't, the interface is wrong, and the module needs to be split externally.
