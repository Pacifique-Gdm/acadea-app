import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea") {
  throw new Error("Serveur réservé au bundle d'émulation local.");
}
const root = resolve("dist");
const port = process.env.ACADEA_E2E_PORT === "4187" ? 4187 : 4173;
let feeHandler;
if (process.env.ACADEA_E2E_FEE_HANDLER === "YES") {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error("API de test réservée aux émulateurs sans identifiants distants.");
  const { initializeApp } = await import("firebase-admin/app");
  initializeApp({ projectId: "demo-acadea" });
  feeHandler = (await import("../api/manage-financial-transaction.js")).default;
}
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".gz": "application/gzip", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
createServer(async (request, response) => {
  try {
    if (feeHandler && new URL(request.url, "http://127.0.0.1:4173").pathname === "/api/manage-financial-transaction") {
      await feeHandler(request, response);
      return;
    }
    if (!(["GET", "HEAD"].includes(request.method))) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1:4173").pathname);
    const target = resolve(root, `.${pathname}`);
    const child = relative(root, target);
    if (child.startsWith("..") || resolve(root, child) !== target) { response.writeHead(403).end(); return; }
    let file = target;
    if (!(await stat(file).then((item) => item.isFile()).catch(() => false))) file = resolve(root, "index.html");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch { response.writeHead(500).end(); }
}).listen(port, "127.0.0.1");
