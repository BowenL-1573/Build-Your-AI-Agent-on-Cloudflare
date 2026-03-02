"""Fetch URL → Markdown. Jina Reader first (better quality), httpx+html2text fallback."""
import sys, httpx, html2text

url = sys.argv[1]
max_len = int(sys.argv[2]) if len(sys.argv) > 2 else 8000

JINA_KEY = "jina_73dbdc23f2244a4bbbc2b29ff5b0a54efQvycXRL2_HYGnYxRYjVEpKYOH4_"

# Try Jina Reader first — handles JS rendering + anti-bot
try:
    r = httpx.get(
        f"https://r.jina.ai/{url}",
        headers={"Accept": "text/markdown", "X-No-Cache": "true", "Authorization": f"Bearer {JINA_KEY}"},
        timeout=20,
    )
    text = r.text.strip()
    if len(text) > 100:
        print(text[:max_len])
        sys.exit(0)
except Exception:
    pass

# Fallback: httpx + html2text
try:
    r2 = httpx.get(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }, follow_redirects=True, timeout=15)
    r2.raise_for_status()
    h = html2text.HTML2Text()
    h.ignore_links = False; h.ignore_images = True; h.body_width = 0
    md = h.handle(r2.text)
    if len(md.strip()) > 100:
        print(md[:max_len])
        sys.exit(0)
except Exception:
    pass

print(f"Both fetch methods failed for {url}", file=sys.stderr)
sys.exit(1)
