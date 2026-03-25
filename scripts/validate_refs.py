from __future__ import annotations

import re
import sys
from pathlib import Path


MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
BACKTICK_REFERENCE_PATTERN = re.compile(r"`(references/[^`]+\.md)`")


def should_skip_reference(reference: str) -> bool:
    lowered = reference.lower()
    return (
        lowered.startswith("http://")
        or lowered.startswith("https://")
        or reference.startswith("#")
        or any(token in reference for token in ("*", "?", "[", "]"))
    )


def iter_references(markdown_file: Path) -> list[tuple[int, str]]:
    lines = markdown_file.read_text(encoding="utf-8").splitlines()
    references: list[tuple[int, str]] = []

    in_frontmatter = False
    frontmatter_checked = False

    for line_number, line in enumerate(lines, start=1):
        if not frontmatter_checked:
            frontmatter_checked = True
            if line.strip() == "---":
                in_frontmatter = True
                continue

        if in_frontmatter:
            if line.strip() == "---":
                in_frontmatter = False
            continue

        for match in MARKDOWN_LINK_PATTERN.finditer(line):
            references.append((line_number, match.group(1).strip()))

        for match in BACKTICK_REFERENCE_PATTERN.finditer(line):
            references.append((line_number, match.group(1).strip()))

    return references


def validate_repo(repo_root: Path) -> list[str]:
    skills_dir = repo_root / "skills"
    broken_references: list[str] = []

    if not skills_dir.is_dir():
        return broken_references

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").exists():
            continue

        for markdown_file in sorted(skill_dir.rglob("*.md")):
            for line_number, reference in iter_references(markdown_file):
                if should_skip_reference(reference):
                    continue

                resolved_path = (markdown_file.parent / reference).resolve()
                if not resolved_path.exists() and reference.startswith("references/"):
                    skill_root = markdown_file.parent
                    if skill_root.name == "references":
                        skill_root = skill_root.parent
                    resolved_path = (skill_root / reference).resolve()

                if not resolved_path.exists():
                    source_path = markdown_file.relative_to(repo_root).as_posix()
                    broken_references.append(f"{source_path}:{line_number}:{reference}")

    return broken_references


def main() -> int:
    repo_root = Path.cwd()
    broken_references = validate_repo(repo_root)

    if broken_references:
        for broken_reference in broken_references:
            print(broken_reference)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
