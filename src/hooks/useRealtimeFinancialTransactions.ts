import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { Expense, Payment } from "../types";

type FinancialTransaction = Payment | Expense;

export function reconcileFinancialSnapshot<T extends FinancialTransaction>(
  current: T[],
  snapshot: T[],
  scope: { schoolId: string; schoolYearId: string },
) {
  const outsideScope = current.filter(
    (item) => item.schoolId !== scope.schoolId || item.schoolYearId !== scope.schoolYearId,
  );
  const snapshotById = new Map(snapshot.map((item) => [item.id, item]));
  return [...outsideScope, ...snapshotById.values()];
}

export function useRealtimeFinancialTransactions({
  enabled,
  schoolId,
  schoolYearId,
  onPayments,
  onExpenses,
  onError,
}: {
  enabled: boolean;
  schoolId: string;
  schoolYearId: string;
  onPayments: (payments: Payment[]) => void;
  onExpenses: (expenses: Expense[]) => void;
  onError?: (error: Error) => void;
}) {
  useEffect(() => {
    if (!enabled || !db || !schoolId || !schoolYearId) return;
    const annualQuery = (name: "payments" | "expenses") => query(
      collection(db, name),
      where("schoolId", "==", schoolId),
      where("schoolYearId", "==", schoolYearId),
    );
    const unsubscribePayments = onSnapshot(
      annualQuery("payments"),
      (snapshot) => onPayments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Payment)),
      (error) => onError?.(error),
    );
    const unsubscribeExpenses = onSnapshot(
      annualQuery("expenses"),
      (snapshot) => onExpenses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Expense)),
      (error) => onError?.(error),
    );
    return () => {
      unsubscribePayments();
      unsubscribeExpenses();
    };
  }, [enabled, onError, onExpenses, onPayments, schoolId, schoolYearId]);
}
