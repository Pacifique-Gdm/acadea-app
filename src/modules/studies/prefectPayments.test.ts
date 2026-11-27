import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/auth", () => ({ getCurrentFirebaseIdToken: async () => "jeton" }));
vi.mock("../../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { cachedPrefectPayments, clearPrefectPaymentsCache, loadPrefectPayments, prefectPaymentsNeedsLoad } from "./prefectPayments";

const payments = { sections: ["Primaire"], classes: [{ className: "1ère Primaire", students: 3, upToDate: 2, late: 1, unknown: 0, upToDateRate: 67, lateRate: 33 }], overall: { students: 3, upToDate: 2, late: 1, unknown: 0, upToDateRate: 67 } };
const fetcher = () => vi.fn(async () => new Response(JSON.stringify(payments), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const portal = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
const section = readFileSync(new URL("./PrefectPaymentsSection.tsx", import.meta.url), "utf8");

describe("lot P4 : situation des paiements du Préfet d'études (écran)", () => {
  beforeEach(() => clearPrefectPaymentsCache());

  it("lecture gardée en mémoire ; relecture seulement après un appui sur la flèche de l'en-tête", async () => {
    expect(prefectPaymentsNeedsLoad("u1", "school-a", "year-1", 0)).toBe(true);
    const fetchMock = fetcher();
    await loadPrefectPayments("u1", "school-a", "year-1", { headerRefresh: 0, fetcher: fetchMock });
    expect(cachedPrefectPayments("u1", "school-a", "year-1")?.classes[0].upToDateRate).toBe(67);
    expect(prefectPaymentsNeedsLoad("u1", "school-a", "year-1", 0)).toBe(false);
    expect(prefectPaymentsNeedsLoad("u1", "school-a", "year-1", 1)).toBe(true);
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toEqual({ action: "prefect-payments", schoolId: "school-a", schoolYearId: "year-1" });
  });

  it("erreur du serveur : message clair, rien gardé", async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "Réservé au Préfet d'études." }), { status: 403 })) as unknown as typeof fetch;
    await expect(loadPrefectPayments("u1", "school-a", "year-1", { fetcher: failing })).rejects.toThrow("Réservé au Préfet d'études.");
    expect(cachedPrefectPayments("u1", "school-a", "year-1")).toBeUndefined();
  });

  it("sur le Dashboard du Préfet seulement ; aucun bouton dans le Menu", () => {
    expect(portal).toContain("{isPrefectOfStudies(user) && <PrefectPaymentsSection uid={user.id}");
    expect(portal).not.toContain("Situation des paiements</strong>");
    expect(portal).not.toContain('setDrawer("prefect-payments")');
  });

  it("aucun montant affiché, aucun bouton (ni « Actualiser »), flèche de l'en-tête écoutée", () => {
    expect(section).toContain("Aucun montant affiché");
    expect(section).not.toMatch(/formatMoney|USD|CDF/);
    expect(section).not.toContain("<button");
    expect(section).toContain("subscribeStaffChildrenRefresh");
  });
});
