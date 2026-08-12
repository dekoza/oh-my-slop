import json
from pathlib import Path

from scripts.validate_refs import find_skill_dir


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
WORKFLOW_LABEL = "workflow:implement"


def test_to_tickets_marks_build_work_for_the_implement_workflow() -> None:
    to_tickets_text = (find_skill_dir(SKILLS_ROOT, "to-tickets") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    label_template_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "triage-labels.md"
    ).read_text(encoding="utf-8")

    assert WORKFLOW_LABEL in to_tickets_text
    assert WORKFLOW_LABEL in label_template_text
    assert "ready-for-agent" in to_tickets_text
    assert "ready-for-human" in to_tickets_text


def test_wayfinder_hands_build_ready_work_to_implementation_tickets() -> None:
    wayfinder_text = (find_skill_dir(SKILLS_ROOT, "wayfinder") / "SKILL.md").read_text(
        encoding="utf-8"
    )

    assert "`to-tickets`" in wayfinder_text
    assert WORKFLOW_LABEL in wayfinder_text
    assert "`implement`" in wayfinder_text
    assert "never carry a `wayfinder:<type>` label" in wayfinder_text


def test_project_setup_and_live_config_define_the_workflow_label() -> None:
    setup_skill_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "SKILL.md"
    ).read_text(encoding="utf-8")
    live_label_config_text = (
        REPO_ROOT / "docs" / "agents" / "triage-labels.md"
    ).read_text(encoding="utf-8")

    assert WORKFLOW_LABEL in setup_skill_text
    assert WORKFLOW_LABEL in live_label_config_text
    assert "Workflow and state are separate" in live_label_config_text


def test_project_setup_can_emit_machine_readable_factory_policy() -> None:
    setup_skill_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "SKILL.md"
    ).read_text(encoding="utf-8")

    assert ".pi/factory.json" in setup_skill_text
    assert '"kind": "gitea"' in setup_skill_text
    assert '"login": "<tea-login-name>"' in setup_skill_text
    assert '"maxWorkers": 1' in setup_skill_text
    assert '"workers"' in setup_skill_text
    assert '"profiles"' in setup_skill_text
    assert '"freshRetry"' in setup_skill_text
    assert '"finalReview": "final-review"' in setup_skill_text
    assert '"model": "fable"' in setup_skill_text
    assert "pi --list-models" in setup_skill_text
    assert "claude --version" in setup_skill_text
    assert '"repairAttempts": 1' in setup_skill_text
    assert '"freshAgentRetries": 1' in setup_skill_text
    assert '"finalMerge": "manual"' in setup_skill_text
    assert '"deploy": false' in setup_skill_text


def test_wayfinder_evals_cover_implementation_handoff_and_label_orthogonality() -> None:
    evals_path = find_skill_dir(SKILLS_ROOT, "wayfinder") / "evals" / "evals.json"
    evals_document = json.loads(evals_path.read_text(encoding="utf-8"))

    assert evals_document["skill_name"] == "wayfinder"
    evals = evals_document["evals"]
    assert len(evals) >= 2

    prompts = "\n".join(eval_case["prompt"] for eval_case in evals)
    expectations = "\n".join(
        expectation
        for eval_case in evals
        for expectation in eval_case["expectations"]
    )

    assert "buildable vertical slices" in prompts
    assert "AFK research" in prompts
    assert WORKFLOW_LABEL in expectations
    assert "ready-for-agent" in expectations
    assert "ready-for-human" in expectations
    assert "wayfinder:research" in expectations
