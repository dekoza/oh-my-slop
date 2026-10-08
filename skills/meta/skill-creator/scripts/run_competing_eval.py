#!/usr/bin/env python3
"""Measure which skill a query selects when competing skills are installed together.

run_eval.py offers one skill, so it can show that a description fires but not that a
competing skill would have won. This harness offers an explicit catalog through pi:
the competitors plus one version of the skill under test per arm, with skill
discovery, extensions, MCP, context files and prompt templates disabled and `read`
as the only tool. A consultation is an executed `read` of a catalog stub's SKILL.md;
the system prompt also names every stub path, so text matching would always fire.

Each run records the catalog pi actually exposed and its ordered consultations.
A run whose catalog differs from the requested one, whose event stream holds a
malformed line, or that fails to finish, is kept as an error and never counted as a
non-selection.
"""

import argparse
import hashlib
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


def parse_events(stdout: str) -> tuple[list[dict], list[int]]:
    """Events of a pi JSON stream, plus the 1-based numbers of lines that are not one.

    A dropped line could be the read that made the selection, so callers must treat
    any malformed line as damaged evidence. Blank lines carry nothing and are skipped.
    """
    events, malformed = [], []
    for number, line in enumerate(stdout.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            event = None
        if isinstance(event, dict):
            events.append(event)
        else:
            malformed.append(number)
    return events, malformed


def stream_error(malformed: list[int]) -> str | None:
    """Why a pi event stream cannot be trusted, or None."""
    if malformed:
        return f"pi emitted {len(malformed)} malformed event line(s), first at line {malformed[0]}"
    return None


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


def attribute(events: list[dict], stubs: dict[str, Path], cwd: Path) -> dict:
    """Ordered consultations of catalog stubs in one pi event stream."""
    by_path = {path.resolve(): name for name, path in stubs.items()}
    consultations = []
    for event in events:
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
        events, malformed = parse_events(stdout)
        sections, exposed = exposed_system_prompt(events)
        if rc is None:
            error = f"pi timed out after {timeout}s"
        else:
            error = (completion_error(rc, events)
                     or stream_error(malformed)
                     or exposure_error(sections, exposed, catalog, stubs))
        record = {"status": "error" if error else "complete", "error": error, "log": str(log),
                  "malformed_lines": malformed, "system_sections": sections,
                  "exposed_catalog": exposed}
        record.update(attribute(events, stubs, cwd))
        return record


def run_competition(eval_set: list[dict], competitors: list[Path], arms: dict[str, Path],
                    model: str, thinking: str, runs_per_query: int, out_dir: Path,
                    pi: str = "pi", num_workers: int = 4, timeout: int = 300,
                    threshold: float = 0.5) -> dict:
    shared = dict(load_skill(path) for path in competitors)
    versions = {arm: load_skill(path) for arm, path in arms.items()}
    targets = {name for name, _ in versions.values()}
    if len(targets) != 1:
        raise ValueError(f"every arm must supply a version of the same skill, got {sorted(targets)}")
    (target,) = targets
    if target in shared:
        raise ValueError(f"{target} is both a competitor and the skill under test")
    catalogs = {arm: dict(sorted({**shared, target: description}.items()))
                for arm, (_, description) in versions.items()}
    unknown = {item["expected"] for item in eval_set} - {None, target, *shared}
    if unknown:
        raise ValueError(f"expected skills missing from the catalog: {sorted(unknown)}")
    jobs =[(arm, i, r) for arm in arms for i in range(len(eval_set)) for r in range(runs_per_query)]

    def work(job):
        arm, i, r = job
        log = out_dir / arm / f"q{i:02d}-run{r + 1}.json"
        log.parent.mkdir(parents=True, exist_ok=True)
        return job, run_query(pi, catalogs[arm], model, thinking, eval_set[i]["query"], log, timeout)

    with ThreadPoolExecutor(max_workers=num_workers) as pool:
        records = dict(pool.map(work, jobs))
    results = {"arms": {}}
    for arm in arms:
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


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pi_version(pi: str) -> str:
    try:
        result = subprocess.run([pi, "--version"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f"unknown ({exc})"
    return (result.stdout or result.stderr).strip()


def parse_arm(value: str) -> tuple[str, Path]:
    label, sep, path = value.partition("=")
    if not sep or not label or not path:
        raise argparse.ArgumentTypeError(f"expected LABEL=SKILL_DIR, got {value!r}")
    return label, Path(path)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--eval-set", required=True, type=Path,
                        help='JSON list of {"query": ..., "expected": skill name or null}')
    parser.add_argument("--competitor", action="append", type=Path, default=[],
                        help="skill directory offered in every arm (repeatable)")
    parser.add_argument("--arm", action="append", type=parse_arm, required=True,
                        help="LABEL=SKILL_DIR: one version of the skill under test (repeatable)")
    parser.add_argument("--model", required=True, help="pi model, e.g. openai-codex/gpt-6.1-sol")
    parser.add_argument("--thinking", default="high")
    parser.add_argument("--runs-per-query", type=int, default=3)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=300, help="seconds per run")
    parser.add_argument("--trigger-threshold", type=float, default=0.5)
    parser.add_argument("--pi", default="pi", help="pi executable")
    parser.add_argument("--out", required=True, type=Path, help="directory for logs and results")
    args = parser.parse_args(argv)

    eval_set = json.loads(args.eval_set.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    results = run_competition(
        eval_set=eval_set, competitors=args.competitor, arms=dict(args.arm), model=args.model,
        thinking=args.thinking, runs_per_query=args.runs_per_query, out_dir=args.out,
        pi=args.pi, num_workers=args.num_workers, timeout=args.timeout,
        threshold=args.trigger_threshold,
    )
    settings = {
        "model": args.model,
        "thinking": args.thinking,
        "runs_per_query": args.runs_per_query,
        "trigger_threshold": args.trigger_threshold,
        "timeout": args.timeout,
        "pi_version": pi_version(args.pi),
        "harness_sha256": sha256(Path(__file__)),
        "eval_set": str(args.eval_set.resolve()),
        "eval_set_sha256": sha256(args.eval_set),
        "competitors": [str(path.resolve()) for path in args.competitor],
        "arms": {label: str(path.resolve()) for label, path in args.arm},
    }
    results = {"settings": settings, **results}
    (args.out / "results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for arm, data in results["arms"].items():
        totals = data["totals"]
        print(f"{arm}: {totals['passed']}/{totals['queries']} pass, "
              f"incomplete={totals['incomplete']}, errors={totals['errors']}")
        for row in data["queries"]:
            s = row["summary"]
            print(f"  [{s['pass']}] expected={row['expected']} first={s['first']} "
                  f"{data['target']}_first={s['target_first']} "
                  f"{data['target']}_consulted={s['target_consulted']}: {row['query'][:60]}")


if __name__ == "__main__":
    main()
