"""Wiring and example checks; response-only lifecycle evals test agent decisions."""

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "skills/practice/docker-discipline/references/resource-lifecycle.md"


@pytest.mark.parametrize(
    "relative",
    [
        "skills/practice/docker-discipline/SKILL.md",
        "skills/practice/testing-workflow/SKILL.md",
        "skills/workflow/implement/SKILL.md",
        "skills/practice/diagnosing-bugs/SKILL.md",
        "skills/reference/docker/references/troubleshooting.md",
    ],
)
def test_resource_creators_and_cleanup_guidance_reach_one_policy(relative: str) -> None:
    """A cleanup instruction is ineffective if its consumer cannot reach it."""
    source = ROOT / relative
    links = re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", source.read_text())
    targets = {(source.parent / link).resolve() for link in links}
    assert POLICY.resolve() in targets, (
        f"{relative} must reach the shared lifecycle policy"
    )
    assert POLICY.is_file()


def test_test_compose_example_preserves_image_installed_dependencies() -> None:
    """The shipped authoring example must not hide the environment it just built."""
    markdown = (ROOT / "skills/practice/docker-discipline/SKILL.md").read_text()
    examples = [
        yaml.safe_load(block)
        for block in re.findall(r"```yaml\n(.*?)```", markdown, re.S)
    ]
    test_stack = next(
        example for example in examples if "testdb" in example.get("services", {})
    )
    mounts = test_stack["services"]["tests"].get("volumes", [])
    assert mounts, "the hot-reload example should still expose source files"
    assert all(mount.split(":", 2)[1] != "/app" for mount in mounts)
    assert all("venv" not in mount for mount in mounts)


def test_disk_pressure_diagnostics_are_read_only() -> None:
    """Inspection must not silently evict another session's build cache."""
    markdown = (
        ROOT / "skills/reference/docker/references/troubleshooting.md"
    ).read_text()
    pressure = markdown.split("### 15.", 1)[1].split("## Always Useful Commands", 1)[0]
    first_commands = re.search(r"```console\n(.*?)```", pressure, re.S).group(1)
    assert "docker system df" in first_commands
    assert "prune" not in first_commands


def test_test_cache_guidance_has_a_lifecycle_boundary() -> None:
    markdown = (ROOT / "skills/practice/testing-workflow/SKILL.md").read_text()
    assert (
        "Persist `.pytest_cache` as a volume so `--lf` works across runs."
        not in markdown
    )
    cache_guidance = next(
        line for line in markdown.splitlines() if "`.pytest_cache`" in line
    )
    assert "within" in cache_guidance.lower()
    assert "run" in cache_guidance.lower()
