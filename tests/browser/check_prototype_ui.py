"""Real-browser evidence for the prototype skill's UI switcher and production exclusion (#258)
and for browser views of logic prototypes (#259, --logic).

Logic mode (#259, Python modules only): drives a browser view of a logic prototype by its
visible button or link names, and after each action requires the page to show the state
the project's own module computes when called directly (--module with initial(),
actions(state) and step(state, action); an action outside actions(state) is a refusal,
and any exception is a failure). The state is looked for in the page's #state element
when it has one, else in the whole page. At the start and after every action the page
must offer exactly the module's legal actions among all actions seen so far. It then
repeats the run on a copy whose module carries one change (--mutate): the page must
follow it. Choose a change inside step() rather than in a transition table, so a page
that copies the logic, or runs its own step() over a table the module exports, cannot
follow it; the default does that for references/logic.md's three-file example, which is
also what it checks by default.

Not a pytest module: it needs system Playwright and an installed Chromium, which the
repository's environment does not provide. Run it from the repository root under an
outer timeout, keeping the full output:

    set -o pipefail; timeout 600 /usr/bin/python3 tests/browser/check_prototype_ui.py \
        --out <evidence-dir> 2>&1 | tee <evidence-dir>/check.log

By default it checks the runnable example in skills/workflow/prototype/references/ui.md.
With --project it checks a project produced for the representative task instead,
started by --start (a command with {env} and {port} placeholders, run from the project
directory), against --reference-project, the untouched project whose production page it
must still render (started the same way from its own directory). Every server must print
its http://127.0.0.1:<port> address on stdout (banner lines before it are fine) within
the readiness deadline.

The switcher is found by the hooks ui.md declares: a `.prototype-bar` element listing
its variants in `data-variants`, `#prev-variant`, `#next-variant` and `#variant-label`.
A switch may navigate or update the page and its URL in place.

Development asks what the page shows, so hidden elements are ignored: variants differ
in visible structure (tags and text, ignoring attributes, case and whitespace); initial
and direct selection, next/previous, wrapping, a label that names the shown variant
without naming all of them, the keyboard focus guard and reload persistence are judged
on the visible page, not the URL or label alone. Animated transitions longer than the
switch settle time are not waited for.

Production asks what the page carries, hidden elements and template content included:
the throwaway route is absent; the real page, read after it settles, is the same for
every variant name seen in development and an unknown one, offered through the
selection parameter the switcher used, a few common parameter names and a cookie of
each of those names; no switcher appears; and the page carries what the reference
project carries, with the same scripts (differences only in styles are recorded as a
warning). The ui.md example, which has no reference, must instead differ from every
development variant. Other selection channels are not probed. Only owned loopback
servers are started, each in its own process group, and they are always stopped.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
UI_REFERENCE = REPO_ROOT / "skills/workflow/prototype/references/ui.md"
LOGIC_REFERENCE = REPO_ROOT / "skills/workflow/prototype/references/logic.md"
CHROMIUM = "/usr/bin/chromium"
LAUNCH_TIMEOUT_MS = 20_000
READY_TIMEOUT_S = 20
SCENARIO_DEADLINE_S = 300
OPERATION_TIMEOUT_MS = 15_000
SWITCH_SETTLE_MS = 300  # after a URL change, time for an in-place switch to finish drawing
SETTLE_MS = 1_500  # production: client-side changes later than this after load are not observed
FOCUS_GUARD_WAIT_MS = 3_000  # a switch later than this after the key press is not observed
UNKNOWN_VARIANT = "no-such-variant"
COMMON_SELECTION_PARAMS = ("variant", "layout", "design", "option", "prototype", "v")
ADDRESS = re.compile(r"http://(?:127\.0\.0\.1|localhost):\d+")
# The default change edits code inside step(), not the TRANSITIONS table, so a page that
# runs its own step() over a table exported by the module cannot follow it.
DEFAULT_MUTATION = ('{"status": TRANSITIONS[(state["status"], action)],'
                    '::{"status": "refund_hold" if (state["status"], action) == ("paid", "cancel")'
                    ' else TRANSITIONS[(state["status"], action)],')
# Development question, "what does the page show?": visible tags and text in document
# order, attributes ignored, text casefolded and whitespace collapsed; hidden elements
# (display, visibility, opacity), templates and the switcher left out.
VISIBLE = """() => {
  const norm = (text) => text.toLowerCase().replace(/\\s+/g, ' ').trim();
  const shown = (node) => node.checkVisibility({visibilityProperty: true, opacityProperty: true});
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return norm(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches('.prototype-bar, script, style, template') || !shown(node)) return '';
    const inner = Array.from(node.childNodes).map(walk).filter(Boolean).join(',');
    return node.tagName.toLowerCase() + '(' + inner + ')';
  };
  return walk(document.body);
}"""
# Production question, "what does the page carry?": every element, hidden or not,
# including template content, so prototype markup cannot hide in the real page.
CARRIED = """() => {
  const norm = (text) => text.toLowerCase().replace(/\\s+/g, ' ').trim();
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return norm(node.textContent);
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return Array.from(node.childNodes).map(walk).filter(Boolean).join(',');
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches('.prototype-bar, script, style')) return '';
    const kids = node.tagName === 'TEMPLATE' ? [node.content] : Array.from(node.childNodes);
    const inner = kids.map(walk).filter(Boolean).join(',');
    return node.tagName.toLowerCase() + '(' + inner + ')';
  };
  return walk(document.body);
}"""
ASSETS = """() => ({
  scripts: Array.from(document.scripts).map((s) => s.src || s.textContent.replace(/\\s+/g, ' ').trim()),
  styles: Array.from(document.querySelectorAll('style, link[rel=stylesheet]'))
    .map((s) => s.href || s.textContent.replace(/\\s+/g, ' ').trim()),
})"""


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
                                        start_new_session=True, env={**os.environ, **NO_BYTECODE})
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
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(self.process.pid, sig)
            except ProcessLookupError:
                break
            try:
                self.process.wait(timeout=10)
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
        self.record: dict = {"development": {}, "warnings": []}

    def new_page(self, context=None):
        page = (context or self.browser).new_page()
        page.set_default_timeout(OPERATION_TIMEOUT_MS)
        page.set_default_navigation_timeout(OPERATION_TIMEOUT_MS)
        self.pages.append(page)
        return page

    def visit(self, page, url: str, settle: bool = False, view: str = VISIBLE) -> str:
        self.deadline.check()
        page.goto(url)
        if settle:
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(SETTLE_MS)
        return page.evaluate(view)

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

    def named(name: str, text: str) -> bool:
        return re.search(rf"(?<![\w-]){re.escape(name.lower())}(?![\w-])", text.lower()) is not None

    def labelled(name: str, variants: list[str]) -> bool:  # names the shown one, not all of them
        text = page.text_content("#variant-label") or ""
        return named(name, text) and not all(named(v, text) for v in variants)

    def switch(action) -> str:
        """Run a control; it must change the URL, by navigation or in place. Returns what shows."""
        run.deadline.check()
        before = page.url
        action()
        page.wait_for_url(lambda url: url != before)
        page.wait_for_load_state("load")
        page.wait_for_timeout(SWITCH_SETTLE_MS)
        return page.evaluate(VISIBLE)

    selection_keys = set()
    for path in (page_path, throwaway):
        run.visit(page, base + path)
        check(page.locator(".prototype-bar").count() == 1, f"development {path}: no .prototype-bar switcher")
        variants = json.loads(page.get_attribute(".prototype-bar", "data-variants") or "[]")
        check(len(variants) >= 2 and all(isinstance(v, str) and v for v in variants),
              f"development {path}: data-variants lists {variants!r}")
        initial = run.visit(page, base + path)
        shown = {}
        for v in variants:
            shown[v] = run.visit(page, f"{base}{path}?variant={quote(v)}")
            check(labelled(v, variants), f"development {path}?variant={v}: the label does not name {v!r} alone")
        check(len(set(shown.values())) == len(variants),
              f"development {path}: variants do not differ in what they show (tags and text)")
        check(initial in shown.values(), f"development {path}: the initial page shows no variant")
        (run.out / f"visible-dev{path.replace('/', '_')}.json").write_text(json.dumps(shown, indent=2))
        first, second, last = variants[0], variants[1], variants[-1]

        run.visit(page, f"{base}{path}?variant={quote(first)}")
        check(switch(lambda: page.click("#next-variant")) == shown[second], f"{path}: next does not show {second!r}")
        keys = [k for k, values in parse_qs(urlsplit(page.url).query).items() if values == [second]]
        check(len(keys) == 1 and labelled(second, variants), f"{path}: URL/label disagree after next ({page.url})")
        selection_keys.add(keys[0])
        check(switch(lambda: page.click("#prev-variant")) == shown[first], f"{path}: previous does not show {first!r}")
        check(switch(lambda: page.click("#prev-variant")) == shown[last], f"{path}: previous from first does not wrap")
        check(switch(lambda: page.click("#next-variant")) == shown[first], f"{path}: next from last does not wrap")

        page.locator("body").click(position={"x": 1, "y": 1})
        check(switch(lambda: page.keyboard.press("ArrowRight")) == shown[second], f"{path}: ArrowRight does not switch")
        check(switch(lambda: page.keyboard.press("ArrowLeft")) == shown[first], f"{path}: ArrowLeft does not switch")
        page.evaluate("""() => { const i = document.createElement('input');
                                 i.id = 'focus-guard-probe'; document.body.prepend(i); i.focus(); }""")
        before, view_before = page.url, page.evaluate(VISIBLE)
        page.keyboard.press("ArrowRight")
        try:
            page.wait_for_url(lambda url: url != before, timeout=FOCUS_GUARD_WAIT_MS)
            switched = True
        except PlaywrightTimeout:  # no URL change in the wait; the view must be unchanged too
            switched = page.evaluate(VISIBLE) != view_before
        check(not switched and page.locator("#focus-guard-probe").count() == 1,
              f"{path}: ArrowRight in a focused input still switched")

        run.visit(page, f"{base}{path}?variant={quote(last)}")
        page.reload()
        page.wait_for_timeout(SWITCH_SETTLE_MS)
        check(page.evaluate(VISIBLE) == shown[last] and labelled(last, variants),
              f"{path}: reload lost the selection {last!r}")
        run.record["development"][path] = {"variants": variants, "visible": shown,
                                           "selection_parameter": keys[0], "checks": "passed"}
    run.record["selection_parameters"] = sorted(selection_keys)


def production(run: Run, base: str, page_path: str, throwaway: str, reference: dict | None) -> None:
    seen = [v for info in run.record["development"].values() for v in info["variants"]]
    check(bool(seen), "production: development recorded no variant names to try")
    names = list(dict.fromkeys(seen + [UNKNOWN_VARIANT]))
    used = run.record["selection_parameters"]
    keys = list(dict.fromkeys(used + list(COMMON_SELECTION_PARAMS)))
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
    carried = run.visit(page, base + page_path, settle=True, view=CARRIED)
    plain = page.evaluate(VISIBLE)
    assets = page.evaluate(ASSETS)
    (run.out / "dom-production.html").write_text(page.content(), encoding="utf-8")
    check(page.locator(".prototype-bar").count() == 0, f"production {page_path}: switcher rendered")
    for key in used:  # the page itself, after it settles, hidden markup included
        for name in names:
            check(run.visit(page, f"{base}{page_path}?{key}={quote(name)}", settle=True, view=CARRIED) == carried
                  and page.locator(".prototype-bar").count() == 0,
                  f"production {page_path}?{key}={name}: the settled page differs from the real page")
    context.close()
    if reference is not None:
        check(carried == reference["carried"],
              f"production {page_path} no longer carries what the untouched project carries (hidden markup included)")
        check(assets["scripts"] == reference["assets"]["scripts"],
              f"production {page_path} carries scripts the untouched project does not")
        if assets["styles"] != reference["assets"]["styles"]:
            run.record["warnings"].append(f"production {page_path} carries styles the untouched project does not")
        basis = "carries what the reference project carries, hidden markup and scripts included"
    else:
        variant_views = {view for info in run.record["development"].values() for view in info["visible"].values()}
        check(plain not in variant_views, f"production {page_path} shows a prototype variant")
        basis = "differs from every development variant"
    run.record["production"] = {"throwaway_absent": [throwaway, throwaway + "/"], "variant_names_tried": names,
                                "parameters_tried_as_query_and_cookie": keys, "settle_ms": SETTLE_MS,
                                "switcher": "absent", "real_page": basis}


def reference_page(run: Run, start: str, cwd: Path, page_path: str) -> dict:
    with Server(start, "production", cwd, run.out / "server-reference-production.log") as server:
        page = run.new_page()
        carried = run.visit(page, server.base + page_path, settle=True, view=CARRIED)
        assets = page.evaluate(ASSETS)
        (run.out / "dom-reference.html").write_text(page.content(), encoding="utf-8")
        page.close()
    (run.out / "reference.json").write_text(json.dumps({"carried": carried, "assets": assets}, indent=2))
    return {"carried": carried, "assets": assets}


def documented_logic_example(out: Path) -> Path:
    """logic.md's example files: python blocks whose first line names the file."""
    folder = out / "logic-example"
    folder.mkdir(parents=True, exist_ok=True)
    found = 0
    for block in re.findall(r"```python\n(.*?)\n```", LOGIC_REFERENCE.read_text(encoding="utf-8"), re.DOTALL):
        match = re.match(r"# (\S+\.py)\n", block)
        if match:
            (folder / match.group(1)).write_text(block + "\n", encoding="utf-8")
            found += 1
    check(found >= 2, "logic.md documents no named example files")
    return folder


NO_BYTECODE = {"PYTHONDONTWRITEBYTECODE": "1"}  # never leave __pycache__ in a checked project


def native_answer(folder: Path, module: str, actions: list[str]) -> dict | None:
    """What the project's own Python module computes for these actions, called directly:
    the state and the actions legal in it. None when an action is not among the module's
    actions(state); any exception or exit is a failure, so a broken module can never pass
    as a refusal."""
    script = (f"import json, sys\nimport {module} as m\nstate = m.initial()\n"
              "for a in sys.argv[1:]:\n    if a not in m.actions(state):\n"
              "        print(json.dumps({'refused': a}))\n        break\n    state = m.step(state, a)\n"
              "else:\n    print(json.dumps({'state': state, 'legal': sorted(m.actions(state))}))\n")
    result = subprocess.run([sys.executable, "-c", script, *actions], cwd=folder, capture_output=True,
                            text=True, timeout=30, env={**os.environ, **NO_BYTECODE})
    check(result.returncode == 0, f"native module {module} failed: {result.stderr.strip()[-300:]}")
    lines = result.stdout.strip().splitlines()
    try:
        answer = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        answer = None
    check(isinstance(answer, dict) and ("state" in answer or "refused" in answer),
          f"native module {module} gave no readable answer: {result.stdout.strip()[-200:]!r}")
    return None if "refused" in answer else answer


def native_state(folder: Path, module: str, actions: list[str]) -> dict | None:
    answer = native_answer(folder, module, actions)
    return None if answer is None else answer["state"]


def apply_mutation(source: Path, mutation: tuple[str, str]) -> None:
    """Change one transition in a copy of the module; a copy already changed is kept."""
    text = source.read_text(encoding="utf-8")
    if mutation[0] in text:
        check(text.count(mutation[0]) == 1, f"mutation text occurs more than once in {source.name}")
        text = text.replace(*mutation)
        source.write_text(text, encoding="utf-8")
    check(mutation[1] in text, f"{source.name} does not carry the mutation")


def logic(run: Run, folder: Path, start: str, module: str, actions: list[str], key: str, label: str,
          must_accept_all: bool) -> list[str]:
    """Drive a browser view of the logic by its visible action names; after each action the
    page must show the state the native module itself computes. Where the module refuses
    the next action, the page must not offer it, and the run stops there."""
    shown = []
    with Server(start, "logic", folder, run.out / f"server-logic-{label}.log") as server:
        page = run.new_page()
        run.visit(page, server.base + "/")

        def control(name: str):
            return page.get_by_role("button", name=name, exact=True).or_(page.get_by_role("link", name=name, exact=True))

        known = set(actions)  # every action seen so far: scripted, or legal in a visited state

        def offers_exactly(legal: list[str], done: list[str]) -> None:
            known.update(legal)
            for name in sorted(known):
                offered = control(name).count() > 0
                check(offered == (name in legal), f"logic {label}: after {done} the page "
                      f"{'offers' if offered else 'does not offer'} {name!r}; the module's legal actions are {legal}")

        offers_exactly(native_answer(folder, module, [])["legal"], [])
        for index, action in enumerate(actions):
            native = native_answer(folder, module, actions[:index + 1])
            if native is None:
                check(not must_accept_all, f"logic {label}: the module refuses {action!r} after {actions[:index]}")
                check(control(action).count() == 0,
                      f"logic {label}: the page offers {action!r}, which the module refuses after {actions[:index]}")
                shown.append(f"<{action} refused>")
                break
            control(action).first.click()
            page.wait_for_load_state("load")
            page.wait_for_timeout(SWITCH_SETTLE_MS)
            offers_exactly(native["legal"], actions[:index + 1])
            expected = str(native["state"][key])
            # Prefer the state the page declares (#state) when it has one; else the whole page.
            shown_text = page.inner_text("#state") if page.locator("#state").count() else page.inner_text("body")
            check(re.search(rf"(?<![\w-]){re.escape(expected)}(?![\w-])", shown_text) is not None,
                  f"logic {label}: after {actions[:index + 1]} the page does not show {key}={expected!r}")
            shown.append(expected)
        (run.out / f"dom-logic-{label}.html").write_text(page.content(), encoding="utf-8")
        page.close()
    return shown


def logic_scenario(run: Run, folder: Path, mutated: Path, start: str, module: str, actions: list[str],
                   key: str, mutation: tuple[str, str]) -> None:
    original = logic(run, folder, start, module, actions, key, "original", must_accept_all=True)
    apply_mutation(mutated / f"{module}.py", mutation)
    altered = logic(run, mutated, start, module, actions, key, "mutated", must_accept_all=False)
    check(altered != original, "the changed module did not change what the browser view shows")
    run.record["logic"] = {"actions": actions, "state_key": key, "shown": original,
                           "shown_after_module_change": altered, "mutation": list(mutation)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--project", type=Path, help="checked project directory (default: the documented example)")
    parser.add_argument("--start", help="start command with {env} and {port} placeholders")
    parser.add_argument("--reference-project", type=Path, help="untouched project the production page must match")
    parser.add_argument("--page", default="/settings")
    parser.add_argument("--throwaway", default="/prototype/settings")
    def mutation(value: str) -> tuple[str, str]:
        old, separator, new = value.partition("::")
        if not (separator and old and new):
            raise argparse.ArgumentTypeError("expected OLD::NEW with both parts non-empty")
        return old, new

    parser.add_argument("--logic", action="store_true",
                        help="check a browser view of a Python logic module instead of UI variants "
                             "(default: logic.md's example)")
    parser.add_argument("--module", default="orders_machine", help="logic: the native Python module (initial/step)")
    parser.add_argument("--actions", default="pay,cancel,refund", help="logic: comma-separated action names")
    parser.add_argument("--state-key", default="status", help="logic: the state field the page must show")
    parser.add_argument("--mutate", type=mutation,
                        default=DEFAULT_MUTATION,
                        help="logic: OLD::NEW change to the module that the page must follow")
    parser.add_argument("--mutated-project", type=Path,
                        help="logic: a copy of --project to change, reused if it exists "
                             "(default: a fresh copy under --out)")
    args = parser.parse_args()
    if args.project and not args.start:
        parser.error("--project needs --start")
    if args.project and not args.logic and not args.reference_project:
        parser.error("--project needs --reference-project")
    args.out.mkdir(parents=True, exist_ok=True)
    short_tmp = None
    if len(tempfile.gettempdir()) > 40:  # Chromium's socket path under TMPDIR must stay short
        short_tmp = tempfile.TemporaryDirectory(prefix="cpu-", dir="/tmp")
        os.environ["TMPDIR"] = tempfile.tempdir = short_tmp.name
    started = time.monotonic()
    record: dict = {"chromium": CHROMIUM, "result": "FAIL: did not finish"}
    run = None
    try:
        if args.logic:
            if args.project:
                cwd, start = args.project.resolve(), args.start
            else:
                cwd = documented_logic_example(args.out)
                start = f"{shlex.quote(sys.executable)} prototype_orders_web.py --port {{port}}"
            mutated = (args.mutated_project or args.out / "logic-mutated").resolve()
            check(mutated != cwd and cwd not in mutated.parents and mutated not in cwd.parents,
                  f"the changed module must live in a separate copy outside {cwd}, not {mutated}")
            check(args.mutated_project is not None or not mutated.exists(),
                  f"{mutated} already exists; use a fresh --out so an old changed copy is never checked")
            if not mutated.exists():
                out = args.out.resolve()

                def skip(directory: str, names: list[str]) -> set[str]:  # never copy the evidence into itself
                    return {n for n in names if n in ("__pycache__", ".git") or Path(directory, n).resolve() == out}

                shutil.copytree(cwd, mutated, ignore=skip)
            record["subject"] = {"project": str(cwd), "files": digest_tree(cwd)}
            if not args.project:  # only the documented example comes from the repository
                record["subject"]["logic.md sha256"] = hashlib.sha256(LOGIC_REFERENCE.read_bytes()).hexdigest()
        elif args.project:
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
                if args.logic:
                    run.record.pop("development")  # UI-mode field; logic mode records its own
                    logic_scenario(run, cwd, mutated, start, args.module, args.actions.split(","),
                                   args.state_key, args.mutate)
                else:
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
        if short_tmp is not None:
            short_tmp.cleanup()
    print(json.dumps({k: record[k] for k in ("result", "warnings", "seconds") if k in record}, indent=2))
    if record["result"] != "PASS":
        print(record["result"], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
