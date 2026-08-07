import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/control/ControlModule.tsx", "utf8");

describe("sécurité des mutations financières du module Contrôle", () => {
  it("attend la confirmation serveur avant la mise à jour locale", () => {
    const paymentCall = source.indexOf("await createPaymentTransaction(");
    const paymentUpdate = source.indexOf("updateData({ payments:", paymentCall);
    const expenseCall = source.indexOf("await createExpenseTransaction(");
    const expenseUpdate = source.indexOf("updateData({ expenses:", expenseCall);
    expect(paymentCall).toBeGreaterThan(-1);
    expect(paymentUpdate).toBeGreaterThan(paymentCall);
    expect(expenseCall).toBeGreaterThan(-1);
    expect(expenseUpdate).toBeGreaterThan(expenseCall);
    expect(source.slice(paymentUpdate, paymentUpdate + 220)).toContain("persist: false");
    expect(source.slice(expenseUpdate, expenseUpdate + 220)).toContain("persist: false");
  });

  it("bloque les doubles soumissions et conserve un état de chargement", () => {
    expect(source).toContain("if (paymentSubmittingRef.current) return");
    expect(source).toContain("if (expenseSubmittingRef.current) return");
    expect(source).toContain("disabled={isPaymentEntryDisabled || paymentSubmitting}");
    expect(source).toContain("disabled={expenseSubmitting}");
    expect(source).toContain("paymentAttemptRef.current");
    expect(source).toContain("expenseAttemptRef.current");
  });

  it("n'utilise plus une longueur de tableau pour générer un reçu", () => {
    expect(source).not.toContain("generateReceiptNumber");
    expect(readFileSync("src/utils/finance.ts", "utf8")).not.toContain("payments.length + 1");
  });
});
