#!/usr/bin/env python3
"""Extract by CSS selector. Usage: python extract.py '<json_params>'"""
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
    params = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(extract(params["url"], params["selector"]), ensure_ascii=False))
