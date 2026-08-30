#!/usr/bin/env python3
"""Join Radon cyclomatic complexity with coverage.py line coverage.

The CRAP score for one routine is::

    complexity ** 2 * (1 - coverage) ** 3 + complexity

Radon supplies routine boundaries and complexity. coverage.py supplies executed
and missing executable lines. Coverage is calculated within each routine's line
range, so this is a method-level CRAP equivalent rather than a file-average
proxy. Exit 1 means the declared threshold was exceeded; malformed or unreadable
reports exit 2 so the factory classifies the recipe as unrunnable, not as a code
failure.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any


def crap_score(*, complexity: int, coverage: float) -> float:
    """Return the Change Risk Anti-Patterns score for one routine."""
    if complexity < 1:
        raise ValueError("complexity must be at least 1")
    if not 0.0 <= coverage <= 1.0:
        raise ValueError("coverage must be between 0 and 1")
    return complexity**2 * (1.0 - coverage) ** 3 + complexity


def routine_scores(radon: Mapping[str, Any], coverage: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Build method-level scores from Radon and coverage.py JSON documents."""
    coverage_files = _mapping(coverage.get("files"), "coverage.files")
    scores: list[dict[str, Any]] = []

    for file_name, raw_blocks in radon.items():
        blocks = _list(raw_blocks, f"radon[{file_name!r}]")
        file_coverage = _mapping(coverage_files.get(file_name, {}), f"coverage.files[{file_name!r}]")
        executed = _line_set(file_coverage.get("executed_lines", []), f"{file_name}.executed_lines")
        missing = _line_set(file_coverage.get("missing_lines", []), f"{file_name}.missing_lines")

        for block in _routines(blocks):
            start = _positive_int(block.get("lineno"), f"{file_name}.lineno")
            end = _positive_int(block.get("endline"), f"{file_name}.endline")
            complexity = _positive_int(block.get("complexity"), f"{file_name}.complexity")
            if end < start:
                raise ValueError(f"{file_name}: endline {end} precedes lineno {start}")

            relevant = {line for line in executed | missing if start <= line <= end}
            covered = len(relevant & executed) / len(relevant) if relevant else 0.0
            scores.append(
                {
                    "file": file_name,
                    "line": start,
                    "name": str(block.get("name", "(unnamed)")),
                    "complexity": complexity,
                    "coverage": covered,
                    "crap": crap_score(complexity=complexity, coverage=covered),
                }
            )

    return scores


def _routines(blocks: Iterable[Any]) -> Iterable[Mapping[str, Any]]:
    for raw in blocks:
        block = _mapping(raw, "radon block")
        if block.get("type") in {"function", "method"}:
            yield block
        for child_key in ("methods", "closures"):
            children = block.get(child_key, [])
            yield from _routines(_list(children, f"radon block.{child_key}"))


def _line_set(value: Any, label: str) -> set[int]:
    return {_positive_int(line, label) for line in _list(value, label)}


def _mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _positive_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _read_json(path: Path) -> Mapping[str, Any]:
    with path.open(encoding="utf-8") as source:
        return _mapping(json.load(source), str(path))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("radon_json", type=Path)
    parser.add_argument("coverage_json", type=Path)
    parser.add_argument("--max", type=float, required=True, dest="maximum")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.maximum < 0:
        _parser().error("--max must be non-negative")

    try:
        scores = routine_scores(_read_json(args.radon_json), _read_json(args.coverage_json))
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as error:
        print(f"CRAP reports are unreadable: {error}", file=sys.stderr)
        return 2

    offenders = sorted(
        (score for score in scores if score["crap"] > args.maximum),
        key=lambda score: (-score["crap"], score["file"], score["line"]),
    )
    for score in offenders:
        print(
            f"{score['file']}:{score['line']} {score['name']} "
            f"CRAP={score['crap']:.2f} complexity={score['complexity']} coverage={score['coverage']:.1%}"
        )

    if offenders:
        print(f"CRAP threshold {args.maximum:g} exceeded by {len(offenders)} routine(s).")
        return 1

    print(f"CRAP threshold {args.maximum:g} passed for {len(scores)} routine(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
