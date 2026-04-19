from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACT_DIR = Path("/tmp/webapp-testing-example")
VIDEO_DIR = ARTIFACT_DIR / "raw-videos"
FINAL_VIDEO_PATH = ARTIFACT_DIR / "homepage-walkthrough.webm"


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
        page = context.new_page()
        video = page.video

        page.goto("http://localhost:5173")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(ARTIFACT_DIR / "homepage.png"), full_page=True)

        if video is not None:
            video.save_as(FINAL_VIDEO_PATH)

        context.close()
        browser.close()

    print(f"Video saved to: {FINAL_VIDEO_PATH}")


if __name__ == "__main__":
    main()
