import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8");
const toolbarStart = source.indexOf('<div className="mb-3 w-full min-w-0 max-w-full">');
const toolbarEnd = source.indexOf('<div className="grid min-w-0 gap-3">', toolbarStart);
const toolbar = source.slice(toolbarStart, toolbarEnd);

describe("actions Contrôle partagées selon le rôle", () => {
  it("utilise une seule grille responsive pour les contrôles communs", () => {
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(toolbar).toContain("grid-cols-1 items-stretch gap-2 box-border sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center lg:gap-1.5");
    expect(toolbar.match(/aria-label="Classe"/g)).toHaveLength(1);
    expect(toolbar.match(/Exporter PDF/g)).toHaveLength(1);
    expect(toolbar.match(/Réinitialiser/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("conserve le même ordre pour les actions communes", () => {
    const labels = ["Classe", "Montant payé", "Filtre", "Exporter PDF", "Réinitialiser", "Historique"];
    let previous = -1;
    for (const label of labels) {
      const index = toolbar.indexOf(label, previous + 1);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it("masque Avertissement au Caissier et regroupe ses deux créations", () => {
    expect(toolbar).toContain('user.role !== "cashier" && <button');
    expect(toolbar).toContain("Avertissement");
    expect(toolbar).toContain('user.role === "cashier" && canPay');
    expect(toolbar).toContain('<Plus className="h-4 w-4" /> Enregistrer');
    expect(toolbar).not.toContain("Enregistrer un paiement");
    expect(toolbar).not.toContain("Enregistrer une dépense");
  });

  it("utilise un drawer et un select uniques pour chaque regroupement", () => {
    expect(source).toContain('<AdminDrawer title="Historique"');
    expect(source).toContain('aria-label="Type d\'historique"');
    const paymentHistoryOption = source.indexOf('<option value="payments">Historique des paiements</option>');
    const expenseHistoryOption = source.indexOf('<option value="expenses">Historique des dépenses</option>');
    expect(paymentHistoryOption).toBeGreaterThan(-1);
    expect(expenseHistoryOption).toBeGreaterThan(paymentHistoryOption);
    expect(source).toContain('historyKind === "payments"');
    expect(source).toContain('historyKind === "expenses" && renderExpenseHistoryContent()');
    expect(source).toContain('const cashierDrawerTitle = "Enregistrer"');
    expect(source).toContain('aria-label="Type d\'enregistrement"');
    expect(source).toContain('<option value="payment">Enregistrer un paiement</option>');
    expect(source).toContain('<option value="expense">Enregistrer une dépense</option>');
    expect(source).toContain('cashierControlDrawer === "payment"');
    expect(source).toContain('cashierControlDrawer === "expense"');
  });

  it("place les deux validations financières du drawer en pleine largeur", () => {
    expect(source).toContain('disabled={isPaymentEntryDisabled || paymentSubmitting} className="primary-button w-full justify-center"');
    expect(source).toContain('disabled={isExpenseEntryIncomplete || expenseSubmitting} className="primary-button w-full justify-center"');
  });

  it("maintient les mutations interdites hors du DOM du Caissier", () => {
    expect(source).toContain('const canCorrectPayments = user.role === "school_admin"');
    expect(source).toContain('const canManageExpenses = user.role === "school_admin"');
    expect(source).toContain('{canCorrectPayments && <button onClick={() => correctPayment(payment)}');
    expect(source).toContain('{canCorrectPayments && <button onClick={() => deletePayment(payment)}');
    expect(source).toContain('{user.role !== "cashier" && canManageExpenses && <button onClick={() => openEditExpense(expense)}');
    expect(source).toContain('{user.role !== "cashier" && canManageExpenses && <button onClick={() => setExpenseDeleteTarget(expense)}');
  });
});
