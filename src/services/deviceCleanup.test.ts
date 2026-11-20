import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cleanDeviceAfterSession, shouldReloadAfterLogout } from "./deviceCleanup";
import { confirmedOperationsToForget } from "./offlineQueue";

describe("P4 lot 2 : nettoyage central de l'appareil", () => {
  it("efface les devises de dépenses et le stockage de l'onglet, sans toucher aux autres clés", async () => {
    const local = new Map<string, string>([["acadea.expenseCurrencies.v2:caissier-a", "{}"], ["acadea:secretary:pdf-settings", "{}"]]);
    const session = new Map<string, string>([["horaire", "v1"]]);
    const fakeStorage = (map: Map<string, string>) => ({
      get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); }, clear: () => map.clear(),
    });
    vi.stubGlobal("localStorage", fakeStorage(local));
    vi.stubGlobal("window", { localStorage: fakeStorage(local) });
    vi.stubGlobal("sessionStorage", fakeStorage(session));
    try {
      const report = await cleanDeviceAfterSession();
      expect(report.memory).toBe(true);
      expect(report.sessionStorage).toBe(true);
      expect(session.size).toBe(0);
      expect([...local.keys()].some((key) => key.startsWith("acadea.expenseCurrencies"))).toBe(false);
      expect(local.has("acadea:secretary:pdf-settings")).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("ne retire que les opérations CONFIRMÉES et expirées : jamais un brouillon non envoyé", () => {
    const now = Date.parse("2026-12-31T00:00:00Z");
    const old = "2026-11-01T00:00:00Z", fresh = "2027-01-15T00:00:00Z";
    const rows = [
      { id: "1", status: "SERVER_CONFIRMED" as const, expiresAt: old },
      { id: "2", status: "SERVER_CONFIRMED" as const, expiresAt: fresh },
      { id: "3", status: "LOCAL_PENDING" as const, expiresAt: old },
      { id: "4", status: "REJECTED" as const, expiresAt: old },
      { id: "5", status: "CONFLICT" as const, expiresAt: old },
      { id: "6", status: "RETRYABLE_ERROR" as const, expiresAt: old },
      { id: "7", status: "SYNCING" as const, expiresAt: old },
    ];
    expect(confirmedOperationsToForget(rows, now).map((row) => row.id)).toEqual(["1"]);
  });

  it("recharge la page seulement en ligne", () => {
    expect(shouldReloadAfterLogout(true)).toBe(true);
    expect(shouldReloadAfterLogout(undefined)).toBe(true);
    expect(shouldReloadAfterLogout(false)).toBe(false);
  });

  it("la déconnexion appelle le nettoyage puis recharge /login, et le nettoyage ne touche pas aux brouillons", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const body = app.slice(app.indexOf("async function logout()"), app.indexOf("function updateData("));
    expect(body.indexOf("cleanDeviceAfterSession")).toBeGreaterThan(body.indexOf("signOutUser()"));
    expect(body).toContain('window.location.replace("/login")');
    const cleanup = readFileSync("src/services/deviceCleanup.ts", "utf8");
    expect(cleanup).not.toMatch(/"operations"|abandonFailedOfflineOperation|transitionOfflineOperation/);
    const queue = readFileSync("src/services/offlineQueue.ts", "utf8");
    const contexts = queue.slice(queue.indexOf("export async function deleteOfflineContexts"), queue.indexOf("export async function deleteOldConfirmedOperations"));
    expect(contexts).toContain('transaction("snapshots", "readwrite")');
    expect(contexts).not.toContain('"operations"');
    expect(contexts).not.toContain('"keys"');
  });
});
