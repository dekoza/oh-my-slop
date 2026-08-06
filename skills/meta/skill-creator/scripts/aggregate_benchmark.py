#!/usr/bin/env python3
"""
Aggregate individual run results into benchmark summary statistics.

Reads grading.json files from run directories and produces:
- run_summary with mean, stddev, min, max for each metric
- delta between with_skill and without_skill configurations

Usage:
    python aggregate_benchmark.py <benchmark_dir>

Example:
    python aggregate_benchmark.py benchmarks/2026-01-15T10-30-00/

The script supports two directory layouts:

    Workspace layout (from skill-creator iterations):
    <benchmark_dir>/
    └── eval-N/
        ├── with_skill/
        │   ├── run-1/grading.json
        │   └── run-2/grading.json
        └── without_skill/
            ├── run-1/grading.json
            └── run-2/grading.json

    Legacy layout (with runs/ subdirectory):
    <benchmark_dir>/
    └── runs/
        └── eval-N/
            ├── with_skill/
            │   └── run-1/grading.json
            └── without_skill/
                └── run-1/grading.json
"""

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path


def calculate_stats(values: list[float]) -> dict:
    """Calculate mean, stddev, min, max for a list of values."""
    if not values:
        return {"mean": 0.0, "stddev": 0.0, "min": 0.0, "max": 0.0}

    n = len(values)
    mean = sum(values) / n

    if n > 1:
        variance = sum((x - mean) ** 2 for x in values) / n
        stddev = math.sqrt(variance)
    else:
        stddev = 0.0

    return {
        "mean": round(mean, 4),
        "stddev": round(stddev, 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def load_run_results(benchmark_dir: Path) -> dict:
    """
    Load all run results from a benchmark directory.

    Returns dict keyed by config name (e.g. "with_skill"/"without_skill",
    or "new_skill"/"old_skill"), each containing a list of run results.
    """
    # Support both layouts: eval dirs directly under benchmark_dir, or under runs/
    runs_dir = benchmark_dir / "runs"
    if runs_dir.exists():
        search_dir = runs_dir
    elif list(benchmark_dir.glob("eval-*")):
        search_dir = benchmark_dir
    else:
        print(
            f"No eval directories found in {benchmark_dir} or {benchmark_dir / 'runs'}"
        )
        return {}

    results: dict[str, list] = {}

    for eval_idx, eval_dir in enumerate(sorted(search_dir.glob("eval-*"))):
        metadata_path = eval_dir / "eval_metadata.json"
        eval_name = eval_dir.name
        if metadata_path.exists():
            try:
                with open(metadata_path) as mf:
                    eval_metadata = json.load(mf)
                eval_id = eval_metadata.get("eval_id", eval_idx)
                eval_name = eval_metadata.get("eval_name", eval_name)
            except (json.JSONDecodeError, OSError):
                eval_id = eval_idx
        else:
            try:
                eval_id = int(eval_dir.name.split("-")[1])
            except ValueError:
                eval_id = eval_idx

        # Discover config directories dynamically rather than hardcoding names
        for config_dir in sorted(eval_dir.iterdir()):
            if not config_dir.is_dir():
                continue
            # Skip non-config directories (inputs, outputs, etc.)
            if not list(config_dir.glob("run-*")):
                continue
            config = config_dir.name
            if config not in results:
                results[config] = []

            for run_dir in sorted(config_dir.glob("run-*")):
                run_number = int(run_dir.name.split("-")[1])
                grading_file = run_dir / "grading.json"

                if not grading_file.exists():
                    print(f"Warning: grading.json not found in {run_dir}")
                    continue

                try:
                    with open(grading_file) as f:
                        grading = json.load(f)
                except json.JSONDecodeError as e:
                    print(f"Warning: Invalid JSON in {grading_file}: {e}")
                    continue

                summary = grading.get("summary")
                required_summary_fields = {"pass_rate", "passed", "failed", "total"}
                if not isinstance(summary, dict):
                    raise ValueError(f"Missing grading summary in {grading_file}")
                missing_summary_fields = required_summary_fields - summary.keys()
                if missing_summary_fields:
                    missing = ", ".join(sorted(missing_summary_fields))
                    raise ValueError(
                        f"Grading summary in {grading_file} missing fields: {missing}"
                    )

                result = {
                    "eval_id": eval_id,
                    "eval_name": eval_name,
                    "run_number": run_number,
                    "pass_rate": summary["pass_rate"],
                    "passed": summary["passed"],
                    "failed": summary["failed"],
                    "total": summary["total"],
                }

                # Extract timing — check grading.json first, then sibling timing.json
                timing = grading.get("timing", {})
                result["time_seconds"] = timing.get("total_duration_seconds")
                result["tokens"] = timing.get("total_tokens")
                timing_file = run_dir / "timing.json"
                if timing_file.exists() and (
                    result["time_seconds"] is None or result["tokens"] is None
                ):
                    try:
                        with open(timing_file) as tf:
                            timing_data = json.load(tf)
                        if result["time_seconds"] is None:
                            result["time_seconds"] = timing_data.get(
                                "total_duration_seconds"
                            )
                        if result["tokens"] is None:
                            result["tokens"] = timing_data.get("total_tokens")
                    except json.JSONDecodeError:
                        pass

                # Extract metrics if available
                metrics = grading.get("execution_metrics", {})
                result["tool_calls"] = metrics.get("total_tool_calls")
                result["errors"] = metrics.get("errors_encountered")

                # Extract expectations — viewer requires fields: text, passed, evidence
                raw_expectations = grading.get("expectations")
                if not isinstance(raw_expectations, list) or not raw_expectations:
                    raise ValueError(f"Missing grading expectations in {grading_file}")
                for expectation in raw_expectations:
                    required_fields = {"text", "passed", "evidence"}
                    missing_fields = required_fields - expectation.keys()
                    if missing_fields:
                        missing = ", ".join(sorted(missing_fields))
                        raise ValueError(
                            f"Expectation in {grading_file} missing required fields: {missing}"
                        )
                    evidence = expectation["evidence"]
                    if not isinstance(evidence, str) or not evidence.strip():
                        raise ValueError(
                            f"Expectation in {grading_file} requires non-empty evidence"
                        )
                result["expectations"] = raw_expectations

                # Extract notes from user_notes_summary
                notes_summary = grading.get("user_notes_summary", {})
                notes = []
                notes.extend(notes_summary.get("uncertainties", []))
                notes.extend(notes_summary.get("needs_review", []))
                notes.extend(notes_summary.get("workarounds", []))
                result["notes"] = notes

                results[config].append(result)

    return results


def aggregate_results(results: dict) -> dict:
    """
    Aggregate run results into summary statistics.

    Returns run_summary with stats for each configuration and delta.
    """
    run_summary = {}
    configs = list(results.keys())

    for config in configs:
        runs = results.get(config, [])
        config_summary = {
            "pass_rate": calculate_stats([run["pass_rate"] for run in runs])
        }
        measured_times = [
            run["time_seconds"]
            for run in runs
            if run["time_seconds"] is not None
        ]
        measured_tokens = [
            run["tokens"] for run in runs if run.get("tokens") is not None
        ]
        if measured_times:
            config_summary["time_seconds"] = calculate_stats(measured_times)
        if measured_tokens:
            config_summary["tokens"] = calculate_stats(measured_tokens)
        run_summary[config] = config_summary

    run_summary["delta"] = {}
    if len(configs) >= 2:
        primary = run_summary[configs[0]]
        baseline = run_summary[configs[1]]
        for metric, precision in (
            ("pass_rate", "+.2f"),
            ("time_seconds", "+.1f"),
            ("tokens", "+.0f"),
        ):
            if metric not in primary or metric not in baseline:
                continue
            difference = primary[metric]["mean"] - baseline[metric]["mean"]
            run_summary["delta"][metric] = format(difference, precision)

    return run_summary


def generate_benchmark(
    benchmark_dir: Path,
    skill_name: str = "",
    skill_path: str = "",
    executor_model: str = "",
    analyzer_model: str = "",
) -> dict:
    """
    Generate complete benchmark.json from run results.
    """
    results = load_run_results(benchmark_dir)
    if len(results) >= 2:
        run_keys_by_config = [
            {(run["eval_id"], run["run_number"]) for run in config_runs}
            for config_runs in results.values()
        ]
        complete_run_keys = set.intersection(*run_keys_by_config)
        results = {
            config: [
                run
                for run in config_runs
                if (run["eval_id"], run["run_number"]) in complete_run_keys
            ]
            for config, config_runs in results.items()
        }

        configs = list(results)
        for eval_id, run_number in complete_run_keys:
            expectation_texts = []
            for config in configs:
                matching_run = next(
                    run
                    for run in results[config]
                    if run["eval_id"] == eval_id
                    and run["run_number"] == run_number
                )
                expectation_texts.append(
                    tuple(
                        expectation["text"]
                        for expectation in matching_run["expectations"]
                    )
                )
            if len(set(expectation_texts)) != 1:
                raise ValueError(
                    f"Grading assertion mismatch for eval {eval_id}, run {run_number}"
                )
    run_summary = aggregate_results(results)

    # Build runs array for benchmark.json
    runs = []
    for config in results:
        for result in results[config]:
            runs.append(
                {
                    "eval_id": result["eval_id"],
                    "eval_name": result["eval_name"],
                    "configuration": config,
                    "run_number": result["run_number"],
                    "result": {
                        "pass_rate": result["pass_rate"],
                        "passed": result["passed"],
                        "failed": result["failed"],
                        "total": result["total"],
                        "time_seconds": result["time_seconds"],
                        "tokens": result.get("tokens"),
                        "tool_calls": result.get("tool_calls"),
                        "errors": result.get("errors"),
                    },
                    "expectations": result["expectations"],
                    "notes": result["notes"],
                }
            )

    # Determine eval IDs from results
    eval_ids = sorted(set(r["eval_id"] for config in results.values() for r in config))

    # Derive runs_per_configuration from actual run dirs
    max_runs = 0
    for config_runs in results.values():
        run_numbers = {r["run_number"] for r in config_runs}
        if len(run_numbers) > max_runs:
            max_runs = len(run_numbers)

    benchmark = {
        "metadata": {
            "skill_name": skill_name or "<skill-name>",
            "skill_path": skill_path or "<path/to/skill>",
            "executor_model": executor_model or "<model-name>",
            "analyzer_model": analyzer_model or "<model-name>",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "evals_run": eval_ids,
            "runs_per_configuration": max_runs,
        },
        "runs": runs,
        "run_summary": run_summary,
        "notes": [],  # To be filled by analyzer
    }

    return benchmark


def generate_markdown(benchmark: dict) -> str:
    """Generate human-readable benchmark.md from benchmark data."""
    metadata = benchmark["metadata"]
    run_summary = benchmark["run_summary"]

    # Determine config names (excluding "delta")
    configs = [k for k in run_summary if k != "delta"]
    config_a = configs[0] if len(configs) >= 1 else "config_a"
    config_b = configs[1] if len(configs) >= 2 else "config_b"
    label_a = config_a.replace("_", " ").title()
    label_b = config_b.replace("_", " ").title()

    lines = [
        f"# Skill Benchmark: {metadata['skill_name']}",
        "",
        f"**Model**: {metadata['executor_model']}",
        f"**Date**: {metadata['timestamp']}",
        f"**Evals**: {', '.join(map(str, metadata['evals_run']))} ({metadata['runs_per_configuration']} runs each per configuration)",
        "",
        "## Summary",
        "",
        f"| Metric | {label_a} | {label_b} | Delta |",
        "|--------|------------|---------------|-------|",
    ]

    a_summary = run_summary.get(config_a, {})
    b_summary = run_summary.get(config_b, {})
    delta = run_summary.get("delta", {})

    # Format pass rate
    a_pr = a_summary.get("pass_rate", {})
    b_pr = b_summary.get("pass_rate", {})
    lines.append(
        f"| Pass Rate | {a_pr.get('mean', 0) * 100:.0f}% ± {a_pr.get('stddev', 0) * 100:.0f}% | {b_pr.get('mean', 0) * 100:.0f}% ± {b_pr.get('stddev', 0) * 100:.0f}% | {delta.get('pass_rate', '—')} |"
    )

    # Format time only when at least one configuration measured it.
    a_time = a_summary.get("time_seconds")
    b_time = b_summary.get("time_seconds")
    if a_time or b_time:
        a_time_text = (
            f"{a_time['mean']:.1f}s ± {a_time['stddev']:.1f}s" if a_time else "—"
        )
        b_time_text = (
            f"{b_time['mean']:.1f}s ± {b_time['stddev']:.1f}s" if b_time else "—"
        )
        delta_time = (
            f"{delta['time_seconds']}s" if "time_seconds" in delta else "—"
        )
        lines.append(f"| Time | {a_time_text} | {b_time_text} | {delta_time} |")

    # Format tokens only when at least one configuration measured them.
    a_tokens = a_summary.get("tokens")
    b_tokens = b_summary.get("tokens")
    if a_tokens or b_tokens:
        a_tokens_text = (
            f"{a_tokens['mean']:.0f} ± {a_tokens['stddev']:.0f}"
            if a_tokens
            else "—"
        )
        b_tokens_text = (
            f"{b_tokens['mean']:.0f} ± {b_tokens['stddev']:.0f}"
            if b_tokens
            else "—"
        )
        lines.append(
            f"| Tokens | {a_tokens_text} | {b_tokens_text} | {delta.get('tokens', '—')} |"
        )

    # Notes section
    if benchmark.get("notes"):
        lines.extend(["", "## Notes", ""])
        for note in benchmark["notes"]:
            lines.append(f"- {note}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Aggregate benchmark run results into summary statistics"
    )
    parser.add_argument(
        "benchmark_dir", type=Path, help="Path to the benchmark directory"
    )
    parser.add_argument(
        "--skill-name", default="", help="Name of the skill being benchmarked"
    )
    parser.add_argument(
        "--skill-path", default="", help="Path to the skill being benchmarked"
    )
    parser.add_argument("--executor-model", default="", help="Model used to run evals")
    parser.add_argument(
        "--analyzer-model", default="", help="Model used to grade/analyze results"
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Output path for benchmark.json (default: <benchmark_dir>/benchmark.json)",
    )

    args = parser.parse_args()

    if not args.benchmark_dir.exists():
        print(f"Directory not found: {args.benchmark_dir}")
        sys.exit(1)

    # Generate benchmark
    benchmark = generate_benchmark(
        args.benchmark_dir,
        args.skill_name,
        args.skill_path,
        executor_model=args.executor_model,
        analyzer_model=args.analyzer_model,
    )

    # Determine output paths
    output_json = args.output or (args.benchmark_dir / "benchmark.json")
    output_md = output_json.with_suffix(".md")

    # Write benchmark.json
    with open(output_json, "w") as f:
        json.dump(benchmark, f, indent=2)
    print(f"Generated: {output_json}")

    # Write benchmark.md
    markdown = generate_markdown(benchmark)
    with open(output_md, "w") as f:
        f.write(markdown)
    print(f"Generated: {output_md}")

    # Print summary
    run_summary = benchmark["run_summary"]
    configs = [k for k in run_summary if k != "delta"]
    delta = run_summary.get("delta", {})

    print(f"\nSummary:")
    for config in configs:
        pr = run_summary[config]["pass_rate"]["mean"]
        label = config.replace("_", " ").title()
        print(f"  {label}: {pr * 100:.1f}% pass rate")
    print(f"  Delta:         {delta.get('pass_rate', '—')}")


if __name__ == "__main__":
    main()
