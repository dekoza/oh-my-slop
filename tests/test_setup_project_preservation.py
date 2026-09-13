"""The setup skill exposes preservation policy as a consent-gated, paired decision.

These are instruction-contract checks, not behavioral model evaluations. The latter
are defined in the skill's evals/evals.json.
"""

import json
from pathlib import Path

from scripts.validate_refs import find_skill_dir


ROOT = Path(__file__).resolve().parents[1]
SKILL = find_skill_dir(ROOT / "skills", "setup-project-skills")


def test_setup_requires_an_explicit_preservation_decision_and_paired_gate() -> None:
    text = " ".join((SKILL / "SKILL.md").read_text(encoding="utf-8").split())

    assert "**Section E — Preservation obligations.**" in text
    assert "Does this project already have users, non-disposable data, integrations" in text
    assert "including beta usage" in text
    assert "Only explicit owner confirmation" in text
    assert "preservation-policy.md" in text
    assert "policy and launch-retirement gate together" in text
    assert "Never infer eligibility" in text


def test_policy_template_makes_release_retirement_a_verified_gate() -> None:
    text = " ".join(
        (SKILL / "preservation-policy.md").read_text(encoding="utf-8").split()
    )

    assert "including qualifying beta releases" in text
    assert "remove the clean-cut exemption" in text
    assert "replace it with the actual data-preservation" in text
    assert "**release commit**" in text
    assert "**NO-GO for real use**" in text
    assert "**named launch-execution gate**" in text
    assert "Closing planning is not retirement" in text
    assert "leave already completed migrations alone" in text


def test_setup_cannot_activate_an_unpaired_exemption_or_resurrect_a_retired_one() -> None:
    policy = " ".join(
        (SKILL / "preservation-policy.md").read_text(encoding="utf-8").split()
    )
    setup = " ".join((SKILL / "SKILL.md").read_text(encoding="utf-8").split())

    assert "ask to create a named launch-execution gate" in policy
    assert "**agent work tracker**" in policy
    assert "A local-markdown tracker uses its ticket-file convention" in policy
    assert "Persist the launch-ticket update or creation first and read it back" in policy
    assert "Only then write the approved instruction paragraph" in policy
    assert "**leave the exemption inactive**" in policy
    assert "never reinstall it automatically" in setup
    assert "(`AGENTS.md` or existing `CLAUDE.md`)" in setup
    assert "without authorization" in setup


def test_preservation_evals_cover_confirmation_real_beta_and_failed_gate_write() -> None:
    data = json.loads((SKILL / "evals" / "evals.json").read_text(encoding="utf-8"))

    assert data["skill_name"] == "setup-project-skills"
    cases = {case["id"]: case for case in data["evals"]}
    assert len(cases) == len(data["evals"]) == 3
    assert "explicitly confirms no obligations" in cases[3]["prompt"]
    assert "paying testers" in cases[2]["prompt"]
    assert "identical re-sync" in cases[1]["prompt"]
    assert "tracker write failing" in cases[3]["prompt"]
    assert all(case["expectations"] and case["expected_output"] for case in cases.values())
