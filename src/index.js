// ==============================
// UTILIDADES
// ==============================

function cleanImageUrl(url) {
  if (!url) return "";
  url = String(url).trim();
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

function getDirectApkUrl(appId) {
  if (!appId) return "";
  return "https://d.apkpure.com/b/APK/" + encodeURIComponent(appId) + "?version=latest";
}

function formatApp(app) {
  return {
    title: app.title || "Sin título",
    developer: app.developer || "Desconocido",
    icon: cleanImageUrl(app.icon || ""),
    appId: app.appId || "",
    scoreText: app.scoreText || "4.5",
    score: app.score || 4.5,
    downloadUrl: getDirectApkUrl(app.appId),
    bannerAd: cleanImageUrl(app.bannerAd || app.icon || ""),
  };
}

async function fetchGooglePlay(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    },
  });
  return await res.text();
}

// ==============================
// PARSER DE LISTAS (MULTI-ESTRATEGIA)
// ==============================

function extractAppsFromHtml(html) {
  const apps = [];
  const seen = new Set();

  // Estrategia 1: buscar bloques AF_initDataCallback
  const blocks = html.match(/AF_initDataCallback\(([\s\S]*?)\);<\/script>/g) || [];

  for (const block of blocks) {
    try {
      const dataMatch = block.match(/data:(\[[\s\S]*?\]), sideChannel/);
      if (!dataMatch) continue;

      // Google a veces escapa los datos con \x22 etc.
      let raw = dataMatch[1];
      const data = JSON.parse(raw);
      walkForApps(data, apps, seen);
    } catch (e) {
      // continuar con el siguiente bloque
    }
  }

  // Estrategia 2: si no encontró nada, buscar por regex directa de appIds
  if (apps.length === 0) {
    const appIdRegex = /"(\/store\/apps\/details\?id=([a-zA-Z0-9._]+))"/g;
    let m;
    while ((m = appIdRegex.exec(html)) !== null) {
      const appId = m[2];
      if (!seen.has(appId) && appId.length > 5) {
        seen.add(appId);
        apps.push({
          appId: appId,
          title: appId,
          developer: "Desconocido",
          icon: "",
          scoreText: "4.5",
          score: 4.5,
        });
      }
    }
  }

  return apps;
}

function walkForApps(node, out, seen) {
  if (!Array.isArray(node)) return;

  // Detecta estructura: [appId, [imagen...], "Título", ...]
  if (
    node.length >= 3 &&
    typeof node[0] === "string" &&
    node[0].length > 5 &&
    node[0].includes(".") &&
    !node[0].includes("/") &&
    !node[0].startsWith("http") &&
    Array.isArray(node[1]) &&
    typeof node[2] === "string" &&
    node[2].length > 0 &&
    !seen.has(node[0])
  ) {
    const appId = node[0];
    let icon = "";

    // Buscar icono en el array de imágenes
    for (const item of node[1]) {
      if (item && typeof item === "object" && item.url) {
        icon = item.url;
        break;
      }
      if (Array.isArray(item)) {
        for (const sub of item) {
          if (sub && typeof sub === "object" && sub.url) {
            icon = sub.url;
            break;
          }
        }
      }
    }

    // Buscar developer y score en nodos hermanos
    let developer = "Desconocido";
    let scoreText = "4.5";

    for (let i = 3; i < Math.min(node.length, 12); i++) {
      const val = node[i];
      if (typeof val === "string" && val.length > 2 && val.length < 50 && !val.startsWith("http") && developer === "Desconocido" && val !== node[2]) {
        developer = val;
      }
      if (Array.isArray(val) && typeof val[0] === "number" && val[0] >= 1 && val[0] <= 5) {
        scoreText = val[0].toString();
      }
    }

    seen.add(appId);
    out.push({
      appId: appId,
      title: node[2],
      developer: developer,
      icon: icon,
      scoreText: scoreText,
      score: parseFloat(scoreText) || 4.5,
    });
  }

  for (const child of node) {
    if (Array.isArray(child)) walkForApps(child, out, seen);
  }
}

// ==============================
// LISTA DE APPS
// ==============================

async function getAppList(category, collection, lang, country) {
  const collectionMap = {
    TOP_FREE: "topselling_free",
    NEW_FREE: "topselling_new_free",
    TOP_PAID: "topselling_paid",
  };

  const coll = collectionMap[collection] || "topselling_free";

  // Google cambió la URL de las listas: ahora usa /store/apps
  let url;
  if (category === "GAME") {
    url = `https://play.google.com/store/apps/category/GAME/collection/${coll}?hl=${lang}&gl=${country}`;
  } else {
    url = `https://play.google.com/store/apps/collection/${coll}?hl=${lang}&gl=${country}`;
  }

  const html = await fetchGooglePlay(url);
  let apps = extractAppsFromHtml(html);

  // Fallback: si no encontró nada, intentar con la URL de categoría general
  if (apps.length === 0) {
    const fallbackUrl = `https://play.google.com/store/apps?hl=${lang}&gl=${country}`;
    const fallbackHtml = await fetchGooglePlay(fallbackUrl);
    apps = extractAppsFromHtml(fallbackHtml);
  }

  return apps.slice(0, 20);
}

// ==============================
// DETALLES
// ==============================

function extractAppDetails(html, appId) {
  const details = { screenshots: [] };

  // Título
  let m = html.match(/<meta itemprop="name" content="([^"]+)"/);
  if (m) details.title = m[1];
  if (!details.title) {
    m = html.match(/<title[^>]*>([^<]+)<\/title>/);
    if (m) details.title = m[1].replace(/ - Apps on Google Play.*/, "").trim();
  }

  // Icono
  m = html.match(/<meta itemprop="image" content="([^"]+)"/);
  if (m) details.icon = m[1];

  // Descripción
  m = html.match(/<meta itemprop="description" content="([^"]+)"/);
  if (m) details.description = m[1];

  // Developer
  m = html.match(/<meta itemprop="author" content="([^"]+)"/);
  if (m) details.developer = m[1];

  // Score
  m = html.match(/<meta itemprop="ratingValue" content="([^"]+)"/);
  if (m) {
    details.score = parseFloat(m[1]);
    details.scoreText = m[1];
  }

  // Installs
  m = html.match(/<meta itemprop="interactionCount" content="([^"]+)"/);
  if (m) details.installs = m[1];

  // Screenshots
  const shotRegex = /https:\/\/play-lh\.googleusercontent\.com\/[^"\\]+/g;
  const shots = new Set();
  let sm;
  while ((sm = shotRegex.exec(html)) !== null) {
    if (sm[0].includes("=w") || sm[0].includes("=s")) {
      shots.add(sm[0].split("=")[0] + "=w1000");
    }
  }
  details.screenshots = Array.from(shots).slice(0, 10);

  return details;
}

// ==============================
// HANDLER
// ==============================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const lang = env.DEFAULT_LANG || "es";
    const country = env.DEFAULT_COUNTRY || "mx";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // HOME
      if (path === "/" || path === "") {
        const apps = await getAppList("APPLICATION", "TOP_FREE", lang, country);
        return jsonResponse(apps.map(formatApp), corsHeaders);
      }

      // APPS / GAMES / TODAY
      if (path === "/api/apps") {
        const tab = url.searchParams.get("tab") || "apps";
        let category = "APPLICATION";
        let collection = "TOP_FREE";

        if (tab === "games" || tab === "arcade") category = "GAME";
        if (tab === "today") collection = "NEW_FREE";

        const apps = await getAppList(category, collection, lang, country);
        return jsonResponse(apps.map(formatApp), corsHeaders);
      }

      // SEARCH
      if (path === "/api/search") {
        const query = url.searchParams.get("q");
        if (!query || query.trim().length === 0) {
          return jsonResponse([], corsHeaders);
        }

        const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=${lang}&gl=${country}`;
        const html = await fetchGooglePlay(searchUrl);
        const apps = extractAppsFromHtml(html).slice(0, 15);

        return jsonResponse(apps.map(formatApp), corsHeaders);
      }

      // APP DETAILS
      if (path === "/api/app") {
        const appId = url.searchParams.get("id") || url.searchParams.get("appId");
        if (!appId) {
          return jsonResponse({ error: "Falta el ID de la aplicación" }, corsHeaders, 400);
        }

        const appUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=${lang}&gl=${country}`;
        const html = await fetchGooglePlay(appUrl);
        const details = extractAppDetails(html, appId);

        return jsonResponse(
          {
            title: details.title || "Sin título",
            developer: details.developer || "Desconocido",
            icon: cleanImageUrl(details.icon || ""),
            summary: details.summary || "",
            description: details.description || "",
            scoreText: details.scoreText || "4.5",
            score: details.score || 4.5,
            installs: details.installs || "Más de 10,000",
            size: details.size || "Varía según el dispositivo",
            androidVersion: details.androidVersion || "Varía",
            priceText: details.priceText || "Gratis",
            bannerAd: cleanImageUrl(details.headerImage || ""),
            screenshots: (details.screenshots || []).map(cleanImageUrl),
            reviews: [],
            downloadUrl: getDirectApkUrl(appId),
          },
          corsHeaders
        );
      }

      // DOWNLOAD
      if (path === "/api/download") {
        const appId = url.searchParams.get("id");
        if (!appId) {
          return jsonResponse({ error: "Falta id" }, corsHeaders, 400);
        }

        const sources = [
          `https://d.apkpure.com/b/APK/${appId}?version=latest`,
          `https://apkpure.com/api/v1/download?package_name=${appId}`,
        ];

        return jsonResponse({ appId, downloadUrl: sources[0], allSources: sources }, corsHeaders);
      }

      return jsonResponse({ error: "Ruta no encontrada: " + path }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: "Error interno: " + error.message }, corsHeaders, 500);
    }
  },
};

function jsonResponse(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}
