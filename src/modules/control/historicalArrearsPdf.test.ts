import { describe, expect, it } from "vitest";
import { historicalArrearsPdfSection } from "./historicalArrearsPdf";

describe("PDF financier — arriérés historiques", () => {
  it("préserve chaque année et frais distincts sans les ajouter aux totaux courants", () => {
    const html = historicalArrearsPdfSection([
      { schoolYearId: "a", yearName: "2025-2026", studentId: "s-a", feeTypeId: "f-a", feeName: "Minerval", expected: 100, paid: 40, remaining: 60, currency: "CDF" },
      { schoolYearId: "b", yearName: "2026-2027", studentId: "s-b", feeTypeId: "f-b", feeName: "Minerval", expected: 80, paid: 80, remaining: 0, currency: "USD" },
    ]);
    expect(html).toContain("2025-2026");
    expect(html).toContain("2026-2027");
    expect(html.match(/Minerval/g)).toHaveLength(2);
    expect(html).toContain("60,00 FC");
    expect(html).toContain("$0,00");
    expect(html).not.toContain("Totaux généraux");
  });

  it("affiche un état vide propre sans montant artificiel", () => {
    const html = historicalArrearsPdfSection([]);
    expect(html).toContain("Aucun arriéré pour cet élève.");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
});
