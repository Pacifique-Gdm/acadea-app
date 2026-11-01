import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";
import { loadControlHistoryPage } from "./controlHistory";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "synthetic-test-token" }));

const actor = (role: AppUser["role"], schoolId = "school-a") => ({ role, schoolId });
afterEach(() => vi.unstubAllGlobals());

describe("historique financier par établissement et section", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"] as const)(
    "utilise exclusivement l'API bornée pour %s",
    async (role) => {
      const fetcher = vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toContain("manage-financial-transaction");
        expect(options.method).toBe("POST");
        return { ok: true, json: async () => ({ items: [], nextCursorId: "next-a" }) };
      });
      vi.stubGlobal("fetch", fetcher);
      for (const kind of ["payments", "expenses", "cashInflows"] as const) {
        const page = await loadControlHistoryPage(kind, "school-a", "year-a", actor(role), { id: "previous-a" });
        expect(page).toMatchObject({ items: [], lastVisible: { id: "next-a" }, hasMore: true });
        const options = fetcher.mock.calls.at(-1)?.[1] as RequestInit;
        expect(JSON.parse(String(options.body))).toEqual({ action: "list-section-financial-history", kind, schoolYearId: "year-a", cursorId: "previous-a" });
      }
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it("refuse également une école étrangère avant la lecture Firestore", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(loadControlHistoryPage("payments", "school-b", "year-a", actor("school_admin")))
      .rejects.toThrow("hors établissement");
    await expect(loadControlHistoryPage("expenses", "school-b", "year-a", actor("primary_admin")))
      .rejects.toThrow("hors établissement");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuse une réponse serveur étrangère ou un échec d'autorisation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: "foreign", schoolId: "school-b", schoolYearId: "year-a" }], nextCursorId: null }) })));
    await expect(loadControlHistoryPage("expenses", "school-a", "year-a", actor("primary_admin")))
      .rejects.toThrow("invalide");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Accès refusé." }) })));
    await expect(loadControlHistoryPage("expenses", "school-a", "year-a", actor("primary_admin")))
      .rejects.toThrow("Accès refusé");
  });
});
