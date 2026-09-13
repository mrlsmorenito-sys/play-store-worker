const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const cacheLinks = new Map();

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Render APK Redirector",
    version: "2.0",
    endpoints: ["/api/download?id=com.whatsapp"]
  });
});

async function obtenerNombreApp(appId) {
  try {
    const url = "https://play.google.com/store/apps/details?id=" + appId + "&hl=es";
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36"
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/<title>([^<]+)<\/title>/);
    if (match && match[1]) {
      return match[1].split(" - ")[0].trim();
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function buscarApkAPKPure(appName, appId) {
  try {
    const nombreLimpio = (appName || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "-");

    const urls = [
      "https://apkpure.com/" + nombreLimpio + "/" + appId,
      "https://apkpure.com/search?q=" + encodeURIComponent(appName || appId)
    ];

    for (const urlPagina of urls) {
      try {
        const resp = await fetch(urlPagina, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml"
          },
          redirect: "follow"
        });
        if (!resp.ok) continue;
        const html = await resp.text();
        const patrones = [
          /href="(https:\/\/d\.apkpure\.net\/[^"]+\.apk[^"]*)"/i,
          /href="(https:\/\/download\.apkpure\.com\/[^"]+\.apk[^"]*)"/i,
          /"(https:\/\/d\.apkpure\.net\/b\/[^"]+\.apk[^"]*)"/i
        ];
        for (const patron of patrones) {
          const match = html.match(patron);
          if (match && match[1]) return match[1];
        }
      } catch (e) { continue; }
    }
    return null;
  } catch (e) {
    return null;
  }
}

app.get("/api/download", async (req, res) => {
  const appId = req.query.id;
  if (!appId) {
    return res.status(400).json({ error: "Falta id" });
  }

  if (cacheLinks.has(appId)) {
    const c = cacheLinks.get(appId);
    if (Date.now() - c.time < 30 * 60 * 1000) {
      return res.redirect(302, c.url);
    } else {
      cacheLinks.delete(appId);
    }
  }

  try {
    const appName = await obtenerNombreApp(appId);
    console.log("App:", appName);

    const urlApk = await buscarApkAPKPure(appName, appId);
    console.log("APK:", urlApk);

    if (urlApk) {
      cacheLinks.set(appId, { url: urlApk, time: Date.now() });
      return res.redirect(302, urlApk);
    } else {
      return res.status(404).json({ error: true, mensaje: "No encontrado" });
    }
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: e.message });
  }
});

app.listen(PORT, () => {
  console.log("Render corriendo en " + PORT);
});
