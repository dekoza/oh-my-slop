from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.crap import crap_score, routine_scores


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "crap.py"


def test_crap_score_joins_complexity_and_coverage() -> None:
    assert crap_score(complexity=10, coverage=0.5) == pytest.approx(22.5)
    assert crap_score(complexity=4, coverage=1.0) == 4


def test_unmeasured_source_is_scored_as_zero_coverage() -> None:
    scores = routine_scores(
        {"unmeasured.py": [{"name": "work", "type": "function", "complexity": 6, "lineno": 1, "endline": 3}]},
        {"files": {}},
    )

    assert scores[0]["coverage"] == 0.0
    assert scores[0]["crap"] == 42.0


def test_cli_reports_only_blocks_over_threshold_and_exits_one(tmp_path: Path) -> None:
    radon = {
        "widget.py": [
            {"name": "fragile", "type": "function", "complexity": 10, "lineno": 1, "endline": 4},
            {"name": "covered", "type": "function", "complexity": 4, "lineno": 6, "endline": 8},
        ]
    }
    coverage = {
        "files": {
            "widget.py": {
                "executed_lines": [1, 6, 7, 8],
                "missing_lines": [2, 3, 4],
            }
        }
    }
    radon_path = tmp_path / "radon.json"
    coverage_path = tmp_path / "coverage.json"
    radon_path.write_text(json.dumps(radon), encoding="utf-8")
    coverage_path.write_text(json.dumps(coverage), encoding="utf-8")

    completed = subprocess.run(
        [sys.executable, str(SCRIPT), str(radon_path), str(coverage_path), "--max", "20"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 1
    assert "widget.py:1 fragile" in completed.stdout
    assert "covered" not in completed.stdout
    assert "CRAP threshold 20 exceeded" in completed.stdout
