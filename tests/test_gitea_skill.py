"""Gitea guidance must produce usable commands, not just valid Markdown."""

import json
import re
import subprocess
import sys
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


def test_gitea_functional_evals_have_inputs_and_observable_expectations() -> None:
    path = GITEA / "evals/evals.json"
    assert path.is_file(), "Trigger cases alone do not exercise tea usage"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["skill_name"] == "gitea"
    cases = {case["id"]: case for case in data["evals"]}
    assert len(cases) == len(data["evals"])
    assert {1, 2, 3, 4, 5, 6, 7, 8, 9, 10} <= cases.keys()
    for case in cases.values():
        assert case["prompt"] and case["expected_output"] and case["expectations"]
        assert all(isinstance(item, str) and item for item in case["expectations"])
        for filename in case.get("files", []):
            assert (GITEA / filename).is_file(), filename


def test_entry_point_exposes_read_grammar_and_reference_gate() -> None:
    text = (GITEA / "SKILL.md").read_text(encoding="utf-8")
    assert "tea comments list --repo OWNER/REPO --login LOGIN INDEX" in text
    assert "tea issues --repo OWNER/REPO --login LOGIN --comments INDEX" in text
    assert "Before the first tracker call" in text
    assert "after compaction" in text
    assert "references/issues.md" in text and "references/api-scripting.md" in text


@pytest.mark.parametrize(
    ("assignees", "expected"),
    [(None, []), ([], []), ([{"login": "worker"}], ["worker"])],
)
def test_documented_large_issue_summary_handles_nullable_assignees(
    tmp_path: Path, assignees: list[dict[str, str]] | None, expected: list[str],
) -> None:
    text = (GITEA / "references/api-scripting.md").read_text(encoding="utf-8")
    recipe = re.search(r"python - response\.json <<'PY'\n(.*?)\nPY", text, re.DOTALL)
    assert recipe is not None, "Expose a runnable file-backed issue summary recipe"
    response = tmp_path / "response.json"
    response.write_text(
        json.dumps({"number": 900, "body": "x" * 300_000, "assignees": assignees}),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-", str(response)],
        input=recipe.group(1), capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"number": 900, "assignees": expected}
    assert len(result.stdout) < 200


@pytest.mark.parametrize("assignees", [{}, "unexpected", 42])
def test_documented_issue_summary_refuses_invalid_collection_shape(
    tmp_path: Path, assignees: object,
) -> None:
    text = (GITEA / "references/api-scripting.md").read_text(encoding="utf-8")
    recipe = re.search(r"python - response\.json <<'PY'\n(.*?)\nPY", text, re.DOTALL)
    assert recipe is not None
    response = tmp_path / "response.json"
    response.write_text(json.dumps({"number": 900, "assignees": assignees}), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-", str(response)],
        input=recipe.group(1), capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0
    assert "Expected an assignees list or null" in result.stderr
    assert result.stdout == ""


def test_api_orchestration_reuses_qualified_helpers_and_recovers_saved_identity() -> None:
    text = " ".join((GITEA / "references/api-scripting.md").read_text().split())
    section = text.split("## Bounded orchestration data", 1)[1].split("## Pagination", 1)[0]
    assert "existing tested API handling" in section
    assert "repository and login binding" in section
    assert "IDs, paths and statuses" in section
    assert "complete saved JSON" in section
    assert "reconcile that identity" in section
    assert "rather than recreating an issue" in section
