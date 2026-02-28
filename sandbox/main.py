import os
import io
import time
import urllib.parse
from contextlib import asynccontextmanager

import boto3
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from playwright.async_api import async_playwright

R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "")
R2_ACCESS_KEY = os.environ.get("R2_ACCESS_KEY", "")
R2_SECRET_KEY = os.environ.get("R2_SECRET_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "")
WORKER_URL = os.environ.get("WORKER_URL", "https://api.agents.cloudc.top")

playwright_instance = None
browser = None

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global playwright_instance, browser
    playwright_instance = await async_playwright().start()
    browser = await playwright_instance.chromium.launch(
        args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    )
    yield
    await browser.close()
    await playwright_instance.stop()


app = FastAPI(lifespan=lifespan)


class ExecuteRequest(BaseModel):
    url: str
    task_id: str = "default"
    username: str = "anonymous"
    take_screenshot: bool = False


class ExtractRequest(BaseModel):
    url: str
    selector: str
    task_id: str = "default"
    username: str = "anonymous"
    take_screenshot: bool = False


class SearchRequest(BaseModel):
    query: str
    task_id: str = "default"
    username: str = "anonymous"
    take_screenshot: bool = False


class FetchRequest(BaseModel):
    url: str
    max_length: int = 8000


class ExecRequest(BaseModel):
    command: str
    timeout: int = 15


def upload_to_r2(data: bytes, key: str) -> str:
    s3 = boto3.client("s3", endpoint_url=R2_ENDPOINT, aws_access_key_id=R2_ACCESS_KEY,
                       aws_secret_access_key=R2_SECRET_KEY, region_name="auto")
    s3.upload_fileobj(io.BytesIO(data), R2_BUCKET, key, ExtraArgs={"ContentType": "image/png"})
    return f"{WORKER_URL}/api/r2/{key}"


async def _open_page(url: str):
    ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, user_agent=UA)
    page = await ctx.new_page()
    await page.goto(url, timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)
    return ctx, page


async def _maybe_screenshot(page, req, suffix=""):
    if not getattr(req, 'take_screenshot', False) or not R2_ENDPOINT:
        return ""
    screenshot = await page.screenshot(type="png")
    return upload_to_r2(screenshot, f"{req.username}/{req.task_id}/{int(time.time())}{suffix}.png")


@app.post("/execute")
async def execute(req: ExecuteRequest):
    ctx, page = await _open_page(req.url)
    try:
        title = await page.title()
        text = (await page.inner_text("body"))[:5000]
        screenshot_url = await _maybe_screenshot(page, req)
        return {"text": text, "screenshot_url": screenshot_url,
                "metadata": {"title": title, "url": page.url, "timestamp": int(time.time())}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await ctx.close()


@app.post("/extract")
async def extract(req: ExtractRequest):
    ctx, page = await _open_page(req.url)
    try:
        title = await page.title()
        elements = await page.query_selector_all(req.selector)
        texts = []
        for el in elements[:50]:  # cap at 50 elements
            t = await el.inner_text()
            if t.strip():
                texts.append(t.strip())
        text = "\n".join(texts)[:5000]
        screenshot_url = await _maybe_screenshot(page, req)
        return {"text": text, "screenshot_url": screenshot_url,
                "metadata": {"title": title, "url": page.url, "selector": req.selector,
                             "matched_count": len(elements), "timestamp": int(time.time())}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await ctx.close()


@app.post("/search")
async def search(req: SearchRequest):
    q = urllib.parse.quote_plus(req.query)
    url = f"https://search.brave.com/search?q={q}"
    ctx, page = await _open_page(url)
    try:
        screenshot_url = await _maybe_screenshot(page, req, "_search")
        results = []
        items = await page.query_selector_all("#results .snippet")
        for item in items[:10]:
            try:
                title_el = await item.query_selector("a .title")
                if not title_el:
                    title_el = await item.query_selector("a")
                link_el = await item.query_selector("a[href]")
                snippet_el = await item.query_selector(".snippet-description")
                title_text = (await title_el.inner_text()).strip() if title_el else ""
                href = await link_el.get_attribute("href") if link_el else ""
                snippet = (await snippet_el.inner_text()).strip() if snippet_el else ""
                if title_text and href and href.startswith("http"):
                    results.append({"title": title_text, "url": href, "snippet": snippet[:200]})
            except:
                continue
        text = "\n".join(f"{i+1}. {r['title']}\n   {r['url']}\n   {r['snippet']}" for i, r in enumerate(results))
        return {"text": text or "No results found", "screenshot_url": screenshot_url,
                "results": results,
                "metadata": {"query": req.query, "result_count": len(results), "timestamp": int(time.time())}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await ctx.close()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/fetch")
async def fetch_url(req: FetchRequest):
    import httpx
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(req.url, headers={"User-Agent": UA})
            text = resp.text[:req.max_length]
            return {"text": text, "metadata": {"url": str(resp.url), "status": resp.status_code,
                    "content_type": resp.headers.get("content-type", ""), "timestamp": int(time.time())}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/exec")
async def exec_command(req: ExecRequest):
    import asyncio
    try:
        proc = await asyncio.create_subprocess_shell(
            req.command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd="/tmp"
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=req.timeout)
        return {
            "text": (stdout.decode()[:8000] if stdout else "") + (("\n[stderr]\n" + stderr.decode()[:2000]) if stderr else ""),
            "metadata": {"exit_code": proc.returncode, "command": req.command, "timestamp": int(time.time())}
        }
    except asyncio.TimeoutError:
        proc.kill()
        return {"text": f"Command timed out after {req.timeout}s", "metadata": {"exit_code": -1, "command": req.command}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
