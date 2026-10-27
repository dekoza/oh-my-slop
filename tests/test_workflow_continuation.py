"""Static continuation-contract guards, not model-behavior or benchmark evidence.

Check installed links, closeout guidance and authored eval coverage. Actual safe
resumption and outcome ownership still need independent behavior comparisons.
"""

import json
from pathlib import Path
import re

import pytest

from scripts.validate_refs import find_skill_dir


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "skills/workflow/handoff/references/workflow-continuation.md"
CONSUMERS = (
    "research", "handoff", "implement", "implement-spec", "fix-pr", "humanify", "prototype",
)
BOUNDARY = r"closeout|clos(?:e|ing)|complet|finish|handoff|restart|resum|when done|session end"
CONTINUATION = r"continuation|resum|restart|fresh.session|larger goal|remaining goal|next actor|next action|outcome ownership|handoff"
AUTHORITY = r"authoriz|authoris|approval|authority|grant|permission"


def skill_path(name: str) -> Path:
    directory = find_skill_dir(ROOT / "skills", name)
    assert directory is not None, f"Missing installed skill: {name}"
    return directory / "SKILL.md"


def normalized(text: str) -> str:
    return " ".join(text.lower().split())


def assert_concepts(text: str, concepts: dict[str, str]) -> None:
    missing = [name for name, pattern in concepts.items() if not re.search(pattern, normalized(text))]
    assert not missing, f"Missing documented concepts: {', '.join(missing)}"


@pytest.mark.parametrize("name", CONSUMERS)
def test_closeout_or_restart_directly_links_the_bundled_contract(name: str) -> None:
    path = skill_path(name)
    text = path.read_text(encoding="utf-8")
    links = list(re.finditer(r"\[[^\]]+\]\(([^)\s]*workflow-continuation\.md)(?:#[^)]+)?\)", text))
    assert links, f"{name} must directly link the shared continuation contract"
    for link in links:
        assert (path.parent / link.group(1)).resolve() == REFERENCE
    assert REFERENCE.is_file(), "The continuation reference must ship in the package"

    # A catalogue link alone does not tell the reader when to load the contract.
    # Accept an actionable paragraph with a boundary in it or its owning heading.
    for link in links:
        before = text[:link.start()]
        headings = re.findall(r"^#{1,6} .+$", before, re.MULTILINE)
        start = before.rfind("\n\n") + 2 if "\n\n" in before else 0
        end = text.find("\n\n", link.end())
        paragraph = text[start:end if end != -1 else len(text)]
        context = (headings[-1] if headings else "") + " " + paragraph
        if re.search(BOUNDARY, context, re.IGNORECASE) and re.search(
            r"\b(?:read|use|apply|follow|load|consult)\b", paragraph, re.IGNORECASE
        ):
            break
    else:
        pytest.fail(f"{name}: link needs an actionable closeout/restart loading condition")


@pytest.mark.parametrize(("concept", "pattern"), [
    ("local completion", r"local.{0,60}(?:complet|done)|(?:complet|done).{0,60}local"),
    ("larger remaining goal", r"(?:larger|overall|remaining).{0,40}(?:goal|outcome)"),
    ("next actor", r"next.{0,30}(?:actor|owner)|responsible.{0,30}(?:actor|owner)"),
    ("next action", r"next.{0,30}(?:action|step)"),
    ("copyable fresh-session prompt", r"(?:copy|paste|copyable).{0,100}prompt|prompt.{0,100}(?:copy|paste|copyable)"),
    ("fresh session", r"fresh.session|new.session|restart"),
    ("durable approval", r"durable.{0,80}(?:approval|authori|grant)|(?:approval|authori|grant).{0,80}durable"),
    ("evidence", r"evidence"),
    ("exact candidate", r"(?:exact|fixed|pinned).{0,60}(?:candidate|sha|commit)|(?:candidate|sha|commit).{0,60}(?:exact|fixed|pinned)"),
    ("source bounds", r"source.{0,60}(?:bound|scope)|(?:bound|scope).{0,60}source"),
    ("remaining budget", r"remaining.{0,30}budget|budget.{0,30}remaining"),
    ("exclusions", r"exclu|out.of.scope"),
    ("stop condition", r"stop.{0,20}(?:condition|criteria)|stopping"),
    ("existing versus proposed authority", r"existing.{0,120}(?:grant|authori|approval)|(?:grant|authori|approval).{0,120}existing"),
    ("proposed authority", r"proposed.{0,80}(?:grant|authori|approval)|(?:grant|authori|approval).{0,80}proposed"),
])
def test_shared_reference_keeps_restart_state_and_authority_fields(concept: str, pattern: str) -> None:
    assert REFERENCE.is_file(), "Missing shared workflow-continuation reference"
    assert_concepts(REFERENCE.read_text(encoding="utf-8"), {concept: pattern})


def test_shared_reference_documents_abort_budget_and_completion_limits() -> None:
    assert REFERENCE.is_file(), "Missing shared workflow-continuation reference"
    assert_concepts(REFERENCE.read_text(encoding="utf-8"), {
        "explicit abort": r"(?:explicit.{0,30})?abort",
        "budget exhaustion": r"budget.{0,100}(?:exhaust|exceed|stop)|(?:exhaust|exceed).{0,100}budget",
        "authorized work only": r"(?:only|existing|already).{0,60}authori[sz]ed|authori[sz]ed.{0,60}only",
        "no forced next project": r"(?:no|not|never|do not|don't).{0,100}(?:invent|manufactur|mandatory|force|new project|next project)",
    })


def outcome_ownership(text: str) -> str:
    match = re.search(r"^### Outcome ownership\s*\n(.*?)(?=^#{1,3} |\Z)", text, re.MULTILINE | re.DOTALL)
    assert match, "The bundled global template must include Outcome ownership guidance"
    return match.group(1)


def test_bundled_global_guidance_and_repository_pointer_share_the_outcome_rule() -> None:
    template = ROOT / "agent/AGENTS.md"
    text = template.read_text(encoding="utf-8")
    repository = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    assert "(agent/AGENTS.md#outcome-ownership)" in repository
    assert_concepts(outcome_ownership(text), {
        "larger outcome": r"goal|outcome",
        "next action or owner": r"next.{0,40}(?:action|step|actor|owner)",
        "authority boundary": AUTHORITY,
        "stopping or bounded scope": r"stop|bound|budget|scope|abort",
    })


def test_research_evals_distinguish_successful_recovery_from_interruption() -> None:
    document = json.loads((skill_path("research").parent / "evals/evals.json").read_text())
    cases = document["evals"]
    assert any("successful-recovery" in case["prompt"] or "successful transport repair" in case["prompt"]
               for case in cases)
    assert any("timeout" in case["prompt"] or "timed out" in case["prompt"] for case in cases)
    recovered = next(case for case in cases if "successful transport repair" in case["prompt"])
    assert any("actually" in item and "report" in item for item in recovered["expectations"])
    assert any("grant" in item for item in recovered["expectations"])


def test_research_documents_a_checkable_coordinator_closeout() -> None:
    text = skill_path("research").read_text(encoding="utf-8")
    assert_concepts(text, {
        "coordinator": r"coordinator|coordinating|parent agent",
        "checkable artifact": r"(?:read.back|verify|check|inspect).{0,100}(?:artifact|file|path|findings)",
        "outcome closeout": r"closeout|remaining goal|next actor|next action",
    })


def test_prototype_selection_documents_a_consolidated_production_handoff() -> None:
    text = skill_path("prototype").read_text(encoding="utf-8")
    assert_concepts(text, {
        "selection": r"select|chosen",
        "consolidated handoff": r"(?:consolidat|single).{0,80}(?:handoff|brief)|(?:handoff|brief).{0,80}consolidat",
        "production handoff": r"production.{0,100}(?:handoff|brief)|(?:handoff|brief).{0,100}production",
        "throwaway separation": r"throwaway",
        "separate implementation authority": r"separately authori[sz]ed implementation",
    })


@pytest.mark.parametrize("name", CONSUMERS)
def test_evals_include_continuation_expectations_with_safety_controls(name: str) -> None:
    path = skill_path(name).parent / "evals/evals.json"
    assert path.is_file(), f"{name} needs authored continuation eval scenarios"
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["skill_name"] == name
    cases = document["evals"]
    assert len({case["id"] for case in cases}) == len(cases), "Eval IDs must be unique"
    relevant = [case for case in cases if re.search(
        CONTINUATION, normalized(" ".join(case["expectations"]))
    )]
    assert relevant, f"{name}: no continuation/outcome expectation coverage"
    # Inspect expectations, not just suggestive scenario titles or expected_output.
    # These checks establish authored coverage, not whether a model obeys it.
    assert any(case.get("prompt", "").strip() and re.search(
        AUTHORITY, normalized(" ".join(case["expectations"]))
    ) and re.search(
        r"abort|stop|budget|bound|exclu|only|does not|never|must not|no automatic",
        normalized(" ".join(case["expectations"]))
    ) for case in relevant), f"{name}: continuation cases need explicit authority and safety expectations"
