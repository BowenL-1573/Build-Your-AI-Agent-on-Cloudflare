#!/usr/bin/env python3
"""Browser tool. Usage:
  python3 browse.py navigate <url> <screenshot_path>
  python3 browse.py click <selector> <screenshot_path>
  python3 browse.py type <selector> <text> <screenshot_path>
  python3 browse.py screenshot '' <screenshot_path>
"""
import sys, json, os

# Persist page state via saved cookies + URL
STATE_FILE = "/tmp/browser_state.json"

def save_state(page):
    state = {"url": page.url, "cookies": page.context.cookies()}
    open(STATE_FILE, "w").write(json.dumps(state))

def load_state(context, page):
    if not os.path.exists(STATE_FILE): return None
    state = json.loads(open(STATE_FILE).read())
    if state.get("cookies"): context.add_cookies(state["cookies"])
    if state.get("url"): page.goto(state["url"], wait_until="domcontentloaded", timeout=15000)
    return state

def run(action, args):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()

        if action == "navigate":
            url, ss_path = args[0], args[1]
            page.goto(url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(1000)
            title = page.title()
            text = page.inner_text("body")[:15000]
            page.screenshot(path=ss_path, full_page=False)
            save_state(page)
            print(json.dumps({"title": title, "url": url, "text": text}, ensure_ascii=False))

        elif action == "click":
            selector, ss_path = args[0], args[1]
            load_state(ctx, page)
            page.click(selector, timeout=5000)
            page.wait_for_timeout(500)
            page.screenshot(path=ss_path, full_page=False)
            text = page.inner_text("body")[:5000]
            save_state(page)
            print(json.dumps({"text": text}, ensure_ascii=False))

        elif action == "type":
            selector, text_val, ss_path = args[0], args[1], args[2]
            load_state(ctx, page)
            page.fill(selector, text_val, timeout=5000)
            page.wait_for_timeout(300)
            page.screenshot(path=ss_path, full_page=False)
            text = page.inner_text("body")[:5000]
            save_state(page)
            print(json.dumps({"text": text}, ensure_ascii=False))

        elif action == "screenshot":
            ss_path = args[1]
            load_state(ctx, page)
            page.screenshot(path=ss_path, full_page=False)
            print(json.dumps({"text": "screenshot taken"}, ensure_ascii=False))

        browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 3: print(json.dumps({"error": "usage: browse.py <action> <args...>"})); sys.exit(1)
    run(sys.argv[1], sys.argv[2:])
