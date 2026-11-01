import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { AppUser } from "../types";
const load = vi.hoisted(() => vi.fn());
vi.mock("./personnelPayroll", () => ({ loadExpenseCashBalance: load }));
import { loadSectionSchoolCashBalance } from "./sectionSchoolCashBalance";
import { SchoolCashReadOnlyBalance } from "../components/SchoolCashReadOnlyBalance";
const user = { id: "test", role: "primary_admin", schoolId: "school", status: "active", sectionIds: ["Primaire"] } as AppUser;
const balance = { schoolId: "school", schoolYearId: "year", currency: "CDF", availableCents: 700, receivedCents: 1000, spentCents: 300 };
beforeEach(() => load.mockReset().mockResolvedValue(balance));
describe("lecture seule de la caisse générale", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"] as const)("autorise %s sans permission financière supplémentaire", async (role) => {
    expect(await loadSectionSchoolCashBalance({ ...user, role }, "school", "year")).toEqual(balance);
    expect(load).toHaveBeenCalledWith("year");
  });
  it("refuse un compte inactif et une section manquante avant la requête", async () => {
    for (const actor of [{ ...user, active: false }, { ...user, sectionIds: [] }]) {
      await expect(loadSectionSchoolCashBalance(actor, "school", "year")).rejects.toThrow();
    }
    expect(load).not.toHaveBeenCalled();
  });
  it("rejette les réponses d'une autre école, année ou devise inconnue", async () => {
    for (const invalid of [{ ...balance, schoolId: "other" }, { ...balance, schoolYearId: "other" }, { ...balance, currency: "EUR" }]) {
      load.mockResolvedValueOnce(invalid);
      await expect(loadSectionSchoolCashBalance(user, "school", "year")).rejects.toThrow("hors établissement");
    }
  });
  it("affiche une attente explicite et aucune commande de mutation", () => {
    const html = renderToStaticMarkup(createElement(SchoolCashReadOnlyBalance, { user, schoolId: "school", yearId: "year" }));
    expect(html).toContain("Lecture seule");
    expect(html).toContain("Chargement du solde général");
    expect(html).not.toMatch(/Supprimer|Annuler|Enregistrer|Modifier|0 FC/);
  });
});
