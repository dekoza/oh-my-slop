"""improve-codebase-architecture starts its review only on an explicit request (#255).

Static contract guards complement the matched behavior comparisons; they do not
establish that a model starts, scopes or withholds the review correctly.
"""

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
