import { describe, expect, it } from "vitest";
import { formatRecordedOperation, formatRecordedTotals, hasCurrencyOutside, totalsByRecordedCurrency } from "./operationCurrency";

describe("devises enregistrées des opérations", () => {
  it("garde les montants CDF et USD séparés après un changement de devise par défaut", () => {
    const totals = totalsByRecordedCurrency([{ amount: 500000, currency: "CDF" }, { amount: 100, currency: "USD" }]);
    expect(totals).toEqual({ CDF: 500000, USD: 100, unknownCount: 0 });
    expect(formatRecordedTotals(totals, "CDF")).toBe(formatRecordedTotals(totals, "USD"));
  });

  it("conserve les centimes dans les totaux de caisse et le libellé des reçus", () => {
    const totals = totalsByRecordedCurrency([
      { amount: 0.1, currency: "USD" }, { amount: 0.2, currency: "USD" },
      { amount: 100.5, currency: "CDF" }, { amount: 50.25, currency: "CDF" },
    ]);
    expect(totals).toEqual({ USD: 0.3, CDF: 150.75, unknownCount: 0 });
    expect(formatRecordedOperation({ amount: 50.25, currency: "USD" })).toBe("$50,25");
  });

  it("signale une opération sans devise sans la classer arbitrairement", () => {
    const totals = totalsByRecordedCurrency([{ amount: 100 }]);
    expect(totals).toEqual({ CDF: 0, USD: 0, unknownCount: 1 });
    expect(formatRecordedOperation({ amount: 100 })).toBe("Devise historique inconnue");
  });

  it("débloque la synthèse seulement après résolution probante de la dépense liée", () => {
    expect(hasCurrencyOutside([{ amount: 100, currency: "USD" }, { amount: 25 }], "USD")).toBe(true);
    expect(hasCurrencyOutside([{ amount: 100, currency: "USD" }, { amount: 25, currency: "USD" }], "USD")).toBe(false);
    expect(hasCurrencyOutside([{ amount: 100, currency: "USD" }, { amount: 25, currency: "CDF" }], "USD")).toBe(true);
  });
});
