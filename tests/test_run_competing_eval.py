"""Regression tests for skill-creator's competing-catalog trigger harness.

A fake `pi` executable stands in for the model runtime. It builds the system
prompt's skill catalog from the `--skill` directories it receives, the way pi
does, and the query text scripts what it reads, so every attribution path runs
through a real subprocess and a real JSON event stream.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = (
    Path(__file__).resolve().parents[1] / "skills" / "meta" / "skill-creator" / "scripts"
)
sys.path.insert(0, str(SCRIPTS_DIR))

import run_competing_eval as rce  # noqa: E402

FAKE_PI = r'''#!/usr/bin/env python3
"""Fake pi: emit a JSON event stream; the query scripts its behaviour.

Query directives (space-separated words):
  read:<name>      read that skill's SKILL.md (in order)
  readrel:<name>   read it by a path relative to the working directory
  readother        read a file that is not a skill
  crash            exit 1 before agent_end
  noend            exit 0 without agent_end
  stoperror        end the assistant message with stopReason "error"
  ambient          add an extra skill to the catalog the harness did not supply
  context          add a project context section to the system prompt
"""
import html
import json
import os
import sys
from pathlib import Path

args = sys.argv[1:]
query = args[args.index("--") + 1]
skills = [Path(args[i + 1]) for i, a in enumerate(args) if a == "--skill"]
words = query.split()


def emit(event):
    print(json.dumps(event), flush=True)


def describe(skill_dir):
    text = (skill_dir / "SKILL.md").read_text()
    front = text.split("---")[1]
    name = front.split("name:")[1].split("\n")[0].strip()
    desc = " ".join(front.split("description: |")[1].split())
    return name, desc


entries = [(*describe(d), str(d / "SKILL.md")) for d in skills]
if "ambient" in words:
    entries.append(("ambient-skill", "Use for everything.", "/elsewhere/SKILL.md"))
catalog = "".join(
    f"  <skill>\n    <name>{n}</name>\n    <description>{html.escape(d)}\n</description>\n"
    f"    <location>{loc}</location>\n  </skill>\n" for n, d, loc in entries
)
sections = {
    "preamble": "You are a coding assistant.",
    "tools": "<tools>\n- read: Read file contents\n</tools>",
    "skills": "<skills>\n<available_skills>\n" + catalog + "</available_skills>\n</skills>",
    "cwd": f"<cwd>\n{os.getcwd()}\n</cwd>",
}
if "context" in words:
    sections["project_context"] = "<context>AGENTS.md says hello</context>"
emit({"type": "session", "cwd": os.getcwd()})
emit({"type": "agent_start"})
emit({"type": "message_end", "message": {"role": "system", "content": "", "sections": sections}})
by_name = {n: loc for n, _, loc in entries}
for word in words:
    if word.startswith("read:"):
        path = by_name[word[5:]]
    elif word.startswith("readrel:"):
        path = os.path.relpath(by_name[word[8:]], os.getcwd())
    elif word == "readother":
        path = "/etc/hostname"
    else:
        continue
    emit({"type": "tool_execution_start", "toolName": "read", "args": {"path": path}})
if "crash" in words:
    print("provider exploded", file=sys.stderr)
    sys.exit(1)
stop = "error" if "stoperror" in words else "stop"
emit({"type": "message_end", "message": {"role": "assistant", "stopReason": stop,
                                          "content": [{"type": "text", "text": "done"}]}})
if "noend" not in words:
    emit({"type": "agent_end", "messages": []})
'''


def write_skill(root: Path, name: str, description: str) -> Path:
    skill_dir = root / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: >\n  {description}\n---\n\n# {name}\n",
        encoding="utf-8",
    )
    return skill_dir


@pytest.fixture
def fake_pi(tmp_path: Path) -> Path:
    path = tmp_path / "bin" / "pi"
    path.parent.mkdir()
    path.write_text(FAKE_PI, encoding="utf-8")
    path.chmod(0o755)
    return path


@pytest.fixture
def catalog(tmp_path: Path) -> dict:
    root = tmp_path / "skills"
    return {
        "competitors": [
            write_skill(root, "prototype", "Use when mocking up throwaway UI variations."),
            write_skill(root, "council", "Use when five advisors should debate a decision."),
        ],
        "arms": {
            "base": write_skill(root / "base", "grilling", "Use when the user wants grilling."),
            "current": write_skill(
                root / "current", "grilling", "Use when the user wants grilling or approvals."
            ),
        },
    }


def run(fake_pi: Path, catalog: dict, tmp_path: Path, eval_set: list[dict], runs: int = 1) -> dict:
    return rce.run_competition(
        eval_set=eval_set,
        competitors=catalog["competitors"],
        arms=catalog["arms"],
        model="fake/model",
        thinking="high",
        runs_per_query=runs,
        out_dir=tmp_path / "out",
        pi=str(fake_pi),
        num_workers=2,
    )


def only_run(results: dict, arm: str = "current") -> dict:
    (row,) = results["arms"][arm]["queries"]
    (record,) = row["runs"]
    return record


def test_run_without_any_skill_read_is_a_complete_no_selection(fake_pi, catalog, tmp_path):
    results = run(fake_pi, catalog, tmp_path, [{"query": "summarize", "expected": None}])

    record = only_run(results)
    assert record["status"] == "complete"
    assert record["consultations"] == []
    assert record["first"] is None
    assert record["outcome"] == "none"


def test_consultations_keep_their_order_and_the_first_read_is_the_selection(
    fake_pi, catalog, tmp_path
):
    results = run(
        fake_pi, catalog, tmp_path,
        [{"query": "read:prototype read:grilling read:prototype", "expected": "prototype"}],
    )

    record = only_run(results)
    assert record["consultations"] == ["prototype", "grilling", "prototype"]
    assert record["first"] == "prototype"
    assert record["outcome"] == "multiple"


def test_relative_stub_reads_count_and_other_file_reads_do_not(fake_pi, catalog, tmp_path):
    results = run(
        fake_pi, catalog, tmp_path,
        [{"query": "readother readrel:council", "expected": "council"}],
    )

    record = only_run(results)
    assert record["consultations"] == ["council"]
    assert record["outcome"] == "single"


def test_stub_path_named_only_in_the_system_prompt_is_not_a_consultation(
    fake_pi, catalog, tmp_path
):
    # Every stub's location appears in the catalog text of each run.
    results = run(fake_pi, catalog, tmp_path, [{"query": "plain", "expected": None}])

    record = only_run(results)
    log = json.loads(Path(record["log"]).read_text())
    assert "skills/grilling/SKILL.md" in log["stdout"]
    assert record["consultations"] == []


def test_each_arm_exposes_the_competitors_plus_its_own_version_of_the_target(
    fake_pi, catalog, tmp_path
):
    results = run(fake_pi, catalog, tmp_path, [{"query": "plain", "expected": None}])

    for arm, description in [
        ("base", "Use when the user wants grilling."),
        ("current", "Use when the user wants grilling or approvals."),
    ]:
        expected = {
            "council": "Use when five advisors should debate a decision.",
            "grilling": description,
            "prototype": "Use when mocking up throwaway UI variations.",
        }
        assert results["arms"][arm]["catalog"] == expected
        record = only_run(results, arm)
        assert record["status"] == "complete"
        assert {e["name"]: e["description"] for e in record["exposed_catalog"]} == expected


def test_command_disables_ambient_skills_context_and_tools(fake_pi, catalog, tmp_path):
    run(fake_pi, catalog, tmp_path, [{"query": "plain", "expected": None}])

    cmd = json.loads((tmp_path / "out" / "current" / "q00-run1.json").read_text())["cmd"]
    for flag in ["--no-skills", "--no-context-files", "--no-extensions", "--no-mcp",
                 "--no-prompt-templates"]:
        assert flag in cmd
    assert cmd[cmd.index("--tools") + 1] == "read"
    assert cmd.count("--skill") == 3


@pytest.mark.parametrize(
    ("query", "reason"),
    [
        ("ambient read:grilling", "catalog"),
        ("context read:grilling", "system prompt section"),
    ],
)
def test_unrequested_catalog_entry_or_context_makes_the_run_an_error(
    fake_pi, catalog, tmp_path, query, reason
):
    results = run(fake_pi, catalog, tmp_path, [{"query": query, "expected": "grilling"}])

    record = only_run(results)
    assert record["status"] == "error"
    assert reason in record["error"]
    # The evidence is kept, but it is not a selection.
    assert record["consultations"] == ["grilling"]
