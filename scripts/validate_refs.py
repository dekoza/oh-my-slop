from __future__ import annotations

import re
import sys
from pathlib import Path


MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
BACKTICK_REFERENCE_PATTERN = re.compile(r"`(references/[^`]+\.md)`")
FENCE_PATTERN = re.compile(r"^(?P<fence>`{3,}|~{3,})")


def should_skip_reference(reference: str) -> bool:
    lowered = reference.lower()
    return (
        lowered.startswith("http://")
        or lowered.startswith("https://")
        or reference.startswith("/")
        or reference.startswith("#")
        or any(token in reference for token in ("*", "?", "[", "]"))
    )


def iter_references(markdown_file: Path) -> list[tuple[int, str]]:
    lines = markdown_file.read_text(encoding="utf-8").splitlines()
    references: list[tuple[int, str]] = []

    in_frontmatter = False
    frontmatter_checked = False
    active_fence: str | None = None
    active_fence_length = 0

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

        stripped_line = line.lstrip()
        fence_match = FENCE_PATTERN.match(stripped_line)

        if active_fence is not None:
            if fence_match:
                current_fence = fence_match.group("fence")
                if current_fence[0] == active_fence and len(current_fence) >= active_fence_length:
                    active_fence = None
                    active_fence_length = 0
            continue

        if fence_match:
            current_fence = fence_match.group("fence")
            active_fence = current_fence[0]
            active_fence_length = len(current_fence)
            continue

        for match in MARKDOWN_LINK_PATTERN.finditer(line):
            references.append((line_number, match.group(1).strip()))

        for match in BACKTICK_REFERENCE_PATTERN.finditer(line):
            references.append((line_number, match.group(1).strip()))

    return references


def iter_skill_dirs(skills_dir: Path) -> list[Path]:
    """Every skill root under ``skills_dir``, at any bucket depth.

    Mirrors pi's own discovery rule: a directory holding SKILL.md is a skill
    root and is not descended into, so a skill's own subdirectories can never
    masquerade as skills. Without the recursion a bucketed tree yields nothing
    and every caller reports success over an empty set.
    """
    if not skills_dir.is_dir():
        return []

    skill_dirs: list[Path] = []

    for entry in sorted(skills_dir.iterdir()):
        if not entry.is_dir():
            continue
        if (entry / "SKILL.md").exists():
            skill_dirs.append(entry)
            continue
        skill_dirs.extend(iter_skill_dirs(entry))

    return skill_dirs


def find_skill_dir(skills_dir: Path, skill_name: str) -> Path | None:
    """The directory of the named skill, whichever bucket currently holds it.

    Callers name skills, not paths, so re-filing a skill into another bucket
    stays a pure move.
    """
    for skill_dir in iter_skill_dirs(skills_dir):
        if skill_dir.name == skill_name:
            return skill_dir
    return None


def validate_repo(repo_root: Path) -> list[str]:
    broken_references: list[str] = []

    for skill_dir in iter_skill_dirs(repo_root / "skills"):
        for markdown_file in sorted(skill_dir.rglob("*.md")):
            for line_number, reference in iter_references(markdown_file):
                if should_skip_reference(reference):
                    continue

                file_path = reference.split("#")[0] or reference
                resolved_path = (markdown_file.parent / file_path).resolve()
                if not resolved_path.exists() and file_path.startswith("references/"):
                    skill_root = markdown_file.parent
                    if skill_root.name == "references":
                        skill_root = skill_root.parent
                    resolved_path = (skill_root / file_path).resolve()

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
