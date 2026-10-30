import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea") {
  throw new Error("Serveur réservé au bundle d'émulation local.");
}
const root = resolve("dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".gz": "application/gzip", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
createServer(async (request, response) => {
  try {
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
}).listen(4173, "127.0.0.1");
