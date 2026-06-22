# Seam Techniques

From Working Effectively with Legacy Code (Michael Feathers). Use when direct edits to legacy code are too risky. Choose the technique that adds behavior with minimal changes to the existing code.

## Sprout Method

**When:** New behavior can be added without deeply editing fragile code.

**Pattern:**
```python
# Before: all behavior in one risky method
def process_order(self, order):
    # ... 200 lines of fragile legacy code ...
    pass

# After: new behavior sprouted into its own method
def process_order(self, order):
    # ... 200 lines of fragile legacy code (untouched) ...
    self._apply_new_discount_logic(order)  # small insertion point

def _apply_new_discount_logic(self, order):
    # new behavior, fully tested in isolation
    ...
```

**Rules:**
- Keep the old code mostly untouched.
- The insertion point should be a single call.
- The new method is tested independently.

## Sprout Class

**When:** A new responsibility doesn't fit the old class, or the old class is too risky to reshape.

**Pattern:**
```python
# Before: everything in one class
class OrderProcessor:
    def process(self, order):
        # ... fragile legacy code ...

# After: new responsibility in a focused collaborator
class OrderProcessor:
    def __init__(self):
        self._discount_engine = DiscountEngine()  # sprout class

    def process(self, order):
        # ... fragile legacy code (untouched) ...
        self._discount_engine.apply(order)  # delegate

class DiscountEngine:
    def apply(self, order):
        # new behavior, fully tested
        ...
```

**Rules:**
- Add a focused new collaborator, don't reshape the legacy class.
- Delegate from the legacy class.
- Move more behavior over incrementally if later justified.

## Wrap Method

**When:** You need pre/post behavior around a risky method, or a way to observe effects.

**Pattern:**
```python
# Before: direct call to risky method
def checkout(self, order):
    self._process_payment(order)  # risky, hard to test

# After: wrapped with observable behavior
def checkout(self, order):
    self._wrapped_process_payment(order)

def _wrapped_process_payment(self, order):
    self._pre_payment_checks(order)  # new, testable
    self._process_payment(order)     # legacy, untouched
    self._post_payment_audit(order)  # new, testable
```

## Wrap Class

**When:** A class is too hard to test directly and behavior can be mediated through a new abstraction.

**Pattern:**
```python
# Before: caller depends directly on hard-to-test class
class CheckoutService:
    def __init__(self):
        self._processor = LegacyProcessor()  # hard to instantiate

# After: wrapper mediates access
class CheckoutService:
    def __init__(self, processor=None):
        self._processor = processor or LegacyProcessorWrapper()

class LegacyProcessorWrapper:
    def __init__(self):
        self._inner = LegacyProcessor()

    def process(self, order):
        # can intercept, observe, or substitute
        return self._inner.process(order)
```

## Extract and Override Call

**When:** Language constraints leave few other options (e.g., can't easily inject in the target language).

**Pattern:**
```python
# Before: hard-coded dependency
class OrderService:
    def calculate(self, order):
        tax = TaxCalculator().compute(order)  # concrete call

# After: extracted method that can be overridden in tests
class OrderService:
    def calculate(self, order):
        tax = self._compute_tax(order)  # overridable

    def _compute_tax(self, order):
        return TaxCalculator().compute(order)

# In test:
class TestableOrderService(OrderService):
    def _compute_tax(self, order):
        return 0.0  # stub
```

**Rules:**
- Prefer composition once a cleaner route appears.
- This is a seam of last resort — add a cleanup obligation.

## Choosing Between Techniques

| Situation | Technique |
|---|---|
| Adding new behavior, old code too fragile to touch | **Sprout Method** |
| New responsibility doesn't fit the old class | **Sprout Class** |
| Need to observe or extend behavior around a method | **Wrap Method** |
| Class too hard to test directly | **Wrap Class** |
| Language constraints prevent injection | **Extract and Override Call** |
| Need to substitute a dependency for testing | **Parameterize Constructor/Method** (see dependency-breaking.md) |
