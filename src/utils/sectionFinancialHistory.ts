import type { CashInflow, Expense, Payment, Student } from "../types";
import type { ActivityHistoryItem } from "./activityHistory";
import { normalizeActivityTimestamp } from "./activityHistory";
import { formatRecordedOperation } from "./operationCurrency";

/** The API authorizes records; this projection also refuses payments without a visible linked student. */
export function buildSectionFinancialHistoryItems(records: { payments: Payment[]; expenses: Expense[]; cashInflows: CashInflow[] }, students: Student[]): ActivityHistoryItem[] {
  const visibleStudents = new Map(students.map((student) => [student.id, student]));
  const payments = records.payments.flatMap((payment): ActivityHistoryItem[] => {
    const student = visibleStudents.get(payment.currentStudentId || payment.studentId);
    if (!student || student.schoolId !== payment.schoolId) return [];
    return [{ id: `payment-${payment.id}`, type: "payment", title: "Paiement scolaire", actorName: payment.cashierName || "Caissier",
      details: `${student.nom} · ${formatRecordedOperation(payment)} · ${payment.paidAt}`,
      createdAt: normalizeActivityTimestamp(payment.createdAt ?? payment.paidAt) }];
  });
  const expenses = records.expenses.map<ActivityHistoryItem>((expense) => ({ id: `expense-${expense.id}`, type: "expense",
    title: "Dépense de l'établissement", actorName: expense.cashierName || "Caissier",
    details: `${expense.category} · ${formatRecordedOperation(expense)} · ${expense.spentAt}`,
    createdAt: normalizeActivityTimestamp(expense.createdAt ?? expense.spentAt) }));
  const inflows = records.cashInflows.map<ActivityHistoryItem>((inflow) => ({ id: `inflow-${inflow.id}`, type: "activity",
    title: "Autre entrée de caisse de l'établissement", actorName: inflow.cashierName || "Caissier",
    details: `${inflow.category} · ${formatRecordedOperation(inflow)} · ${inflow.entryDate}`,
    createdAt: normalizeActivityTimestamp(inflow.createdAt ?? inflow.entryDate) }));
  return [...payments, ...expenses, ...inflows].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}
