"""Real-browser evidence for the prototype skill's UI switcher and production exclusion (#258).

Not a pytest module: it needs system Playwright and an installed Chromium, which the
repository's environment does not provide. Run it from the repository root under an
outer timeout, keeping the full output:

    set -o pipefail; timeout 600 /usr/bin/python3 tests/browser/check_prototype_ui.py \
        --out <evidence-dir> 2>&1 | tee <evidence-dir>/check.log

By default it checks the runnable example in skills/workflow/prototype/references/ui.md.
With --project it checks a project produced for the representative task instead,
started by --start (a command with {env} and {port} placeholders); --reference-project
names the untouched project, whose production page the checked one must still render.
Every server must print its http://127.0.0.1:<port> address on its first stdout line.

The switcher is found by the hooks ui.md declares: a `.prototype-bar` element listing
its variants in `data-variants`, `#prev-variant`, `#next-variant` and `#variant-label`.

Development: variants differ in structure (tags and text, not just attributes); initial
and direct selection, next/previous, wrapping, the keyboard focus guard and reload
persistence are judged on the rendered page, not the URL or label. Production: the
throwaway route is absent; the real page renders the same, in the browser, for every
variant name seen in development and an unknown one, shows no switcher, and matches
the reference project (or, without one, differs from every development variant). Only
owned loopback servers are started, and they are always stopped.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
UI_REFERENCE = REPO_ROOT / "skills/workflow/prototype/references/ui.md"
CHROMIUM = "/usr/bin/chromium"
LAUNCH_TIMEOUT_MS = 20_000
READY_TIMEOUT_S = 20
SCENARIO_DEADLINE_S = 300
OPERATION_TIMEOUT_MS = 15_000
NO_NAVIGATION_WAIT_MS = 800  # loopback navigation starts within milliseconds; nothing after this is a switch
UNKNOWN_VARIANT = "no-such-variant"
RENDERED = """() => {
  const body = document.body.cloneNode(true);
  body.querySelectorAll('.prototype-bar, script, style').forEach((node) => node.remove());
  return body.innerHTML;
}"""
STRUCTURE = """() => {
  const skip = (node) => node.matches && node.matches('.prototype-bar, script, style');
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();
    if (node.nodeType !== Node.ELEMENT_NODE || skip(node)) return '';
    const inner = Array.from(node.childNodes).map(walk).filter(Boolean).join(',');
    return node.tagName.toLowerCase() + '(' + inner + ')';
  };
  return walk(document.body);
}"""


class Failure(AssertionError):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise Failure(message)


class Deadline:
    def __init__(self, seconds: float) -> None:
        self.until = time.monotonic() + seconds

    def check(self) -> None:
        check(time.monotonic() < self.until, f"scenario deadline of {SCENARIO_DEADLINE_S}s exceeded")


def digest_tree(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file() and ".git" not in p.relative_to(root).parts}


def documented_example(out: Path) -> str:
    text = UI_REFERENCE.read_text(encoding="utf-8")
    blocks = [b for b in re.findall(r"```python\n(.*?)\n```", text, re.DOTALL) if "--env" in b]
    check(len(blocks) == 1, "ui.md must document exactly one runnable example taking --env")
    script = out / "prototype_example.py"
    script.write_text(blocks[0] + "\n", encoding="utf-8")
    return f"{shlex.quote(sys.executable)} {shlex.quote(str(script))} --env {{env}} --port {{port}}"


class Server:
    """One owned loopback server: readiness under a deadline, output kept, always stopped."""

    def __init__(self, start: str, env: str, cwd: Path, log: Path) -> None:
        self.log_path = log
        self.log = log.open("w", encoding="utf-8")
        argv = shlex.split(start.format(env=env, port=0))
        self.process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=self.log, text=True)
        first: list[str] = []
        ready = threading.Event()

        def drain() -> None:  # first line announces the address; the rest is kept, never left to fill the pipe
            for index, line in enumerate(self.process.stdout):
                if index == 0:
                    first.append(line)
                    ready.set()
                self.log.write(f"[stdout] {line}")
            ready.set()

        self.reader = threading.Thread(target=drain, daemon=True)
        self.reader.start()
        ready.wait(READY_TIMEOUT_S)
        match = re.search(r"http://127\.0\.0\.1:\d+", first[0]) if first else None
        if not match:
            self.stop()
            raise Failure(f"{env} server announced no loopback address within {READY_TIMEOUT_S}s "
                          f"(first line {first[0] if first else None!r}; log {log})")
        self.base = match.group(0)

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        self.reader.join(timeout=5)
        self.log.close()

    def __enter__(self) -> "Server":
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()


def fetch(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")


class Run:
    """Shared state of one check: browser, open pages for failure artifacts, record."""

    def __init__(self, browser, out: Path, deadline: Deadline) -> None:
        self.browser, self.out, self.deadline = browser, out, deadline
        self.pages: list = []
        self.record: dict = {"development": {}}

    def new_page(self):
        page = self.browser.new_page()
        page.set_default_timeout(OPERATION_TIMEOUT_MS)
        page.set_default_navigation_timeout(OPERATION_TIMEOUT_MS)
        self.pages.append(page)
        return page

    def visit(self, page, url: str) -> tuple[str, str]:
        self.deadline.check()
        page.goto(url)
        return page.evaluate(RENDERED), page.evaluate(STRUCTURE)

    def save_failure_artifacts(self) -> None:
        for index, page in enumerate(self.pages):
            if page.is_closed():
                continue
            try:
                (self.out / f"failure-page-{index}.html").write_text(page.content(), encoding="utf-8")
                page.screenshot(path=str(self.out / f"failure-page-{index}.png"), full_page=True)
                (self.out / f"failure-page-{index}.url").write_text(page.url, encoding="utf-8")
            except Exception as error:  # a crashed page still leaves the other artifacts
                (self.out / f"failure-page-{index}.error").write_text(repr(error), encoding="utf-8")


def development(run: Run, base: str, page_path: str, throwaway: str) -> None:
    page = run.new_page()

    def labelled(name: str) -> bool:  # a whole word, so "a" does not match inside "variant"
        text = (page.text_content("#variant-label") or "").lower()
        return re.search(rf"(?<![\w-]){re.escape(name.lower())}(?![\w-])", text) is not None

    def after(action) -> str:
        run.deadline.check()
        with page.expect_navigation():
            action()
        return page.evaluate(RENDERED)

    for path in (page_path, throwaway):
        run.visit(page, base + path)
        check(page.locator(".prototype-bar").count() == 1, f"development {path}: no .prototype-bar switcher")
        variants = json.loads(page.get_attribute(".prototype-bar", "data-variants") or "[]")
        check(len(variants) >= 2 and all(isinstance(v, str) and v for v in variants),
              f"development {path}: data-variants lists {variants!r}")
        initial, _ = run.visit(page, base + path)
        rendered, structure = {}, {}
        for v in variants:
            rendered[v], structure[v] = run.visit(page, f"{base}{path}?variant={v}")
            check(labelled(v), f"development {path}?variant={v}: the label does not name {v!r}")
        check(len(set(structure.values())) == len(variants),
              f"development {path}: variants do not differ in structure (tags and text)")
        check(initial in rendered.values(), f"development {path}: the initial render is no variant")
        (run.out / f"dom-dev{path.replace('/', '_')}.json").write_text(json.dumps(rendered, indent=2))
        first, second, last = variants[0], variants[1], variants[-1]

        run.visit(page, f"{base}{path}?variant={first}")
        check(after(lambda: page.click("#next-variant")) == rendered[second], f"{path}: next does not render {second!r}")
        check(f"variant={second}" in page.url and labelled(second), f"{path}: URL/label disagree after next")
        check(after(lambda: page.click("#prev-variant")) == rendered[first], f"{path}: previous does not render {first!r}")
        check(after(lambda: page.click("#prev-variant")) == rendered[last], f"{path}: previous from first does not wrap")
        check(after(lambda: page.click("#next-variant")) == rendered[first], f"{path}: next from last does not wrap")

        page.locator("body").click(position={"x": 1, "y": 1})
        check(after(lambda: page.keyboard.press("ArrowRight")) == rendered[second], f"{path}: ArrowRight does not switch")
        check(after(lambda: page.keyboard.press("ArrowLeft")) == rendered[first], f"{path}: ArrowLeft does not switch")
        page.evaluate("""() => { const i = document.createElement('input');
                                 i.id = 'focus-guard-probe'; document.body.prepend(i); i.focus(); }""")
        before_url = page.url
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(NO_NAVIGATION_WAIT_MS)
        check(page.url == before_url and page.locator("#focus-guard-probe").count() == 1,
              f"{path}: ArrowRight in a focused input still switched")

        run.visit(page, f"{base}{path}?variant={last}")
        page.reload()
        check(page.evaluate(RENDERED) == rendered[last] and labelled(last),
              f"{path}: reload lost the selection {last!r}")
        run.record["development"][path] = {"variants": variants, "structures": structure, "checks": "passed"}


def production(run: Run, base: str, page_path: str, throwaway: str, reference: dict | None) -> None:
    seen = [v for info in run.record["development"].values() for v in info["variants"]]
    check(bool(seen), "production: development recorded no variant names to try")
    for url in (throwaway, throwaway + "/", f"{throwaway}?variant={seen[0]}"):
        status, _ = fetch(base + url)
        check(status == 404, f"production {url}: HTTP {status}, expected 404")
    status, _ = fetch(base + page_path)
    check(status == 200, f"production {page_path}: HTTP {status}")
    page = run.new_page()
    plain, plain_structure = run.visit(page, base + page_path)
    (run.out / "dom-production.html").write_text(page.content(), encoding="utf-8")
    check(page.locator(".prototype-bar").count() == 0, f"production {page_path}: switcher rendered")
    for name in dict.fromkeys(seen + [UNKNOWN_VARIANT]):
        rendered, _ = run.visit(page, f"{base}{page_path}?variant={name}")
        check(rendered == plain, f"production {page_path}?variant={name} renders differently from the real page")
        check(page.locator(".prototype-bar").count() == 0, f"production {page_path}?variant={name}: switcher rendered")
    if reference is not None:
        check(plain_structure == reference["structure"],
              f"production {page_path} no longer renders like the untouched project")
        basis = "matches the reference project"
    else:
        variant_structures = {s for info in run.record["development"].values() for s in info["structures"].values()}
        check(plain_structure not in variant_structures, f"production {page_path} renders a prototype variant")
        basis = "differs from every development variant"
    run.record["production"] = {"throwaway_absent": [throwaway, throwaway + "/"], "variant_names_tried": seen,
                                "unknown_name_tried": UNKNOWN_VARIANT, "switcher": "absent", "real_page": basis}


def reference_page(run: Run, start: str, cwd: Path, page_path: str) -> dict:
    with Server(start, "production", cwd, run.out / "server-reference-production.log") as server:
        page = run.new_page()
        rendered, structure = run.visit(page, server.base + page_path)
        page.close()
    return {"rendered": rendered, "structure": structure}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--project", type=Path, help="checked project directory (default: the ui.md example)")
    parser.add_argument("--start", help="start command with {env} and {port} placeholders")
    parser.add_argument("--reference-project", type=Path, help="untouched project the production page must match")
    parser.add_argument("--page", default="/settings")
    parser.add_argument("--throwaway", default="/prototype/settings")
    args = parser.parse_args()
    if args.project and not args.start:
        parser.error("--project needs --start")
    args.out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    record: dict = {"chromium": CHROMIUM, "result": "FAIL: did not finish"}
    run = None
    try:
        if args.project:
            cwd, start = args.project.resolve(), args.start
            record["subject"] = {"project": str(cwd), "files": digest_tree(cwd)}
        else:
            cwd, start = REPO_ROOT, documented_example(args.out)
            head = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], capture_output=True, text=True)
            record["subject"] = {"ui.md sha256": hashlib.sha256(UI_REFERENCE.read_bytes()).hexdigest(),
                                 "repository HEAD": head.stdout.strip() or None}
        if args.reference_project:
            record["reference"] = {"project": str(args.reference_project.resolve()),
                                   "files": digest_tree(args.reference_project.resolve())}
        from playwright.sync_api import sync_playwright  # system Playwright, imported only here

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, timeout=LAUNCH_TIMEOUT_MS)
            record["browser_version"] = browser.version
            run = Run(browser, args.out, Deadline(SCENARIO_DEADLINE_S))
            try:
                reference = (reference_page(run, start, args.reference_project.resolve(), args.page)
                             if args.reference_project else None)
                with Server(start, "development", cwd, args.out / "server-development.log") as server:
                    development(run, server.base, args.page, args.throwaway)
                with Server(start, "production", cwd, args.out / "server-production.log") as server:
                    production(run, server.base, args.page, args.throwaway, reference)
                record["result"] = "PASS"
            except BaseException:
                run.save_failure_artifacts()
                raise
            finally:
                record.update(run.record)
                browser.close()
    except Exception as error:  # report every failure, including Playwright timeouts
        record["result"] = f"FAIL: {error}"
        record["traceback"] = traceback.format_exc()
    finally:
        record["seconds"] = round(time.monotonic() - started, 2)
        (args.out / "result.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps({k: record[k] for k in ("result", "seconds") if k in record}, indent=2))
    if record["result"] != "PASS":
        print(record["result"], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
