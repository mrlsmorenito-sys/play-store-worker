const RENDER_URL = "https://play-store-backend.onrender.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);

      let response = await cache.match(cacheKey);

      if (!response) {
        const renderResponse = await fetch(RENDER_URL + url.pathname + url.search, {
          method: "GET",
          headers: { "Accept": "application/json" },
        });

        const body = await renderResponse.text();

        response = new Response(body, {
          status: renderResponse.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            ...corsHeaders,
          },
        });

        if (renderResponse.status === 200) {
          await cache.put(cacheKey, response.clone());
        }
      } else {
        response = new Response(response.body, {
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers),
            ...corsHeaders,
          },
        });
      }

      return response;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Error en proxy: " + error.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(RENDER_URL + "/", { method: "GET" }).catch(() => {})
    );
  },
};
