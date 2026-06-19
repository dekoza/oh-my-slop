#!/usr/bin/env python3
"""
ponytail-debt: Harvest SHORTCUT markers from the codebase.

Scans for tagged shortcuts left during development and reports them
grouped by file, with upgrade-path coverage stats.

Usage:
    uv run python scripts/ponytail_debt.py [path] [--output-debt-file]

Output: one row per marker, grouped by file.
Flags markers missing an upgrade path.
Optionally writes SHORTCUT-DEBT.md for tracking.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from datetime import date


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

# Matches: # SHORTCUT: <description>. Upgrade: <path>.
# Also matches: // SHORTCUT: <description>. Upgrade: <path>.
SHORTCUT_PATTERN = re.compile(
    r"(?:#|//)\s*SHORTCUT:\s*(.+?)(?:\.\s*Upgrade:\s*(.+?))?\.",
    re.IGNORECASE,
)


@dataclass
class Shortcut:
    description: str
    upgrade: str  # empty string if missing
    path: str
    line: int

    @property
    def has_upgrade(self) -> bool:
        return bool(self.upgrade.strip())


@dataclass
class DebtReport:
    shortcuts: list[Shortcut] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.shortcuts)

    @property
    def missing_upgrade(self) -> int:
        return sum(1 for s in self.shortcuts if not s.has_upgrade)

    def grouped(self) -> dict[str, list[Shortcut]]:
        groups: dict[str, list[Shortcut]] = {}
        for s in self.shortcuts:
            groups.setdefault(s.path, []).append(s)
        return groups


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

SKIP_DIRS = {
    ".git", ".ruff_cache", ".pytest_cache", "__pycache__", "node_modules",
    ".venv", "venv", "env", ".tox", ".mypy_cache", "dist", "build",
    ".next", ".nuxt", "coverage", ".eggs", "*.egg-info",
    ".a5c",
}

SOURCE_EXT = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".rb", ".go", ".rs", ".java", ".kt", ".swift",
}


def scan_file(path: Path) -> list[Shortcut]:
    """Extract SHORTCUT markers from a single file."""
    shortcuts: list[Shortcut] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (UnicodeDecodeError, OSError):
        return shortcuts

    for i, line in enumerate(lines, 1):
        m = SHORTCUT_PATTERN.search(line)
        if m:
            shortcuts.append(Shortcut(
                description=m.group(1).strip(),
                upgrade=m.group(2).strip() if m.group(2) else "",
                path=str(path),
                line=i,
            ))

    return shortcuts


def run_debt_scan(root: Path) -> DebtReport:
    report = DebtReport()
    for path in sorted(root.rglob("*")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in SOURCE_EXT:
            for shortcut in scan_file(path):
                report.shortcuts.append(shortcut)
    return report


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def format_report(report: DebtReport) -> str:
    lines: list[str] = []
    grouped = report.grouped()

    for file_path, shortcuts in grouped.items():
        lines.append(f"## {file_path}")
        for s in shortcuts:
            flag = " ⚠️ no-trigger" if not s.has_upgrade else ""
            lines.append(
                f"  L{s.line}: {s.description}. "
                f"ceiling: {s.upgrade or 'none'}.{flag}"
            )
        lines.append("")

    lines.append(f"---")
    lines.append(f"{report.total} markers, {report.missing_upgrade} with no trigger.")

    return "\n".join(lines)


def write_debt_file(report: DebtReport, root: Path) -> Path:
    """Write a SHORTCUT-DEBT.md file for tracking."""
    debt_path = root / "SHORTCUT-DEBT.md"
    today = date.today().isoformat()

    content = f"# Shortcut Debt — {today}\n\n"
    content += f"**Total:** {report.total} markers, "
    content += f"**{report.missing_upgrade}** missing upgrade path.\n\n"

    grouped = report.grouped()
    for file_path, shortcuts in grouped.items():
        content += f"## {file_path}\n\n"
        for s in shortcuts:
            flag = " ⚠️" if not s.has_upgrade else ""
            content += f"- **L{s.line}:** {s.description}"
            if s.upgrade:
                content += f" — upgrade: {s.upgrade}"
            else:
                content += f" — **no upgrade path**"
            content += f"{flag}\n"
        content += "\n"

    if report.missing_upgrade > 0:
        content += f"## Action Required\n\n"
        content += f"{report.missing_upgrade} marker(s) lack an upgrade path. "
        content += f"Either add one or resolve the shortcut.\n"

    debt_path.write_text(content, encoding="utf-8")
    return debt_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="ponytail-debt: harvest SHORTCUT markers from the codebase.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="Root directory to scan (default: current directory)",
    )
    parser.add_argument(
        "--output-debt-file",
        action="store_true",
        help="Write SHORTCUT-DEBT.md with full report",
    )
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory.", file=sys.stderr)
        sys.exit(1)

    report = run_debt_scan(root)

    if not report.total:
        print("No SHORTCUT markers found. Clean.")
        return

    print(format_report(report))

    if args.output_debt_file:
        debt_path = write_debt_file(report, root)
        print(f"\nDebt file written to: {debt_path}")


if __name__ == "__main__":
    main()
