import { describe, expect, it } from "vitest";
import { formatRecordedOperation, formatRecordedTotals, totalsByRecordedCurrency } from "./operationCurrency";

describe("devises enregistrées des opérations", () => {
  it("garde les montants CDF et USD séparés après un changement de devise par défaut", () => {
    const totals = totalsByRecordedCurrency([{ amount: 500000, currency: "CDF" }, { amount: 100, currency: "USD" }]);
    expect(totals).toEqual({ CDF: 500000, USD: 100, unknownCount: 0 });
    expect(formatRecordedTotals(totals, "CDF")).toBe(formatRecordedTotals(totals, "USD"));
  });

  it("signale une opération sans devise sans la classer arbitrairement", () => {
    const totals = totalsByRecordedCurrency([{ amount: 100 }]);
    expect(totals).toEqual({ CDF: 0, USD: 0, unknownCount: 1 });
    expect(formatRecordedOperation({ amount: 100 })).toBe("Devise historique inconnue");
  });
});
