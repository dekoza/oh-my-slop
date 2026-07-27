"""`prompts/` is an entry-point surface, not a second copy of the skills.

A template exists for one reason a `/skill:<name>` invocation cannot cover:
it forwards its arguments, so `/arch ~/some/repo` reviews another tree in one
shot. Everything else about the flow belongs to the skill, which is the single
source of truth. `prompts/arch.md` spent three releases describing a flow its
skill no longer had; these tests exist so that cannot recur silently.
"""

from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PROMPTS_DIR = REPO_ROOT / "prompts"
SKILLS_DIR = REPO_ROOT / "skills"

HANDOFF_SENTENCE = re.compile(r"Use the `([a-z0-9-]+)` skill")
FALLBACK_CLAUSE = (
    "If it isn't among your available skills, locate its `SKILL.md` "
    "in the installed `oh-my-slop` package and follow that."
)
MAX_BODY_LINES = 10


def iter_templates() -> list[Path]:
    templates = sorted(path for path in PROMPTS_DIR.glob("*.md") if path.is_file())
    assert templates, "no prompt templates found"
    return templates


def split_template(template: Path) -> tuple[str, str]:
    """Return the template's frontmatter and body, without the `---` fences."""
    text = template.read_text(encoding="utf-8")

    assert text.startswith("---\n"), f"{template.name} has no frontmatter"
    frontmatter, _, body = text[4:].partition("\n---\n")

    return frontmatter, body


def named_skill(template: Path) -> str:
    body = split_template(template)[1]
    names = HANDOFF_SENTENCE.findall(body)

    assert len(names) == 1, (
        f"{template.name} must name exactly one skill with the handoff sentence "
        f'"Use the `<skill>` skill …", found {names}'
    )
    return names[0]


def skill_frontmatter(skill_name: str) -> str:
    text = (SKILLS_DIR / skill_name / "SKILL.md").read_text(encoding="utf-8")

    return text[4:].partition("\n---\n")[0]


def test_every_template_names_a_skill_that_exists() -> None:
    """The failure that actually breaks a shim: a skill renamed or removed
    while the template still names it. A named skill can be checked; an
    absolute install path cannot, which is why templates carry no paths."""
    for template in iter_templates():
        skill_name = named_skill(template)

        assert (SKILLS_DIR / skill_name / "SKILL.md").exists(), (
            f"{template.name} names skill `{skill_name}`, "
            f"but skills/{skill_name}/SKILL.md does not exist"
        )


def test_every_template_keeps_its_frontmatter() -> None:
    """Frontmatter is what makes the file a slash command with an argument
    hint; the body is the only part the rule strips."""
    for template in iter_templates():
        frontmatter = split_template(template)[0]

        assert "description:" in frontmatter, f"{template.name} lost its description"
        assert "argument-hint:" in frontmatter, (
            f"{template.name} lost its argument-hint"
        )


def test_every_template_stays_a_thin_entry_point() -> None:
    """A structural cap, so re-adding a condensed process means deleting an
    assertion — a visible act in review — rather than quietly reintroducing a
    second source of truth that nobody maintains."""
    for template in iter_templates():
        body = split_template(template)[1]
        lines = [line for line in body.splitlines() if line.strip()]

        headings = [line for line in lines if line.lstrip().startswith("#")]
        assert not headings, (
            f"{template.name} carries section headings {headings}; "
            "process text belongs in the skill, not the template"
        )
        assert len(lines) <= MAX_BODY_LINES, (
            f"{template.name} body is {len(lines)} lines, "
            f"over the {MAX_BODY_LINES}-line entry-point cap"
        )


def test_manual_only_skills_carry_the_fallback_clause() -> None:
    """A skill with `disable-model-invocation: true` is stripped from the
    `<available_skills>` listing, so naming it is not enough to reach it — the
    template must tell the agent where to look instead. Skills the model can
    invoke need only the naming sentence."""
    for template in iter_templates():
        skill_name = named_skill(template)
        body = split_template(template)[1]
        manual_only = any(
            line.strip() == "disable-model-invocation: true"
            for line in skill_frontmatter(skill_name).splitlines()
        )

        if manual_only:
            assert FALLBACK_CLAUSE in body, (
                f"{template.name} names manual-only skill `{skill_name}` "
                "but omits the fallback clause"
            )
        else:
            assert FALLBACK_CLAUSE not in body, (
                f"{template.name} names model-invocable skill `{skill_name}`; "
                "the fallback clause is dead weight there"
            )
