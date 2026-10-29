import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let server: Server;
let origin: string;
const worker = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)));

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const routes: Record<string, { type: string; body: string | Buffer }> = {
      "/": { type: "text/html", body: "<!doctype html><title>Acadéa test</title><link rel='stylesheet' href='/assets/app.css'><main>Acadéa local</main><script src='/assets/app.js'></script>" },
      "/sw.js": { type: "text/javascript", body: worker },
      "/offline-assets.json": { type: "application/json", body: JSON.stringify({ version: "test", assets: ["/assets/app.js", "/assets/app.css"] }) },
      "/assets/app.js": { type: "text/javascript", body: "document.body.dataset.appLoaded = 'yes';" },
      "/assets/app.css": { type: "text/css", body: "main { color: navy; }" },
      "/api/private": { type: "application/json", body: '{"private":true}' },
    };
    const item = routes[path];
    if (!item) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": `${item.type}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(item.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Serveur local indisponible.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("rouvre le shell après fermeture réseau sans conserver la réponse API", async ({ page, context }) => {
  await page.goto(origin);
  await expect(page.locator("main")).toHaveText("Acadéa local");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const ready = await navigator.serviceWorker.ready;
    if (!ready.active) throw new Error("Service worker non activé.");
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.ok) resolve(); else reject(new Error(event.data?.error || "Préparation refusée."));
      };
      ready.active?.postMessage({ type: "PREPARE_OFFLINE_SHELL", version: "test" }, [channel.port2]);
    });
    await fetch("/api/private");
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("main")).toHaveText("Acadéa local");
  await expect(page.locator("body")).toHaveAttribute("data-app-loaded", "yes");
  const apiAccessible = await page.evaluate(async () => {
    try { await fetch("/api/private"); return true; } catch { return false; }
  });
  expect(apiAccessible).toBe(false);
});
