"""`factory/AGENTS.md` is an index, and this test is what keeps it one.

The section it replaced grew by 20-50 lines with every ticket closed and lost nothing
in between, because nothing said it could not. Three rules stop that:

- every row names a module that exists, so a rename cannot leave a row pointing nowhere;
- every ``§`` is a section the specification actually has, so the reasoning a row does not
  carry stays reachable;
- the file has a line ceiling, so a new invariant costs a row and a full file costs a
  decision about which rows have become the module's own job to state.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = REPO_ROOT / "factory" / "AGENTS.md"
SPEC_PATH = REPO_ROOT / "docs" / "specs" / "software-factory.md"
LIB_ROOT = REPO_ROOT / "factory" / "lib"

# The ceiling is the size the index was written at, plus room for the invariants a
# handful of tickets add. Raising it is a decision, not a formality: see the module
# docstring above.
MAX_LINES = 800

MODULE_REF = re.compile(r"`([a-z][a-z-]*/[a-z][a-z-]*\.mjs)`")
DIR_REF = re.compile(r"`([a-z][a-z-]*/)`")
PATH_REF = re.compile(r"`((?:tests|docs)/[a-z][a-z0-9_/-]*\.(?:mjs|py|md)|package\.json)`")
SECTION_REF = re.compile(r"§(\d+)(?:\.(\d+))?")
ROW = re.compile(r"^- \*\*")

# Sections whose members are numbered list items rather than headings.
LIST_SECTIONS = {"14", "15"}

# Directories the controller creates at runtime beside `state.db`. They are named in rows
# because that is where the artifact lands, and they are not source paths to resolve.
RUNTIME_DIRS = {"attempts/", "baselines/", "quarantine/", "worktrees/"}


@pytest.fixture(scope="module")
def index_text() -> str:
    return INDEX_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def spec_text() -> str:
    return SPEC_PATH.read_text(encoding="utf-8")


def test_index_stays_under_its_ceiling(index_text: str) -> None:
    lines = index_text.splitlines()
    assert len(lines) <= MAX_LINES, (
        f"factory/AGENTS.md is {len(lines)} lines, over its {MAX_LINES}-line ceiling. "
        "Rows whose reasoning now lives in the owning module's comments come out; "
        "the ceiling moves only as a deliberate decision."
    )


def test_every_row_names_a_module_or_a_section(index_text: str) -> None:
    orphans = []
    for line, row in _rows(index_text):
        owned = (
            MODULE_REF.search(row)
            or DIR_REF.search(row)
            or PATH_REF.search(row)
            or SECTION_REF.search(row)
        )
        if not owned:
            orphans.append(f"  line {line}: {row[:90]}")
    assert not orphans, (
        "every index row carries where the invariant lives — a module, a spec section, "
        "or the test that holds it:\n" + "\n".join(orphans)
    )


def test_every_named_module_exists(index_text: str) -> None:
    missing = sorted(
        {name for name in MODULE_REF.findall(index_text) if not (LIB_ROOT / name).exists()}
    )
    assert not missing, (
        "factory/AGENTS.md names modules that are not under factory/lib/: " + ", ".join(missing)
    )


def test_every_named_repo_path_exists(index_text: str) -> None:
    missing = sorted(
        {name for name in PATH_REF.findall(index_text) if not (REPO_ROOT / name).exists()}
    )
    assert not missing, "factory/AGENTS.md names paths that do not exist: " + ", ".join(missing)


def test_every_named_directory_exists(index_text: str) -> None:
    missing = sorted(
        {
            name
            for name in DIR_REF.findall(index_text)
            if name not in RUNTIME_DIRS
            and not (LIB_ROOT / name).is_dir()
            and not (REPO_ROOT / name).is_dir()
        }
    )
    assert not missing, (
        "factory/AGENTS.md names directories that exist neither under factory/lib/ nor at the "
        "repository root: " + ", ".join(missing)
    )


def test_every_cited_section_exists_in_the_spec(index_text: str, spec_text: str) -> None:
    headings = set(re.findall(r"^#{2,4} (\d+(?:\.\d+)?)\.? ", spec_text, re.M))
    top_level = {h.split(".")[0] for h in headings}
    list_items = _list_items(spec_text)

    missing = set()
    for major, minor in SECTION_REF.findall(index_text):
        if minor == "":
            if major not in top_level:
                missing.add(f"§{major}")
            continue
        if major in LIST_SECTIONS:
            if int(minor) not in list_items.get(major, set()):
                missing.add(f"§{major}.{minor}")
            continue
        if f"{major}.{minor}" not in headings:
            missing.add(f"§{major}.{minor}")

    assert not missing, (
        "factory/AGENTS.md cites sections docs/specs/software-factory.md does not have: "
        + ", ".join(sorted(missing))
    )


def _rows(text: str) -> list[tuple[int, str]]:
    """Index rows, each folded back into one line so a wrapped row reads whole."""
    rows: list[tuple[int, str]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if ROW.match(line):
            rows.append((number, line))
        elif rows and line.startswith("  ") and line.strip():
            index, current = rows[-1]
            rows[-1] = (index, f"{current} {line.strip()}")
    return rows


def _list_items(spec_text: str) -> dict[str, set[int]]:
    """The numbered items under each list-shaped section, keyed by section number."""
    items: dict[str, set[int]] = {}
    current: str | None = None
    for line in spec_text.splitlines():
        heading = re.match(r"^## (\d+)\.? ", line)
        if heading:
            current = heading.group(1) if heading.group(1) in LIST_SECTIONS else None
            continue
        if current is None:
            continue
        item = re.match(r"^(\d+)\. ", line)
        if item:
            items.setdefault(current, set()).add(int(item.group(1)))
    return items
