"""The installed producer and repairer must share one handoff criterion.

Static contract guards complement the frozen behavior comparisons; they do not
establish that a model produces sufficient briefs or executes publication safely.
"""

from pathlib import Path
import re

from scripts.validate_refs import find_skill_dir


ROOT = Path(__file__).resolve().parents[1]


def skill_path(name: str) -> Path:
    directory = find_skill_dir(ROOT / "skills", name)
    assert directory is not None, f"Missing installed skill: {name}"
    return directory / "SKILL.md"


def test_producer_and_repairer_resolve_one_bundled_handoff_reference() -> None:
    targets = set()
    for name in ("to-spec", "to-tickets", "humanify"):
        path = skill_path(name)
        links = re.findall(r"\]\(([^)]+implementation-handoff\.md)\)", path.read_text())
        assert len(links) == 1, f"{name} must point directly at the shared criterion"
        target = (path.parent / links[0]).resolve()
        assert target.is_file(), f"{name}'s criterion is missing from the package"
        targets.add(target)

    assert targets == {
        ROOT / "skills/workflow/to-tickets/references/implementation-handoff.md"
    }
