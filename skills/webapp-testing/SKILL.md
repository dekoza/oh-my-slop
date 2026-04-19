---
name: webapp-testing
description: Use when testing, debugging, reproducing, or demonstrating a local web application with Playwright, especially when the user needs browser logs, screenshots, or a recorded video of the UI flow.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

Write native Python Playwright scripts for local webapp testing. Prefer small, task-specific scripts over framework-heavy test harnesses unless the project already has one.

## Helper Scripts Available

- `scripts/with_server.py` — manages one or more local servers for the duration of the automation run

**Always run helper scripts with `--help` first.** Treat bundled scripts as black boxes unless the task genuinely requires customization.

## Core workflow

1. Decide whether the target is a static HTML file or a running web application.
2. Decide what evidence the user actually needs: DOM assertions, logs, screenshots, or a recorded video.
3. If video is needed, configure recording on the browser context **before** creating the page.
4. Navigate, wait for the rendered state to settle, inspect the actual DOM, then choose selectors.
5. Execute the requested flow and report both the observed UI result and browser-side evidence.
6. Close the browser context cleanly so artifacts such as videos are fully written.

## Decision tree

```text
User task → Static HTML file or dynamic webapp?
    ├─ Static HTML
    │   ├─ Read the file directly to identify likely structure
    │   ├─ Open it with Playwright and verify the rendered DOM
    │   └─ Use screenshots/video only if the user asked or the behavior is visual
    │
    └─ Dynamic webapp
        ├─ Server already running?
        │   ├─ Yes → use the supplied URL; do not start a duplicate server
        │   └─ No → run `python scripts/with_server.py --help`, then use the helper
        │
        └─ Need a visual artifact?
            ├─ Yes → enable Playwright video recording before `context.new_page()`
            └─ No → use screenshots/logs/assertions as the lighter default
```

## Starting local servers

Run `--help` first, then use the helper.

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

Your Playwright script should contain only browser automation logic; server lifecycle is handled by the helper.

## Reconnaissance-then-action

On dynamic apps, do not guess selectors from source alone.

1. Navigate to the page.
2. Wait for `page.wait_for_load_state("networkidle")`.
3. Inspect rendered state with one or more of:
   ```python
   page.screenshot(path="/tmp/inspect.png", full_page=True)
   page.content()
   page.locator("button").all()
   ```
4. Pick selectors from rendered output.
5. Perform the requested actions.
6. Capture logs, screenshots, or video artifacts as needed.

## When to record video

Record video when at least one of these is true:

- The user explicitly asks for a recording, walkthrough, demo, or repro artifact.
- The bug is transient or timing-sensitive: toasts, redirects, modal flashes, race conditions, focus loss, animation issues.
- The flow is multi-step and screenshots would hide how the state changed over time.
- The task is a user-facing walkthrough and the visual path matters.

Do **not** default to video for every task. For trivial static checks, one screenshot plus assertions is usually enough.

**Video supplements logs, assertions, and written findings. It does not replace them.**

## Preferred video recording pattern

Use Playwright's built-in context recording. Keep Chromium headless.

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
    video = page.video

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

## Video artifact rules

- Configure `record_video_dir` and `record_video_size` on `browser.new_context(...)`, not on the page.
- If you want one video per tested flow, use **one fresh browser context** and one page for that flow.
- Capture the `video = page.video` handle early if you plan to rename or move the artifact.
- `context.close()` is mandatory. The video is finalized only when the browser context closes.
- If the final filename matters, call `video.save_as(...)` and report the saved path explicitly.
- Always tell the user where the video file was saved.

## Common pitfalls

❌ Inspecting the DOM before waiting for the rendered state on dynamic apps.

❌ Starting a second dev server when the user already gave you a running one.

❌ Enabling video after the page already exists. Recording must be configured on the context first.

❌ Forgetting `context.close()`. That loses or truncates video artifacts.

## Best practices

- Use `sync_playwright()` for simple synchronous scripts.
- Always close the browser context before `browser.close()` when artifacts are involved.
- Use descriptive selectors: `get_by_role(...)`, `text=...`, CSS selectors, or stable IDs.
- Prefer explicit waits for state changes: `wait_for_selector()`, locator `.wait_for()`, or URL assertions.
- For HTMX or JS swaps, wait for the swapped target to appear instead of assuming `networkidle` is enough.
- Keep the automation script self-contained and report artifact paths clearly.

## Playwright Python (sync) API gotchas

### Triple-click to select all text
```python
# ❌ Wrong — triple_click() does not exist on Locator:
locator.triple_click()

# ✅ Correct:
locator.click(click_count=3)
```

### Waiting for HTMX swaps
`page.wait_for_load_state("networkidle")` does **not** wait for HTMX content swaps.

```python
# ❌ Wrong — networkidle may fire before the swapped element exists:
page.locator("button[hx-post]").click()
page.wait_for_load_state("networkidle")
page.locator("input[name='opening_float']").fill("500")

# ✅ Correct — wait for the real target state:
page.locator("button[hx-post]").click()
page.locator("input[name='opening_float']").wait_for(state="visible", timeout=8000)
page.locator("input[name='opening_float']").fill("500")
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

## Examples

- `examples/element_discovery.py` — inspect buttons, links, and inputs on a page
- `examples/static_html_automation.py` — automate a local `file://` HTML target
- `examples/console_logging.py` — capture console logs during automation
- `examples/video_recording.py` — record and name a browser-video artifact for a test run
