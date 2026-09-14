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
