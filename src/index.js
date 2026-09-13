const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CACHÉ DE LINKS (30 minutos)
// ==========================================
const cacheLinks = new Map();

// ==========================================
// RUTA PRINCIPAL
// ==========================================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Render APK Redirector",
    version: "2.0",
    endpoints: [
      "/api/download?id=com.whatsapp"
    ]
  });
});

// ==========================================
// HELPER: Obtener nombre de la app desde Play Store
// Solo lee el <title> del HTML (1 petición ligera)
// ==========================================
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
      // Formato: "WhatsApp Messenger - Apps en Google Play"
      return match[1].split(" - ")[0].trim();
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ==========================================
// HELPER: Buscar link directo del APK en APKPure
// ==========================================
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
      } catch (e) {
        continue;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ==========================================
// ENDPOINT: /api/download?id=com.whatsapp
// Redirige al APK directo (302)
// ==========================================
app.get("/api/download", async (req, res) => {
  const appId = req.query.id;

  if (!appId) {
    return res.status(400).json({ error: "Falta id" });
  }

  // Ver caché
  if (cacheLinks.has(appId)) {
    const c = cacheLinks.get(appId);
    if (Date.now() - c.time < 30 * 60 * 1000) {
      return res.redirect(302, c.url);
    } else {
      cacheLinks.delete(appId);
    }
  }

  try {
    // 1. Obtener nombre de la app desde Play Store
    const appName = await obtenerNombreApp(appId);
    console.log("App encontrada:", appName);

    // 2. Buscar link del APK en APKPure
    const urlApk = await buscarApkAPKPure(appName, appId);
    console.log("APK encontrado:", urlApk);

    if (urlApk) {
      // Guardar en caché
      cacheLinks.set(appId, { url: urlApk, time: Date.now() });
      // Redirigir al APK
      return res.redirect(302, urlApk);
    } else {
      return res.status(404).json({
        error: true,
        mensaje: "No encontrado"
      });
    }

  } catch (e) {
    console.error("Error:", e.message);
    return res.status(500).json({
      error: true,
      mensaje: e.message
    });
  }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log("Render APK Redirector corriendo en puerto " + PORT);
});
