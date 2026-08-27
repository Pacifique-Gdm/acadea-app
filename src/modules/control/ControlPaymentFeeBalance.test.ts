import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8");

describe("Contrôle — métriques du paiement sélectionné", () => {
  it("calcule Attendu, Payé et Solde uniquement pour le frais sélectionné", () => {
    expect(source).toContain("sumPaymentsForStudentFee(controlIndexes, selectedPaymentStudent.id, selectedPaymentFee.id)");
    expect(source).toContain("expected: selectedPaymentFee?.amount ?? 0");
    expect(source).toContain("remaining: selectedPaymentFeeRemaining");
    expect(source).toContain('label="Attendu" value={formatMoney(selectedPaymentFeeBalance.expected)}');
    expect(source).toContain('label="Payé" value={formatMoney(selectedPaymentFeeBalance.paid)}');
    expect(source).toContain('label="Solde" value={formatMoney(selectedPaymentFeeBalance.remaining)}');
    expect(source).not.toContain("selectedPaymentBalance");
  });
});
