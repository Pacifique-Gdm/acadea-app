import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { userFacingError } from "../../utils/userFacingError";

const source = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8");
// Execute the real submit/reset handlers, without Firebase or real records.
function handlers() {
  const file = ts.createSourceFile("ControlModule.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && ["savePayment", "resetStudentDependentPaymentState"].includes(node.name?.text ?? "")) selected.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return ts.transpileModule(selected.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function runSubmit(save: () => Promise<unknown>) {
  const values: Record<string, unknown> = { StudentId: "a", PaymentStudentQuery: "Eleve A", FeeTypeId: "fee-a", Amount: "20", PaymentNote: "note A" };
  const setters = Object.fromEntries(["CashierControlFeedback", "CashierControlFeedbackDrawer", "PaymentError", "PaymentSubmitting", "PaymentArrears", "ArrearsError", "ArrearsLoading", ...Object.keys(values)].map(key => [`set${key}`, (value: unknown) => { values[key] = value; }]));
  const attempt = { current: null as unknown };
  const bindings = { ...setters, userFacingError, crypto: { randomUUID: () => "request-fictive" },
    paymentSubmittingRef: { current: false }, paymentStudentRequestRef: { current: 0 }, paymentAttemptRef: attempt,
    isArchivedContext: false, studentId: "a", selectedFeeTypeValue: "fee-a", amount: "20", paymentNote: "note A",
    selectedPaymentStudent: { id: "a" }, selectedPaymentFee: { id: "fee-a" }, selectedPaymentDebt: undefined,
    yearData: { payments: [] }, school: { id: "school-fictive" }, year: { id: "year-fictive" }, user: { role: "cashier" },
    support: {}, selectedPaymentFeeRemaining: 100,
    sumMoney: () => 0, toMoneyMinor: (n: number) => n * 100, remainingMoney: () => 100,
    createPaymentTransaction: vi.fn(save), paymentHistory: { prependItem: vi.fn() }, refreshExpenseCashBalance: async () => {},
  };
  const submit = new Function(...Object.keys(bindings), `${handlers()}; return savePayment;`)(...Object.values(bindings)) as () => Promise<void>;
  return { submit, values, attempt, bindings };
}
describe("formulaire neuf après paiement confirmé", () => {
  it("conserve la saisie pendant la requête puis efface toutes les données du premier élève", async () => {
    let confirm!: (value: unknown) => void;
    const pending = new Promise(resolve => { confirm = resolve; });
    const test = runSubmit(() => pending);
    const saving = test.submit();
    expect(test.values.StudentId).toBe("a");
    expect(test.values.Amount).toBe("20");
    confirm({ id: "payment-fictive" });
    await saving;
    for (const key of ["StudentId", "PaymentStudentQuery", "FeeTypeId", "Amount", "PaymentNote"]) expect(test.values[key], key).toBe("");
    expect(test.values.PaymentArrears).toEqual([]);
    expect(test.attempt.current).toBeNull();
    expect(test.bindings.paymentHistory.prependItem).toHaveBeenCalledOnce();
  });
  it.each(["Accès refusé", "Réponse serveur non confirmée"])("conserve la saisie et la même clé après %s", async error => {
    const test = runSubmit(async () => { throw new Error(error); });
    await test.submit();
    expect(test.values.StudentId).toBe("a");
    expect(test.values.PaymentStudentQuery).toBe("Eleve A");
    expect(test.values.Amount).toBe("20");
    expect(test.values.PaymentNote).toBe("note A");
    expect(test.values.PaymentError).toBe(error);
    const attempt = test.attempt.current;
    await test.submit();
    expect(test.attempt.current).toEqual(attempt);
    expect(test.bindings.paymentHistory.prependItem).not.toHaveBeenCalled();
  });
  it("ne ferme pas le formulaire du paiement suivant à l'expiration du message de succès", () => {
    expect(source).toContain('if (feedbackDrawer === "expense") setCashierControlDrawer');
  });
});
