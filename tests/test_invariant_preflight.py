"""Shared pre-review routing and discriminating task-fixture contracts.

These checks establish reachable instructions and eval inputs, not model compliance.
The paired response exercises are recorded beside the affected skills' evals.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / "skills/workflow"


def preflight_reference(skill: str) -> tuple[str, Path]:
    body = (WORKFLOWS / skill / "SKILL.md").read_text(encoding="utf-8")
    links = re.findall(r"\[[^\]]+\]\(([^)]+invariant-preflight\.md)\)", body)
    assert len(links) == 1, f"{skill} must route to one shared preflight owner"
    target = (WORKFLOWS / skill / links[0]).resolve()
    assert target.is_file(), f"{skill}'s preflight must ship at its linked path"
    return body, target


def test_build_and_repair_share_a_reachable_pre_review_preflight() -> None:
    repair, repair_reference = preflight_reference("fix-pr")
    build, build_reference = preflight_reference("implement")
    assert repair_reference == build_reference
    assert repair.index("invariant-preflight.md") < repair.index("Address actionable review findings")
    assert build.index("invariant-preflight.md") < build.index("## Build and verify")
    assert "before the first edit" in build
    for body in (repair, build):
        assert "two-axis-review" in body
        assert "preflight" in body.lower()


def test_preflight_has_counterexample_and_evidence_exit_conditions() -> None:
    _, target = preflight_reference("fix-pr")
    text = target.read_text(encoding="utf-8")
    for required in (
        "Invariant | Counterexample | Reachable paths | Verification",
        "unknown", "not permission", "sibling", "explicit", "whole-PR",
        "RED", "PostgreSQL", "browser", "mandatory", "exact candidate",
        "not independent review", "unresolved", "static",
    ):
        assert required.lower() in text.lower()


@pytest.mark.parametrize("skill,case_id", [("fix-pr", 7), ("implement", 19)])
def test_failure_path_eval_uses_an_unreported_sibling_not_only_the_reported_bug(
    skill: str, case_id: int,
) -> None:
    root = WORKFLOWS / skill
    data = json.loads((root / "evals/evals.json").read_text(encoding="utf-8"))
    case = next(item for item in data["evals"] if item["id"] == case_id)
    assert case["files"], "Discovery must inspect a supplied source fixture"
    for relative in case["files"]:
        assert (root / relative).is_file()
    expectations = "\n".join(case["expectations"])
    assert "counterexample" in case["prompt"].lower()
    assert "affected" in case["prompt"].lower()
    assert "independent" in expectations.lower()


def stock_api(path: Path):
    spec = importlib.util.spec_from_file_location("eval_stock", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stock_failures(api) -> list[str]:
    """Independent public-interface oracle, not a model-generated expected value."""
    failures = []
    cases = [
        ((10, 3, True, True, 2), 5),
        ((2, 0, False, True, 0), None),
        ((2, 0, True, False, 0), None),
        ((2, 0, False, False, 0), None),
        ((2, 0, True, True, 2), 0),
    ]
    for args, expected in cases:
        if api.prepare(*args) != expected:
            failures.append(f"prepare:{args}")
        for requested in (1, 5, 6):
            wanted = "reserved" if expected is not None and requested <= expected else "refused"
            if api.reserve(*args, requested) != wanted:
                failures.append(f"reserve:{args}:{requested}")
    return failures


def test_executable_sibling_oracle_rejects_a_report_only_repair(tmp_path: Path) -> None:
    fixture = WORKFLOWS / "fix-pr/evals/files/reservation.py"
    source = fixture.read_text(encoding="utf-8")
    assert stock_failures(stock_api(fixture)), "The unrepaired fixture must expose real defects"
    report_only = tmp_path / "report_only.py"
    report_only.write_text(source.replace(
        "max(0, physical - backed)", "max(0, physical - consigned - backed)"
    ), encoding="utf-8")
    failures = stock_failures(stock_api(report_only))
    assert any(item.startswith("prepare:") for item in failures)
    assert any(item.startswith("reserve:") and "False" in item for item in failures)

    complete = tmp_path / "complete.py"
    complete.write_text(
        "def prepare(physical, consigned, ownership_known, authority_known, backed):\n"
        "    if not ownership_known or not authority_known:\n"
        "        return None\n"
        "    return max(0, physical - consigned - backed)\n\n"
        "def reserve(physical, consigned, ownership_known, authority_known, backed, requested):\n"
        "    cap = prepare(physical, consigned, ownership_known, authority_known, backed)\n"
        "    return 'reserved' if cap is not None and requested <= cap else 'refused'\n",
        encoding="utf-8",
    )
    assert stock_failures(stock_api(complete)) == []
