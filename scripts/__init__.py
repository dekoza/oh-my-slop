from __future__ import annotations

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
SKILL_CREATOR_SCRIPTS_DIR = (
    PACKAGE_DIR.parent / "skills" / "skill-creator" / "scripts"
)

if SKILL_CREATOR_SCRIPTS_DIR.is_dir():
    __path__.append(str(SKILL_CREATOR_SCRIPTS_DIR))
