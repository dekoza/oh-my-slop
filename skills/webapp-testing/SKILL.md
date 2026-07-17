---
name: webapp-testing
description: >
  Use when browser-based evidence of a local web app's behavior is needed — reproducing a
  UI bug, demonstrating a flow, inspecting rendered DOM, or capturing screenshots, console
  logs, or video. Not for writing the project's E2E test suite (see testing-workflow).
  Triggers on: "reproduce this in the browser", "screenshot", "record a video",
  "check what actually renders", "browser console".
license: Complete terms in LICENSE.txt
---

# Web Application Testing

Write small, task-specific Python Playwright scripts that produce **browser evidence**:
assertions on rendered state first, screenshots/logs/video as supporting artifacts.
This skill is the evidence tool — the project's E2E *suite* (tiers, Docker env, when E2E
runs) is owned by the `testing-workflow` skill; a script written here can graduate into
that suite, but suite rules live there.

## Core workflow

Every run follows the same spine — **the assertion step is not optional**; a script that
only looks and screenshots proves nothing:

1. **Target** — static HTML file or running app? Server already running, or start one via
   the helper?
2. **Recon** — navigate, wait for rendered state, inspect the actual DOM, choose selectors
   from what's really there.
3. **Interact** — drive the requested flow.
4. **Assert** — verify the expected state in code (`assert`), not by eyeballing a
   screenshot.
5. **Evidence** — capture what the user needs: logs, screenshots, video (appendix), and
   report observed result + artifact paths.
6. **Teardown** — `context.close()` then `browser.close()`, so artifacts are fully written.

### Script template (copy, then adapt)

```python
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    )
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    console_msgs = []
    page.on("console", lambda m: console_msgs.append(f"[{m.type}] {m.text}"))

    # 1-2. Navigate + recon
    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")

    # 3. Interact
    page.get_by_role("button", name="Create task").click()
    page.locator("input[name='title']").wait_for(state="visible", timeout=8000)
    page.locator("input[name='title']").fill("Buy milk")
    page.get_by_role("button", name="Save").click()

    # 4. Assert — the point of the whole script
    expect(page.locator(".task-list")).to_contain_text("Buy milk")
    js_errors = [m for m in console_msgs if m.startswith("[error]")]
    assert not js_errors, f"Console errors: {js_errors}"

    # 5. Evidence
    page.screenshot(path="/tmp/webapp-testing/after-create.png", full_page=True)

    # 6. Teardown
    context.close()
    browser.close()

print("PASS — screenshot at /tmp/webapp-testing/after-create.png")
```

## Helper scripts

- `scripts/with_server.py` — starts one or more local servers, waits for readiness, runs
  your automation, cleans up. Server errors are echoed to the console (prefixed
  `[server N]`), so a failed startup is visible, not silent.

**Always run helper scripts with `--help` first.** Treat bundled scripts as black boxes
unless the task genuinely requires customization.

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers:**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

Keep server lifecycle in the helper and only browser logic in your script. If the user
already has a server running, use their URL — do not start a duplicate.

## Reconnaissance-then-action

On dynamic apps, do not guess selectors from source alone.

1. Navigate to the page.
2. Wait for `page.wait_for_load_state("networkidle")`.
3. Inspect rendered state with one or more of:
   ```python
   page.screenshot(path="/tmp/webapp-testing/inspect.png", full_page=True)
   page.content()
   page.locator("button").all()
   ```
4. Pick selectors from rendered output — prefer `get_by_role(...)`, `text=...`, stable IDs.
5. Perform the requested actions, with explicit waits for state changes
   (`wait_for_selector()`, locator `.wait_for()`, URL assertions).

## Core pattern: waiting for HTMX/JS swaps

`networkidle` does **not** wait for HTMX content swaps or JS-driven re-renders — it fires
when the network is quiet, which can be before the swapped element exists. Wait for the
**real target state**:

```python
# ❌ networkidle may fire before the swapped element exists:
page.locator("button[hx-post]").click()
page.wait_for_load_state("networkidle")
page.locator("input[name='opening_float']").fill("500")

# ✅ wait for the element the swap produces:
page.locator("button[hx-post]").click()
page.locator("input[name='opening_float']").wait_for(state="visible", timeout=8000)
page.locator("input[name='opening_float']").fill("500")
```

The same rule covers fixed sleeps: `wait_for_timeout(500)` is a race condition with
slower machines — wait for the state, not the clock.

## Pitfalls → correct pattern

| ❌ Pitfall | ✅ Instead |
|-----------|-----------|
| Inspecting the DOM before the rendered state settles | Recon after `networkidle` + element-level waits |
| Starting a second dev server when one is already running | Use the supplied URL |
| Screenshot-only "verification" | Assert on DOM state; screenshot is supporting evidence |
| `wait_for_timeout(...)` for content to "probably" load | Wait for the specific selector/state |
| Enabling video after the page exists | Configure recording on the context first (appendix) |
| Skipping `context.close()` | Close context before browser — artifacts finalize on close |

## Playwright Python (sync) API gotchas

### Triple-click to select all text
```python
# ❌ Wrong — triple_click() does not exist on Locator:
locator.triple_click()

# ✅ Correct:
locator.click(click_count=3)
```

### Reading data attributes
```python
basket_id = page.locator("[data-basket-id]").first.get_attribute("data-basket-id")
text = page.locator("button").first.inner_text()
```

### Typing text sequentially
```python
# ❌ Deprecated:
locator.type("text", delay=80)

# ✅ Current:
locator.press_sequentially("text", delay=80)
```

## Debugging Content Security Policy (CSP) violations

### Common CSP error patterns

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `Applying inline style violates... 'style-src'` | Element has `style="..."` attribute | Add `'unsafe-inline'` to `style-src` (replace entire directive) |
| `Executing inline script violates... 'script-src'` | `<script>...</script>` without hash/nonce | Add `'unsafe-inline'` to `script-src` (replace entire directive) |
| `Loading the image 'https://...' violates... 'img-src'` | External image domain not allowed | Add domain to `img-src` |
| `Loading the stylesheet 'https://...' violates... 'style-src'` | External CSS not allowed | Add CDN domain to `style-src` |
| `'unsafe-inline' is ignored if either a hash or nonce value is present` | Hash/nonce present alongside `'unsafe-inline'` | **Replace** entire directive, don't append |

### Capturing CSP violations

```python
console_messages = []
page.on("console", lambda msg: console_messages.append(f"[{msg.type}] {msg.text}"))

# Filter for CSP violations after the run
csp_errors = [m for m in console_messages if "Content Security Policy" in m]
```

### Standard test CSP relaxations (django-csp)

```python
# In test settings (settings_test.py):
if CONTENT_SECURITY_POLICY:
    # Inline styles (Leaflet, Chart.js, etc.)
    CONTENT_SECURITY_POLICY["DIRECTIVES"]["style-src"] = (
        "'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com"
    )
    # Inline scripts (config injection, analytics)
    CONTENT_SECURITY_POLICY["DIRECTIVES"]["script-src"] = (
        "'self'", "'unsafe-inline'", "'unsafe-eval'",
        "https://unpkg.com", "https://cdn.jsdelivr.net"
    )
    # Map tiles, external images
    CONTENT_SECURITY_POLICY["DIRECTIVES"]["img-src"] = (
        "'self'", "data:", "https://*.tile.openstreetmap.org"
    )
```

**Key rule**: When adding `'unsafe-inline'`, **replace the entire directive tuple**.
Appending it alongside hashes makes CSP ignore `'unsafe-inline'` entirely.

## Examples

- `examples/element_discovery.py` — inspect buttons, links, and inputs on a page
- `examples/static_html_automation.py` — automate a local `file://` HTML target
- `examples/console_logging.py` — capture console logs during automation
- `examples/video_recording.py` — record and name a browser-video artifact with an
  orange-dot pointer overlay, click ripple effect, and human-paced smooth pointer movement

## Appendix: video recording

Video is the **rare** case. Record only when at least one of these is true:

- The user explicitly asks for a recording, walkthrough, demo, or repro artifact.
- The bug is transient or timing-sensitive: toasts, redirects, modal flashes, race
  conditions, focus loss, animation issues.
- The flow is multi-step and screenshots would hide how the state changed over time.

For everything else, assertions + a screenshot are the lighter default. **Video
supplements logs, assertions, and written findings — it never replaces them.**

### Recording pattern

Use Playwright's built-in context recording; keep Chromium headless.

```python
from pathlib import Path
from playwright.sync_api import sync_playwright

artifact_dir = Path("/tmp/webapp-testing")
artifact_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    )
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        record_video_dir=str(artifact_dir / "raw-videos"),
        record_video_size={"width": 1440, "height": 900},
    )
    page = context.new_page()
    video = page.video  # capture the handle early if you plan to rename

    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    # ... interaction ...

    final_video_path = artifact_dir / "login-repro.webm"
    if video is not None:
        video.save_as(final_video_path)

    context.close()
    browser.close()

print(f"Video saved to: {final_video_path}")
```

### Artifact rules

- Configure `record_video_dir`/`record_video_size` on `browser.new_context(...)`, not on
  the page; one fresh context per recorded flow.
- `context.close()` is mandatory — the video finalizes only when the context closes.
- Call `video.save_as(...)` when the filename matters, and always report the saved path.

### Human-facing recordings

For demos and walkthroughs (not raw debugging): inject a lightweight overlay showing the
pointer as an **orange dot** with a click **ripple effect** (non-interactive:
`pointer-events: none`); move at the **pace of a human** — short pauses around key state
changes, smooth stepped motion via `page.mouse.move(..., steps=...)`, no teleporting
between targets. See `examples/video_recording.py` for the full pattern.
