#!/usr/bin/env python3
"""Measure which skill a query selects when competing skills are installed together.

run_eval.py offers one skill, so it can show that a description fires but not that a
competing skill would have won. This harness offers an explicit catalog through pi:
the competitors plus one version of the skill under test per arm, with skill
discovery, extensions, MCP, context files and prompt templates disabled and `read`
as the only tool. A consultation is an executed `read` of a catalog stub's SKILL.md;
the system prompt also names every stub path, so text matching would always fire.

Each run records the catalog pi actually exposed and its ordered consultations.
A run whose catalog differs from the requested one, or that fails to finish, is
kept as an error and never counted as a non-selection.
"""

import argparse
import html
import json
import re
import subprocess
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from scripts.utils import parse_skill_md
except ImportError:  # loaded as a top-level module from scripts/
    from utils import parse_skill_md

SKILL_ENTRY = re.compile(
    r"<skill>\s*<name>(.*?)</name>\s*<description>(.*?)</description>\s*"
    r"<location>(.*?)</location>\s*</skill>",
    re.DOTALL,
)
# pi 1.1.0's system prompt sections with context files, extensions and templates off.
SYSTEM_SECTIONS = {"preamble", "tools", "rules", "docs", "skills", "cwd"}
NO_SELECTION = "(none)"


def normalize(text: str) -> str:
    return " ".join(text.split())


def load_skill(skill_dir: Path) -> tuple[str, str]:
    """Return (name, description) of a skill directory."""
    name, description, _ = parse_skill_md(Path(skill_dir))
    return name, normalize(description)


def build_stub(name: str, description: str) -> str:
    return (
        "---\n"
        f"name: {name}\n"
        "description: |\n"
        f"  {description}\n"
        "---\n\n"
        f"# {name}\n\n"
        "Use this skill when the description matches the user's request.\n"
    )


def build_command(pi: str, stub_dirs: list[Path], model: str, thinking: str, query: str) -> list[str]:
    cmd = [pi, "-p", "--mode", "json", "--no-session", "--no-skills"]
    for stub_dir in stub_dirs:
        cmd += ["--skill", str(stub_dir)]
    cmd += ["--no-extensions", "--no-mcp", "--no-context-files", "--no-prompt-templates",
            "--no-themes", "--tools", "read", "--model", model, "--thinking", thinking,
            "--offline", "--", query]
    return cmd


def parse_events(stdout: str) -> list[dict]:
    events = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def exposed_system_prompt(events: list[dict]) -> tuple[list[str], list[dict]]:
    """Section names and skill catalog of the system prompt pi actually sent."""
    for event in events:
        message = event.get("message") or {}
        if event.get("type") == "message_end" and message.get("role") == "system":
            sections = message.get("sections") or {}
            catalog = [
                {"name": html.unescape(name).strip(),
                 "description": normalize(html.unescape(description)),
                 "location": html.unescape(location).strip()}
                for name, description, location in SKILL_ENTRY.findall(sections.get("skills", ""))
            ]
            return sorted(sections), catalog
    return [], []


def as_text(output: str | bytes | None) -> str:
    """TimeoutExpired carries bytes even when the run was in text mode."""
    if isinstance(output, bytes):
        return output.decode("utf-8", errors="replace")
    return output or ""


def completion_error(rc: int, events: list[dict]) -> str | None:
    """Why a pi run did not finish cleanly, or None."""
    if rc != 0:
        return f"pi exited {rc}"
    if not any(event.get("type") == "agent_end" for event in events):
        return "pi produced no agent_end event"
    for event in events:
        message = event.get("message") or {}
        if (event.get("type") == "message_end" and message.get("role") == "assistant"
                and message.get("stopReason") in {"error", "aborted"}):
            return f"assistant message ended with stopReason {message['stopReason']}"
    return None


def exposure_error(sections: list[str], exposed: list[dict], catalog: dict[str, str],
                   stubs: dict[str, Path]) -> str | None:
    """Why the exposed prompt differs from the requested catalog, or None."""
    unexpected = [s for s in sections if s not in SYSTEM_SECTIONS]
    if unexpected:
        return f"unexpected system prompt section: {', '.join(unexpected)}"
    expected = sorted((name, catalog[name], str(stubs[name].resolve())) for name in catalog)
    actual = sorted((e["name"], e["description"], str(Path(e["location"]).resolve()))
                    for e in exposed)
    if actual != expected:
        return f"exposed catalog differs from the requested catalog: {[e['name'] for e in exposed]}"
    return None


def attribute(stdout: str, stubs: dict[str, Path], cwd: Path) -> dict:
    """Ordered consultations of catalog stubs in one pi event stream."""
    by_path = {path.resolve(): name for name, path in stubs.items()}
    consultations = []
    for event in parse_events(stdout):
        if event.get("type") != "tool_execution_start" or event.get("toolName") != "read":
            continue
        raw = Path(str((event.get("args") or {}).get("path", "")))
        path = (raw if raw.is_absolute() else cwd / raw).resolve()
        if path in by_path:
            consultations.append(by_path[path])
    distinct = list(dict.fromkeys(consultations))
    outcome = "none" if not distinct else "single" if len(distinct) == 1 else "multiple"
    return {
        "consultations": consultations,
        "first": distinct[0] if distinct else None,
        "outcome": outcome,
    }


def run_query(pi: str, catalog: dict[str, str], model: str, thinking: str, query: str,
              log: Path, timeout: int) -> dict:
    """Run one query against one catalog and return its run record."""
    with tempfile.TemporaryDirectory(prefix="pi-competing-") as tmp:
        cwd = Path(tmp)
        stubs = {}
        for name, description in catalog.items():
            stub_dir = cwd / "skills" / name
            stub_dir.mkdir(parents=True)
            stubs[name] = stub_dir / "SKILL.md"
            stubs[name].write_text(build_stub(name, description), encoding="utf-8")
        cmd = build_command(pi, [p.parent for p in stubs.values()], model, thinking, query)
        try:
            result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
            rc, stdout, stderr = result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired as exc:
            rc, stdout, stderr = None, as_text(exc.stdout), as_text(exc.stderr)
        log.write_text(json.dumps({"cmd": cmd, "rc": rc, "stdout": stdout, "stderr": stderr})
                       + "\n", encoding="utf-8")
        events = parse_events(stdout)
        sections, exposed = exposed_system_prompt(events)
        error = (f"pi timed out after {timeout}s" if rc is None else completion_error(rc, events)
                 or exposure_error(sections, exposed, catalog, stubs))
        record = {"status": "error" if error else "complete", "error": error, "log": str(log),
                  "system_sections": sections, "exposed_catalog": exposed}
        record.update(attribute(stdout, stubs, cwd))
        return record


def run_competition(eval_set: list[dict], competitors: list[Path], arms: dict[str, Path],
                    model: str, thinking: str, runs_per_query: int, out_dir: Path,
                    pi: str = "pi", num_workers: int = 4, timeout: int = 300,
                    threshold: float = 0.5) -> dict:
    shared = dict(load_skill(path) for path in competitors)
    catalogs = {}
    for arm, path in arms.items():
        name, description = load_skill(path)
        catalogs[arm] = dict(sorted({**shared, name: description}.items()))
    jobs = [(arm, i, r) for arm in arms for i in range(len(eval_set)) for r in range(runs_per_query)]

    def work(job):
        arm, i, r = job
        log = out_dir / arm / f"q{i:02d}-run{r + 1}.json"
        log.parent.mkdir(parents=True, exist_ok=True)
        return job, run_query(pi, catalogs[arm], model, thinking, eval_set[i]["query"], log, timeout)

    with ThreadPoolExecutor(max_workers=num_workers) as pool:
        records = dict(pool.map(work, jobs))
    results = {"arms": {}}
    for arm, path in arms.items():
        target = load_skill(path)[0]
        rows = []
        for i, item in enumerate(eval_set):
            runs = [records[(arm, i, r)] for r in range(runs_per_query)]
            rows.append({"query": item["query"], "expected": item["expected"], "runs": runs,
                         "summary": summarize(runs, item["expected"], target, threshold)})
        summaries = [row["summary"] for row in rows]
        totals = {
            "queries": len(rows),
            "passed": sum(s["pass"] is True for s in summaries),
            "failed": sum(s["pass"] is False for s in summaries),
            "incomplete": sum(s["pass"] is None for s in summaries),
            "runs": len(rows) * runs_per_query,
            "errors": sum(s["errors"] for s in summaries),
        }
        results["arms"][arm] = {"target": target, "catalog": catalogs[arm], "queries": rows,
                                "totals": totals}
    return results


def summarize(runs: list[dict], expected: str | None, target: str, threshold: float) -> dict:
    """Per-query selection counts; a query with any errored run gets no verdict."""
    complete = [run for run in runs if run["status"] == "complete"]
    first = Counter(run["first"] or NO_SELECTION for run in complete)
    expected_first = sum(run["first"] == expected for run in complete)
    verdict = None
    if complete and len(complete) == len(runs):
        verdict = expected_first / len(complete) >= threshold
    return {
        "completed": len(complete),
        "errors": len(runs) - len(complete),
        "first": dict(first.most_common()),
        "expected_first": expected_first,
        "target_first": sum(run["first"] == target for run in complete),
        "target_consulted": sum(target in run["consultations"] for run in complete),
        "multiple": sum(run["outcome"] == "multiple" for run in complete),
        "pass": verdict,
    }
