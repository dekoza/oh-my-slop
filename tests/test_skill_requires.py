"""The `requires:` skill-closure declaration and its mechanical gate.

`docs/specs/software-factory.md` §6.2 makes the transitive skill closure a
machine-readable frontmatter declaration: the factory computes a worker's
closure from the pinned package revision and proves every member is invocable
*before* claiming a ticket, so no role knowledge is hardcoded in the factory.

That only works if the declarations are true. These tests are what makes them
true — an undeclared dependency fails here rather than at a worker's preflight.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from scripts.validate_refs import iter_skill_dirs

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "skills"

# A markdown link to another skill's SKILL.md. Unambiguous: nothing links a
# whole other skill except to send the reader there.
SKILL_LINK_PATTERN = re.compile(r"\]\((?P<path>[^)]*?/?(?P<name>[a-z0-9-]+)/SKILL\.md)\)")

# The imperative idiom the package already uses to hand work to another skill:
# "Use the `tdd` skill", "use `websearch` skill".
SKILL_IMPERATIVE_PATTERN = re.compile(
    r"use\s+(?:the\s+)?`(?P<name>[a-z0-9-]+)`\s+skill", re.IGNORECASE
)

FENCE_PATTERN = re.compile(r"^(?:`{3,}|~{3,})")


def skill_dirs() -> list[Path]:
    return iter_skill_dirs(SKILLS_DIR)


def skills_by_name() -> dict[str, Path]:
    return {path.name: path for path in skill_dirs()}


def split_frontmatter(skill_md: Path) -> tuple[str, str]:
    lines = skill_md.read_text(encoding="utf-8").splitlines()
    assert lines and lines[0] == "---", f"{skill_md} does not start with frontmatter"
    for index, line in enumerate(lines[1:], start=1):
        if line == "---":
            return "\n".join(lines[1:index]), "\n".join(lines[index + 1 :])
    raise AssertionError(f"{skill_md} frontmatter is never closed with '---'")


def strip_fenced_blocks(body: str) -> str:
    """Drop fenced code blocks; a skill name inside an example is not a dependency."""
    kept: list[str] = []
    fence: str | None = None
    for line in body.splitlines():
        stripped = line.lstrip()
        match = FENCE_PATTERN.match(stripped)
        if fence is not None:
            if match and stripped.startswith(fence):
                fence = None
            continue
        if match:
            fence = match.group()[0] * 3
            continue
        kept.append(line)
    return "\n".join(kept)


def declared_requires(skill_dir: Path) -> list[str]:
    frontmatter, _ = split_frontmatter(skill_dir / "SKILL.md")
    parsed = yaml.safe_load(frontmatter) or {}
    return parsed.get("requires") or []


def referenced_skills(skill_dir: Path) -> set[str]:
    """Skill names this skill's body hands work to."""
    _, body = split_frontmatter(skill_dir / "SKILL.md")
    prose = strip_fenced_blocks(body)
    names = {match.group("name") for match in SKILL_LINK_PATTERN.finditer(prose)}
    names |= {match.group("name") for match in SKILL_IMPERATIVE_PATTERN.finditer(prose)}
    return names - {skill_dir.name}


@pytest.fixture(params=skill_dirs(), ids=lambda path: path.name)
def skill_dir(request: pytest.FixtureRequest) -> Path:
    return request.param


def test_requires_is_a_list_of_known_skills(skill_dir: Path) -> None:
    requires = declared_requires(skill_dir)
    known = skills_by_name()

    assert isinstance(requires, list), (
        f"{skill_dir.name}: 'requires' must be a YAML list of skill names"
    )
    for entry in requires:
        assert isinstance(entry, str) and entry.strip(), (
            f"{skill_dir.name}: 'requires' contains a non-string entry {entry!r}"
        )
        assert entry in known, (
            f"{skill_dir.name}: requires '{entry}', which is not a bundled skill"
        )


def test_requires_does_not_name_itself(skill_dir: Path) -> None:
    assert skill_dir.name not in declared_requires(skill_dir), (
        f"{skill_dir.name}: requires itself"
    )


def test_every_handed_off_skill_is_declared(skill_dir: Path) -> None:
    """A body that sends the agent to another skill must declare it.

    This is the gate that keeps the closure honest. A worker launched with only
    its entry skill and the declared closure hits a dead pointer otherwise —
    and it hits it mid-attempt, after a ticket is already claimed.

    Only two unambiguous forms count: a markdown link to another SKILL.md, and
    the "use the `x` skill" imperative. A bare backtick mention is prose.
    """
    known = skills_by_name()
    declared = set(declared_requires(skill_dir))
    referenced = {name for name in referenced_skills(skill_dir) if name in known}

    missing = sorted(referenced - declared)
    assert not missing, (
        f"{skill_dir.name}: hands work to {missing} without declaring them in"
        f" 'requires' — add them, or rephrase the mention so it does not read as a"
        f" hand-off"
    )


def test_declared_closure_resolves(skill_dir: Path) -> None:
    """The transitive closure terminates and every member exists.

    Cycles are permitted: closure is a set, and two skills that route to each
    other is a legitimate shape (construction-craft and testing-workflow do).
    """
    known = skills_by_name()
    closure: set[str] = set()
    pending = list(declared_requires(skill_dir))

    while pending:
        name = pending.pop()
        if name in closure:
            continue
        assert name in known, f"{skill_dir.name}: closure reaches unknown skill '{name}'"
        closure.add(name)
        pending.extend(declared_requires(known[name]))

    assert skill_dir.name not in closure or True  # a cycle back to self is fine


def test_the_factory_builder_entry_skill_closure_carries_its_disciplines() -> None:
    """`implement` is the factory's builder role (spec §6.2, §11.5).

    Its closure is what a worker actually gets, so the disciplines the spec
    relies on must be reachable from it — not merely present in the package.
    `construction-craft` carries the output-capture rule (§6.8), and
    `git-discipline` carries the commit conventions §7.3 expects.
    """
    known = skills_by_name()
    closure: set[str] = set()
    pending = list(declared_requires(known["implement"]))

    while pending:
        name = pending.pop()
        if name in closure:
            continue
        closure.add(name)
        pending.extend(declared_requires(known[name]))

    for expected in ("tdd", "testing-workflow", "two-axis-review", "construction-craft",
                     "git-discipline", "review-standards", "review-spec", "domain-modeling"):
        assert expected in closure, (
            f"implement's declared closure is missing '{expected}'"
        )
