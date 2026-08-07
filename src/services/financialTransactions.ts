import type { Expense, Payment } from "../types";
import { getCurrentFirebaseIdToken } from "./auth";

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
};

async function financialRequest(input: Record<string, unknown> & { action: FinancialAction; clientRequestId: string }) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch("/api/manage-financial-transaction", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as FinancialResponse;
  if (!response.ok) throw new Error(payload.error ?? "Opération financière impossible.");
  return payload;
}

export function createPaymentTransaction(input: { schoolYearId: string; studentId: string; feeTypeId: string; amount: number; clientRequestId: string }) {
  return financialRequest({ action: "create-payment", ...input }).then((result) => {
    if (!result.payment) throw new Error("Réponse de paiement incomplète.");
    return result.payment;
  });
}

export function createExpenseTransaction(input: { schoolYearId: string; amount: number; category: string; description: string; beneficiary: string; paymentMethod: string; reference?: string; clientRequestId: string }) {
  return financialRequest({ action: "create-expense", ...input }).then((result) => {
    if (!result.expense) throw new Error("Réponse de dépense incomplète.");
    return result.expense;
  });
}

export function updatePaymentTransaction(input: { transactionId: string; amount: number; reason: string; clientRequestId: string }) {
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
