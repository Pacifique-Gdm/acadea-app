import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getIdToken: vi.fn(async () => "test-token") }));
vi.mock("../firebase", () => ({ auth: { currentUser: { uid: "fixture-user" } } }));
vi.mock("firebase/auth", () => ({ getIdToken: mocks.getIdToken }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { createClientReportLimiter, normalizedClientFailure, reportClientFailure } from "./clientFailureTelemetry";

describe("télémétrie P0 côté navigateur", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 }))); });
  afterEach(() => vi.unstubAllGlobals());

  it("distingue quota Firestore, limite HTTP API, quota Storage et stockage navigateur", () => {
    expect(normalizedClientFailure({ code: "firestore/resource-exhausted" }, "api")).toEqual({ service: "firestore", code: "resource-exhausted", status: null });
    expect(normalizedClientFailure({ code: "resource-exhausted", status: 429 }, "api")).toEqual({ service: "api", code: "resource-exhausted", status: 429 });
    expect(normalizedClientFailure({ code: "storage/quota-exceeded" }, "storage")).toEqual({ service: "storage", code: "quota-exceeded", status: null });
    expect(normalizedClientFailure({ name: "QuotaExceededError" }, "firestore")).toEqual({ service: "browser-storage", code: "browser-storage-quota", status: null });
    expect(normalizedClientFailure(new TypeError("secret@example.invalid"), "api")).toEqual({ service: "network", code: "network-failed", status: null });
    expect(normalizedClientFailure({ code: "functions/internal" }, "functions")).toEqual({ service: "functions", code: "internal", status: null });
    expect(normalizedClientFailure({ code: "internal", status: 500 }, "api")).toEqual({ service: "api", code: "internal", status: 500 });
  });

  it("n'envoie que des métadonnées bornées, sans message ni identifiant scolaire", async () => {
    await reportClientFailure("students.page", { code: "firestore/resource-exhausted", message: "secret@example.invalid", schoolId: "school-private" }, Date.now() - 42);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/manage-financial-transaction");
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body.action).toBe("report-client-failure");
    expect(body.event).toMatchObject({ operation: "students.page", service: "firestore", code: "resource-exhausted", status: null, attempts: 1 });
    expect((body.event as Record<string, unknown>).durationMs).toEqual(expect.any(Number));
    expect((body.event as Record<string, unknown>).correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(body)).not.toContain("secret@example.invalid");
    expect(JSON.stringify(body)).not.toContain("school-private");
    expect(mocks.getIdToken).toHaveBeenCalledWith({ uid: "fixture-user" }, false);
  });

  it("ne réessaie pas une erreur de télémétrie", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    await expect(reportClientFailure("ai.secretary", { code: "functions/unavailable" })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("déduplique une même panne sans stockage local ni nouvelle lecture Firestore", async () => {
    await reportClientFailure("dashboard.arrears", { code: "resource-exhausted", status: 429 });
    await reportClientFailure("dashboard.arrears", { code: "resource-exhausted", status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("renouvelle le budget après dix minutes et réserve deux places aux erreurs critiques", () => {
    const allow = createClientReportLimiter();
    const now = 1_000_000;
    expect(allow("network-1", false, now)).toBe(true);
    expect(allow("network-1", false, now + 1)).toBe(false);
    expect(allow("network-2", false, now + 2)).toBe(true);
    expect(allow("network-3", false, now + 3)).toBe(true);
    expect(allow("network-4", false, now + 4)).toBe(false);
    expect(allow("firestore-quota", true, now + 5)).toBe(true);
    expect(allow("storage-quota", true, now + 6)).toBe(true);
    expect(allow("functions-error", true, now + 7)).toBe(false);
    expect(allow("network-1", false, now + 10 * 60_000)).toBe(true);
    expect(createClientReportLimiter()("network-1", false, now)).toBe(true);
  });

  it("n'ajoute aucune requête de diagnostic quand le navigateur est hors connexion", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await reportClientFailure("students.count", { code: "firestore/unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
