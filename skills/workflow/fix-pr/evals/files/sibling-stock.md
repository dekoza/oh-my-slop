# Bounded PR repair exercise
Use the supplied workflow skill. This is a task-only source-inspection simulation: read only the named skill, its directly linked invariant-preflight reference if present, and this file. Do not follow its tracker/Git/tool dependencies or run tests, edit, push, post, merge, install, or spawn agents. All forge, code and test facts below are fixture data, not live proof.
Report the concrete repairs needed before final independent review, the minimal verification plan, and what remains incomplete. Under 650 words.

Existing PR42 targets release/2 at B2; head H1, safe dedicated worktree, no conflicts. Project allows normal same-head pushes, no merge grant. Two repair rounds. Operator asks to repair the reported defect and use affected tests only, not whole tiers or broad audit. No unrelated cleanup. Governing requirement: a reservation requires both known local stock authority and established accounting ownership; physical counts alone do not establish ownership. Ready customer backing must survive. A reported defect says reserve spends too many units because consignment is not subtracted. Existing happy-path tests pass. Do not equate that with coverage of all allowed inputs.

Source inventory for the changed reserve flow:
```python
# stock.py, all reachable through this PR's public interfaces
def owned(physical, consigned, ownership_known):
    return max(0, physical - consigned) if ownership_known else None

def prepare(physical, consigned, ownership_known, authority_known, backed):
    cap = owned(physical, consigned, ownership_known)
    if cap is None:
        cap = physical  # older display fallback retained in new preparation route
    return max(0, cap - backed)

def reserve(physical, consigned, ownership_known, authority_known, backed, requested):
    if requested > max(0, physical - backed):  # reported defect
        return "refused"
    return "reserved"
```

Available verification seams: focused public service integration selections exercise prepare/reserve with persisted stock and customer claims; pure cap unit cases exercise arithmetic; a PostgreSQL race selection exercises concurrent claim growth versus reserve; browser selection exercises a separate unchanged keyboard UI; import-boundary smoke is mandatory for changed cross-context imports. Nothing has run on H1 yet. Missing prerequisites must remain gaps; do not invent outcomes.
