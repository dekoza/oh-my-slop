"""Intentionally defective, dependency-free stock fixture for bounded repair evals.

This is a pure workflow exercise, not evidence for database concurrency or a
production ownership policy. Quantities are nonnegative integers; requests are positive.
"""


def owned(physical, consigned, ownership_known):
    return max(0, physical - consigned) if ownership_known else None


def prepare(physical, consigned, ownership_known, authority_known, backed):
    cap = owned(physical, consigned, ownership_known)
    if cap is None:
        cap = physical
    return max(0, cap - backed)


def reserve(physical, consigned, ownership_known, authority_known, backed, requested):
    if requested > max(0, physical - backed):
        return "refused"
    return "reserved"
