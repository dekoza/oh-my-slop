# Subscription billing logic prototype (test fixture)

Input for the prototype skill's logic evaluation (#259): a logic prototype in progress,
Python standard library only, no package manager or build step.

- `subscription_machine.py` is the logic under question: `initial()`, `actions(state)`
  and `step(state, action)` over plain data, with no I/O.
- `prototype_subscription.py` is the terminal prototype that drives it:
  `python3 prototype_subscription.py`.
