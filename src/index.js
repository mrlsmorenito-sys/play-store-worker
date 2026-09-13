const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// Caché en memoria de links directos (10 minutos)
const cacheLinks = new Map();

// ==========================================
// RUTA PRINCIPAL
// ==========================================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Render APK Downloader funcionando",
    version: "1.0",
    endpoints: ["/api/download?id=com.whatsapp"]
  });
});

// ==========================================
// /api/download?id=com.whatsapp
// Redirige al APK directo
// ==========================================
app.get("/api/download", async (req, res) => {
  const appId = req.query.id;

  if (!appId) {
    return res.status(400).json({ error: "Falta el parámetro id" });
  }

  // Verificar caché
  if (cacheLinks.has(appId)) {
    const cached = cacheLinks.get(appId);
    if (Date.now() - cached.time < 10 * 60 * 1000) {
      return res.redirect(302, cached.url);
    } else {
      cacheLinks.delete(appId);
    }
  }

  let browser = null;

  try {
    // ==========================================
    // Abrir Evozi con Puppeteer Stealth
    // ==========================================
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    );

    await page.setViewport({ width: 412, height: 915 });

    console.log("Abriendo Evozi para: " + appId);

    await page.goto("https://apps.evozi.com/apk-downloader/?id=" + appId, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    // Esperar a que cargue el botón de descarga
    await new Promise(r => setTimeout(r, 3000));

    // ==========================================
    // Buscar el link del APK en la página
    // ==========================================
    const urlApk = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));

      for (const link of links) {
        const href = link.href || "";
        const texto = (link.textContent || "").toLowerCase();

        // Buscar links que sean de descarga
        if (
          href.includes(".apk") ||
          href.includes("apkcube") ||
          href.includes("download") ||
          texto.includes("download")
        ) {
          // Verificar que no sea un link de "APK Catalog" o menu
          if (!href.includes("catalog") && !href.includes("dmca") && !href.includes("speed")) {
            return href;
          }
        }
      }
      return null;
    });

    await browser.close();
    browser = null;

    if (urlApk) {
      // Guardar en caché
      cacheLinks.set(appId, { url: urlApk, time: Date.now() });

      // Redirigir al APK
      return res.redirect(302, urlApk);
    } else {
      return res.json({
        error: false,
        mensaje: "No se pudo obtener link directo",
        urlManual: "https://apps.evozi.com/apk-downloader/?id=" + appId
      });
    }

  } catch (e) {
    console.error("Error:", e.message);

    if (browser) {
      try { await browser.close(); } catch (err) {}
    }

    return res.status(500).json({
      error: true,
      message: "Error al procesar descarga: " + e.message,
      urlManual: "https://apps.evozi.com/apk-downloader/?id=" + appId
    });
  }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
