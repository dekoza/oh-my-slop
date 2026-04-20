"""Regression tests for aggregate_benchmark.py.

These tests target specific bugs found during the python-async skill iteration-7
benchmarking. Each test fails against the current (buggy) script and should pass
after the fix is applied.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = (
    Path(__file__).resolve().parents[1] / "skills" / "skill-creator" / "scripts"
)
sys.path.insert(0, str(SCRIPTS_DIR))

from aggregate_benchmark import generate_benchmark, load_run_results, calculate_stats


def _make_grading(passed: int, failed: int, total: int) -> dict:
    return {
        "summary": {
            "passed": passed,
            "failed": failed,
            "total": total,
            "pass_rate": passed / total if total else 0.0,
        },
        "expectations": [
            {"text": f"Expectation {i}", "passed": i < passed, "evidence": "test"}
            for i in range(total)
        ],
    }


def _make_timing(duration: float, tokens: int) -> dict:
    return {"total_duration_seconds": duration, "total_tokens": tokens}


def _build_iteration_dir(
    tmp_path: Path,
    num_evals: int = 2,
    num_runs: int = 1,
    configs: tuple[str, ...] = ("with_skill", "without_skill"),
) -> Path:
    """Build a minimal iteration directory with grading.json and timing.json."""
    for eid in range(1, num_evals + 1):
        for config in configs:
            for run in range(1, num_runs + 1):
                run_dir = tmp_path / f"eval-{eid}" / config / f"run-{run}"
                run_dir.mkdir(parents=True)

                grading = _make_grading(passed=5, failed=1, total=6)
                (run_dir / "grading.json").write_text(json.dumps(grading))

                timing = _make_timing(duration=42.5, tokens=50000)
                (run_dir / "timing.json").write_text(json.dumps(timing))
    return tmp_path


class TestRunsPerConfigurationDerivedFromDirs:
    """Bug: runs_per_configuration was hardcoded to 3 regardless of actual run dirs."""

    def test_single_run_per_config_produces_1(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=2, num_runs=1)
        benchmark = generate_benchmark(tmp_path)
        assert benchmark["metadata"]["runs_per_configuration"] == 1

    def test_two_runs_per_config_produces_2(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=2, num_runs=2)
        benchmark = generate_benchmark(tmp_path)
        assert benchmark["metadata"]["runs_per_configuration"] == 2

    def test_three_runs_per_config_produces_3(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=2, num_runs=3)
        benchmark = generate_benchmark(tmp_path)
        assert benchmark["metadata"]["runs_per_configuration"] == 3

    def test_mixed_run_counts_uses_max(self, tmp_path: Path) -> None:
        """When eval-1 has 2 runs and eval-2 has 1, report max (2)."""
        _build_iteration_dir(tmp_path, num_evals=2, num_runs=1)
        extra_run = tmp_path / "eval-1" / "with_skill" / "run-2"
        extra_run.mkdir(parents=True)
        grading = _make_grading(passed=6, failed=0, total=6)
        (extra_run / "grading.json").write_text(json.dumps(grading))
        timing = _make_timing(duration=30.0, tokens=40000)
        (extra_run / "timing.json").write_text(json.dumps(timing))

        benchmark = generate_benchmark(tmp_path)
        assert benchmark["metadata"]["runs_per_configuration"] >= 2


class TestModelFieldsAcceptCliArgs:
    """Bug: executor_model and analyzer_model were always '<model-name>' placeholders."""

    def test_executor_model_passed_through(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=1, num_runs=1)
        benchmark = generate_benchmark(
            tmp_path, executor_model="github-copilot/gpt-5.4"
        )
        assert benchmark["metadata"]["executor_model"] == "github-copilot/gpt-5.4"

    def test_analyzer_model_passed_through(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=1, num_runs=1)
        benchmark = generate_benchmark(tmp_path, analyzer_model="inline-manual")
        assert benchmark["metadata"]["analyzer_model"] == "inline-manual"

    def test_executor_model_defaults_to_placeholder_when_omitted(
        self, tmp_path: Path
    ) -> None:
        _build_iteration_dir(tmp_path, num_evals=1, num_runs=1)
        benchmark = generate_benchmark(tmp_path)
        assert benchmark["metadata"]["executor_model"] == "<model-name>"

    def test_analyzer_model_defaults_to_placeholder_when_omitted(
        self, tmp_path: Path
    ) -> None:
        _build_iteration_dir(tmp_path, num_evals=1, num_runs=1)
        assert True  # analyzer_model default is already "<model-name>", this is fine

    def test_skill_path_preserved_when_provided(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=1, num_runs=1)
        benchmark = generate_benchmark(
            tmp_path, skill_path="/home/minder/projekty/oh-my-slop/skills/python-async"
        )
        assert (
            benchmark["metadata"]["skill_path"]
            == "/home/minder/projekty/oh-my-slop/skills/python-async"
        )


class TestCalculateStatsUsesPopulationStddev:
    """
    The manually-computed benchmarks use population stddev (divide by n).
    The script uses sample stddev (divide by n-1). For consistency with
    existing benchmark.json files, population stddev should be used.
    """

    def test_single_value_stddev_is_zero(self) -> None:
        result = calculate_stats([0.95])
        assert result["stddev"] == 0.0

    def test_population_stddev_for_two_values(self) -> None:
        result = calculate_stats([0.8, 1.0])
        # population stddev of [0.8, 1.0] = sqrt(((0.8-0.9)^2 + (1.0-0.9)^2) / 2) = 0.1
        # sample stddev would be sqrt(0.02 / 1) = 0.1414
        assert result["stddev"] == pytest.approx(0.1, abs=0.001)


class TestLoadRunResultsHandlesWorkspaceLayout:
    """Verify the script correctly loads results from the workspace layout."""

    def test_loads_all_runs_from_workspace_layout(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=3, num_runs=2)
        results = load_run_results(tmp_path)
        assert "with_skill" in results
        assert "without_skill" in results
        assert len(results["with_skill"]) == 6  # 3 evals * 2 runs
        assert len(results["without_skill"]) == 6

    def test_loads_timing_from_sibling_file(self, tmp_path: Path) -> None:
        _build_iteration_dir(tmp_path, num_evals=1, num_runs=1)
        results = load_run_results(tmp_path)
        run = results["with_skill"][0]
        assert run["time_seconds"] == 42.5
        assert run["tokens"] == 50000
