import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8");

describe("Contrôle — métriques du paiement sélectionné", () => {
  it("calcule Attendu, Payé et Solde uniquement pour le frais sélectionné", () => {
    expect(source).toContain("sumPaymentsForStudentFee(controlIndexes, selectedPaymentStudent.id, selectedPaymentFee.id)");
    expect(source).toContain("expected: selectedPaymentFee?.amount ?? selectedPaymentDebt?.expected ?? 0");
    expect(source).toContain("remaining: selectedPaymentFeeRemaining");
    expect(source).toContain('formatCurrencyMoney(selectedPaymentFeeBalance.expected, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.expected)');
    expect(source).toContain('formatCurrencyMoney(selectedPaymentFeeBalance.paid, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.paid)');
    expect(source).toContain('formatCurrencyMoney(selectedPaymentFeeBalance.remaining, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.remaining)');
    expect(source).not.toContain("selectedPaymentBalance");
  });
});
