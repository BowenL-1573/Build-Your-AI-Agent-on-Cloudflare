import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";

interface Env {
  BROWSER: BrowserWorker;
}

async function withBrowser<T>(env: Env, fn: (page: any) => Promise<T>): Promise<T> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// --- /search ---
async function handleSearch(query: string, env: Env): Promise<Response> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
  const results = await withBrowser(env, async (page) => {
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 15000 });
    return page.evaluate(() => {
      const items: { title: string; url: string; snippet: string }[] = [];
      document.querySelectorAll("div.g").forEach((el: any) => {
        const a = el.querySelector("a[href]");
        const h3 = el.querySelector("h3");
        const snip = el.querySelector("[data-sncf], .VwiC3b, .st");
        if (a && h3) {
          items.push({
            title: h3.innerText || "",
            url: a.href || "",
            snippet: snip?.innerText || "",
          });
        }
      });
      return items;
    });
  });

  return Response.json({ query, results: results.slice(0, 8), metadata: { source: "google", url: searchUrl } });
}

// --- /navigate ---
async function handleNavigate(url: string, env: Env, needScreenshot: boolean): Promise<Response> {
  const result = await withBrowser(env, async (page) => {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
    const text: string = await page.evaluate(() => document.body.innerText || "");
    let screenshotBase64: string | null = null;
    if (needScreenshot) {
      const buf = await page.screenshot({ type: "jpeg", quality: 60 });
      screenshotBase64 = Buffer.from(buf).toString("base64");
    }
    return { text, screenshotBase64 };
  });

  return Response.json({
    url,
    content: result.text.slice(0, 50000),
    screenshot_base64: result.screenshotBase64,
  });
}

// --- /scrape ---
async function handleScrape(url: string, selector: string, env: Env): Promise<Response> {
  const results = await withBrowser(env, async (page) => {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
    return page.evaluate((sel: string) => {
      const items: { text: string; html: string }[] = [];
      document.querySelectorAll(sel).forEach((el: any) => {
        items.push({ text: el.innerText || "", html: el.innerHTML || "" });
      });
      return items;
    }, selector);
  });

  return Response.json({ url, selector, results });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST") {
      return Response.json({ endpoints: ["/search", "/navigate", "/scrape"] });
    }

    try {
      const body: any = await req.json().catch(() => ({}));
      switch (url.pathname) {
        case "/search":
          if (!body.query) return Response.json({ error: "missing query" }, { status: 400 });
          return handleSearch(body.query, env);
        case "/navigate":
          if (!body.url) return Response.json({ error: "missing url" }, { status: 400 });
          return handleNavigate(body.url, env, body.screenshot !== false);
        case "/scrape":
          if (!body.url || !body.selector) return Response.json({ error: "missing url or selector" }, { status: 400 });
          return handleScrape(body.url, body.selector, env);
        default:
          return Response.json({ error: "not found" }, { status: 404 });
      }
    } catch (e: any) {
      return Response.json({ error: e.message || "internal error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
