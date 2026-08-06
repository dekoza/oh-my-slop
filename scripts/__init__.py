from __future__ import annotations

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
SKILLS_DIR = PACKAGE_DIR.parent / "skills"


def _skill_creator_scripts_dir() -> Path | None:
    """skill-creator's scripts, wherever its bucket currently puts it.

    Searched by name rather than by path so re-filing the skill stays a pure
    move — this runs at package-import time, before validate_refs (and its
    find_skill_dir) can be imported from here.
    """
    for candidate in sorted(SKILLS_DIR.glob("*/skill-creator/scripts")):
        if candidate.is_dir():
            return candidate

    legacy = SKILLS_DIR / "skill-creator" / "scripts"
    return legacy if legacy.is_dir() else None


SKILL_CREATOR_SCRIPTS_DIR = _skill_creator_scripts_dir()

if SKILL_CREATOR_SCRIPTS_DIR is not None:
    __path__.append(str(SKILL_CREATOR_SCRIPTS_DIR))
