import type { AuditLog, Expense, Payment } from "../types";
import { nearestCreationLog } from "./audit";

export function generateReceiptNumber(payments: Payment[], yearName: string) {
  const year = yearName.slice(0, 4);
  return `REC-${year}-${String(payments.length + 1).padStart(4, "0")}`;
}

export function resolvePaymentCashierName(payment: Payment, auditLogs: AuditLog[]) {
  const paymentKeys = [payment.receiptNumber, payment.id].filter(Boolean);
  const matchingLog = nearestCreationLog(auditLogs, "Création paiement", payment.createdAt ?? payment.paidAt, (details) =>
    paymentKeys.some((key) => details.includes(String(key))),
  );
  return matchingLog?.actorName || payment.cashierName || "-";
}

export function resolveExpenseCashierName(expense: Expense, auditLogs: AuditLog[]) {
  const matchingLog = nearestCreationLog(auditLogs, "Création dépense", expense.createdAt ?? expense.spentAt, (details) =>
    details.includes(expense.category) && details.includes(`$${expense.amount}`),
  );
  return matchingLog?.actorName || expense.cashierName || "-";
}
