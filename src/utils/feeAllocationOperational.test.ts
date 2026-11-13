import { describe, expect, it } from "vitest";
import { allocationFinancialTotals, projectAllocations } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationWorkspace } from "../services/feeAllocation";

const id = "a".repeat(32);
function workspace(): AllocationWorkspace {
  return { school: { id: "school", name: "Fictif", activeSchoolYearId: "year" }, year: { id: "year", schoolId: "school", name: "2026", status: "active", startsAt: null, endsAt: null },
    currency: "USD", canConfigure: true, operational: false, fees: [{ id: "fee", name: "Minerval", className: "1ère", classOptionKey: null, amount: 100 }],
    configs: [{ id: "config", schoolId: "school", schoolYearId: "year", feeTypeId: "fee", className: "1ère", currency: "USD", draftRevision: 1,
      draft: { rubrics: [{ id, name: "Fonctionnement", mode: "percent", basisPoints: 10000 }], feeAmountMinor: 10000, updatedAt: "2026-01-01", updatedBy: "admin" } }],
    ledger: { testOnly: true, status: "ACTIVE", cutoffAt: "2026-01-01", rubrics: [{ id, name: "Fonctionnement" }], balances: [{ rubricId: id, openingMinor: 1000, receivedMinor: 5000, spentMinor: 2000, reservedMinor: 0, availableMinor: 4000 }],
      movements: [
        { id: "opening", sourceType: "opening", type: "opening", amountMinor: 1000, lines: [{ rubricId: id, amountMinor: 1000 }], feeTypeId: null, className: null, classOptionKey: null, originSchoolYearId: "year", postedAt: "2026-01-01" },
        { id: "receipt", sourceType: "payment", type: "receipt", amountMinor: 5000, lines: [{ rubricId: id, amountMinor: 5000 }], feeTypeId: "fee", className: "1ère", classOptionKey: null, originSchoolYearId: "old", postedAt: "2026-02-01" },
        { id: "expense", sourceType: "expense", type: "expense", amountMinor: -2000, lines: [{ rubricId: id, amountMinor: -2000 }], feeTypeId: null, className: null, classOptionKey: null, originSchoolYearId: "year", postedAt: "2026-03-01" },
      ] } };
}
describe("projection et PDF du registre rapproché", () => {
  it("distingue le disponible de fin de période de la variation de la période", () => {
    const rows = projectAllocations([workspace()], { kind: "period", value: "custom", from: "2026-03-01", to: "2026-03-31" });
    expect(rows[0].financial).toEqual({ receivedMinor: 0, spentMinor: 2000, availableMinor: 4000, openingMinor: 1000, arrearsMinor: 0, cumulativeReceivedMinor: 5000, cumulativeSpentMinor: 2000 });
    const earlier = projectAllocations([workspace()], { kind: "period", value: "custom", from: "2026-02-01", to: "2026-02-28" });
    expect(earlier[0].financial).toMatchObject({ receivedMinor: 5000, spentMinor: 0, availableMinor: 6000, arrearsMinor: 5000 });
  });
  it("ne fabrique pas une dépense par frais ou un solde de classe", () => {
    const rows = projectAllocations([workspace()], { kind: "fee", value: JSON.stringify(["school", "different-fee"]), from: "", to: "" });
    expect(rows[0].financial).toMatchObject({ receivedMinor: 0, spentMinor: 2000, availableMinor: 4000 });
    expect(rows[0].feeName).toContain("global");
    const pdf = feeAllocationPdfSections(rows, "Frais différent", "Fictif").join("");
    expect(pdf).toContain("Frais différent"); expect(pdf).toContain("Selon le filtre"); expect(pdf).toContain("Situation globale de la rubrique à la fin de la période"); expect(pdf).toContain("40");
    expect(pdf).toContain("ouverture"); expect(pdf).toContain("dont arriérés"); expect(pdf).not.toContain("brouillon v");
  });
  it("sépare les monnaies et refuse un total opérationnel mêlé à une école non activée", () => {
    const a = workspace(), b = { ...workspace(), currency: "CDF" as const };
    const rows = projectAllocations([a, b], { kind: "fee", value: "", from: "", to: "" });
    expect(allocationFinancialTotals(rows, "availableMinor")).toEqual([{ currency: "USD", value: 4000 }, { currency: "CDF", value: 4000 }]);
    for (const [field, value] of [["openingMinor", 1000], ["cumulativeReceivedMinor", 5000], ["cumulativeSpentMinor", 2000]] as const) {
      expect(allocationFinancialTotals(rows, field)).toEqual([{ currency: "USD", value }, { currency: "CDF", value }]);
    }
    expect(allocationFinancialTotals([...rows, { ...rows[0], financial: undefined }], "availableMinor")[0].value).toBeNull();
  });
  it("explique exactement les écarts Staging de 56 USD et 211 USD sans modifier le registre", () => {
    const w = workspace(), unallocated = "UNALLOCATED";
    w.ledger!.rubrics = [{ id, name: "Rubrique fictive 1" }, { id: unallocated, name: "Non affecté" }];
    const movement = (key: string, sourceType: "opening" | "payment" | "expense", a: number, b: number, feeTypeId: string | null, postedAt = "2026-11-13") => ({
      id: key, sourceType, type: sourceType, amountMinor: a + b, lines: [{ rubricId: id, amountMinor: a }, { rubricId: unallocated, amountMinor: b }],
      feeTypeId, className: feeTypeId === "selected" ? "2ème" : "1ère", classOptionKey: null, originSchoolYearId: "year", postedAt,
    });
    w.ledger!.movements = [movement("opening", "opening", 0, 500, null), movement("selected", "payment", 400, 4400, "selected"),
      movement("other", "payment", 5600, 21100, "other"), movement("expense", "expense", -4300, 0, null), movement("compensation", "expense", 100, 0, null)];
    w.ledger!.balances = [{ rubricId: id, openingMinor: 0, receivedMinor: 6000, spentMinor: 4200, reservedMinor: 0, availableMinor: 1800 },
      { rubricId: unallocated, openingMinor: 500, receivedMinor: 25500, spentMinor: 0, reservedMinor: 0, availableMinor: 26000 }];
    const before = structuredClone(w);
    for (const filter of [{ kind: "fee", value: JSON.stringify(["school", "selected"]) }, { kind: "class", value: JSON.stringify(["school", "2ème"]) }] as const) {
      const rows = projectAllocations([w], { ...filter, from: "", to: "" });
      expect(rows[0].financial).toMatchObject({ receivedMinor: 400, cumulativeReceivedMinor: 6000, cumulativeSpentMinor: 4200, openingMinor: 0, availableMinor: 1800 });
      expect(rows[1].financial).toMatchObject({ receivedMinor: 4400, cumulativeReceivedMinor: 25500, cumulativeSpentMinor: 0, openingMinor: 500, availableMinor: 26000 });
      expect(rows.map(r => r.financial!.cumulativeReceivedMinor - r.financial!.receivedMinor)).toEqual([5600, 21100]);
      rows.forEach(r => expect(r.financial!.openingMinor + r.financial!.cumulativeReceivedMinor - r.financial!.cumulativeSpentMinor).toBe(r.financial!.availableMinor));
    }
    const empty = projectAllocations([w], { kind: "period", value: "custom", from: "2026-11-14", to: "2026-11-14" });
    expect(empty.map(r => r.financial!.receivedMinor)).toEqual([0, 0]);
    expect(empty.map(r => r.financial!.availableMinor)).toEqual([1800, 26000]);
    expect(empty.map(r => r.financial!.cumulativeSpentMinor)).toEqual([4200, 0]);
    const earlier = projectAllocations([w], { kind: "period", value: "custom", from: "2026-11-12", to: "2026-11-12" });
    expect(earlier.every(r => r.financial!.availableMinor === 0)).toBe(true);
    expect(w).toEqual(before);
    const html = feeAllocationPdfSections(empty, "Période sans mouvement", "USD").join("");
    for (const heading of ["Selon le filtre", "Ouverture", "Encaissements cumulés", "Dépenses nettes cumulées", "Solde disponible"]) expect(html).toContain(heading);
    expect(html).toContain("$60,00"); expect(html).toContain("$255,00"); expect(html).toContain("$42,00");
  });
  it("refuse une réservation non expliquée au lieu de présenter une égalité trompeuse", () => {
    const w = workspace(); w.ledger!.balances[0].reservedMinor = 100;
    expect(() => projectAllocations([w], { kind: "fee", value: "", from: "", to: "" })).toThrow("Réservations");
  });
});
