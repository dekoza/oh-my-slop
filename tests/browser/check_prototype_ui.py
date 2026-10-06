"""Real-browser evidence for the prototype skill's UI switcher and production exclusion (#258).

Not a pytest module: it needs system Playwright and an installed Chromium, which the
repository's environment does not provide. Run it from the repository root under an
outer timeout, keeping the full output:

    set -o pipefail; timeout 600 /usr/bin/python3 tests/browser/check_prototype_ui.py \
        --out <evidence-dir> 2>&1 | tee <evidence-dir>/check.log

By default it checks the runnable example in skills/workflow/prototype/references/ui.md.
With --project it checks a project produced for the representative task instead,
started by --start (a command with {env} and {port} placeholders), against
--reference-project, the untouched project whose production page it must still render.
Every server must print its http://127.0.0.1:<port> address on stdout (banner lines
before it are fine) within the readiness deadline.

The switcher is found by the hooks ui.md declares: a `.prototype-bar` element listing
its variants in `data-variants`, `#prev-variant`, `#next-variant` and `#variant-label`.

Development: variants differ in structure (tags and text, ignoring attributes, case and
whitespace); initial and direct selection, next/previous, wrapping, a label naming
exactly the shown variant, the keyboard focus guard and reload persistence are judged on
the rendered page, not the URL or label.

Production: the throwaway route is absent; the real page, read after it settles, is the
same for every variant name seen in development and an unknown one, offered through the
selection parameter the switcher used, a few common parameter names and a cookie of each
of those names; no switcher appears; and the page matches the reference project
including its scripts (the ui.md example, which has no reference, must instead differ
from every development variant). Other selection channels are not probed. Only owned
loopback servers are started, each in its own process group, and they are always stopped.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
UI_REFERENCE = REPO_ROOT / "skills/workflow/prototype/references/ui.md"
CHROMIUM = "/usr/bin/chromium"
LAUNCH_TIMEOUT_MS = 20_000
READY_TIMEOUT_S = 20
SCENARIO_DEADLINE_S = 300
OPERATION_TIMEOUT_MS = 15_000
SETTLE_MS = 1_500  # client-side changes later than this after load are not observed
FOCUS_GUARD_WAIT_MS = 3_000  # a switch later than this after the key press is not observed
UNKNOWN_VARIANT = "no-such-variant"
COMMON_SELECTION_PARAMS = ("variant", "layout", "design", "option", "prototype", "v")
ADDRESS = re.compile(r"http://127\.0\.0\.1:\d+")
RENDERED = """() => {
  const body = document.body.cloneNode(true);
  body.querySelectorAll('.prototype-bar, script, style').forEach((node) => node.remove());
  return body.innerHTML;
}"""
# Tags and text in document order, attributes ignored, text casefolded and whitespace
# collapsed. With scripts=true, script and style text counts as well (production).
STRUCTURE = """(scripts) => {
  const norm = (text) => text.toLowerCase().replace(/\\s+/g, ' ').trim();
  const skip = (node) => node.matches && (node.matches('.prototype-bar') || (!scripts && node.matches('script, style')));
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return norm(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || skip(node)) return '';
    const inner = Array.from(node.childNodes).map(walk).filter(Boolean).join(',');
    return node.tagName.toLowerCase() + '(' + inner + ')';
  };
  return walk(scripts ? document.documentElement : document.body);
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
    """One owned loopback server in its own process group: readiness under a deadline,
    output kept in its log, the whole group stopped on exit."""

    def __init__(self, start: str, env: str, cwd: Path, log: Path) -> None:
        self.log = log.open("w", encoding="utf-8")
        argv = shlex.split(start.format(env=env, port=0))
        self.process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=self.log, text=True,
                                        start_new_session=True)
        found: list[str] = []
        ready = threading.Event()

        def drain() -> None:  # keep every line, so a chatty server never fills the pipe
            for line in self.process.stdout:
                self.log.write(f"[stdout] {line}")
                match = ADDRESS.search(line)
                if match and not found:
                    found.append(match.group(0))
                    ready.set()
            ready.set()

        self.reader = threading.Thread(target=drain, daemon=True)
        self.reader.start()
        ready.wait(READY_TIMEOUT_S)
        if not found:
            self.stop()
            raise Failure(f"{env} server announced no loopback address within {READY_TIMEOUT_S}s (log {log})")
        self.base = found[0]

    def stop(self) -> None:
        for sig, wait in ((signal.SIGTERM, 10), (signal.SIGKILL, 10)):
            try:
                os.killpg(self.process.pid, sig)
            except ProcessLookupError:
                break
            try:
                self.process.wait(timeout=wait)
                break
            except subprocess.TimeoutExpired:
                continue
        try:  # anything left in the group after the leader exited
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.reader.join(timeout=5)
        self.log.close()

    def __enter__(self) -> "Server":
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()


def fetch(url: str, cookie: str | None = None) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"Cookie": cookie} if cookie else {})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")


class Run:
    """Shared state of one check: browser, open pages for failure artifacts, record."""

    def __init__(self, browser, out: Path, deadline: Deadline) -> None:
        self.browser, self.out, self.deadline = browser, out, deadline
        self.pages: list = []
        self.record: dict = {"development": {}}

    def new_page(self, context=None):
        page = (context or self.browser).new_page()
        page.set_default_timeout(OPERATION_TIMEOUT_MS)
        page.set_default_navigation_timeout(OPERATION_TIMEOUT_MS)
        self.pages.append(page)
        return page

    def visit(self, page, url: str, settle: bool = False) -> tuple[str, str]:
        self.deadline.check()
        page.goto(url)
        if settle:
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(SETTLE_MS)
        return page.evaluate(RENDERED), page.evaluate(STRUCTURE, settle)

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
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    page = run.new_page()

    def named(name: str, text: str) -> bool:  # a whole word, so "a" does not match inside "variant"
        return re.search(rf"(?<![\w-]){re.escape(name.lower())}(?![\w-])", text.lower()) is not None

    def labelled(name: str, variants: list[str]) -> bool:
        text = page.text_content("#variant-label") or ""
        return named(name, text) and not any(named(other, text) for other in variants if other != name)

    def selected(key: str) -> str | None:
        return parse_qs(urlsplit(page.url).query).get(key, [None])[0]

    def after(action) -> str:
        run.deadline.check()
        with page.expect_navigation():
            action()
        return page.evaluate(RENDERED)

    selection_keys = set()
    for path in (page_path, throwaway):
        run.visit(page, base + path)
        check(page.locator(".prototype-bar").count() == 1, f"development {path}: no .prototype-bar switcher")
        variants = json.loads(page.get_attribute(".prototype-bar", "data-variants") or "[]")
        check(len(variants) >= 2 and all(isinstance(v, str) and v for v in variants),
              f"development {path}: data-variants lists {variants!r}")
        initial, _ = run.visit(page, base + path)
        rendered, structure = {}, {}
        for v in variants:
            rendered[v], structure[v] = run.visit(page, f"{base}{path}?variant={quote(v)}")
            check(labelled(v, variants), f"development {path}?variant={v}: the label does not name exactly {v!r}")
        check(len(set(structure.values())) == len(variants),
              f"development {path}: variants do not differ in structure (tags and text)")
        check(initial in rendered.values(), f"development {path}: the initial render is no variant")
        (run.out / f"dom-dev{path.replace('/', '_')}.json").write_text(json.dumps(rendered, indent=2))
        first, second, last = variants[0], variants[1], variants[-1]

        run.visit(page, f"{base}{path}?variant={quote(first)}")
        check(after(lambda: page.click("#next-variant")) == rendered[second], f"{path}: next does not render {second!r}")
        keys = [k for k, values in parse_qs(urlsplit(page.url).query).items() if values == [second]]
        check(len(keys) == 1 and labelled(second, variants), f"{path}: URL/label disagree after next ({page.url})")
        selection_keys.add(keys[0])
        check(after(lambda: page.click("#prev-variant")) == rendered[first], f"{path}: previous does not render {first!r}")
        check(after(lambda: page.click("#prev-variant")) == rendered[last], f"{path}: previous from first does not wrap")
        check(after(lambda: page.click("#next-variant")) == rendered[first], f"{path}: next from last does not wrap")

        page.locator("body").click(position={"x": 1, "y": 1})
        check(after(lambda: page.keyboard.press("ArrowRight")) == rendered[second], f"{path}: ArrowRight does not switch")
        check(after(lambda: page.keyboard.press("ArrowLeft")) == rendered[first], f"{path}: ArrowLeft does not switch")
        page.evaluate("""() => { const i = document.createElement('input');
                                 i.id = 'focus-guard-probe'; document.body.prepend(i); i.focus(); }""")
        try:
            with page.expect_navigation(timeout=FOCUS_GUARD_WAIT_MS):
                page.keyboard.press("ArrowRight")
            switched = True
        except PlaywrightTimeout:
            switched = False
        check(not switched and selected(keys[0]) == first, f"{path}: ArrowRight in a focused input still switched")

        run.visit(page, f"{base}{path}?variant={quote(last)}")
        page.reload()
        check(page.evaluate(RENDERED) == rendered[last] and labelled(last, variants),
              f"{path}: reload lost the selection {last!r}")
        run.record["development"][path] = {"variants": variants, "structures": structure,
                                           "selection_parameter": keys[0], "checks": "passed"}
    run.record["selection_parameters"] = sorted(selection_keys)


def production(run: Run, base: str, page_path: str, throwaway: str, reference: dict | None) -> None:
    seen = [v for info in run.record["development"].values() for v in info["variants"]]
    check(bool(seen), "production: development recorded no variant names to try")
    names = list(dict.fromkeys(seen + [UNKNOWN_VARIANT]))
    keys = list(dict.fromkeys(run.record.get("selection_parameters", []) + list(COMMON_SELECTION_PARAMS)))
    bodies = run.out / "production-http"
    bodies.mkdir(exist_ok=True)
    for url in (throwaway, throwaway + "/", f"{throwaway}?variant={quote(seen[0])}"):
        status, body = fetch(base + url)
        (bodies / f"{quote(url, safe='')}.html").write_text(body, encoding="utf-8")
        check(status == 404, f"production {url}: HTTP {status}, expected 404")
    status, plain_body = fetch(base + page_path)
    (bodies / "plain.html").write_text(plain_body, encoding="utf-8")
    check(status == 200, f"production {page_path}: HTTP {status}")
    for key in keys:  # the server must not select a variant through any probed channel
        for name in names:
            for how, url, cookie in (("query", f"{base}{page_path}?{key}={quote(name)}", None),
                                     ("cookie", base + page_path, f"{key}={quote(name)}")):
                answer = fetch(url, cookie)
                if answer != (200, plain_body):
                    (bodies / f"{how}-{key}-{quote(name, safe='')}.html").write_text(answer[1], encoding="utf-8")
                check(answer == (200, plain_body), f"production {page_path}: {how} {key}={name} changes the response")
    context = run.browser.new_context()
    page = run.new_page(context)
    plain, plain_structure = run.visit(page, base + page_path, settle=True)
    (run.out / "dom-production.html").write_text(page.content(), encoding="utf-8")
    check(page.locator(".prototype-bar").count() == 0, f"production {page_path}: switcher rendered")
    for key in run.record.get("selection_parameters", ["variant"]):  # the page itself, after it settles
        for name in names:
            rendered, _ = run.visit(page, f"{base}{page_path}?{key}={quote(name)}", settle=True)
            check(rendered == plain and page.locator(".prototype-bar").count() == 0,
                  f"production {page_path}?{key}={name}: the settled page differs from the real page")
    context.close()
    if reference is not None:
        check(plain_structure == reference["structure"],
              f"production {page_path} (with its scripts) no longer matches the untouched project")
        basis = "matches the reference project, scripts included"
    else:
        variant_structures = {s for info in run.record["development"].values() for s in info["structures"].values()}
        _, body_structure = run.visit(run.new_page(), base + page_path)  # body only, like the variants
        check(body_structure not in variant_structures, f"production {page_path} renders a prototype variant")
        basis = "differs from every development variant"
    run.record["production"] = {"throwaway_absent": [throwaway, throwaway + "/"], "variant_names_tried": names,
                                "selection_parameters_tried": keys, "cookies_tried": keys,
                                "settle_ms": SETTLE_MS, "switcher": "absent", "real_page": basis}


def reference_page(run: Run, start: str, cwd: Path, page_path: str) -> dict:
    with Server(start, "production", cwd, run.out / "server-reference-production.log") as server:
        page = run.new_page()
        rendered, structure = run.visit(page, server.base + page_path, settle=True)
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
    if args.project and not (args.start and args.reference_project):
        parser.error("--project needs --start and --reference-project")
    args.out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    record: dict = {"chromium": CHROMIUM, "result": "FAIL: did not finish"}
    run = None
    try:
        if args.project:
            cwd, start = args.project.resolve(), args.start
            record["subject"] = {"project": str(cwd), "files": digest_tree(cwd)}
            record["reference"] = {"project": str(args.reference_project.resolve()),
                                   "files": digest_tree(args.reference_project.resolve())}
        else:
            cwd, start = REPO_ROOT, documented_example(args.out)
            head = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], capture_output=True, text=True)
            record["subject"] = {"ui.md sha256": hashlib.sha256(UI_REFERENCE.read_bytes()).hexdigest(),
                                 "repository HEAD": head.stdout.strip() or None}
        from playwright.sync_api import sync_playwright  # system Playwright, imported only here

        with sync_playwright() as playwright:
            # The renderer sandbox stays on: checked pages may come from model-written code.
            browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, timeout=LAUNCH_TIMEOUT_MS,
                                                 chromium_sandbox=True)
            record["browser_version"] = browser.version
            run = Run(browser, args.out, Deadline(SCENARIO_DEADLINE_S))
            try:
                reference = (reference_page(run, start, args.reference_project.resolve(), args.page)
                             if args.project else None)
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
