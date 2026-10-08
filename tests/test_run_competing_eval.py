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
  garble:<name>    emit that skill's read event as a truncated, malformed JSON line
  nonobject        emit a valid JSON line that is not an event object
  crash           exit 1 before agent_end
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
    elif word.startswith("garble:"):
        line = json.dumps({"type": "tool_execution_start", "toolName": "read",
                           "args": {"path": by_name[word[7:]]}})
        print(line[:-5], flush=True)
        continue
    elif word == "nonobject":
        print(json.dumps(["tool_execution_start"]), flush=True)
        continue
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


@pytest.mark.parametrize(
    ("query", "reason"),
    [
        ("crash", "exited 1"),
        ("noend", "no agent_end"),
        ("stoperror", "stopReason error"),
    ],
)
def test_unfinished_run_is_an_error_with_its_raw_output_kept(
    fake_pi, catalog, tmp_path, query, reason
):
    results = run(fake_pi, catalog, tmp_path, [{"query": query, "expected": None}])

    record = only_run(results)
    assert record["status"] == "error"
    assert reason in record["error"]
    log = json.loads(Path(record["log"]).read_text())
    assert "stdout" in log and "stderr" in log


@pytest.mark.parametrize("query", ["garble:grilling", "nonobject"])
def test_malformed_event_line_makes_the_run_an_error_not_a_passing_no_selection(
    fake_pi, catalog, tmp_path, query
):
    # Dropping the damaged line would leave a clean, passing no-selection.
    results = run(fake_pi, catalog, tmp_path, [{"query": query, "expected": None}])

    record = only_run(results)
    assert record["status"] == "error"
    assert "malformed event line" in record["error"]
    assert summary_row(results, "current")["pass"] is None
    assert results["arms"]["current"]["totals"]["errors"] == 1


def test_timed_out_run_is_an_error_not_a_crash_of_the_whole_evaluation(
    fake_pi, catalog, tmp_path
):
    slow = fake_pi.parent / "slow-pi"
    slow.write_text("#!/bin/sh\nsleep 5\n", encoding="utf-8")
    slow.chmod(0o755)

    results = rce.run_competition(
        eval_set=[{"query": "plain", "expected": None}],
        competitors=catalog["competitors"],
        arms=catalog["arms"],
        model="fake/model",
        thinking="high",
        runs_per_query=1,
        out_dir=tmp_path / "out",
        pi=str(slow),
        timeout=1,
    )

    record = only_run(results)
    assert record["status"] == "error"
    assert "timed out" in record["error"]


def summary_row(results: dict, arm: str, index: int = 0) -> dict:
    return results["arms"][arm]["queries"][index]["summary"]


def test_owner_winning_first_passes_even_when_the_target_is_consulted_afterwards(
    fake_pi, catalog, tmp_path
):
    results = run(
        fake_pi, catalog, tmp_path,
        [{"query": "read:prototype read:grilling", "expected": "prototype"}],
        runs=3,
    )

    row = summary_row(results, "current")
    assert row["completed"] == 3
    assert row["first"] == {"prototype": 3}
    assert row["expected_first"] == 3
    assert row["target_first"] == 0
    assert row["target_consulted"] == 3
    assert row["multiple"] == 3
    assert row["pass"] is True


def test_target_read_first_on_another_skills_query_counts_as_taken(fake_pi, catalog, tmp_path):
    results = run(
        fake_pi, catalog, tmp_path,
        [{"query": "read:grilling read:prototype", "expected": "prototype"}],
        runs=3,
    )

    row = summary_row(results, "base")
    assert row["first"] == {"grilling": 3}
    assert row["expected_first"] == 0
    assert row["target_first"] == 3
    assert row["pass"] is False


def test_no_selection_passes_only_where_no_skill_is_expected(fake_pi, catalog, tmp_path):
    results = run(
        fake_pi, catalog, tmp_path,
        [{"query": "plain", "expected": None}, {"query": "plain again", "expected": "grilling"}],
    )

    assert summary_row(results, "current", 0)["first"] == {"(none)": 1}
    assert summary_row(results, "current", 0)["pass"] is True
    assert summary_row(results, "current", 1)["pass"] is False


def test_errored_runs_leave_the_query_incomplete_instead_of_failing_it(
    fake_pi, catalog, tmp_path
):
    results = run(fake_pi, catalog, tmp_path, [{"query": "crash", "expected": None}], runs=2)

    row = summary_row(results, "current")
    assert row["completed"] == 0
    assert row["errors"] == 2
    assert row["first"] == {}
    assert row["pass"] is None
    totals = results["arms"]["current"]["totals"]
    assert totals == {"queries": 1, "passed": 0, "failed": 0, "incomplete": 1, "runs": 2,
                      "errors": 2}


def test_expectation_naming_a_skill_outside_the_catalog_is_rejected(fake_pi, catalog, tmp_path):
    with pytest.raises(ValueError, match="wayfinder"):
        run(fake_pi, catalog, tmp_path, [{"query": "plain", "expected": "wayfinder"}])


def test_arms_must_vary_one_and_the_same_skill(fake_pi, catalog, tmp_path):
    catalog["arms"]["other"] = write_skill(tmp_path / "x", "qa", "Use when filing bugs.")

    with pytest.raises(ValueError, match="same skill"):
        run(fake_pi, catalog, tmp_path, [{"query": "plain", "expected": None}])


def test_cli_writes_results_with_provenance(fake_pi, catalog, tmp_path):
    eval_set = tmp_path / "set.json"
    eval_set.write_text(json.dumps([{"query": "read:prototype", "expected": "prototype"}]))
    out = tmp_path / "cli-out"

    rce.main([
        "--eval-set", str(eval_set),
        "--competitor", str(catalog["competitors"][0]),
        "--competitor", str(catalog["competitors"][1]),
        "--arm", f"base={catalog['arms']['base']}",
        "--arm", f"current={catalog['arms']['current']}",
        "--model", "fake/model",
        "--thinking", "high",
        "--runs-per-query", "2",
        "--pi", str(fake_pi),
        "--out", str(out),
    ])

    results = json.loads((out / "results.json").read_text())
    settings = results["settings"]
    assert settings["model"] == "fake/model"
    assert settings["thinking"] == "high"
    assert settings["runs_per_query"] == 2
    assert len(settings["eval_set_sha256"]) == 64
    assert len(settings["harness_sha256"]) == 64
    assert "pi_version" in settings
    assert results["arms"]["current"]["totals"]["passed"] == 1
