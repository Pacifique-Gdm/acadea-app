import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  compressUnderLimit,
  LOGIN_IMAGE_MAX_BYTES,
  loadLoginImage,
  parseLoginImage,
  readCachedLoginImage,
  writeCachedLoginImage,
} from "./loginImage";

const IMAGE = "data:image/webp;base64,AAAA";
const blob = (size: number) => ({ size }) as Blob;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("image de l'écran de connexion (lot 9) : service du site", () => {
  it("compresse automatiquement sous 100 Ko : garde la première version assez légère", async () => {
    const tries: string[] = [];
    const result = await compressUnderLimit(4000, async (width, quality) => {
      tries.push(`${width}@${quality}`);
      return blob(width === 1280 && quality <= 0.62 ? 90_000 : 300_000);
    });
    expect(result.size).toBeLessThanOrEqual(LOGIN_IMAGE_MAX_BYTES);
    expect(tries.at(-1)).toBe("1280@0.62");
    // On commence par la version la plus nette.
    expect(tries[0]).toBe("1600@0.82");
  });

  it("n'agrandit jamais une petite image", async () => {
    const widths = new Set<number>();
    await expect(compressUnderLimit(500, async (width) => { widths.add(width); return blob(200_000); })).rejects.toThrow("100 Ko");
    expect([...widths]).toEqual([500]);
  });

  it("refuse si aucune version ne passe sous 100 Ko", async () => {
    await expect(compressUnderLimit(2000, async () => blob(LOGIN_IMAGE_MAX_BYTES + 1))).rejects.toThrow("Choisissez une autre image");
  });

  it("n'accepte qu'une image « data: » JPEG, PNG ou WEBP", () => {
    expect(parseLoginImage({ imageDataUrl: IMAGE, updatedAt: "x" })).toEqual({ imageDataUrl: IMAGE, updatedAt: "x" });
    expect(parseLoginImage({ imageDataUrl: "https://pirate.example/a.jpg" })).toEqual({ imageDataUrl: "", updatedAt: "" });
    expect(parseLoginImage({ imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).imageDataUrl).toBe("");
    expect(parseLoginImage(null)).toEqual({ imageDataUrl: "", updatedAt: "" });
  });

  it("garde la dernière image sur l'appareil, et l'efface au retour à l'origine", () => {
    const storage = memoryStorage();
    expect(readCachedLoginImage(storage)).toBe("");
    writeCachedLoginImage(IMAGE, storage);
    expect(readCachedLoginImage(storage)).toBe(IMAGE);
    writeCachedLoginImage("", storage);
    expect(readCachedLoginImage(storage)).toBe("");
    storage.setItem("acadea.loginImage.v1", "javascript:alert(1)");
    expect(readCachedLoginImage(storage)).toBe("");
  });

  it("lecture publique sans jeton ; une panne remonte une erreur (l'écran garde son image)", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ imageDataUrl: IMAGE, updatedAt: "t" }), { status: 200 }));
    expect(await loadLoginImage(ok as unknown as typeof fetch)).toEqual({ imageDataUrl: IMAGE, updatedAt: "t" });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/manage-school?action=login-image");
    expect(init.method).toBe("GET");
    expect(init.headers).toBeUndefined();
    const down = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(loadLoginImage(down as unknown as typeof fetch)).rejects.toThrow();
  });

  it("aucun nouveau fichier serveur : l'écriture passe par api/manage-school.js", () => {
    const service = readFileSync("src/services/loginImage.ts", "utf8");
    expect(service).toContain('resolveApiUrl("/api/manage-school")');
    expect(service).toContain('action: "login-image-save"');
  });
});
