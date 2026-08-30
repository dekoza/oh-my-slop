from __future__ import annotations

import json
import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent


def test_factory_declares_feedable_mutation_and_complexity_recipes() -> None:
    config = json.loads((REPO_ROOT / ".pi" / "factory.json").read_text(encoding="utf-8"))
    recipes = {check["name"]: check for check in config["checks"] if check["severity"] == "advisory"}

    assert set(recipes) == {"mutation-python", "mutation-node", "complexity-crap-python"}
    for recipe in recipes.values():
        assert recipe["timeout"] > 0
        assert recipe["feeds"] == ["implement"]
    assert recipes["mutation-python"]["expectedFailureExitCodes"] == []
    assert recipes["mutation-node"]["expectedFailureExitCodes"] == [1]
    assert recipes["complexity-crap-python"]["expectedFailureExitCodes"] == [1]


def test_quality_tool_configuration_is_installable_and_targeted() -> None:
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    quality = "\n".join(pyproject["dependency-groups"]["quality"])

    assert "mutmut" in quality
    assert "radon" in quality
    assert "coverage" in quality
    assert pyproject["tool"]["mutmut"]["only_mutate"] == ["scripts/crap.py"]

    stryker = json.loads((REPO_ROOT / "stryker.config.json").read_text(encoding="utf-8"))
    assert stryker["mutate"] == ["factory/lib/config/checks.mjs"]
    assert stryker["thresholds"]["break"] == 70
