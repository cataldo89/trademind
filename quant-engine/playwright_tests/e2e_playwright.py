from playwright.sync_api import sync_playwright
import time

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto("http://127.0.0.1:8000/docs")
        time.sleep(2)
        content = page.content()
        if "Quant Engine" in content:
            print("E2E OK: docs page loaded and contains 'Quant Engine'")
        else:
            print("E2E FAIL: docs page did not contain expected text")
            raise AssertionError("Docs page content mismatch")
        browser.close()

if __name__ == '__main__':
    main()
