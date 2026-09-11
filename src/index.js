// ==============================
// URL DE TU RENDER (el que funciona)
// ==============================
const RENDER_URL = "https://play-store-backend.onrender.com";

// ==============================
// WORKER PROXY CON CACHÉ + CORS
// ==============================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    // Responder a preflight OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // Cache del edge de Cloudflare (5 minutos)
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);

      let response = await cache.match(cacheKey);

      if (!response) {
        // ⚡ No está en caché → pedir a Render
        const renderUrl = RENDER_URL + url.pathname + url.search;

        const renderResponse = await fetch(renderUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": "Cloudflare-Worker-Proxy",
          },
        });

        const body = await renderResponse.text();

        response = new Response(body, {
          status: renderResponse.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "X-Cache": "MISS",
            ...corsHeaders,
          },
        });

        // Guardar en caché solo si fue exitoso
        if (renderResponse.status === 200 && request.method === "GET") {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
      } else {
        // ✅ Está en caché → respuesta instantánea
        const cachedBody = await response.text();
        response = new Response(cachedBody, {
          status: response.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-Cache": "HIT",
            ...corsHeaders,
          },
        });
      }

      return response;
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Error en proxy Cloudflare",
          detail: error.message,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders,
          },
        }
      );
    }
  },

  // ⏰ Cron: ping a Render cada 10 min para que NUNCA se duerma
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(RENDER_URL + "/", { method: "GET" })
        .then((res) => console.log("Ping OK:", res.status))
        .catch((e) => console.log("Ping falló:", e.message))
    );
  },
};
