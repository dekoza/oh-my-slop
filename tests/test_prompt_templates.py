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

from scripts.validate_refs import find_skill_dir


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
    skill_dir = find_skill_dir(SKILLS_DIR, skill_name)

    assert skill_dir is not None, f"no bundled skill named `{skill_name}`"
    text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")

    return text[4:].partition("\n---\n")[0]


def test_implement_spec_passes_arguments_to_the_manual_coordinator() -> None:
    template = PROMPTS_DIR / "implement-spec.md"
    assert template.exists()
    assert named_skill(template) == "implement-spec"
    frontmatter, body = split_template(template)
    assert "<spec>" in frontmatter
    assert "$@" in body
    assert FALLBACK_CLAUSE in body
    assert "disable-model-invocation: true" in skill_frontmatter("implement-spec")


def test_humanify_is_a_manual_ticket_entry_point() -> None:
    """Human-led work is an explicit action, with the ticket passed through."""
    template = PROMPTS_DIR / "humanify.md"

    assert template.exists(), "/humanify is not installed as a prompt template"
    assert named_skill(template) == "humanify"
    frontmatter, body = split_template(template)
    assert "<ticket>" in frontmatter
    assert "$@" in body
    assert "disable-model-invocation: true" in skill_frontmatter("humanify")


def test_refine_ticket_routes_explicit_ticket_through_authorized_readiness() -> None:
    """The command reaches the readiness owner without granting authority itself."""
    template = PROMPTS_DIR / "refine-ticket.md"

    assert template.exists(), "/refine-ticket is not installed as a prompt template"
    assert named_skill(template) == "humanify"
    frontmatter, body = split_template(template)
    assert 'argument-hint: "<ticket-number>"' in frontmatter
    assert body.strip() == (
        "Use the `humanify` skill to refine the single ticket-number argument $@ "
        "via its `/refine-ticket` flow. " + FALLBACK_CLAUSE
    )
    # Authority and ambiguous-input handling belong to the owner, not the shim.
    owner = (find_skill_dir(SKILLS_DIR, "humanify") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    assert "unambiguously" in owner
    assert "exactly one positive ticket number" in owner
    assert "optionally prefixed with `#`" in owner
    assert "before any ticket work" in owner
    assert "missing, invalid or ambiguous" in owner
    assert "`/refine-ticket <ticket-number>`" in owner
    assert "Implementation starts in a separate session." in owner
    assert "Never infer readiness from design confirmation." in owner


def test_fixrev_routes_review_and_conflict_repairs_to_one_owner() -> None:
    """Repair the existing PR; neither review-only nor conflict-only is the job."""
    template = PROMPTS_DIR / "fixrev.md"

    assert named_skill(template) == "fix-pr"
    frontmatter, body = split_template(template)
    assert 'argument-hint: "<pull_request>"' in frontmatter
    assert "$@" in body
    assert "review findings and merge conflicts" in body
    assert FALLBACK_CLAUSE in body
    assert "disable-model-invocation: true" in skill_frontmatter("fix-pr")


def test_revmerge_routes_publication_and_merge_to_its_explicit_owner_flow() -> None:
    """Only /revmerge requests comment/merge; ordinary review stays read-only."""
    template = PROMPTS_DIR / "revmerge.md"

    assert template.exists(), "/revmerge is not installed as a prompt template"
    assert named_skill(template) == "two-axis-review"
    frontmatter, body = split_template(template)
    assert "<pull_request>" in frontmatter
    assert "$@" in body
    assert body.strip() == (
        "Use the `two-axis-review` skill to review, comment on and merge the pull "
        "request $@ via its `/revmerge` flow."
    )
    owner_dir = find_skill_dir(SKILLS_DIR, "two-axis-review")
    owner = (owner_dir / "SKILL.md").read_text(encoding="utf-8")
    assert "references/revmerge.md" in owner
    flow = (owner_dir / "references/revmerge.md").read_text(encoding="utf-8")
    assert "Wait for both axes to complete" in flow
    assert "new discussion comment" in flow
    assert "no blocking findings" in flow
    assert "`grilling` skill" in flow
    assert "wait for the owner's answer" in flow
    assert "changed head or target" in flow
    assert "read back" in flow
    assert "ordinary review grants neither publication nor merge" in owner
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines() if "**`/revmerge " in line)
    assert "new comment" in row
    assert "merge only without blockers" in row
    assert "`grilling`" in row


def test_every_template_names_a_skill_that_exists() -> None:
    """The failure that actually breaks a shim: a skill renamed or removed
    while the template still names it. A named skill can be checked; an
    absolute install path cannot, which is why templates carry no paths."""
    for template in iter_templates():
        skill_name = named_skill(template)

        assert find_skill_dir(SKILLS_DIR, skill_name) is not None, (
            f"{template.name} names skill `{skill_name}`, "
            f"but no bucket under skills/ holds a `{skill_name}` skill"
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
