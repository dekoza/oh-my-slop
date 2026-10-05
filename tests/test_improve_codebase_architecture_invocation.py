"""improve-codebase-architecture starts its review only on an explicit request (#255).

Static contract guards complement the matched behavior comparisons; they do not
establish that a model starts, scopes or withholds the review correctly.
"""

import json
from pathlib import Path

from scripts.validate_refs import find_skill_dir


SKILLS_ROOT = Path(__file__).resolve().parents[1] / "skills"
ENTRY_HEADING = "## Start only on an explicit request"


def _skill_dir() -> Path:
    skill_dir = find_skill_dir(SKILLS_ROOT, "improve-codebase-architecture")
    assert skill_dir is not None, "improve-codebase-architecture skill not found"
    return skill_dir


def _normalized(text: str) -> str:
    return " ".join(text.split())


def _entry_section() -> str:
    body = (_skill_dir() / "SKILL.md").read_text(encoding="utf-8")
    assert ENTRY_HEADING in body, "the entry boundary needs its own section"
    return _normalized(body.split(f"{ENTRY_HEADING}\n", 1)[1].split("\n---\n", 1)[0])


def test_reading_the_body_is_not_a_request_to_run_the_review() -> None:
    """Loading the text for research or review starts no exploration, report or
    tracker mutation; the old 'if you are reading this' licence is gone (#255)."""
    skill_text = _normalized((_skill_dir() / "SKILL.md").read_text(encoding="utf-8"))
    entry = _entry_section()

    assert "if you are reading this, the user has already issued the entire request" not in skill_text
    assert "Reading this body is not a request" in entry
    assert "no exploration, report or tracker change" in entry


def test_explicit_request_keeps_its_scope_and_starts_without_ceremony() -> None:
    """/arch and an explicit invocation pass their scope through, and the review
    begins with no generic approval question; the first pause stays at the
    Phase 3 selection prompt (#255)."""
    entry = _entry_section()

    assert "Take the scope the request supplies" in entry
    assert "the `/arch` path" in entry
    assert "without one, review the current working directory" in entry
    assert 'do not ask "what would you like me to do?"' in entry
    assert "no recognizable codebase at that scope" in entry
    assert "**Phase 3**" in entry


def test_catalogue_states_the_entry_boundary() -> None:
    """The README row tells operators how the review starts and that reading
    the skill does not start it (#255)."""
    readme = (SKILLS_ROOT.parent / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines() if "skills/workflow/improve-codebase-architecture/SKILL.md" in line)

    assert "runs only on an explicit request" in row
    assert "reading the skill starts nothing" in row


def _evals() -> dict[int, dict]:
    document = json.loads((_skill_dir() / "evals" / "evals.json").read_text(encoding="utf-8"))
    assert document["skill_name"] == "improve-codebase-architecture"
    cases = {case["id"]: case for case in document["evals"]}
    assert len(cases) == len(document["evals"])
    return cases


def _expectations(case: dict) -> str:
    return " ".join(case["expectations"]).lower()


def test_entry_evals_pair_explicit_requests_with_body_inspection() -> None:
    """Paired entry cases: /arch and an explicit invocation keep their scope and
    start without ceremony; reading the body for research starts nothing. The
    earlier phase evals stay (#255)."""
    cases = _evals()
    assert set(range(1, 11)) <= cases.keys(), "existing phase evals must be retained"
    assert {11, 12, 13} <= cases.keys()

    arch, invoked, inspected = cases[11], cases[12], cases[13]
    assert arch["prompt"].startswith("/arch ")
    assert invoked["prompt"].startswith("/skill:improve-codebase-architecture ")
    for case in (arch, invoked):
        expectations = _expectations(case)
        assert "without asking" in expectations
        assert "scope" in expectations
        assert "selection prompt" in expectations

    # The inspection prompt carries no "don't run it" disclaimer, so only the
    # skill's own entry boundary can keep the review from starting.
    for hint in ("don't run", "do not run", "without running", "not run it"):
        assert hint not in inspected["prompt"].lower()
    inspected_expectations = _expectations(inspected)
    assert "does not start the review" in inspected_expectations
    assert "no html report" in inspected_expectations

    for case in (arch, invoked, inspected):
        expectations = _expectations(case)
        assert "write log" in expectations
        assert "git state are unchanged" in expectations
