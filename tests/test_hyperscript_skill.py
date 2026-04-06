from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "hyperscript"


def test_hyperscript_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "hyperscript"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_hyperscript_skill_version_is_present() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "0.9" in skill_text
    assert "last_verified" in skill_text


def test_hyperscript_skill_guardrails_cover_critical_rules() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "processNode" in skill_text
    assert "queue last" in skill_text
    assert "queue all" in skill_text
    assert "queue none" in skill_text
    assert "string" in skill_text.lower() and "@" in skill_text
    assert "parenthes" in skill_text.lower()
    assert "`js ... end`" in skill_text or "js ... end" in skill_text
    assert "local" in skill_text.lower() and "behavior" in skill_text.lower()
    assert "/dist/workers.js" in skill_text or "separate script" in skill_text.lower()
    assert "precede" in skill_text.lower() or "before" in skill_text.lower()


def test_hyperscript_skill_has_when_not_to_use_section() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "When NOT" in skill_text or "when not" in skill_text.lower()
    assert "htmx" in skill_text.lower()
    assert "JavaScript" in skill_text


def test_hyperscript_skill_has_setup_essentials() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "unpkg.com" in skill_text or "hyperscript.org" in skill_text
    assert "browserInit" in skill_text
    assert "processNode" in skill_text
    assert "text/hyperscript" in skill_text


def test_hyperscript_skill_has_htmx_companion_guidance() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "htmx:beforeRequest" in skill_text or "htmx:" in skill_text
    assert "htmx" in skill_text.lower()


def test_hyperscript_skill_reference_files_cover_key_topics() -> None:
    core_text = (SKILL_ROOT / "references" / "core-language.md").read_text(
        encoding="utf-8"
    )
    dom_text = (SKILL_ROOT / "references" / "dom-and-commands.md").read_text(
        encoding="utf-8"
    )
    events_text = (SKILL_ROOT / "references" / "events-and-async.md").read_text(
        encoding="utf-8"
    )
    advanced_text = (SKILL_ROOT / "references" / "advanced-and-interop.md").read_text(
        encoding="utf-8"
    )

    assert "scope" in core_text.lower()
    assert "`$`" in core_text or "global" in core_text.lower()
    assert "`:`" in core_text or "element" in core_text.lower()
    assert "as" in core_text and "Int" in core_text
    assert "closure" in core_text.lower() or "\\" in core_text
    assert "catch" in core_text

    assert "put" in dom_text.lower()
    assert "toggle" in dom_text.lower()
    assert "closest" in dom_text.lower()
    assert "take" in dom_text.lower()
    assert "tell" in dom_text.lower()
    assert "settle" in dom_text.lower()

    assert "queue" in events_text.lower()
    assert "destructur" in events_text.lower()
    assert "filter" in events_text.lower()
    assert "async" in events_text.lower()
    assert "wait" in events_text.lower()
    assert "mutation" in events_text.lower() or "MutationObserver" in events_text

    assert "fetch" in advanced_text.lower()
    assert "behavior" in advanced_text.lower()
    assert "worker" in advanced_text.lower()
    assert "socket" in advanced_text.lower()
    assert (
        "eventsource" in advanced_text.lower()
        or "event source" in advanced_text.lower()
    )
    assert "/dist/" in advanced_text or "separate script" in advanced_text.lower()


def test_hyperscript_skill_evals_cover_core_risk_areas() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "hyperscript"
    evals = payload["evals"]
    assert len(evals) >= 7
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = [item["prompt"] for item in evals]
    all_prompts = "\n".join(prompts)

    assert any("processNode" in p or "dynamically" in p.lower() for p in prompts)
    assert any("queue" in p.lower() for p in prompts)
    assert any(
        "toggle" in p.lower() or "put" in p.lower() or "closest" in p.lower()
        for p in prompts
    )
    assert any("fetch" in p.lower() for p in prompts)
    assert any("htmx" in p.lower() for p in prompts)
    assert any("js" in p.lower() or "javascript" in p.lower() for p in prompts)
    assert any(
        "behavior" in p.lower() or "worker" in p.lower() or "socket" in p.lower()
        for p in prompts
    )

    assert all(item["expectations"] and item["expected_output"] for item in evals)


def test_hyperscript_evals_have_discriminating_expectations() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    evals = payload["evals"]

    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )

    assert "processNode" in expectations
    assert "queue" in expectations.lower()
    assert "finally" in expectations.lower() or "cleanup" in expectations.lower()
    assert "htmx" in expectations.lower()
    assert "js ... end" in expectations.lower() or "javascript" in expectations.lower()
    assert "/dist/" in expectations or "separate" in expectations.lower()
