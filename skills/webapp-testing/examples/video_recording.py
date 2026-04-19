from pathlib import Path

from playwright.sync_api import BrowserContext, Locator, Page, sync_playwright


ARTIFACT_DIR = Path("/tmp/webapp-testing-example")
VIDEO_DIR = ARTIFACT_DIR / "raw-videos"
FINAL_VIDEO_PATH = ARTIFACT_DIR / "homepage-walkthrough.webm"
ORANGE_POINTER_COLOR = "#ff8c00"
POINTER_OVERLAY_SCRIPT = f"""
(() => {{
  const setup = () => {{
    if (window.__videoPointerOverlayInstalled) {{
      return;
    }}
    window.__videoPointerOverlayInstalled = true;

    const pointer = document.createElement('div');
    pointer.setAttribute('data-video-pointer', 'true');
    Object.assign(pointer.style, {{
      position: 'fixed',
      width: '14px',
      height: '14px',
      borderRadius: '9999px',
      background: '{ORANGE_POINTER_COLOR}',
      border: '2px solid rgba(255, 255, 255, 0.95)',
      boxShadow: '0 0 0 2px rgba(255, 140, 0, 0.35)',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      left: '-100px',
      top: '-100px',
      transition: 'left 20ms linear, top 20ms linear',
    }});
    document.documentElement.appendChild(pointer);

    const movePointer = (event) => {{
      pointer.style.left = `${{event.clientX}}px`;
      pointer.style.top = `${{event.clientY}}px`;
    }};

    const showRipple = (event) => {{
      const ripple = document.createElement('div');
      Object.assign(ripple.style, {{
        position: 'fixed',
        width: '18px',
        height: '18px',
        borderRadius: '9999px',
        border: '3px solid rgba(255, 140, 0, 0.9)',
        background: 'rgba(255, 140, 0, 0.18)',
        transform: 'translate(-50%, -50%) scale(0.2)',
        transformOrigin: 'center',
        pointerEvents: 'none',
        zIndex: '2147483647',
        left: `${{event.clientX}}px`,
        top: `${{event.clientY}}px`,
        opacity: '1',
        transition: 'transform 320ms ease-out, opacity 320ms ease-out',
      }});
      document.documentElement.appendChild(ripple);
      requestAnimationFrame(() => {{
        ripple.style.transform = 'translate(-50%, -50%) scale(2.8)';
        ripple.style.opacity = '0';
      }});
      window.setTimeout(() => ripple.remove(), 360);
    }};

    window.addEventListener('mousemove', movePointer, true);
    window.addEventListener('click', showRipple, true);
  }};

  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', setup, {{ once: true }});
  }} else {{
    setup();
  }}
}})();
"""


def install_video_pointer_overlay(context: BrowserContext) -> None:
    context.add_init_script(POINTER_OVERLAY_SCRIPT)


def move_pointer_smoothly(page: Page, x: float, y: float) -> None:
    page.mouse.move(x, y, steps=24)


def present_click(page: Page, locator: Locator) -> None:
    box = locator.bounding_box()
    if box is None:
        raise RuntimeError("Cannot present-click a locator without a visible bounding box.")

    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    move_pointer_smoothly(page, x, y)
    page.wait_for_timeout(180)
    page.mouse.click(x, y)
    page.wait_for_timeout(220)


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(VIDEO_DIR),
            record_video_size={"width": 1440, "height": 900},
        )
        install_video_pointer_overlay(context)

        page = context.new_page()
        video = page.video

        page.goto("http://localhost:5173")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(400)

        first_link = page.locator("a, button").first
        present_click(page, first_link)

        page.wait_for_timeout(400)
        page.screenshot(path=str(ARTIFACT_DIR / "homepage.png"), full_page=True)

        if video is not None:
            video.save_as(FINAL_VIDEO_PATH)

        context.close()
        browser.close()

    print(f"Video saved to: {FINAL_VIDEO_PATH}")


if __name__ == "__main__":
    main()
