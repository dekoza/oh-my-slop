#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether a skill's description causes OpenCode to trigger a skill
for a set of queries. Outputs results as JSON.
"""

import argparse
import json
import subprocess
import sys
import tempfile
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from scripts.utils import parse_skill_md


def find_project_root() -> Path:
    """Find the project root by walking up from cwd looking for OpenCode config."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".opencode").is_dir():
            return parent
    return current


def build_skill_file(skill_name: str, skill_description: str) -> str:
    """Build a minimal skill file with a custom description."""
    indented_desc = "\n  ".join(skill_description.splitlines() or [""])
    return (
        "---\n"
        f"name: {skill_name}\n"
        "description: |\n"
        f"  {indented_desc}\n"
        "---\n\n"
        f"# {skill_name}\n\n"
        "Use this skill when the description matches the user's request."
    )


def classify_event(line: str, skill_name: str) -> bool | None:
    """Classify a single JSON event line for trigger detection."""
    line = line.strip()
    if not line:
        return None

    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return None

    if event.get("type") == "tool_use":
        part = event.get("part", {})
        if part.get("tool") != "skill":
            return None

        state = part.get("state", {})
        skill_input = state.get("input", {})
        return skill_input.get("name") == skill_name

    if event.get("type") == "step_finish":
        return False

    return None


def detect_skill_trigger(events: list[str], skill_name: str) -> bool:
    """Return True when the JSON event stream shows the target skill was used."""
    for line in events:
        if classify_event(line, skill_name) is True:
            return True

    return False


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
    max_attempts_per_run: int = 2,
) -> bool:
    """Run a single query and return whether the skill was triggered."""
    with tempfile.TemporaryDirectory(
        prefix=f"skill-eval-{uuid.uuid4().hex[:8]}-"
    ) as temp_dir:
        temp_root = Path(temp_dir)
        temp_skill_dir = temp_root / ".opencode" / "skills" / skill_name
        command_file = temp_skill_dir / "SKILL.md"
        temp_skill_dir.mkdir(parents=True, exist_ok=True)
        command_file.write_text(build_skill_file(skill_name, skill_description))

        cmd = [
            "opencode",
            "run",
            query,
            "--format",
            "json",
            "--dir",
            str(temp_root),
        ]
        if model:
            cmd.extend(["--model", model])

        last_timeout: subprocess.TimeoutExpired | None = None
        for _attempt in range(1, max_attempts_per_run + 1):
            try:
                result = subprocess.run(
                    args=cmd,
                    capture_output=True,
                    text=True,
                    cwd=project_root,
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired as exc:
                last_timeout = exc
                continue

            return detect_skill_trigger(result.stdout.splitlines(), skill_name)

        if last_timeout is not None:
            return False

        return False


def run_eval(
    eval_set: list[dict],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
    max_attempts_per_run: int = 2,
) -> dict:
    """Run the full eval set and return results."""
    results = []

    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        future_to_info = {}
        for item in eval_set:
            for run_idx in range(runs_per_query):
                future = executor.submit(
                    run_single_query,
                    item["query"],
                    skill_name,
                    description,
                    timeout,
                    str(project_root),
                    model,
                    max_attempts_per_run,
                )
                future_to_info[future] = (item, run_idx)

        query_triggers: dict[str, list[bool]] = {}
        query_items: dict[str, dict] = {}
        for future in as_completed(future_to_info):
            item, _ = future_to_info[future]
            query = item["query"]
            query_items[query] = item
            if query not in query_triggers:
                query_triggers[query] = []
            try:
                query_triggers[query].append(future.result())
            except Exception as e:
                print(f"Warning: query failed: {e}", file=sys.stderr)
                query_triggers[query].append(False)

    for query, triggers in query_triggers.items():
        item = query_items[query]
        trigger_rate = sum(triggers) / len(triggers)
        should_trigger = item["should_trigger"]
        if should_trigger:
            did_pass = trigger_rate >= trigger_threshold
        else:
            did_pass = trigger_rate < trigger_threshold
        results.append(
            {
                "query": query,
                "should_trigger": should_trigger,
                "trigger_rate": trigger_rate,
                "triggers": sum(triggers),
                "runs": len(triggers),
                "pass": did_pass,
            }
        )

    passed = sum(1 for r in results if r["pass"])
    total = len(results)

    return {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": total - passed,
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Run trigger evaluation for a skill description"
    )
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument(
        "--description", default=None, help="Override description to test"
    )
    parser.add_argument(
        "--num-workers", type=int, default=4, help="Number of parallel workers"
    )
    parser.add_argument(
        "--timeout", type=int, default=30, help="Timeout per query in seconds"
    )
    parser.add_argument(
        "--runs-per-query", type=int, default=3, help="Number of runs per query"
    )
    parser.add_argument(
        "--max-attempts-per-run",
        type=int,
        default=2,
        help="Retry timed out opencode runs up to this many attempts per run",
    )
    parser.add_argument(
        "--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold"
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model to use for `opencode run` (default: configured model)",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Print progress to stderr"
    )
    args = parser.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text())
    skill_path = Path(args.skill_path)

    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    name, original_description, content = parse_skill_md(skill_path)
    description = args.description or original_description
    project_root = find_project_root()

    if args.verbose:
        print(f"Evaluating: {description}", file=sys.stderr)

    output = run_eval(
        eval_set=eval_set,
        skill_name=name,
        description=description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        project_root=project_root,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        model=args.model,
        max_attempts_per_run=args.max_attempts_per_run,
    )

    if args.verbose:
        summary = output["summary"]
        print(
            f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr
        )
        for r in output["results"]:
            status = "PASS" if r["pass"] else "FAIL"
            rate_str = f"{r['triggers']}/{r['runs']}"
            print(
                f"  [{status}] rate={rate_str} expected={r['should_trigger']}: {r['query'][:70]}",
                file=sys.stderr,
            )

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
