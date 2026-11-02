import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "fictitious" }));
import { loadSectionDashboard } from "./sectionDashboard";
const actor = { id: "a", role: "primary_admin", schoolId: "school", sectionIds: ["Primaire"], status: "active" } as AppUser;
const result = { schoolId: "school", schoolYearId: "year", sections: ["Primaire"], currency: "CDF", students: 2, parents: 1,
  classRows: [{ className: "1ère Primaire", girls: 1, boys: 1, total: 2 }],
  personnel: { school_admin: 1, cashier: 1, discipline_director: 1 }, financialStats: { expected: 100, paid: 25, remaining: 75 }, feeProgressRows: [] };
afterEach(() => vi.unstubAllGlobals());
describe("synthèse scolaire serveur", () => {
  it("transmet uniquement les filtres autorisés", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => result })); vi.stubGlobal("fetch", fetcher);
    expect(await loadSectionDashboard(actor, "school", "year", {})).toEqual(result);
    await expect(loadSectionDashboard(actor, "school", "year", { section: "Secondaire" })).rejects.toThrow("interdite");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ schoolId: "other" }, { sections: ["Secondaire"] }, { parents: -1 }, { currency: "EUR" },
    { classRows: [{ className: "1ère Primaire", girls: 1, boys: 1, total: 3 }] },
    { classRows: [{ className: "1ère Primaire", girls: 0, boys: 0, total: 1 }] }])("refuse une réponse incohérente", async (patch) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...result, ...patch }) })));
    await expect(loadSectionDashboard(actor, "school", "year", {})).rejects.toThrow("invalide");
  });
});
