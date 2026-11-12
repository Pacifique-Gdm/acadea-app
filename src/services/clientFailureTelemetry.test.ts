import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getIdToken: vi.fn(async () => "test-token") }));
vi.mock("../firebase", () => ({ auth: { currentUser: { uid: "fixture-user" } } }));
vi.mock("firebase/auth", () => ({ getIdToken: mocks.getIdToken }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { normalizedClientFailure, reportClientFailure } from "./clientFailureTelemetry";

describe("télémétrie P0 côté navigateur", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 }))); });

  it("distingue quota Firestore, limite HTTP API, quota Storage et stockage navigateur", () => {
    expect(normalizedClientFailure({ code: "firestore/resource-exhausted" }, "api")).toEqual({ service: "firestore", code: "resource-exhausted", status: null });
    expect(normalizedClientFailure({ code: "resource-exhausted", status: 429 }, "api")).toEqual({ service: "api", code: "resource-exhausted", status: 429 });
    expect(normalizedClientFailure({ code: "storage/quota-exceeded" }, "storage")).toEqual({ service: "storage", code: "quota-exceeded", status: null });
    expect(normalizedClientFailure({ name: "QuotaExceededError" }, "firestore")).toEqual({ service: "browser-storage", code: "browser-storage-quota", status: null });
    expect(normalizedClientFailure(new TypeError("secret@example.invalid"), "api")).toEqual({ service: "network", code: "network-failed", status: null });
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
});
