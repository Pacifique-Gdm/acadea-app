import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Correction 1.20.2 : /version.json doit montrer la version réellement en ligne (numéro et date), jamais une copie gardée.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("version.json toujours à jour", () => {
  it("contient le commit (pour les vérifications), le numéro de version et la date de construction", () => {
    const config = read("vite.config.ts");
    expect(config).toMatch(/const appVersion = String\(JSON\.parse\(readFileSync\(resolve\(process\.cwd\(\), "package\.json"\)/);
    expect(config).toMatch(/fileName: "version\.json",[\s\S]{0,400}version: buildId,[\s\S]{0,60}appVersion,[\s\S]{0,60}generatedAt: new Date\(\)\.toISOString\(\)/);
  });
  it("le site interdit toute mise en mémoire de /version.json", () => {
    const vercel = JSON.parse(read("vercel.json")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const rule = vercel.headers.find((entry) => entry.source === "/version.json");
    expect(rule?.headers).toContainEqual({ key: "Cache-Control", value: "no-store, max-age=0" });
  });
  it("le service worker laisse passer /version.json et ne garde comme page d'accueil qu'une vraie page HTML", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('if (url.pathname === "/version.json") return;');
    expect(sw.indexOf('if (url.pathname === "/version.json") return;')).toBeLessThan(sw.indexOf('if (request.mode === "navigate")'));
    expect(sw).toMatch(/if \(response\.ok && \(response\.headers\.get\("content-type"\) \|\| ""\)\.includes\("text\/html"\)\) \{\s*const copy = response\.clone\(\);\s*caches\.open\(SHELL_CACHE\)\.then\(\(cache\) => cache\.put\("\/", copy\)\);/);
  });
});
