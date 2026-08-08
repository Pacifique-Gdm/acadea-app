import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Header = { key: string; value: string };
const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { headers?: Array<{ source: string; headers: Header[] }> };
const globalHeaders = new Map((config.headers?.find((entry) => entry.source === "/(.*)")?.headers ?? []).map((header) => [header.key, header.value]));

describe("en-têtes HTTP Vercel", () => {
  it("active les protections navigateur non régressives", () => {
    expect(globalHeaders.get("X-Content-Type-Options")).toBe("nosniff");
    expect(globalHeaders.get("X-Frame-Options")).toBe("DENY");
    expect(globalHeaders.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(globalHeaders.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(globalHeaders.get("Strict-Transport-Security")).toContain("max-age=63072000");
  });

  it("déploie la CSP en Report-Only avec les frontières essentielles", () => {
    expect(globalHeaders.has("Content-Security-Policy")).toBe(false);
    const policy = globalHeaders.get("Content-Security-Policy-Report-Only") ?? "";
    for (const directive of ["default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "object-src 'self' blob:", "form-action 'self'", "worker-src 'self' blob:"]) expect(policy).toContain(directive);
  });

  it("autorise en observation les services nécessaires sans wildcard globale", () => {
    const policy = globalHeaders.get("Content-Security-Policy-Report-Only") ?? "";
    for (const source of ["https://*.googleapis.com", "https://*.firebaseio.com", "wss://*.firebaseio.com", "https://*.firebaseapp.com", "https://*.cloudfunctions.net", "https://firebasestorage.googleapis.com", "https://storage.googleapis.com"]) expect(policy).toContain(source);
    expect(policy).not.toContain("default-src *");
    expect(policy).not.toContain("script-src *");
  });
});
