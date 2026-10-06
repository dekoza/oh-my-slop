"""Subscription billing logic under question (pure: no I/O, no printing).

Open question: after a failed payment, should "cancel" end the subscription at once, or
should the customer keep access until the paid period runs out?
"""

TRANSITIONS = {
    ("trial", "subscribe"): "active",
    ("trial", "cancel"): "cancelled",
    ("active", "payment_failed"): "past_due",
    ("active", "cancel"): "cancel_at_period_end",
    ("past_due", "pay"): "active",
    ("past_due", "cancel"): "cancelled",
    ("cancel_at_period_end", "reactivate"): "active",
    ("cancel_at_period_end", "period_ends"): "cancelled",
}


def initial() -> dict:
    return {"status": "trial", "history": []}


def actions(state: dict) -> list[str]:
    """The actions that are legal right now."""
    return sorted(action for (status, action) in TRANSITIONS if status == state["status"])


def step(state: dict, action: str) -> dict:
    if action not in actions(state):
        raise ValueError(f"{action!r} is not legal in {state['status']!r}")
    return {"status": TRANSITIONS[(state["status"], action)], "history": state["history"] + [action]}
