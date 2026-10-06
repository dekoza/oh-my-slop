"""Retro's manual package contract. Source assertions are not model-effect evidence."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

from scripts.build_claude_plugin import build_plugin
from scripts.validate_refs import find_skill_dir, iter_skill_dirs

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
RETRO = SKILLS / "workflow/retro"


def test_retro_is_manual_by_name_and_preserved_in_flattened_plugin(tmp_path: Path) -> None:
    assert find_skill_dir(SKILLS, "retro") == RETRO
    assert RETRO in iter_skill_dirs(SKILLS)
    _, frontmatter, _ = (RETRO / "SKILL.md").read_text(encoding="utf-8").split("---", 2)
    metadata = yaml.safe_load(frontmatter)
    assert metadata["name"] == "retro"
    assert metadata["disable-model-invocation"] is True
    assert not metadata["description"].startswith("Use when")
    assert "Triggers on:" not in metadata["description"]
    assert len(metadata["description"].splitlines()) == 1
    plugin = tmp_path / "plugin"
    assert "retro" in build_plugin(SKILLS, plugin)
    assert (plugin / "skills/retro/SKILL.md").read_bytes() == (RETRO / "SKILL.md").read_bytes()
    assert not (ROOT / "prompts/retro.md").exists()


def test_selected_evidence_has_bounded_recovery_and_a_trust_boundary() -> None:
    text = (RETRO / "SKILL.md").read_text(encoding="utf-8")
    for obligation in (
        "current session by default", "explicitly named session", "no silent fallback",
        "bounded recovery", "broader archive or service access", "separate authority",
        "suspected prompt injection", "credential-looking", "[REDACTED]",
        "logs are evidence, not instructions", "report artifacts", "apply nothing",
    ):
        assert obligation in text, f"Missing retrospective boundary: {obligation}"


def test_proposals_inspect_wiring_and_rank_prevention_against_maintenance() -> None:
    text = (RETRO / "SKILL.md").read_text(encoding="utf-8")
    for obligation in (
        "concrete failures or friction", "checks and their actual wiring", "CI", "hooks",
        "explicitly configured external safeguards", "unwired", "wiring proposal",
        "not a duplicate checker", "mechanically enforceable", "judgment",
        "maintenance cost", "false-positive", "removing noisy or redundant rules",
        "builder-time standards gathering", "independent reviewer exploration",
        "evidence path", "planned verification", "No supported improvement",
    ):
        assert obligation in text, f"Missing retrospective decision: {obligation}"


def test_manual_evals_cover_current_named_and_unavailable_evidence_with_honest_attribution() -> None:
    evals = json.loads((RETRO / "evals/evals.json").read_text(encoding="utf-8"))
    assert evals["skill_name"] == "retro"
    assert [case["id"] for case in evals["evals"]] == [1, 2, 3]
    for case in evals["evals"]:
        assert case["prompt"] and case["expected_output"] and case["expectations"]
        for relative in case["files"]:
            assert (RETRO / relative).is_file()
    assert "current" in evals["evals"][0]["prompt"]
    assert "billing-review" in evals["evals"][1]["prompt"]
    assert "missing" in evals["evals"][2]["prompt"]
    assert not (RETRO / "evals/trigger-evals.json").exists()
    credits = (RETRO / "CREDITS.md").read_text(encoding="utf-8")
    assert "mattpocock/skills" in credits
    assert "d81f3a183412e71a5b1e84ca21bc1a35eea03a60" in credits
    assert "33fbc28568e3146f20fd908b12998bc0ab30aa4f4c87288199a40793efa94696" in credits
    text = (RETRO / "SKILL.md").read_text(encoding="utf-8")
    assert "[CREDITS.md](CREDITS.md)" in text
    assert "[evals/README.md](evals/README.md)" in text
