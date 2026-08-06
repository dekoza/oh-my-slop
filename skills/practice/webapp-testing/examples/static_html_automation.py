from pathlib import Path

from playwright.sync_api import expect, sync_playwright
import os

# Example: Automating interaction with static HTML files using file:// URLs

html_file_path = os.path.abspath('path/to/your/file.html')
file_url = f'file://{html_file_path}'

artifact_dir = Path('/tmp/webapp-testing')
artifact_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})

    # Navigate to local HTML file
    page.goto(file_url)

    # Take screenshot
    page.screenshot(path=str(artifact_dir / 'static_page.png'), full_page=True)

    # Interact with elements
    page.click('text=Click Me')
    page.fill('#name', 'John Doe')
    page.fill('#email', 'john@example.com')

    # Submit form, then wait for the resulting state — not the clock
    page.click('button[type="submit"]')
    page.locator('.success-message').wait_for(state='visible', timeout=5000)

    # Assert on the outcome before capturing evidence
    expect(page.locator('.success-message')).to_contain_text('Thank you')

    # Take final screenshot
    page.screenshot(path=str(artifact_dir / 'after_submit.png'), full_page=True)

    browser.close()

print(f"Static HTML automation completed! Screenshots in {artifact_dir}")
