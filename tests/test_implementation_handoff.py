"""The installed producer and repairer must share one handoff criterion.

Static contract guards complement the frozen behavior comparisons; they do not
establish that a model produces sufficient briefs or executes publication safely.
"""

import json
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


def test_execution_consumers_read_the_same_criterion_before_dispatch() -> None:
    reference = ROOT / "skills/workflow/to-tickets/references/implementation-handoff.md"
    for name, next_step in (("implement", "## Delivery:"),
                            ("implement-spec", "## 2. Pin")):
        path = skill_path(name)
        text = path.read_text()
        links = re.findall(r"\]\(([^)]+implementation-handoff\.md)\)", text)
        assert len(links) == 1, f"{name} must consume the shared criterion directly"
        assert (path.parent / links[0]).resolve() == reference
        assert text.index("implementation-handoff.md") < text.index(next_step)
        assert "definitive brief" in text
        assert "changed premise" in text
        assert "responsible owner" in text
        assert "unchanged" in text
        assert "routine" in text


def test_ticket_publication_cannot_default_to_agent_readiness() -> None:
    text = skill_path("to-tickets").read_text()
    publication = text.split("### 5. Publish", 1)[1]
    assert "read back the definitive briefs and authority records **before**" in publication
    assert "ready-for-agent` by default" not in publication
    assert "**Status:** ready-for-agent" not in publication
    assert "publication approval alone is not readiness authorization" in text


def test_ticket_approval_recommends_scoped_readiness_without_dispatch() -> None:
    text = " ".join(skill_path("to-tickets").read_text().split())
    approval = text.split("### 4. Check briefs", 1)[1].split("### 5. Publish", 1)[0]
    assert "recommend publication and scoped readiness together" in approval
    assert "qualified tickets" in approval
    assert "publication approval alone is not readiness authorization" in approval
    assert "If publication alone is authorized" in approval
    assert "no automatic dispatch, merge or closure" in approval


def test_approval_evals_pair_combined_grants_with_publication_only_control() -> None:
    path = skill_path("to-tickets").parent / "evals/evals.json"
    cases = {case["id"]: case for case in json.loads(path.read_text())["evals"]}
    assert {7, 8} <= cases.keys()
    assert "parent" in cases[7]["prompt"]
    assert "needs-info" in cases[7]["prompt"]
    assert any("combined" in item and "readiness" in item for item in cases[7]["expectations"])
    assert "explicitly withholds agent readiness" in cases[8]["prompt"]
    assert any("does not repeat" in item for item in cases[8]["expectations"])


def test_briefs_use_canonical_policy_pointers_without_losing_local_facts() -> None:
    text = " ".join(skill_path("to-tickets").read_text().split())
    drafting = text.split("### 3. Draft", 1)[1].split("<vertical-slice-rules>", 1)[0]
    assert "precise authoritative pointers" in drafting
    assert "repeated boilerplate" in drafting
    reference = ROOT / "skills/workflow/to-tickets/references/implementation-handoff.md"
    compact = reference.read_text().split("## Concise briefs", 1)[1]
    for fact in ("ticket-specific", "verification policy", "authority", "residual"):
        assert fact in compact
    assert "builder and independent reviewer" in compact
    assert "private chat" in compact


def test_repaired_brief_distinguishes_readiness_from_blocked_eligibility() -> None:
    text = skill_path("humanify").read_text()
    preflight = text.split("## 4. Perform the readiness preflight", 1)[1]
    assert "Assess brief sufficiency, scoped authority and current execution eligibility separately" in preflight
    assert "prepared/authorized—blocked" in preflight
    reference = ROOT / "skills/workflow/to-tickets/references/implementation-handoff.md"
    assert "relevant rejected alternatives" in reference.read_text()
