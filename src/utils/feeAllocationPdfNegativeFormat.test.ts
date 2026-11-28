// 1.43.0 (28/11/2026) : dans le PDF de la Répartition des frais, un montant négatif s'écrit « −$16,67 » / « −16 670,00 FC »,
// sur les lignes de rubrique et dans les totaux, jamais « $-16,67 ».
import { describe, expect, it } from "vitest";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationRow } from "./feeAllocationView";

const row = (currency: "USD" | "CDF", availableMinor: number) => ({ key: "r", schoolId: "school", schoolName: "École", yearName: "2026-2027", feeName: "Minerval", table: 1, rubricId: "personnel",
  classLabel: "1ère", currency, rubricName: "Personnel", amountMinor: 5000, percent: 50, config: { draftRevision: 1 }, stale: false,
  financial: { receivedMinor: 2000, spentMinor: 0, availableMinor, openingMinor: 1000, arrearsMinor: 0, formerMinor: 0, cumulativeReceivedMinor: 2000, cumulativeSpentMinor: 4667 } }) as unknown as AllocationRow;

describe("PDF Répartition — montant négatif au format des tableaux", () => {
  it("ligne de rubrique et total : « −$16,67 » en dollars, « −16 670,00 FC » en francs, jamais « $-16,67 »", () => {
    const usd = feeAllocationPdfSections([row("USD", -1667)], "Frais : Tous les frais", "École · 2026-2027").join("");
    expect(usd).toContain("−$16,67");
    expect(usd).toContain("disponible −$16,67");
    expect(usd).not.toMatch(/\$-|-\$/);
    const cdf = feeAllocationPdfSections([row("CDF", -1667000)], "Frais : Tous les frais", "École · 2026-2027").join("");
    expect(cdf).toMatch(/disponible −16\s670,00\sFC/);
    expect(cdf).not.toMatch(/-16|-\d/);
    // Un montant positif ne change pas.
    expect(feeAllocationPdfSections([row("USD", 1667)], "Frais : Tous les frais", "École · 2026-2027").join("")).toContain("$16,67");
  });
});
