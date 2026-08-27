import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/control/ControlModule.tsx", "utf8");

describe("sécurité des mutations financières du module Contrôle", () => {
  it("laisse le listener Firestore comme source de vérité du state financier", () => {
    const paymentCall = source.indexOf("await createPaymentTransaction(");
    const expenseCall = source.indexOf("await createExpenseTransaction(");
    expect(paymentCall).toBeGreaterThan(-1);
    expect(expenseCall).toBeGreaterThan(-1);
    expect(source).not.toContain("updateData({ payments:");
    expect(source).not.toContain("updateData({ expenses:");
    expect(source.indexOf("paymentHistory.prependItem(payment)", paymentCall)).toBeGreaterThan(paymentCall);
    expect(source.indexOf("expenseHistory.prependItem(expense)", expenseCall)).toBeGreaterThan(expenseCall);
  });

  it("bloque les doubles soumissions et conserve un état de chargement", () => {
    expect(source).toContain("if (paymentSubmittingRef.current) return");
    expect(source).toContain("if (expenseSubmittingRef.current) return");
    expect(source).toContain("disabled={isPaymentEntryDisabled || paymentSubmitting}");
    expect(source).toContain("disabled={isExpenseEntryIncomplete || expenseSubmitting}");
    expect(source).toContain("paymentAttemptRef.current");
    expect(source).toContain("expenseAttemptRef.current");
  });

  it("n'utilise plus une longueur de tableau pour générer un reçu", () => {
    expect(source).not.toContain("generateReceiptNumber");
    expect(readFileSync("src/utils/finance.ts", "utf8")).not.toContain("payments.length + 1");
  });

  it("conserve le sélecteur de frais actif, bloque un solde nul et transmet la description", () => {
    expect(source).toContain('Ce type de frais est déjà soldé.');
    expect(source).toContain('Le montant saisi dépasse le solde restant pour ce type de frais.');
    expect(source).toContain('disabled={!selectedPaymentStudent || payableFeeTypes.length === 0 || paymentSubmitting}');
    expect(source).not.toContain('select value={selectedFeeTypeValue} onChange={(event) => setFeeTypeId(event.target.value)} disabled={isPaymentEntryDisabled}');
    expect(source).toContain('const [paymentNote, setPaymentNote] = useState("")');
    expect(source).toContain('note: trimmedNote || undefined');
    expect(source).toContain('payment.note &&');
    expect(source).toContain('payment.note ?? ""');
    expect(source).toContain('JSON.stringify([year.id, studentId, selectedFeeTypeValue, paymentAmount, trimmedNote])');
  });
});
