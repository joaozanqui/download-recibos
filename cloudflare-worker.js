// Deploy em: https://workers.cloudflare.com
// 1. Crie uma conta gratuita no Cloudflare
// 2. Vá em Workers & Pages > Create > Worker
// 3. Cole este código e clique em Deploy
// 4. Copie a URL gerada (ex: https://meu-proxy.seuusuario.workers.dev)
// 5. Substitua CLOUDFLARE_WORKER_URL em app.js pela URL copiada

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target || (!target.startsWith("http://") && !target.startsWith("https://"))) {
      return new Response("Bad Request: url invalido", { status: 400 });
    }

    try {
      const resp = await fetch(target, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/pdf,*/*",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
        redirect: "follow",
      });

      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set(
        "Access-Control-Expose-Headers",
        "Content-Disposition, Content-Type"
      );

      const cd = resp.headers.get("Content-Disposition");
      if (cd) responseHeaders.set("Content-Disposition", cd);

      const ct = resp.headers.get("Content-Type");
      if (ct) responseHeaders.set("Content-Type", ct);

      return new Response(resp.body, {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  },
};
