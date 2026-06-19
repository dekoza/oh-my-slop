#!/usr/bin/env python3
"""
ponytail-audit: Scan a codebase for over-engineering.

Finds dead code, reinvented stdlib, unneeded deps, speculative abstractions,
single-implementation interfaces, pass-through wrappers, and dead flags/config.

Usage:
    uv run python scripts/ponytail_audit.py [path] [--min-score 1]

Output: one line per finding, ranked biggest-cut-first.
Tags: delete, stdlib, native, yagni, shrink
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    tag: str  # delete | stdlib | native | yagni | shrink
    message: str
    path: str
    line: int = 0
    score: int = 1  # estimated lines/deps saved

    def __str__(self) -> str:
        loc = f"{self.path}:{self.line}" if self.line else self.path
        return f"[{self.tag}] {self.message}. [{loc}]"


@dataclass
class AuditReport:
    findings: list[Finding] = field(default_factory=list)

    def add(self, finding: Finding) -> None:
        self.findings.append(finding)

    def summary(self) -> str:
        total_lines = sum(f.score for f in self.findings if f.tag in ("delete", "shrink"))
        total_deps = sum(1 for f in self.findings if f.tag in ("stdlib", "native", "yagni"))
        return f"net: -{total_lines} lines, -{total_deps} deps possible."


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------

PYTHON_EXT = {".py"}
TS_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs"}
ALL_EXT = PYTHON_EXT | TS_EXT

SKIP_DIRS = {
    ".git", ".ruff_cache", ".pytest_cache", "__pycache__", "node_modules",
    ".venv", "venv", "env", ".tox", ".mypy_cache", "dist", "build",
    ".next", ".nuxt", "coverage", ".eggs", "*.egg-info",
}


def discover_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in ALL_EXT:
            files.append(path)
    return sorted(files)


# ---------------------------------------------------------------------------
# Python checks
# ---------------------------------------------------------------------------

def check_python_stdlib_reinvention(path: Path, source: str) -> list[Finding]:
    """Detect common patterns where stdlib is reinvented."""
    findings: list[Finding] = []
    lines = source.splitlines()

    # Common reinvention patterns: custom implementations of things stdlib does
    reinvention_patterns = [
        (
            re.compile(r"def\s+(?:read_file|write_file|slurp|dump_file)\s*\("),
            "Custom file read/write — use pathlib Path.read_text/write_text",
        ),
        (
            re.compile(r"def\s+(?:retry|retry_on_exception|retry_decorator)\s*\(.*\):\s*\n\s*(?:import\s+time|time\.sleep)"),
            "Custom retry loop — use tenacity or functools.wraps with backoff",
        ),
        (
            re.compile(r"class\s+\w*(?:Cache|LRU|Memo)\w*\s*[:(]"),
            "Custom cache class — use functools.lru_cache or functools.cache",
        ),
        (
            re.compile(r"def\s+(?:chunk|batched|batch_items|grouper)\s*\("),
            "Custom chunking — use itertools.batched (3.12+) or more-itertools",
        ),
        (
            re.compile(r"def\s+(?:deep_merge|merge_dicts|dict_merge)\s*\("),
            "Custom dict merge — use dict |= (3.9+) or {**a, **b}",
        ),
        (
            re.compile(r"def\s+(?:ensure_dir|mkdir_p|make_dirs)\s*\("),
            "Custom mkdir — use Path.mkdir(parents=True, exist_ok=True)",
        ),
        (
            re.compile(r"def\s+(?:get_env|getenv|read_env)\s*\("),
            "Custom env reader — use os.environ.get or pydantic-settings",
        ),
    ]

    for pattern, message in reinvention_patterns:
        for i, line in enumerate(lines, 1):
            if pattern.search(line):
                findings.append(Finding(
                    tag="stdlib",
                    message=message,
                    path=str(path),
                    line=i,
                    score=10,
                ))

    return findings


def check_python_dead_code(path: Path, source: str) -> list[Finding]:
    """Detect unreachable or unused code patterns."""
    findings: list[Finding] = []
    lines = source.splitlines()

    # Functions/classes that are never referenced (heuristic: defined but not
    # imported or called within the same file, and not __all__ or public API)
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return findings

    defined_names: list[tuple[str, int]] = []
    used_names: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not node.name.startswith("_"):
                defined_names.append((node.name, node.lineno))
        elif isinstance(node, ast.ClassDef):
            if not node.name.startswith("_"):
                defined_names.append((node.name, node.lineno))
        elif isinstance(node, ast.Name):
            used_names.add(node.id)
        elif isinstance(node, ast.Attribute):
            # Collect attribute access like obj.method
            if isinstance(node.value, ast.Name):
                used_names.add(node.value.id)

    # Check if names defined in this file are used anywhere in the file
    for name, lineno in defined_names:
        if name not in used_names:
            # Heuristic: might be exported. Skip if in __all__.
            if f'"{name}"' in source or f"'{name}'" in source:
                continue
            findings.append(Finding(
                tag="delete",
                message=f"'{name}' defined but never referenced — likely dead code",
                path=str(path),
                line=lineno,
                score=15,
            ))

    return findings


def check_python_pass_through_wrappers(path: Path, source: str) -> list[Finding]:
    """Detect functions/classes that only delegate to another call."""
    findings: list[Finding] = []

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return findings

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        # Skip dunder methods, property getters, etc.
        if node.name.startswith("_"):
            continue

        body = node.body
        # Single-expression body that's just a return of a call
        if len(body) == 1 and isinstance(body[0], ast.Return):
            ret = body[0]
            if ret.value and isinstance(ret.value, ast.Call):
                # Check if it's a pass-through: same args forwarded
                call = ret.value
                func_args = {a.arg for a in node.args.args}
                call_args: set[str] = set()
                for a in call.args:
                    if isinstance(a, ast.Name):
                        call_args.add(a.id)
                for kw in call.keywords:
                    if isinstance(kw.value, ast.Name):
                        call_args.add(kw.value.id)

                if func_args and call_args and func_args == call_args:
                    findings.append(Finding(
                        tag="shrink",
                        message=f"'{node.name}' is a pass-through wrapper — inline the call",
                        path=str(path),
                        line=node.lineno,
                        score=5,
                    ))

    return findings


def check_python_speculative_abstractions(path: Path, source: str) -> list[Finding]:
    """Detect abstractions with only one implementation."""
    findings: list[Finding] = []

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return findings

    # Find abstract base classes / Protocols
    abc_classes: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            # Check for ABCMeta or abstract methods
            is_abc = False
            for base in node.bases:
                base_name = ""
                if isinstance(base, ast.Name):
                    base_name = base.id
                elif isinstance(base, ast.Attribute):
                    base_name = base.attr
                if base_name in ("ABC", "Protocol", "Generic"):
                    is_abc = True
                    break
            if is_abc or any(
                isinstance(d, ast.Name) and d.id == "abstractmethod"
                for d in node.decorator_list
            ):
                abc_classes.append((node.name, node.lineno))

    # Count subclasses in this file
    for abc_name, lineno in abc_classes:
        impl_count = 0
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name != abc_name:
                for base in node.bases:
                    base_name = ""
                    if isinstance(base, ast.Name):
                        base_name = base.id
                    elif isinstance(base, ast.Attribute):
                        base_name = base.attr
                    if base_name == abc_name:
                        impl_count += 1

        if impl_count <= 1:
            findings.append(Finding(
                tag="yagni",
                message=f"ABC '{abc_name}' has {impl_count} implementation(s) — YAGNI, use the concrete class",
                path=str(path),
                line=lineno,
                score=20,
            ))

    return findings


# ---------------------------------------------------------------------------
# TypeScript / JavaScript checks
# ---------------------------------------------------------------------------

def check_ts_stdlib_reinvention(path: Path, source: str) -> list[Finding]:
    """Detect common TS/JS patterns where native APIs are reinvented."""
    findings: list[Finding] = []
    lines = source.splitlines()

    reinvention_patterns = [
        (
            re.compile(r"(?:function|const)\s+(?:debounce|throttle)\s*[=(]"),
            "Custom debounce/throttle — use lodash or the platform (many frameworks include it)",
        ),
        (
            re.compile(r"(?:function|const)\s+(?:deepClone|deep_copy|cloneDeep)\s*[=(]"),
            "Custom deep clone — use structuredClone()",
        ),
        (
            re.compile(r"(?:function|const)\s+(?:sleep|delay|wait)\s*[=(].*Promise"),
            "Custom sleep — use new Promise(r => setTimeout(r, ms)) inline or a one-liner",
        ),
        (
            re.compile(r"(?:function|const)\s+(?:groupBy|group_by)\s*[=(]"),
            "Custom groupBy — use Object.groupBy() (ES2024) or Map-based approach",
        ),
        (
            re.compile(r"(?:function|const)\s+(?:unique|distinct|dedupe)\s*[=(]"),
            "Custom unique — use [...new Set(arr)]",
        ),
        (
            re.compile(r"(?:function|const)\s+(?:pick|omit)\s*[=(]"),
            "Custom pick/omit — use destructuring or a one-liner",
        ),
    ]

    for pattern, message in reinvention_patterns:
        for i, line in enumerate(lines, 1):
            if pattern.search(line):
                findings.append(Finding(
                    tag="native",
                    message=message,
                    path=str(path),
                    line=i,
                    score=8,
                ))

    return findings


def check_ts_dead_code(path: Path, source: str) -> list[Finding]:
    """Detect exported but unused functions/components in TS."""
    findings: list[Finding] = []
    lines = source.splitlines()

    # Find exported functions/components
    export_pattern = re.compile(
        r"export\s+(?:async\s+)?function\s+(\w+)|"
        r"export\s+(?:const|let|var)\s+(\w+)\s*[=:]"
    )

    for i, line in enumerate(lines, 1):
        m = export_pattern.search(line)
        if not m:
            continue
        name = m.group(1) or m.group(2)
        if not name or name.startswith("_"):
            continue

        # Count occurrences: definition + usage
        # If only appears in the export line and nowhere else, it's likely dead
        occurrences = sum(1 for l in lines if name in l)
        if occurrences <= 1:
            findings.append(Finding(
                tag="delete",
                message=f"Exported '{name}' never used in its own file — likely dead",
                path=str(path),
                line=i,
                score=10,
            ))

    return findings


# ---------------------------------------------------------------------------
# Generic checks (any language)
# ---------------------------------------------------------------------------

def check_dead_config_flags(path: Path, source: str) -> list[Finding]:
    """Detect feature flags / config options that are always true/false."""
    findings: list[Finding] = []
    lines = source.splitlines()

    # Look for flags that are hardcoded
    flag_pattern = re.compile(
        r'(?:ENABLE_|USE_|FEATURE_|WITH_|IS_|HAS_)(\w+)\s*=\s*(?:True|False|true|false|1|0|"yes"|"no")'
    )

    for i, line in enumerate(lines, 1):
        m = flag_pattern.search(line)
        if m:
            flag_name = m.group(0).split("=")[0].strip()
            findings.append(Finding(
                tag="yagni",
                message=f"Feature flag '{flag_name}' is hardcoded — remove the flag and keep the active branch",
                path=str(path),
                line=i,
                score=10,
            ))

    return findings


def check_unnecessary_type_wrappers(path: Path, source: str) -> list[Finding]:
    """Detect type aliases that just rename a primitive."""
    findings: list[Finding] = []

    if path.suffix in PYTHON_EXT:
        # Python: TypeAlias that's just a rename
        alias_pattern = re.compile(
            r"^(\w+)\s*[:=]\s*(?:TypeAlias\s*\[\s*)?(?:str|int|float|bool|bytes|list|dict|set|tuple|None|Optional|Union|Literal)\b",
            re.MULTILINE,
        )
        for m in alias_pattern.finditer(source):
            name = m.group(1)
            if name in ("TypeAlias", "Optional", "Union"):
                continue
            line_num = source[:m.start()].count("\n") + 1
            findings.append(Finding(
                tag="shrink",
                message=f"Type alias '{name}' is a primitive rename — use the primitive directly",
                path=str(path),
                line=line_num,
                score=3,
            ))

    return findings


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def audit_file(path: Path) -> list[Finding]:
    """Run all applicable checks on a single file."""
    try:
        source = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []

    if not source.strip():
        return []

    findings: list[Finding] = []

    # Generic checks (all languages)
    findings.extend(check_dead_config_flags(path, source))
    findings.extend(check_unnecessary_type_wrappers(path, source))

    if path.suffix in PYTHON_EXT:
        findings.extend(check_python_stdlib_reinvention(path, source))
        findings.extend(check_python_dead_code(path, source))
        findings.extend(check_python_pass_through_wrappers(path, source))
        findings.extend(check_python_speculative_abstractions(path, source))

    if path.suffix in TS_EXT:
        findings.extend(check_ts_stdlib_reinvention(path, source))
        findings.extend(check_ts_dead_code(path, source))

    return findings


def run_audit(root: Path, min_score: int = 1) -> AuditReport:
    report = AuditReport()
    files = discover_files(root)

    for f in files:
        for finding in audit_file(f):
            if finding.score >= min_score:
                report.add(finding)

    # Sort by score descending (biggest cuts first)
    report.findings.sort(key=lambda f: f.score, reverse=True)
    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="ponytail-audit: scan for over-engineering and bloat.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="Root directory to scan (default: current directory)",
    )
    parser.add_argument(
        "--min-score",
        type=int,
        default=1,
        help="Minimum score threshold for findings (default: 1)",
    )
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory.", file=sys.stderr)
        sys.exit(1)

    report = run_audit(root, args.min_score)

    if not report.findings:
        print("No over-engineering detected. Clean codebase.")
        return

    for finding in report.findings:
        print(finding)

    print(f"\n{report.summary()}")


if __name__ == "__main__":
    main()
