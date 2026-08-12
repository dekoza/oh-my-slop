"""Frontmatter and body-budget gate for every bundled skill.

Adapted from open-mercato/skills' lint gate (see
docs/surveys/open-mercato-skills-adoption-2026-08-12.md, §1.2): the rules
`writing-great-skills` states as prose, enforced mechanically.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from scripts.validate_refs import iter_skill_dirs

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "skills"

# Descriptions load into every session's context, for all skills at once.
# Current maximum is 745 chars (domain-driven-design); the platform hard limit
# is 1024. Hold the line just above our own distribution, not at the platform's.
DESCRIPTION_BUDGET = 800

# Progressive-disclosure budget: ~20k chars ≈ 5k tokens for a SKILL.md body;
# detail beyond that belongs in references/.
BODY_BUDGET = 20_000

# Grandfathered over-budget bodies. Do not add to this list — split the skill
# into references/ instead. The self-cleaning test below removes stale entries.
BODY_BUDGET_EXCEPTIONS = {
    "diagnosing-bugs",
    "improve-codebase-architecture",
}

PLAIN_SCALAR_COLON = re.compile(r": ")


def skill_dirs() -> list[Path]:
    return iter_skill_dirs(SKILLS_DIR)


def split_frontmatter(skill_md: Path) -> tuple[str, str]:
    """Return (raw frontmatter, body) of a SKILL.md; fail if not delimited."""
    lines = skill_md.read_text(encoding="utf-8").splitlines()
    assert lines and lines[0] == "---", f"{skill_md} does not start with frontmatter"
    for index, line in enumerate(lines[1:], start=1):
        if line == "---":
            frontmatter = "\n".join(lines[1:index])
            body = "\n".join(lines[index + 1 :])
            return frontmatter, body
    raise AssertionError(f"{skill_md} frontmatter is never closed with '---'")


def raw_description_block(frontmatter: str) -> str:
    """The description entry's raw lines: its own line plus indented continuations."""
    lines = frontmatter.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("description:"):
            block = [line]
            for continuation in lines[index + 1 :]:
                if continuation.strip() and not continuation.startswith((" ", "\t")):
                    break
                block.append(continuation)
            return "\n".join(block)
    return ""


@pytest.fixture(params=skill_dirs(), ids=lambda path: path.name)
def skill_dir(request: pytest.FixtureRequest) -> Path:
    return request.param


def test_discovers_the_bundled_skills() -> None:
    assert len(skill_dirs()) > 60


def test_frontmatter_parses_as_yaml(skill_dir: Path) -> None:
    frontmatter, _ = split_frontmatter(skill_dir / "SKILL.md")
    parsed = yaml.safe_load(frontmatter)
    assert isinstance(parsed, dict), f"{skill_dir.name}: frontmatter is not a mapping"


def test_name_matches_directory(skill_dir: Path) -> None:
    frontmatter, _ = split_frontmatter(skill_dir / "SKILL.md")
    name = yaml.safe_load(frontmatter).get("name")
    assert name == skill_dir.name, (
        f"{skill_dir / 'SKILL.md'} declares name '{name}' but the directory —"
        f" the authority per AGENTS.md — is '{skill_dir.name}'"
    )


def test_description_present_and_within_budget(skill_dir: Path) -> None:
    frontmatter, _ = split_frontmatter(skill_dir / "SKILL.md")
    description = yaml.safe_load(frontmatter).get("description")
    assert isinstance(description, str) and description.strip(), (
        f"{skill_dir.name}: frontmatter is missing a description"
    )
    assert len(description) <= DESCRIPTION_BUDGET, (
        f"{skill_dir.name}: description is {len(description)} chars"
        f" (budget {DESCRIPTION_BUDGET}) — it loads into every session's context"
    )


def test_plain_scalar_description_has_no_unquoted_colon_space(skill_dir: Path) -> None:
    """An unquoted ': ' in a plain YAML scalar is invalid for strict parsers —
    the most common cross-client skill parse failure. Block scalars and quoted
    strings are safe; only plain scalars are checked."""
    frontmatter, _ = split_frontmatter(skill_dir / "SKILL.md")
    block = raw_description_block(frontmatter)
    if not block:
        return
    value = block.split(":", 1)[1].strip()
    if value.startswith((">", "|", '"', "'")):
        return
    scalar = "\n".join(
        [value] + [line.strip() for line in block.splitlines()[1:]]
    )
    assert not PLAIN_SCALAR_COLON.search(scalar), (
        f"{skill_dir.name}: plain-scalar description contains an unquoted ': ' —"
        " rephrase (use — ), quote the value, or switch to a block scalar"
    )


def test_body_within_progressive_disclosure_budget(skill_dir: Path) -> None:
    if skill_dir.name in BODY_BUDGET_EXCEPTIONS:
        return
    _, body = split_frontmatter(skill_dir / "SKILL.md")
    assert len(body) <= BODY_BUDGET, (
        f"{skill_dir.name}: SKILL.md body is {len(body)} chars"
        f" (budget {BODY_BUDGET} ≈ 5k tokens) — move detail into references/"
    )


def test_body_budget_exceptions_are_still_needed() -> None:
    """The grandfather list must shrink, never linger: a listed skill that has
    come under budget (or been retired) is removed from the list."""
    by_name = {path.name: path for path in skill_dirs()}
    for name in sorted(BODY_BUDGET_EXCEPTIONS):
        assert name in by_name, f"exception '{name}' names a skill that no longer exists"
        _, body = split_frontmatter(by_name[name] / "SKILL.md")
        assert len(body) > BODY_BUDGET, (
            f"'{name}' is within budget now — remove it from BODY_BUDGET_EXCEPTIONS"
        )
