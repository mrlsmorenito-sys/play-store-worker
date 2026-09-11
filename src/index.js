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
  return (
    "https://d.apkpure.com/b/APK/" +
    encodeURIComponent(appId) +
    "?version=latest"
  );
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
    bannerAd: cleanImageUrl(
      app.headerImage ||
        (app.screenshots && app.screenshots.length > 0
          ? app.screenshots[0]
          : "")
    ),
  };
}

async function fetchGooglePlay(url, lang, country) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": `${lang}-${country},${lang};q=0.9`,
    },
  });
  return await res.text();
}

function extractAppsFromHtml(html) {
  const apps = [];
  const seen = new Set();

  const regex =
    /AF_initDataCallback\(\{key: 'ds:[\d]+',[\s\S]*?data:([\s\S]*?), sideChannel[\s\S]*?\}\)/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      walkForApps(data, apps, seen);
    } catch (e) {
      // ignorar
    }
  }

  return apps;
}

function walkForApps(node, out, seen) {
  if (!Array.isArray(node)) return;

  if (
    node.length > 3 &&
    typeof node[0] === "string" &&
    node[0].length > 5 &&
    node[0].includes(".") &&
    Array.isArray(node[1]) &&
    typeof node[2] === "string" &&
    node[2].length > 0 &&
    !seen.has(node[0])
  ) {
    const appId = node[0];
    const icon = node[1]?.[0]?.url || node[1]?.[3]?.url || "";
    const title = node[2];
    const developer = node[4] || "Desconocido";
    const scoreText =
      node[6]?.[0]?.[0]?.toString() ||
      node[6]?.[0]?.toString() ||
      "4.5";

    seen.add(appId);
    out.push({
      appId,
      title,
      developer,
      icon,
      scoreText,
      score: parseFloat(scoreText) || 4.5,
    });
  }

  for (const child of node) {
    if (Array.isArray(child)) walkForApps(child, out, seen);
  }
}

async function getAppList(category, collection, lang, country) {
  const collectionMap = {
    TOP_FREE: "topselling_free",
    NEW_FREE: "topselling_new_free",
    TOP_PAID: "topselling_paid",
  };

  const coll = collectionMap[collection] || "topselling_free";
  const cat = category || "APPLICATION";

  const url =
    `https://play.google.com/store/apps/collection/${coll}` +
    `?hl=${lang}&gl=${country}&category=${cat}`;

  const html = await fetchGooglePlay(url, lang, country);
  return extractAppsFromHtml(html).slice(0, 20);
}

function extractAppDetails(html) {
  const details = { screenshots: [] };

  const titleMatch = html.match(/<meta itemprop="name" content="([^"]+)"/);
  if (titleMatch) details.title = titleMatch[1];

  const iconMatch = html.match(/<meta itemprop="image" content="([^"]+)"/);
  if (iconMatch) details.icon = iconMatch[1];

  const descMatch = html.match(
    /<meta itemprop="description" content="([^"]+)"/
  );
  if (descMatch) details.description = descMatch[1];

  const devMatch = html.match(/<meta itemprop="author" content="([^"]+)"/);
  if (devMatch) details.developer = devMatch[1];

  const scoreMatch = html.match(
    /<meta itemprop="ratingValue" content="([^"]+)"/
  );
  if (scoreMatch) {
    details.score = parseFloat(scoreMatch[1]);
    details.scoreText = scoreMatch[1];
  }

  const installMatch = html.match(
    /<meta itemprop="interactionCount" content="([^"]+)"/
  );
  if (installMatch) details.installs = installMatch[1];

  const shotRegex = /https:\/\/play-lh\.googleusercontent\.com\/[^"\\]+/g;
  const shots = new Set();
  let m;
  while ((m = shotRegex.exec(html)) !== null) {
    if (m[0].includes("=w") || m[0].includes("=s")) {
      shots.add(m[0].split("=")[0] + "=w1000");
    }
  }
  details.screenshots = Array.from(shots).slice(0, 10);

  return details;
}

// ==============================
// HANDLER PRINCIPAL
// ==============================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const lang = env.DEFAULT_LANG || "es";
    const country = env.DEFAULT_COUNTRY || "mx";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // RUTA: /
      if (path === "/" || path === "") {
        const apps = await getAppList(
          "APPLICATION",
          "TOP_FREE",
          lang,
          country
        );
        return jsonResponse(apps.map(formatApp), corsHeaders);
      }

      // RUTA: /api/apps
      if (path === "/api/apps") {
        const tab = url.searchParams.get("tab") || "apps";
        let category = "APPLICATION";
        let collection = "TOP_FREE";

        if (tab === "games" || tab === "arcade") {
          category = "GAME";
        }
        if (tab === "today") {
          collection = "NEW_FREE";
        }

        const apps = await getAppList(category, collection, lang, country);
        return jsonResponse(apps.map(formatApp), corsHeaders);
      }

      // RUTA: /api/search
      if (path === "/api/search") {
        const query = url.searchParams.get("q");
        if (!query || query.trim().length === 0) {
          return jsonResponse([], corsHeaders);
        }

        const searchUrl =
          `https://play.google.com/store/search?q=${encodeURIComponent(
            query
          )}&c=apps&hl=${lang}&gl=${country}`;

        const html = await fetchGooglePlay(searchUrl, lang, country);
        const apps = extractAppsFromHtml(html).slice(0, 15);

        return jsonResponse(apps.map(formatApp), corsHeaders);
      }

      // RUTA: /api/app
      if (path === "/api/app") {
        const appId =
          url.searchParams.get("id") || url.searchParams.get("appId");
        if (!appId) {
          return jsonResponse(
            { error: "Falta el ID de la aplicación" },
            corsHeaders,
            400
          );
        }

        const appUrl =
          `https://play.google.com/store/apps/details?id=${encodeURIComponent(
            appId
          )}&hl=${lang}&gl=${country}`;

        const html = await fetchGooglePlay(appUrl, lang, country);
        const details = extractAppDetails(html);

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

      // RUTA: /api/download
      if (path === "/api/download") {
        const appId = url.searchParams.get("id");
        if (!appId) {
          return jsonResponse({ error: "Falta id" }, corsHeaders, 400);
        }

        const sources = [
          `https://d.apkpure.com/b/APK/${appId}?version=latest`,
          `https://apkpure.com/api/v1/download?package_name=${appId}`,
        ];

        return jsonResponse(
          {
            appId,
            downloadUrl: sources[0],
            allSources: sources,
          },
          corsHeaders
        );
      }

      return jsonResponse(
        { error: "Ruta no encontrada: " + path },
        corsHeaders,
        404
      );
    } catch (error) {
      return jsonResponse(
        { error: "Error interno: " + error.message },
        corsHeaders,
        500
      );
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
