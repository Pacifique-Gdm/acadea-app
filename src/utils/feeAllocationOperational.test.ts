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
    expect(rows[0].financial).toEqual({ receivedMinor: 0, spentMinor: 2000, availableMinor: 4000, openingMinor: 1000, arrearsMinor: 0 });
    const earlier = projectAllocations([workspace()], { kind: "period", value: "custom", from: "2026-02-01", to: "2026-02-28" });
    expect(earlier[0].financial).toMatchObject({ receivedMinor: 5000, spentMinor: 0, availableMinor: 6000, arrearsMinor: 5000 });
  });
  it("ne fabrique pas une dépense par frais ou un solde de classe", () => {
    const rows = projectAllocations([workspace()], { kind: "fee", value: JSON.stringify(["school", "different-fee"]), from: "", to: "" });
    expect(rows[0].financial).toMatchObject({ receivedMinor: 0, spentMinor: 2000, availableMinor: 4000 });
    expect(rows[0].feeName).toContain("global");
    const pdf = feeAllocationPdfSections(rows, "Frais différent", "Fictif").join("");
    expect(pdf).toContain("Frais différent"); expect(pdf).toContain("globaux"); expect(pdf).toContain("40");
  });
  it("sépare les monnaies et refuse un total opérationnel mêlé à une école non activée", () => {
    const a = workspace(), b = { ...workspace(), currency: "CDF" as const };
    const rows = projectAllocations([a, b], { kind: "fee", value: "", from: "", to: "" });
    expect(allocationFinancialTotals(rows, "availableMinor")).toEqual([{ currency: "USD", value: 4000 }, { currency: "CDF", value: 4000 }]);
    expect(allocationFinancialTotals([...rows, { ...rows[0], financial: undefined }], "availableMinor")[0].value).toBeNull();
  });
});
