#!/usr/bin/env python3
"""Google search via Serper API."""
import sys, json, os
import httpx

def search(query):
    key = os.environ.get("SERPER_API_KEY", "")
    if not key:
        return [{"title": "Error", "url": "", "snippet": "SERPER_API_KEY not set"}]
    r = httpx.post("https://google.serper.dev/search",
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
        json={"q": query, "num": 10}, timeout=10)
    data = r.json()
    return [{"title": i["title"], "url": i["link"], "snippet": i.get("snippet", "")[:200]}
            for i in data.get("organic", [])]

if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else ""
    if not q: print(json.dumps({"error": "no query"})); sys.exit(1)
    print(json.dumps(search(q), ensure_ascii=False))
