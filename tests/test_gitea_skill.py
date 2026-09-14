"""Gitea guidance must produce usable commands, not just valid Markdown."""

import json
import re
from pathlib import Path

import pytest

from scripts.validate_refs import find_skill_dir


ROOT = Path(__file__).resolve().parents[1]
GITEA = find_skill_dir(ROOT / "skills", "gitea")
SETUP = find_skill_dir(ROOT / "skills", "setup-project-skills")
TRACKER_DOCUMENTS = [SETUP / "issue-tracker-gitea.md", ROOT / "docs/agents/issue-tracker.md"]


@pytest.mark.parametrize("document", TRACKER_DOCUMENTS, ids=["scaffold", "repository"])
def test_dependency_examples_supply_complete_issue_meta(document: Path) -> None:
    text = document.read_text(encoding="utf-8")
    payloads = re.findall(r"--data '([^']+)'", text)
    assert payloads, "The blocking-edge recipe must include its request body"
    for raw in payloads:
        payload = json.loads(raw.replace("<blocker>", "7"))
        assert {"index", "owner", "repo"} <= payload.keys()
        assert payload["index"] == 7
        assert payload["owner"] and payload["repo"]


@pytest.mark.parametrize("document", TRACKER_DOCUMENTS, ids=["scaffold", "repository"])
def test_runnable_tracker_examples_bind_repository_scope(document: Path) -> None:
    text = document.read_text(encoding="utf-8").split("\n# Intake: GitHub", 1)[0]
    commands = re.findall(r"`(tea (?:issues|comments|labels|pr) [^`]+)`", text)
    runnable = [
        command
        for command in commands
        if any(argument in command for argument in ("<index>", "<comment-id>", "--title", "--state", "--name"))
    ]
    assert runnable
    assert all("--repo " in command for command in runnable), runnable
    assert "Use the `gitea` skill" in text
