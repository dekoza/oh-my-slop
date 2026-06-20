from __future__ import annotations

import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "ponytail-audit"


def _skill_text() -> str:
    return (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")


def test_heuristic_audit_script_is_not_shipped() -> None:
    """The AST/regex ponytail_audit.py produced almost-universal false
    positives because dead-code and single-implementation detection are
    cross-file, intent-laden judgments that a per-file heuristic cannot make.
    Over-engineering auditing is LLM-driven; a heuristic script must not be
    re-added. See git history for the removal rationale."""
    assert not (SKILL_ROOT / "scripts" / "ponytail_audit.py").exists()
    assert not (REPO_ROOT / "scripts" / "ponytail_audit.py").exists()


def test_skill_does_not_invoke_a_script() -> None:
    """The audit is performed by the model reading the codebase, not by
    shelling out to a script. The SKILL.md must not instruct running
    ponytail_audit.py."""
    text = _skill_text()

    assert "ponytail_audit.py" not in text
    assert "uv run python" not in text


def test_skill_auto_triggers() -> None:
    """ponytail-audit is invoked directly by users AND by
    improve-codebase-architecture, so it must be available to model
    invocation (no disable-model-invocation)."""
    text = _skill_text()

    assert "disable-model-invocation" not in text


def test_skill_documents_the_tag_vocabulary() -> None:
    text = _skill_text()

    for tag in ("delete", "stdlib", "native", "yagni", "shrink"):
        assert tag in text


def test_skill_enforces_one_shot_read_only_boundaries() -> None:
    """The audit lists findings and applies nothing; it stops after
    presenting and asks the user what to act on (no mid-audit scope drift
    into a general codebase tour)."""
    text = _skill_text().lower()

    assert "one-shot" in text or "one shot" in text
    assert "read-only" in text or "read only" in text or "applies nothing" in text
    assert "stop" in text


def test_skill_is_model_driven() -> None:
    """Over-engineering detection is a cross-file, intent-laden judgment, so
    the audit is performed by the model reading the codebase and reasoning
    about usage — not by shelling out to a heuristic analyzer."""
    text = _skill_text().lower()

    assert "model-driven" in text or "llm-driven" in text


def test_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "ponytail-audit"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_improve_codebase_architecture_does_not_run_audit_script() -> None:
    """improve-codebase-architecture folds a ponytail-audit pass into its
    simplify candidates. It must invoke the skill, not the removed script."""
    text = (
        REPO_ROOT
        / "skills"
        / "improve-codebase-architecture"
        / "SKILL.md"
    ).read_text(encoding="utf-8")

    assert "ponytail_audit.py" not in text
    assert "uv run python" not in text or "ponytail_audit.py" not in text
