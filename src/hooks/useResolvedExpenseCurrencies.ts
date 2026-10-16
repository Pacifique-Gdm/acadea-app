import { useEffect, useState } from "react";
import type { Expense } from "../types";
import { resolveHistoricalExpenseCurrencies } from "../services/financialTransactions";

export function useResolvedExpenseCurrencies(expenses: Expense[]) {
  return useExpenseCurrencyResolution(expenses).rows;
}

export function useExpenseCurrencyResolution(expenses: Expense[]) {
  const [result, setResult] = useState<{ source: Expense[]; rows: Expense[]; status: "ready" | "error" }>();
  const needsResolution = expenses.some((expense) => !expense.currency && expense.personnelPaymentId);
  useEffect(() => {
    if (!needsResolution) return undefined;
    let cancelled = false;
    void resolveHistoricalExpenseCurrencies(expenses, true)
      .then((rows) => { if (!cancelled) setResult({ source: expenses, rows, status: "ready" }); })
      .catch(() => { if (!cancelled) setResult({ source: expenses, rows: expenses, status: "error" }); });
    return () => { cancelled = true; };
  }, [expenses, needsResolution]);
  if (!needsResolution) return { rows: expenses, status: "ready" as const };
  // A new Firestore snapshot stays unresolved until its linked evidence is rechecked.
  return result?.source === expenses ? { rows: result.rows, status: result.status } : { rows: expenses, status: "loading" as const };
}
