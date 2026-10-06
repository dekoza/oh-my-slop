"""Real-browser evidence for the prototype skill's UI switcher and production exclusion (#258).

Not a pytest module: it needs system Playwright and an installed Chromium, which the
repository's environment does not provide. Run it from the repository root under an
outer timeout, keeping the full output:

    set -o pipefail; timeout 600 /usr/bin/python3 tests/browser/check_prototype_ui.py \
        --out <evidence-dir> 2>&1 | tee <evidence-dir>/check.log

By default it checks the runnable example in skills/workflow/prototype/references/ui.md.
With --project it checks a project produced for the representative task instead,
started by --start (a command with {env} and {port} placeholders). Either server must
print its http://127.0.0.1:<port> address on its first stdout line.

Development: initial and direct selection, next/previous, wrapping, the keyboard focus
guard and reload persistence, all judged on the rendered page, not the URL or label.
Production: the throwaway route is absent and the real page renders the same with or
without ?variant=, with no switcher. Only owned loopback servers are started, and they
are always stopped.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
UI_REFERENCE = REPO_ROOT / "skills/workflow/prototype/references/ui.md"
CHROMIUM = "/usr/bin/chromium"
LAUNCH_TIMEOUT_MS = 20_000
SCENARIO_DEADLINE_S = 300
NAVIGATION_TIMEOUT_MS = 15_000
NO_NAVIGATION_WAIT_MS = 800
RENDERED = """() => {
  const body = document.body.cloneNode(true);
  body.querySelectorAll('.prototype-bar, script').forEach((node) => node.remove());
  return body.innerHTML;
}"""


class Failure(AssertionError):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise Failure(message)


def documented_example(out: Path) -> str:
    text = UI_REFERENCE.read_text(encoding="utf-8")
    blocks = [b for b in re.findall(r"```python\n(.*?)\n```", text, re.DOTALL) if "--env" in b]
    check(len(blocks) == 1, "ui.md must document exactly one runnable example taking --env")
    script = out / "prototype_example.py"
    script.write_text(blocks[0] + "\n", encoding="utf-8")
    return f"{shlex.quote(sys.executable)} {shlex.quote(str(script))} --env {{env}} --port {{port}}"


class Server:
    """One owned loopback server, stopped on exit."""

    def __init__(self, start: str, env: str, cwd: Path, log: Path) -> None:
        self.log = log.open("w", encoding="utf-8")
        argv = shlex.split(start.format(env=env, port=0))
        self.process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=self.log, text=True)
        line = self.process.stdout.readline()
        self.log.write(f"[first stdout line] {line}")
        match = re.search(r"http://127\.0\.0\.1:\d+", line)
        if not match:
            self.stop()
            raise Failure(f"{env} server announced no loopback address: {line!r}")
        self.base = match.group(0)

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
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


def development(browser, base: str, page_path: str, throwaway: str, out: Path, record: dict) -> None:
    page = browser.new_page()
    page.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)

    def visit(url: str) -> str:
        page.goto(url)
        return page.evaluate(RENDERED)

    def label() -> str:
        return (page.text_content("#variant-label") or "").strip()

    def after(action) -> str:
        with page.expect_navigation():
            action()
        return page.evaluate(RENDERED)

    for path in (page_path, throwaway):
        visit(base + path)
        check(page.locator(".prototype-bar").count() == 1, f"development {path}: no switcher bar")
        variants = json.loads(page.get_attribute(".prototype-bar", "data-variants") or "[]")
        check(len(variants) >= 2, f"development {path}: data-variants lists {variants!r}")
        initial = page.evaluate(RENDERED)
        rendered = {v: visit(f"{base}{path}?variant={v}") for v in variants}
        check(len(set(rendered.values())) == len(variants),
              f"development {path}: variants do not render differently")
        check(initial == rendered[variants[0]], f"development {path}: initial render is not {variants[0]!r}")
        (out / f"dom-dev{path.replace('/', '_')}.json").write_text(json.dumps(rendered, indent=2))
        first, second, last = variants[0], variants[1], variants[-1]

        visit(f"{base}{path}?variant={first}")
        check(after(lambda: page.click("#next-variant")) == rendered[second], f"{path}: next does not render {second!r}")
        check(f"variant={second}" in page.url and second.upper() in label(), f"{path}: URL/label disagree after next")
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

        visit(f"{base}{path}?variant={last}")
        page.reload()
        check(page.evaluate(RENDERED) == rendered[last] and last.upper() in label(),
              f"{path}: reload lost the selection {last!r}")
        record["development"][path] = {"variants": variants, "checks": "passed"}
    page.close()


def production(browser, base: str, page_path: str, throwaway: str, out: Path, record: dict) -> None:
    status, _ = fetch(base + throwaway)
    check(status == 404, f"production {throwaway}: HTTP {status}, expected 404")
    status, plain = fetch(base + page_path)
    check(status == 200, f"production {page_path}: HTTP {status}")
    for v in ("a", "b", "c"):
        check(fetch(f"{base}{page_path}?variant={v}") == (200, plain),
              f"production {page_path}?variant={v} renders differently from the real page")
    page = browser.new_page()
    page.goto(f"{base}{page_path}?variant=b")
    check(page.locator(".prototype-bar").count() == 0, "production: switcher bar rendered")
    (out / "dom-production.html").write_text(page.content(), encoding="utf-8")
    page.close()
    record["production"] = {"throwaway_status": 404, "variant_param_ignored": True, "switcher": "absent"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--project", type=Path, help="checked project directory (default: the ui.md example)")
    parser.add_argument("--start", help="start command with {env} and {port} placeholders")
    parser.add_argument("--page", default="/settings")
    parser.add_argument("--throwaway", default="/prototype/settings")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    record: dict = {"development": {}, "chromium": CHROMIUM}
    if args.project:
        if not args.start:
            parser.error("--project needs --start")
        cwd, start = args.project.resolve(), args.start
        record["subject"] = str(cwd)
    else:
        cwd, start = REPO_ROOT, documented_example(args.out)
        record["subject"] = "ui.md runnable example"
    from playwright.sync_api import sync_playwright  # system Playwright, imported only here

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, timeout=LAUNCH_TIMEOUT_MS)
            record["browser_version"] = browser.version
            try:
                for env, scenario in (("development", development), ("production", production)):
                    with Server(start, env, cwd, args.out / f"server-{env}.log") as server:
                        scenario(browser, server.base, args.page, args.throwaway, args.out, record)
                    check(time.monotonic() - started < SCENARIO_DEADLINE_S, "scenario deadline exceeded")
            finally:
                browser.close()
    except Exception as error:  # report every failure, including Playwright timeouts
        record["result"] = f"FAIL: {error}"
        print(record["result"], file=sys.stderr)
        return 1
    finally:
        record["seconds"] = round(time.monotonic() - started, 2)
        (args.out / "result.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    record["result"] = "PASS"
    (args.out / "result.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
