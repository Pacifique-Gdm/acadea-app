import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { CashInflow, Expense, Payment } from "../types";

type FinancialTransaction = Payment | Expense | CashInflow;

export function reconcileFinancialSnapshot<T extends FinancialTransaction>(
  current: T[],
  snapshot: T[],
  scope: { schoolId: string; schoolYearId: string },
) {
  const outsideScope = current.filter(
    (item) => item.schoolId !== scope.schoolId || (item.schoolYearId !== scope.schoolYearId && (!("collectionSchoolYearId" in item) || item.collectionSchoolYearId !== scope.schoolYearId)),
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
  onCashInflows,
  onError,
}: {
  enabled: boolean;
  schoolId: string;
  schoolYearId: string;
  onPayments: (payments: Payment[]) => void;
  onExpenses: (expenses: Expense[]) => void;
  onCashInflows: (cashInflows: CashInflow[]) => void;
  onError?: (error: Error) => void;
}) {
  useEffect(() => {
    if (!enabled || !db || !schoolId || !schoolYearId) return;
    const annualQuery = (name: "payments" | "expenses" | "cashInflows") => query(
      collection(db, name),
      where("schoolId", "==", schoolId),
      where("schoolYearId", "==", schoolYearId),
    );
    let annualPayments: Payment[] = [];
    let collectedArrears: Payment[] = [];
    const emitPayments = () => onPayments([...new Map([...annualPayments, ...collectedArrears].map((item) => [item.id, item])).values()]);
    const unsubscribePayments = onSnapshot(
      annualQuery("payments"),
      (snapshot) => { annualPayments = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Payment); emitPayments(); },
      (error) => onError?.(error),
    );
    const unsubscribeCollectedArrears = onSnapshot(
      query(collection(db, "payments"), where("schoolId", "==", schoolId), where("collectionSchoolYearId", "==", schoolYearId)),
      (snapshot) => { collectedArrears = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Payment); emitPayments(); },
      (error) => onError?.(error),
    );
    const unsubscribeExpenses = onSnapshot(
      annualQuery("expenses"),
      (snapshot) => onExpenses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Expense)),
      (error) => onError?.(error),
    );
    const unsubscribeCashInflows = onSnapshot(
      annualQuery("cashInflows"),
      (snapshot) => onCashInflows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CashInflow)),
      (error) => onError?.(error),
    );
    return () => {
      unsubscribePayments();
      unsubscribeCollectedArrears();
      unsubscribeExpenses();
      unsubscribeCashInflows();
    };
  }, [enabled, onCashInflows, onError, onExpenses, onPayments, schoolId, schoolYearId]);
}
