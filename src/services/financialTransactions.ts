import type { Expense, Payment } from "../types";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import { getCurrentFirebaseIdToken } from "./auth";
import { validateArrearsTotals, type ArrearsTotals } from "../utils/arrearsFilter";

type FinancialAction =
  | "create-payment"
  | "create-expense"
  | "update-payment"
  | "update-expense"
  | "delete-payment"
  | "delete-expense";

type FinancialResponse = {
  payment?: Payment;
  expense?: Expense;
  deletedId?: string;
  kind?: "payment" | "expense";
  idempotent?: boolean;
  error?: string;
  code?: string;
  debts?: HistoricalDebt[];
  settled?: HistoricalDebt[];
  totals?: ArrearsTotals;
  details?: Record<string, HistoricalDebt[]>;
  resolvedCurrencies?: Record<string, "USD" | "CDF">;
};

export type HistoricalDebt = {
  schoolYearId: string;
  yearName: string;
  studentId: string;
  feeTypeId: string;
  feeName: string;
  expected: number;
  paid: number;
  remaining: number;
  currency: "USD" | "CDF";
};

async function financialRequest(input: Record<string, unknown> & { action: FinancialAction | "list-arrears" | "list-arrears-batch" | "list-resolved-expense-currencies"; clientRequestId?: string }) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as FinancialResponse;
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Opération financière impossible."));
  return payload;
}

export async function resolveHistoricalExpenseCurrencies(expenses: Expense[]): Promise<Expense[]> {
  const unresolvedIds = [...new Set(expenses.filter((expense) => !expense.currency && expense.personnelPaymentId)
    .map((expense) => expense.id))];
  if (!unresolvedIds.length) return expenses;
  try {
    const resolved = new Map<string, "USD" | "CDF">();
    for (let index = 0; index < unresolvedIds.length; index += 50) {
      const response = await financialRequest({ action: "list-resolved-expense-currencies",
        expenseIds: unresolvedIds.slice(index, index + 50) });
      for (const [id, currency] of Object.entries(response.resolvedCurrencies ?? {})) {
        if (currency === "CDF" || currency === "USD") resolved.set(id, currency);
      }
    }
    return expenses.map((expense) => expense.currency || !resolved.has(expense.id)
      ? expense : { ...expense, currency: resolved.get(expense.id) });
  } catch {
    // Preserve the unknown currency and keep financial exports blocked on API failure.
    return expenses;
  }
}

export function createPaymentTransaction(input: { schoolYearId: string; studentId: string; feeTypeId: string; debtSchoolYearId?: string; amount: number; note?: string; clientRequestId: string }) {
  return financialRequest({ action: "create-payment", ...input }).then((result) => {
    if (!result.payment) throw new Error("Réponse de paiement incomplète.");
    return result.payment;
  });
}

export function loadStudentArrears(input: { schoolYearId: string; studentId: string }) {
  return financialRequest({ action: "list-arrears", ...input }).then((result) => {
    if (!Array.isArray(result.debts) || !Array.isArray(result.settled)) throw new Error("Réponse des arriérés incomplète.");
    return { debts: result.debts, settled: result.settled };
  });
}

export async function loadStudentArrearsBatch(schoolYearId: string, studentIds: string[]) {
  const result = await financialRequest({ action: "list-arrears-batch", schoolYearId, studentIds });
  return validateArrearsTotals(result.totals, studentIds);
}

export async function loadStudentArrearsDetailsBatch(schoolYearId: string, studentIds: string[]) {
  const result = await financialRequest({ action: "list-arrears-batch", schoolYearId, studentIds, includeDetails: true });
  validateArrearsTotals(result.totals, studentIds);
  if (!result.details || studentIds.some((id) => !Array.isArray(result.details?.[id]))) throw new Error("Détail des arriérés incomplet.");
  return result.details;
}

export function createExpenseTransaction(input: { schoolYearId: string; amount: number; category: string; description: string; beneficiary: string; paymentMethod: string; reference?: string; clientRequestId: string }) {
  return financialRequest({ action: "create-expense", ...input }).then((result) => {
    if (!result.expense) throw new Error("Réponse de dépense incomplète.");
    return result.expense;
  });
}

export function updatePaymentTransaction(input: { transactionId: string; amount: number; reason: string; confirmation: string; expectedUpdatedAt: string; clientRequestId: string }) {
  return financialRequest({ action: "update-payment", ...input }).then((result) => {
    if (!result.payment) throw new Error("Réponse de correction de paiement incomplète.");
    return result.payment;
  });
}

export function updateExpenseTransaction(input: { transactionId: string; amount: number; category: string; description: string; reason: string; clientRequestId: string }) {
  return financialRequest({ action: "update-expense", ...input }).then((result) => {
    if (!result.expense) throw new Error("Réponse de correction de dépense incomplète.");
    return result.expense;
  });
}

export function deleteFinancialTransaction(input: { kind: "payment" | "expense"; transactionId: string; reason: string; clientRequestId: string }) {
  return financialRequest({ action: input.kind === "payment" ? "delete-payment" : "delete-expense", transactionId: input.transactionId, reason: input.reason, clientRequestId: input.clientRequestId }).then((result) => {
    if (result.deletedId !== input.transactionId || result.kind !== input.kind) throw new Error("Réponse de suppression financière incomplète.");
    return result;
  });
}
