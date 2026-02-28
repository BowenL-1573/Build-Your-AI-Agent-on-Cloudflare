interface Env {
  TENANT: DispatchNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route: /<tenant-name>/... → dispatch to tenant's User Worker
    const parts = url.pathname.split("/").filter(Boolean);
    const tenantName = parts[0];

    if (!tenantName) {
      return new Response(JSON.stringify({ error: "Missing tenant in path. Use /<tenant>/ws" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Rewrite path: remove tenant prefix before forwarding
    const forwardPath = "/" + parts.slice(1).join("/") + url.search;
    const forwardUrl = new URL(forwardPath, request.url);

    try {
      const userWorker = env.TENANT.get(tenantName);
      return userWorker.fetch(new Request(forwardUrl.toString(), request));
    } catch (e: any) {
      if (e.message?.includes("Worker not found")) {
        return new Response(JSON.stringify({ error: `Tenant "${tenantName}" not found` }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw e;
    }
  },
};
