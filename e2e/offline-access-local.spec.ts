import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

let server: Server;
let origin: string;
let bundle: string;

test.beforeAll(async () => {
  const source = readFileSync(fileURLToPath(new URL("../src/services/offlineAccess.ts", import.meta.url)), "utf8");
  bundle = (await transform(source, { loader: "ts", format: "iife", globalName: "OfflineAccess" })).code;
  server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end("<!doctype html><html><body>Accès local fictif Acadéa</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Serveur local indisponible.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("ticket chiffré, borné, isolé et supprimé à la déconnexion", async ({ page }) => {
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  const now = Date.now();
  await page.evaluate(async (time) => {
    const access = (window as unknown as { OfflineAccess: typeof import("../src/services/offlineAccess") }).OfflineAccess;
    await access.rememberOfflineAccess({ userId: "teacher-a", role: "teacher", schoolId: "school-a",
      schoolName: "École fictive A", schoolYearId: "year-a", schoolYearName: "2026-2027" }, time);
  }, now);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (time) => {
    const access = (window as unknown as { OfflineAccess: typeof import("../src/services/offlineAccess") }).OfflineAccess;
    const valid = await access.readOfflineAccess("teacher-a", time + 1000);
    const other = await access.readOfflineAccess("teacher-b", time + 1000);
    const expired = await access.readOfflineAccess("teacher-a", time + 8 * 60 * 60 * 1000 + 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("acadea-offline-access-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = database.transaction("access", "readonly").objectStore("access").get("current");
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    await access.clearOfflineAccess();
    const afterLogout = await access.readOfflineAccess("teacher-a", time + 1000);
    return { valid, other, expired, stored, afterLogout };
  }, now);
  expect(result.valid).toMatchObject({ userId: "teacher-a", schoolId: "school-a", role: "teacher" });
  expect(result.other).toBeNull();
  expect(result.expired).toBeNull();
  expect(result.stored).toHaveProperty("ciphertext");
  expect(result.stored).not.toHaveProperty("schoolName");
  expect(result.afterLogout).toBeNull();
});
