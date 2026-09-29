"""Factory is retired; package updates must not restore its executable surfaces."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_package_no_longer_installs_factory() -> None:
    manifest = json.loads((ROOT / "package.json").read_text())
    assert "factory" not in manifest.get("bin", {})
    assert "./extensions/factory" not in manifest["pi"]["extensions"]
    assert manifest["pi"]["skills"] == ["./skills"]
    assert manifest["pi"]["prompts"] == ["./prompts"]


def test_factory_implementations_and_local_policy_are_removed() -> None:
    for relative in (
        "factory",
        "extensions/factory",
        "extensions/.legacy/software-factory",
        "extensions/.legacy/job-pipeline",
        ".pi/factory.json",
        "skills/meta/skill-loading-proof",
        "skills/meta/setup-project-skills/factory-policy.md",
        "scripts/stryker.mjs",
        "stryker.config.json",
        "tests/live/prove-skill-loading.mjs",
        "tests/live/claude-chrome-cache.mjs",
        "tests/live/herdr-agent-presence-source.mjs",
        "tests/live/herdr-agent-quit-sequence.mjs",
        "tests/live/herdr-agent-stop-latency.mjs",
        "tests/live/herdr-isolated-worker-status.mjs",
        "tests/live/herdr-pane-exit-frame.mjs",
        "tests/live/herdr-subscription-frames.mjs",
        "tests/live/herdr-tab-env-reaches-agent.mjs",
    ):
        assert not (ROOT / relative).exists(), f"Retired Factory surface remains: {relative}"
    assert not list((ROOT / "tests/node").glob("factory_*.test.mjs"))
    assert not list((ROOT / "tests/node/helpers").glob("factory-*.mjs"))


def test_project_setup_and_skills_do_not_generate_factory_contracts() -> None:
    for path in (ROOT / "skills").rglob("*"):
        if not path.is_file() or path.suffix not in {".md", ".json", ".py", ".sh"}:
            continue
        content = path.read_text()
        for retired in (
            ".pi/factory.json",
            "factory/lib/",
            "factory/bin/",
            "docs/specs/software-factory.md",
            "FACTORY_ATTEMPT",
        ):
            assert retired not in content, f"{path.relative_to(ROOT)} retains {retired}"


def test_factory_is_documented_as_retired_in_favor_of_cleopatra() -> None:
    readme = (ROOT / "README.md").read_text()
    assert "Cleopatra" in readme
    assert "proof-of-concept" in readme
    assert "factory --help" not in readme
    assert "factory doctor" not in readme
    assert "factory start" not in readme
    for relative in (
        "docs/specs/software-factory.md",
        "docs/specs/software-factory-monitor.md",
    ):
        content = (ROOT / relative).read_text()
        assert "Superseded" in content
        assert "Cleopatra" in content
        assert "Status:** locked" not in content
