#!/usr/bin/env python3
"""Debug: dump Google search page HTML structure"""
import sys, json
from playwright.sync_api import sync_playwright

q = " ".join(sys.argv[1:]) or "test"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page()
    page.goto(f"https://www.google.com/search?q={q}&hl=en", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(2000)
    # Check for consent
    consent = page.query_selector("form[action*='consent']")
    print(f"CONSENT_FORM: {bool(consent)}")
    print(f"TITLE: {page.title()}")
    print(f"URL: {page.url}")
    # Dump first 3000 chars of body
    html = page.content()[:3000]
    print(f"HTML_SNIPPET: {html}")
    # Check what divs exist
    divs_g = len(page.query_selector_all("div.g"))
    divs_mnr = len(page.query_selector_all("div.MjjYud"))
    divs_tF2 = len(page.query_selector_all("div.tF2Cxc"))
    print(f"div.g={divs_g}, div.MjjYud={divs_mnr}, div.tF2Cxc={divs_tF2}")
    browser.close()
