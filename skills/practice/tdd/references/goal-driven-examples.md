# Goal-Driven Examples

Concrete ❌/✅ comparisons showing how to transform vague imperative requests into verifiable goals. Adapted from Andrej Karpathy's observations on LLM coding pitfalls.

## 1. Vague vs. Verifiable Goals

### ❌ Vague Approach

User asks: "Fix the authentication system"

```
I'll fix the authentication system by:
1. Reviewing the code
2. Identifying issues
3. Making improvements
4. Testing the changes

[Proceeds to make changes without clear success criteria]
```

**Problem:** No verification criteria. "Fix" is undefined. The agent will make changes and declare victory without proving anything.

### ✅ Verifiable Goals

User asks: "Fix the authentication system"

```
To "fix authentication," I need to define success criteria. What specific issue are we solving?

If the issue is "users stay logged in after password change":

Plan:
1. Write test: Change password → verify old session invalidated
   Verify: Test fails (reproduces bug)
2. Implement: Invalidate sessions on password change
   Verify: Test passes
3. Check edge cases: Multiple active sessions, concurrent changes
   Verify: Additional tests pass
4. Verify no regression: Existing auth tests still pass
   Verify: Full test suite green

What's the specific auth issue you're seeing?
```

**Why it works:** Each step has a pass/fail criterion. The agent can loop independently. The user can verify each step.

---

## 2. Test-First Verification

### ❌ Fix Without Reproducing

User asks: "The sorting breaks when there are duplicate scores"

```python
# Immediately changes sort logic without confirming the bug
def sort_scores(scores):
    return sorted(scores, key=lambda x: (-x['score'], x['name']))
```

**Problem:** The agent assumed the bug and applied a fix without reproducing it first. Maybe the bug was something else entirely.

### ✅ Reproduce First, Then Fix

User asks: "The sorting breaks when there are duplicate scores"

```python
# 1. First, write a test that reproduces the issue
def test_sort_with_duplicate_scores():
    scores = [
        {'name': 'Alice', 'score': 100},
        {'name': 'Bob', 'score': 100},
        {'name': 'Charlie', 'score': 90},
    ]
    result = sort_scores(scores)
    # The bug: order is non-deterministic for duplicates
    assert result[0]['score'] == 100
    assert result[1]['score'] == 100
    assert result[2]['score'] == 90

# Verify: Run test 10 times → fails with inconsistent ordering

# 2. Now fix with stable sort
def sort_scores(scores):
    return sorted(scores, key=lambda x: (-x['score'], x['name']))

# Verify: Test passes consistently
```

**Why it works:** The test proves the bug exists, proves the fix works, and becomes a regression test.

---

## 3. Multi-Step with Verification

### ❌ All at Once

User asks: "Add rate limiting to the API"

```python
# Implements full rate limiting with Redis, multiple strategies,
# configuration system, and monitoring in one 300-line commit
# No clear verification steps
```

**Problem:** No intermediate verification. If something breaks, you don't know which part failed. Can't deploy incrementally.

### ✅ Incremental with Verification

User asks: "Add rate limiting to the API"

```
Plan for rate limiting:

1. Add basic in-memory rate limiting (single endpoint)
   Verify:
   - Test: 100 requests → first 10 succeed, rest get 429
   - Manual: curl endpoint 11 times, see rate limit error

2. Extract to middleware (apply to all endpoints)
   Verify:
   - Test: Rate limits apply to /users and /posts
   - Existing endpoint tests still pass

3. Add Redis backend (for multi-server)
   Verify:
   - Test: Rate limit persists across app restarts
   - Test: Two app instances share rate limit counter

4. Add configuration (rates per endpoint)
   Verify:
   - Test: /search allows 10/min, /users allows 100/min
   - Config file parsed correctly

Each step is independently verifiable and deployable.
Start with step 1?
```

**Why it works:** Each step is a complete, verifiable unit. You can stop at any step and have something that works.

---

## 4. Over-Engineering vs. Simplicity

### ❌ Over-Engineered

User asks: "Add a function to calculate discount"

```python
from abc import ABC, abstractmethod
from typing import Protocol, Union
from dataclasses import dataclass

class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, amount: float) -> float: pass

class PercentageDiscount(DiscountStrategy):
    def __init__(self, percentage: float):
        self.percentage = percentage
    def calculate(self, amount: float) -> float:
        return amount * (self.percentage / 100)

class FixedDiscount(DiscountStrategy):
    def __init__(self, fixed_amount: float):
        self.fixed_amount = fixed_amount
    def calculate(self, amount: float) -> float:
        return min(self.fixed_amount, amount)

@dataclass
class DiscountConfig:
    strategy: DiscountStrategy
    min_purchase: float = 0.0
    max_discount: float = float('inf')

class DiscountCalculator:
    def __init__(self, config: DiscountConfig):
        self.config = config
    def apply_discount(self, amount: float) -> float:
        if amount < self.config.min_purchase:
            return 0
        discount = self.config.strategy.calculate(amount)
        return min(discount, self.config.max_discount)
```

**Problem:** Strategy pattern, abstract base classes, dataclasses, configuration objects — for a single discount calculation. 50+ lines where 3 would do.

### ✅ Simple

User asks: "Add a function to calculate discount"

```python
def calculate_discount(amount: float, percent: float) -> float:
    """Calculate discount amount. percent should be 0-100."""
    return amount * (percent / 100)
```

**Why it works:** Solves today's problem. If you need multiple discount types later, refactor then. The simple version is easier to understand, test, and modify.

---

## 5. Drive-by Refactoring vs. Surgical Changes

### ❌ Drive-by Refactoring

User asks: "Fix the bug where empty emails crash the validator"

```diff
  def validate_user(user_data):
-     # Check email format
-     if not user_data.get('email'):
+     """Validate user data."""
+     email = user_data.get('email', '').strip()
+
+     # Validate email
+     if not email:
          raise ValueError("Email required")
-     # Basic email validation
-     if '@' not in user_data['email']:
+     if '@' not in email or '.' not in email.split('@')[1]:
          raise ValueError("Invalid email")
-
-     # Check username
-     if not user_data.get('username'):
+     # Validate username
+     username = user_data.get('username', '').strip()
+     if not username:
          raise ValueError("Username required")
+     if len(username) < 3:
+         raise ValueError("Username too short")
+     if not username.isalnum():
+         raise ValueError("Username must be alphanumeric")
      return True
```

**Problems:**
- "Improved" email validation beyond the bug fix
- Added username validation nobody asked for
- Changed comments
- Added docstring
- Changed variable access patterns

### ✅ Surgical

User asks: "Fix the bug where empty emails crash the validator"

```diff
  def validate_user(user_data):
      # Check email format
-     if not user_data.get('email'):
+     email = user_data.get('email', '')
+     if not email or not email.strip():
          raise ValueError("Email required")
      # Basic email validation
-     if '@' not in user_data['email']:
+     if '@' not in email:
          raise ValueError("Invalid email")
      # Check username
      if not user_data.get('username'):
          raise ValueError("Username required")
      return True
```

**Why it works:** Only changed lines that fix the empty email bug. Everything else is untouched.

---

## Anti-Patterns Summary

| Anti-Pattern | Fix |
|---|---|
| "I'll review and improve the code" | "Write test for bug X → make it pass → verify no regressions" |
| Strategy pattern for single discount | One function until complexity is actually needed |
| Reformat quotes, add type hints while fixing bug | Only change lines that fix the reported issue |
| Implement 300-line feature in one commit | Break into independently verifiable steps |
| Fix without reproducing first | Write failing test, then fix |

## Key Insight

The "overcomplicated" examples aren't obviously wrong — they follow design patterns and best practices. The problem is **timing**: they add complexity before it's needed.

Good code solves today's problem simply, not tomorrow's problem prematurely.
