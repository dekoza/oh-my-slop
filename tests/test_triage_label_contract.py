"""Installed guidance and the setup template must distinguish routing from readiness."""

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LABEL_DOCS = (
    ROOT / "docs/agents/triage-labels.md",
    ROOT / "skills/meta/setup-project-skills/triage-labels.md",
)


@pytest.mark.parametrize("path", LABEL_DOCS, ids=("repository", "setup-template"))
def test_workflow_label_does_not_grant_readiness(path: Path) -> None:
    text = path.read_text()
    workflow = text.split("## Workflow labels\n", 1)[1].split("\n## ", 1)[0]

    assert "routing, not readiness or authorization" in workflow
    assert "`needs-info` + `workflow:implement`" in workflow
    assert "owner and next action" in workflow
    assert "prerequisite" in workflow.lower()
    assert "build-ready work" not in workflow


def test_setup_and_repository_agree_on_default_state_meanings() -> None:
    def meanings(path: Path) -> dict[str, str]:
        section = path.read_text().split("## State roles\n", 1)[1].split("\n## ", 1)[0]
        return {
            cells[0]: cells[2]
            for line in section.splitlines()
            if line.startswith("| `")
            for cells in [[cell.strip() for cell in line.strip("|").split("|")]]
        }

    installed, template = (meanings(path) for path in LABEL_DOCS)
    assert installed == template
    assert "refinement" in installed["`needs-info`"]
    assert "authorized" in installed["`ready-for-agent`"]
    assert "judgement" in installed["`ready-for-human`"]
