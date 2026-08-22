"""Cross-skill invocation rules shared by every bundled skill."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from scripts.validate_refs import iter_skill_dirs

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "skills"

DIRECT_RUN_PATTERN = re.compile(
    r"(?:^|[.!?;:—]\s+)run\s+`/(?:skill:)?(?P<name>[a-z0-9-]+)`",
    re.IGNORECASE,
)


def split_skill(skill_md: Path) -> tuple[dict[str, object], str]:
    text = skill_md.read_text(encoding="utf-8")
    _, frontmatter, body = text.split("---", 2)
    return yaml.safe_load(frontmatter), body


def test_user_invoked_skills_are_routed_back_to_the_user() -> None:
    """A running skill cannot invoke a skill hidden from the model."""
    skills = {
        skill_dir.name: split_skill(skill_dir / "SKILL.md")
        for skill_dir in iter_skill_dirs(SKILLS_DIR)
    }
    user_invoked = {
        name
        for name, (frontmatter, _) in skills.items()
        if frontmatter.get("disable-model-invocation") is True
    }

    violations: list[str] = []
    for source_name, (_, body) in skills.items():
        for line_number, line in enumerate(body.splitlines(), start=1):
            for match in DIRECT_RUN_PATTERN.finditer(line):
                target = match.group("name")
                if target not in user_invoked:
                    continue
                prefix = line[: match.start()].lower()
                if "tell the user" in prefix or "ask the user" in prefix:
                    continue
                violations.append(f"{source_name}:{line_number} -> {target}")

    assert not violations, (
        "skills directly instruct the agent to run user-invoked skills; route these"
        f" commands back to the user instead: {violations}"
    )
