import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

let server: Server;
let origin: string;
let bundle: string;

test.beforeAll(async () => {
  const source = readFileSync(fileURLToPath(new URL("../src/services/offlineQueue.ts", import.meta.url)), "utf8");
  bundle = (await transform(source, { loader: "ts", format: "iife", globalName: "OfflineQueue" })).code;
  server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end("<!doctype html><html><body>Test local de stockage Acadéa</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Serveur local indisponible.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("persiste après rechargement, chiffre le contenu, isole les périmètres et contrôle les transitions", async ({ page }) => {
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  const created = await page.evaluate(async () => {
    const queue = (window as unknown as { OfflineQueue: typeof import("../src/services/offlineQueue") }).OfflineQueue;
    return queue.queueOfflineOperation({ userId: "teacher-a", schoolId: "school-a", schoolYearId: "year-a" }, "grade", { studentId: "student-a", score: 12 });
  });
  expect(created.status).toBe("LOCAL_PENDING");
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (id) => {
    const queue = (window as unknown as { OfflineQueue: typeof import("../src/services/offlineQueue") }).OfflineQueue;
    const owner = { userId: "teacher-a", schoolId: "school-a", schoolYearId: "year-a" };
    const other = { userId: "teacher-b", schoolId: "school-b", schoolYearId: "year-a" };
    const entries = await queue.listOfflineOperations(owner);
    const invisible = await queue.listOfflineOperations(other);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("acadea-offline-operations-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = database.transaction("operations", "readonly").objectStore("operations").get(id);
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    let wrongScopeRejected = false;
    try { await queue.transitionOfflineOperation(other, id, "SYNCING"); } catch { wrongScopeRejected = true; }
    let prematureConfirmationRejected = false;
    try { await queue.transitionOfflineOperation(owner, id, "SERVER_CONFIRMED"); } catch { prematureConfirmationRejected = true; }
    await queue.transitionOfflineOperation(owner, id, "SYNCING");
    await queue.transitionOfflineOperation(owner, id, "RETRYABLE_ERROR", "Réseau indisponible");
    await queue.transitionOfflineOperation(owner, id, "SYNCING");
    await queue.transitionOfflineOperation(owner, id, "SERVER_CONFIRMED");
    const confirmed = await queue.listOfflineOperations(owner);
    await queue.removeConfirmedOfflineOperation(owner, id);
    const empty = await queue.listOfflineOperations(owner);
    return { entries, invisible, wrongScopeRejected, prematureConfirmationRejected, confirmed, empty, stored };
  }, created.id);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].payload).toEqual({ studentId: "student-a", score: 12 });
  expect(result.invisible).toEqual([]);
  expect(result.wrongScopeRejected).toBe(true);
  expect(result.prematureConfirmationRejected).toBe(true);
  expect(result.confirmed[0]).toMatchObject({ status: "SERVER_CONFIRMED", attempts: 2 });
  expect(result.empty).toEqual([]);
  expect(result.stored).not.toHaveProperty("payload");
  expect(result.stored).toHaveProperty("ciphertext");
});

test("inscription locale chiffrée et isolée d'une autre année", async ({ page }) => {
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const queue = (window as unknown as { OfflineQueue: typeof import("../src/services/offlineQueue") }).OfflineQueue;
    const scope = { userId: "secretary-a", schoolId: "school-a", schoolYearId: "year-a" };
    const payload = { nom: "Fictif", postnom: "Test", prenom: "Alice", classId: "class-a", classOptionKey: "option-a" };
    const created = await queue.queueOfflineOperation(scope, "student_enrollment", payload);
    const own = await queue.listOfflineOperations(scope);
    const nextYear = await queue.listOfflineOperations({ ...scope, schoolYearId: "year-b" });
    return { created, own, nextYear };
  });
  expect(result.created.status).toBe("LOCAL_PENDING");
  expect(result.own[0].payload).toMatchObject({ classOptionKey: "option-a" });
  expect(result.nextYear).toEqual([]);
});
