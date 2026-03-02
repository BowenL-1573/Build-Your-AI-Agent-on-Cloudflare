#!/usr/bin/env python3
"""Extract by CSS selector. Usage: python3 extract.py <url> <selector>"""
import sys, json
from playwright.sync_api import sync_playwright

def extract(url, selector):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(500)
        title = page.title()
        items = []
        for el in page.query_selector_all(selector)[:50]:
            text = el.inner_text().strip()
            href = el.get_attribute("href") or ""
            if text: items.append({"text": text, "href": href} if href else {"text": text})
        browser.close()
    return {"title": title, "url": url, "items": items}

if __name__ == "__main__":
    if len(sys.argv) < 3: print(json.dumps({"error": "usage: extract.py <url> <selector>"})); sys.exit(1)
    print(json.dumps(extract(sys.argv[1], sys.argv[2]), ensure_ascii=False))
