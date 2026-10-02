"""PR presentation contracts and native install/draft fixtures.

Source checks guard instructions; fixture effects are not model-following proof.
Matched model outputs and consultation receipts remain outside the package.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from scripts.build_claude_plugin import build_plugin
from scripts.validate_refs import find_skill_dir, iter_skill_dirs

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
PR = SKILLS / "reference/pr"


def test_pr_is_model_discoverable_by_name_and_ships_in_flattened_plugin(tmp_path: Path) -> None:
    assert find_skill_dir(SKILLS, "pr") == PR
    assert PR in iter_skill_dirs(SKILLS)
    _, frontmatter, _ = (PR / "SKILL.md").read_text(encoding="utf-8").split("---", 2)
    metadata = yaml.safe_load(frontmatter)
    assert metadata["name"] == "pr"
    assert metadata.get("disable-model-invocation", False) is False
    assert metadata["description"].startswith("Use when")
    plugin = tmp_path / "plugin"
    assert "pr" in build_plugin(SKILLS, plugin)
    assert (plugin / "skills/pr/SKILL.md").read_bytes() == (PR / "SKILL.md").read_bytes()
    assert not (ROOT / "prompts/pr.md").exists()
