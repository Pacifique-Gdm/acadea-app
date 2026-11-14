import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Header = { key: string; value: string };
const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { headers?: Array<{ source: string; headers: Header[] }> };

describe("fichiers statiques légers et mis en cache", () => {
  it("garde l'icône Acadéa sous 150 Ko", () => {
    expect(statSync(new URL("../../public/acadea-icon.png", import.meta.url)).size).toBeLessThan(150 * 1024);
  });

  it("met en cache un an les fichiers /assets dont le nom contient une empreinte", () => {
    const assets = config.headers?.find((entry) => entry.source === "/assets/(.*)");
    expect(assets?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });

  it("ne met pas en cache longue durée la page d'accueil ni le service worker", () => {
    const longCache = (config.headers ?? []).filter((entry) => entry.headers.some((header) => header.key === "Cache-Control" && header.value.includes("immutable")));
    expect(longCache.map((entry) => entry.source)).toEqual(["/assets/(.*)"]);
  });
});
